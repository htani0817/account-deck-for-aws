// 拡張機能を読み込んだ Chromium で、自動入力・スイッチロール・ロック・バックアップを通しで確かめる。
// AWS には接続しない: Chromium の --host-resolver-rules で *.signin.aws.amazon.com をローカルの HTTPS サーバーへ向け、
// AWS の画面に似せたページを返す（Playwright の route は、拡張機能が開いたタブの通信を受け止められないため）。
// 自己署名の証明書は openssl でその場で作る（Windows では Git for Windows 同梱の openssl を使う）。
//   npm run e2e
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { launchWithExtension, seedSampleData } from "../scripts/lib/extension.mjs";

const MASTER = "correct horse battery";
let ctx;
let server;
let certDir;

// --- AWS の画面に似せたページ ---

// /console は、本物と同じようにリージョンのサブドメインへリダイレクトさせる（途中のページで値を使い切らないかを見る）
const consolePage = `<!doctype html><title>redirecting</title><script>
  setTimeout(() => location.replace("https://ap-northeast-1.signin.aws.amazon.com/oauth?client_id=test"), 300);
</script>`;

// サインインフォームは React のように表示後に作る。id は付けず、プレースホルダで見分けさせる。
// 本物と同じく、いったん表示した欄を作り直したり（ハイドレーション）、値を空に戻したりして、
// 入れた値が消されても入れ直すかを確かめる
const signinPage = `<!doctype html><title>Sign in</title><div id="root"></div><script>
  const render = () => {
    document.getElementById("root").innerHTML =
      '<form onsubmit="return false">' +
      '<input type="text" placeholder="Account ID (12 digits) or account alias">' +
      '<input type="text" placeholder="IAM username">' +
      '<input type="password" placeholder="Password">' +
      '<button type="submit">Sign in</button></form>';
  };
  setTimeout(render, 600);
  setTimeout(render, 1500); // 欄を丸ごと作り直す
  setTimeout(() => document.querySelectorAll("input").forEach((i) => { i.value = ""; }), 2500); // 値だけ空に戻す
  // 送信されたら、送られた値と回数を title に残す
  let submits = 0;
  document.addEventListener("submit", (e) => {
    e.preventDefault();
    submits += 1;
    document.title = "SUBMITTED" + submits + ":" + [...document.querySelectorAll("form input")].map((i) => i.value).join("|");
  });
</script>`;

// スイッチロール画面: URLパラメータを入力欄に入れてから Switch Role ボタンを出す。押されたら title を変える。
// 最初の描画ではボタンを押しても何も起きない（React が管理を始める前の再現）。1.5 秒後に作り直してから反応する
const switchRolePage = `<!doctype html><title>Switch role</title><div class="switch-roles"></div><script>
  const p = new URLSearchParams(location.search);
  const render = (live) => {
    document.querySelector(".switch-roles").innerHTML =
      '<form><input name="account"><input name="role"><input name="name"><button type="submit">Switch Role</button></form>';
    const [a, r, n] = document.querySelectorAll("input");
    a.value = p.get("account"); r.value = p.get("roleName"); n.value = p.get("displayName");
    document.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (live) document.title = "SWITCHED:" + p.get("roleName");
    });
  };
  setTimeout(() => render(false), 500);
  setTimeout(() => render(true), 1500);
</script>`;

function findOpenssl() {
  const candidates = ["openssl", "C:/Program Files/Git/usr/bin/openssl.exe", "C:/Program Files/Git/mingw64/bin/openssl.exe"];
  for (const c of candidates) {
    try {
      execFileSync(c, ["version"], { stdio: "ignore" });
      return c;
    } catch {
      // 次の候補へ
    }
  }
  throw new Error("openssl が見つかりません");
}

/** AWS の画面に似せたページを返すローカルの HTTPS サーバーを立て、ポート番号を返す */
async function startFakeAws() {
  certDir = await mkdtemp(path.join(os.tmpdir(), "account-deck-cert-"));
  const key = path.join(certDir, "key.pem");
  const cert = path.join(certDir, "cert.pem");
  execFileSync(findOpenssl(), [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-keyout", key, "-out", cert, "-subj", "/CN=signin.aws.amazon.com",
  ], { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  if (!existsSync(cert)) throw new Error("証明書を作れませんでした");

  server = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const body = url.pathname.startsWith("/switchrole")
      ? switchRolePage
      : url.pathname.startsWith("/console")
        ? consolePage
        : signinPage;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

// --- 補助 ---

async function openPage(file, size) {
  const page = await ctx.context.newPage();
  if (size) await page.setViewportSize(size);
  await page.bringToFront();
  await page.goto(`${ctx.base}/${file}`);
  return page;
}

/** 拡張機能のページでは waitForFunction が CSP に止められるので、要素の数を繰り返し数えて待つ */
async function waitForCount(page, selector, count, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await page.$$eval(selector, (els) => els.length)) === count) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`${selector} が ${count} 個になりませんでした`);
}

/** 入力されるのを待ち、偽ページが値を消す時刻（2.5 秒）を過ぎてから戻る（入れ直されたかを見るため） */
async function waitFilledAfterResets(page, selector = 'input[type="password"]') {
  await page.waitForFunction((s) => document.querySelector(s)?.value, selector, { timeout: 15000 });
  await page.waitForTimeout(3500);
}

/** サインインボタンが押されるのを待ち、送信された値（title）を返す */
async function waitSubmitted(page) {
  await page.waitForFunction(() => document.title.startsWith("SUBMITTED"), null, { timeout: 15000 });
  return page.title();
}

async function signinValues(page) {
  await page.waitForSelector('input[type="password"]');
  return page.$$eval("form input", (inputs) => inputs.map((i) => i.value));
}

async function pending() {
  return ctx.worker.evaluate(async () => (await chrome.storage.session.get("pendingLaunches")).pendingLaunches || {});
}

/** ポップアップで行のボタンを押し、開いたタブを返す */
/** ポップアップを開き、種別のタブを選ぶ（ポップアップは最後に選んだタブを覚えているため、毎回選び直す） */
async function openPopup(type = "login") {
  const popup = await openPage("popup.html", { width: 380, height: 560 });
  await popup.waitForSelector(".row, #empty:not([hidden])");
  await popup.click(`[data-type="${type}"]`);
  return popup;
}

async function launchFromPopup(rowName, { type = "login" } = {}) {
  const popup = await openPopup(type);
  const row = popup.locator(".row", { hasText: rowName });
  const [tab] = await Promise.all([ctx.context.waitForEvent("page"), row.locator(".open-btn").click()]);
  return tab;
}

before(async () => {
  const port = await startFakeAws();
  ctx = await launchWithExtension({
    locale: "ja",
    extraArgs: [
      // AWS のサインインのホストは全てローカルの偽サーバーへ向け、それ以外の名前解決は失敗させる
      `--host-resolver-rules=MAP signin.aws.amazon.com 127.0.0.1:${port}, MAP *.signin.aws.amazon.com 127.0.0.1:${port}, MAP * ~NOTFOUND`,
      "--ignore-certificate-errors",
    ],
  });
  const options = await openPage("options.html#environments");
  await seedSampleData(options, { lang: "ja" });
  await options.close();
});

after(async () => {
  if (ctx) {
    await ctx.context.close();
    await rm(ctx.userDataDir, { recursive: true, force: true });
  }
  if (server) server.close();
  if (certDir) await rm(certDir, { recursive: true, force: true });
});

/** 前のテストの状態に左右されないよう、マスターパスワードがあればロックを解いておく */
async function ensureUnlockedForTest(page) {
  await page.evaluate(async (pw) => {
    const state = await getVaultState();
    if (state.locked) await unlockVault(pw);
  }, MASTER);
}

test("開く: リダイレクトや画面の作り直しをはさんでも入力し、サインインボタンを1回だけ押す", async () => {
  const tab = await launchFromPopup("本番環境");
  await tab.waitForURL(/ap-northeast-1\.signin\.aws\.amazon\.com\/oauth/);
  // 欄の作り直し（1.5 秒）と値の消去（2.5 秒）のあとに、正しい値で1回だけ送信される
  assert.equal(await waitSubmitted(tab), "SUBMITTED1:111122223333|ops-admin|sample-password-1");
  await tab.waitForTimeout(3000);
  assert.equal(await tab.title(), "SUBMITTED1:111122223333|ops-admin|sample-password-1", "2回目は押さない");
  // 押した時点で受け渡しの値は消える
  assert.deepEqual(await pending(), {});
  await tab.close();
});

test("パスワードを保存していない環境は、入力するだけで押さない", async () => {
  const tab = await launchFromPopup("検証用サンドボックス");
  await waitFilledAfterResets(tab, '#root input[placeholder="IAM username"]');
  assert.deepEqual(await signinValues(tab), ["123412341234", "sandbox", ""]);
  assert.ok(!(await tab.title()).startsWith("SUBMITTED"));
  await tab.close();
});

test("拡張機能が作っていないタブには値を渡さない", async () => {
  // 先に別のタブ用の値を用意しておき、無関係のタブからは取れないことを見る
  const popupTab = await launchFromPopup("ステージング");
  const stranger = await ctx.context.newPage();
  await stranger.goto("https://ap-northeast-1.signin.aws.amazon.com/oauth?client_id=other");
  await stranger.waitForTimeout(2500);
  assert.deepEqual(await signinValues(stranger), ["", "", ""]);
  assert.ok(!(await stranger.title()).startsWith("SUBMITTED"));
  assert.equal(await waitSubmitted(popupTab), "SUBMITTED1:444455556666|ops-admin|sample-password-2");
  await stranger.close();
  await popupTab.close();
});

test("スイッチロール: 最初に押したのが無視されても、押し直して切り替える", async () => {
  const tab = await launchFromPopup("開発 管理者", { type: "switchRole" });
  await tab.waitForFunction(() => document.title.startsWith("SWITCHED"), null, { timeout: 15000 });
  assert.equal(await tab.title(), "SWITCHED:AdministratorRole");
  const url = new URL(tab.url());
  assert.equal(url.searchParams.get("account"), "777788889999");
  assert.equal(url.searchParams.get("color"), "B7CA9D");
  await tab.close();
});

test("ポップアップ: 検索して Enter で開く", async () => {
  const popup = await openPopup("login");
  await popup.focus("#search");
  await popup.keyboard.type("4444");
  assert.equal(await popup.locator(".row").count(), 1);
  const [tab] = await Promise.all([ctx.context.waitForEvent("page"), popup.keyboard.press("Enter")]);
  await tab.waitForURL(/signin\.aws\.amazon\.com/);
  assert.match(tab.url(), /^https:\/\/444455556666\.signin\.aws\.amazon\.com\/console|ap-northeast-1/);
  await tab.close();
});

test("マスターパスワード: ロック中は解除を求め、正しく入れると開いて入力する", async () => {
  const options = await openPage("options.html#settings");
  await options.evaluate(async (pw) => {
    await setMasterPassword(pw);
    await lockVault();
  }, MASTER);
  await options.close();

  const popup = await openPopup("login");
  await popup.waitForSelector("#lockBtn:not([hidden])");
  await popup.locator(".row", { hasText: "開発環境" }).locator(".open-btn").click();
  await popup.waitForSelector("#unlock:not([hidden])");
  await popup.fill("#unlockInput", "wrong password");
  await popup.click("#unlockSubmit");
  await popup.waitForSelector("#unlockError:not([hidden])");

  await popup.fill("#unlockInput", MASTER);
  const [tab] = await Promise.all([ctx.context.waitForEvent("page"), popup.click("#unlockSubmit")]);
  assert.equal(await waitSubmitted(tab), "SUBMITTED1:777788889999|dev-user|sample-password-3");
  await tab.close();
});

test("バックアップ: ファイル用パスワード付きで書き出し、消してから読み込むと元に戻る", async () => {
  const options = await openPage("options.html#settings", { width: 1100, height: 800 });
  await ensureUnlockedForTest(options);
  await options.click("#exportBtn");
  await options.fill("#exPass1", "file-pass-123");
  await options.fill("#exPass2", "file-pass-123");
  const [download] = await Promise.all([options.waitForEvent("download"), options.click('#exForm button[type="submit"]')]);
  const file = path.join(os.tmpdir(), `account-deck-e2e-${Date.now()}.json`);
  await download.saveAs(file);

  await options.evaluate(() => saveItems([]));
  const [chooser] = await Promise.all([options.waitForEvent("filechooser"), options.click("#importBtn")]);
  await chooser.setFiles(file);
  await options.waitForSelector("#passwordDialog[open]");
  await options.fill("#pwInput", "wrong");
  await options.click("#pwSubmit");
  await options.waitForSelector("#pwError:not([hidden])");
  await options.fill("#pwInput", "file-pass-123");
  await options.click("#pwSubmit");
  // 拡張機能のページは CSP で eval を禁じていて waitForFunction が使えないので、画面の行数を数えて待つ
  await options.goto(`${ctx.base}/options.html#environments`);
  await waitForCount(options, ".env-row", 7);

  const restored = await options.evaluate(async () => {
    const items = await getItems();
    const prod = items.find((i) => i.accountId === "111122223333" && i.type === "login");
    return { count: items.length, password: await decryptItemPassword(prod) };
  });
  assert.deepEqual(restored, { count: 7, password: "sample-password-1" });
  await rm(file, { force: true });
  await options.close();
});

test("管理画面: 削除して「元に戻す」で同じ位置に戻る", async () => {
  const options = await openPage("options.html#environments", { width: 1100, height: 800 });
  const names = () => options.$$eval(".env-name", (els) => els.map((e) => e.textContent));
  await options.waitForSelector(".env-row");
  const before = await names();
  await options.locator(".env-row", { hasText: "ステージング" }).locator(".icon-btn.danger").click();
  await waitForCount(options, ".env-name", before.length - 1);
  assert.ok(!(await names()).includes("ステージング"));
  await options.click("#toast button");
  await waitForCount(options, ".env-name", before.length);
  assert.deepEqual(await names(), before);
  await options.close();
});

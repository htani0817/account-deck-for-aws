// Chrome ウェブストア掲載用の画像を書き出す（render-assets.mjs screenshots から呼ぶ）。
// 1. 拡張機能を読み込んだ Chromium で画面を撮る（store-assets/_work/raw/）
// 2. 見出しと組み合わせて 1280×800 のスクリーンショットと 440×280 のプロモ画像にする（store-assets/<言語>/）
// データは架空のサンプルだけを使い、AWS の画面は写さない。

import { chromium } from "playwright-core";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ROOT, WORK, launchWithExtension, seedSampleData } from "./lib/extension.mjs";

const OUT = path.join(ROOT, "store-assets");
const RAW = path.join(WORK, "raw");
const ENV_COLORS = ["#F2B0A9", "#FBBF93", "#FAD791", "#B7CA9D", "#99BCE3"];

const COPY = {
  ja: {
    s1: ["本番も開発も、<br>色で見分けてワンクリック", "AWS のサインイン先とスイッチロールを一覧にまとめ、ツールバーからすぐに開けます。"],
    s2: ["探して Enter。<br>そのままサインインまで", "アカウントID・ユーザー名・パスワードを入力して、サインインボタンまで押します。"],
    s5: ["スイッチロールも<br>ワンクリック", "切り替え画面の Switch Role ボタンまで押します。ライトとダークは OS の設定に合わせます。"],
    promo: "AWS のアカウントを、色で見分けてワンクリック",
  },
  en: {
    s1: ["Every AWS account,<br>one click away", "Keep your sign-in pages and switch roles in one list and open them from the toolbar."],
    s2: ["Search, press Enter,<br>and you're signed in", "It fills in your account ID, user name and password, then presses Sign in for you."],
    s5: ["Switch roles in one click", "It presses Switch Role for you. Light and dark follow your OS setting."],
    promo: "Every AWS account, color-coded and one click away",
  },
};

const THEMES = {
  light: { bg: "#e9edf1", ink: "#18202b", sub: "#4a5565", frame: "#d5dbe2", shadow: "rgba(16,24,40,.22)" },
  dark: { bg: "#12161c", ink: "#e7ebf0", sub: "#b3bcc8", frame: "#2e3542", shadow: "rgba(0,0,0,.6)" },
};

const FONT = `"Segoe UI Variable Display", "Segoe UI", "Yu Gothic UI", "Hiragino Sans", "Meiryo UI", system-ui, sans-serif`;

async function hideCaret(page) {
  await page.addStyleTag({ content: "*{caret-color:transparent !important}" });
}

/** ポップアップ・管理画面・初回案内を撮る */
async function captureRaw(locale, colorScheme) {
  // 2倍で撮って縮小表示し、文字をくっきりさせる
  const { context, base, userDataDir } = await launchWithExtension({ locale, colorScheme, deviceScaleFactor: 2 });
  const shots = {};
  const shot = (name) => path.join(RAW, `${name}-${locale}-${colorScheme}.png`);

  const options = await context.newPage();
  await options.setViewportSize({ width: 1280, height: 800 });
  await options.bringToFront();
  await options.goto(`${base}/options.html#environments`);
  await seedSampleData(options, { lang: locale });
  // 文言がキー名のまま（getMessage が空文字を返した）なら、壊れた画像を出さないよう止める
  const navText = await options.textContent('.nav a[data-section="environments"]');
  if (navText === "navEnvironments") throw new Error(`${locale}-${colorScheme}: 文言が読み込まれていません`);

  // 初回案内（全面）
  await options.goto(`${base}/options.html#welcome`);
  await options.waitForSelector("#welcome:not([hidden])");
  await hideCaret(options);
  await options.locator("body").click({ position: { x: 5, y: 5 } });
  await options.waitForTimeout(300);
  await options.screenshot({ path: (shots.welcome = shot("welcome")) });

  // 管理画面の一覧（全面）
  await options.goto(`${base}/options.html#environments`);
  await options.waitForSelector(".env-row");
  await options.mouse.move(640, 300);
  await options.waitForTimeout(300);
  await options.screenshot({ path: (shots.options = shot("options")) });
  await options.close();

  // ポップアップ
  const popupShot = async (name, prepare) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 380, height: 600 });
    await page.bringToFront();
    await page.goto(`${base}/popup.html`);
    await page.waitForSelector(".row");
    await hideCaret(page);
    await prepare(page);
    await page.waitForTimeout(250);
    await page.locator("body").screenshot({ path: (shots[name] = shot(name)) });
    await page.close();
  };
  await popupShot("popup", async (p) => {
    await p.click('[data-type="login"]');
    await p.focus("#search");
  });
  await popupShot("popupSearch", async (p) => {
    await p.click('[data-type="login"]');
    await p.focus("#search");
    await p.keyboard.type(locale === "ja" ? "ステージ" : "stag");
  });
  await popupShot("popupRole", async (p) => {
    await p.click('[data-type="switchRole"]');
    await p.focus("#search");
    await p.keyboard.press("ArrowDown");
  });

  await context.close();
  await rm(userDataDir, { recursive: true, force: true });
  return shots;
}

/** about:blank のページから file:// は読めないので、画像は data URI にして埋め込む */
async function dataUrl(file) {
  return `data:image/png;base64,${(await readFile(file)).toString("base64")}`;
}

function stripe() {
  return ENV_COLORS.map((c) => `<span style="background:${c}"></span>`).join("");
}

/** 見出しとポップアップの画面を組み合わせた 1280×800 の台紙 */
// 見出しの改行位置は <br> で決め、説明文は日本語を文節で折り返す（word-break: auto-phrase）
function stageHtml({ title, body, image, theme, lang, popupWidth = 470 }) {
  const t = THEMES[theme];
  return `<!doctype html><html lang="${lang}"><meta charset="utf-8"><style>
    html,body{margin:0;width:1280px;height:800px;overflow:hidden;background:${t.bg};font-family:${FONT}}
    .stripe{position:absolute;left:0;top:0;bottom:0;width:26px;display:grid;grid-template-rows:repeat(5,1fr)}
    .copy{position:absolute;left:112px;top:0;bottom:0;width:520px;display:flex;flex-direction:column;justify-content:center}
    h1{margin:0 0 22px;color:${t.ink};font-size:46px;line-height:1.28;font-weight:700;letter-spacing:.005em}
    h1,p{word-break:auto-phrase}
    p{margin:0;color:${t.sub};font-size:21px;line-height:1.7}
    .shot{position:absolute;right:120px;top:50%;transform:translateY(-50%);width:${popupWidth}px;border-radius:16px;
      border:1px solid ${t.frame};box-shadow:0 30px 70px ${t.shadow},0 4px 14px ${t.shadow};display:block}
  </style>
  <div class="stripe">${stripe()}</div>
  <div class="copy"><h1>${title}</h1><p>${body}</p></div>
  <img class="shot" src="${image}">`;
}

/** 440×280 の小さいプロモーション タイル */
async function promoHtml(locale) {
  const svg = await readFile(path.join(ROOT, "icons-src", "icon.svg"));
  const t = THEMES.dark;
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:440px;height:280px;overflow:hidden;background:${t.bg};font-family:${FONT}}
    .stripe{position:absolute;left:0;top:0;bottom:0;width:14px;display:grid;grid-template-rows:repeat(5,1fr)}
    .wrap{position:absolute;left:46px;right:34px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
    img{width:64px;height:64px;margin:0 0 16px -6px}
    h1{margin:0 0 8px;color:${t.ink};font-size:27px;line-height:1.2;font-weight:700}
    p{margin:0;color:${t.sub};font-size:15px;line-height:1.55}
  </style>
  <div class="stripe">${stripe()}</div>
  <div class="wrap">
    <img src="data:image/svg+xml;base64,${svg.toString("base64")}">
    <h1>Account Deck for AWS</h1>
    <p>${COPY[locale].promo}</p>
  </div>`;
}

export async function renderStoreAssets() {
  await mkdir(RAW, { recursive: true });
  const raw = {};
  for (const locale of ["ja", "en"]) {
    raw[locale] = {
      light: await captureRaw(locale, "light"),
      dark: await captureRaw(locale, "dark"),
    };
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  for (const locale of ["ja", "en"]) {
    const dir = path.join(OUT, locale);
    await mkdir(dir, { recursive: true });
    const c = COPY[locale];
    const r = raw[locale];
    const staged = [
      ["01-popup.png", { title: c.s1[0], body: c.s1[1], image: await dataUrl(r.light.popup), theme: "light" }],
      ["02-search.png", { title: c.s2[0], body: c.s2[1], image: await dataUrl(r.light.popupSearch), theme: "light" }],
      ["05-switch-role.png", { title: c.s5[0], body: c.s5[1], image: await dataUrl(r.dark.popupRole), theme: "dark" }],
    ];
    for (const [name, opts] of staged) {
      await page.setContent(stageHtml({ ...opts, lang: locale }), { waitUntil: "load" });
      await page.screenshot({ path: path.join(dir, name) });
      console.log("screenshot:", path.relative(ROOT, path.join(dir, name)));
    }
    // 管理画面と初回案内は、撮った画面をそのまま使う（1280×800 の画面を2倍で撮ってあるので縮めて貼る）
    for (const [name, src] of [["03-manage.png", r.light.options], ["04-protect.png", r.dark.welcome]]) {
      await page.setContent(`<style>html,body{margin:0}img{display:block;width:1280px;height:800px}</style><img src="${await dataUrl(src)}">`, { waitUntil: "load" });
      await page.screenshot({ path: path.join(dir, name) });
      console.log("screenshot:", path.relative(ROOT, path.join(dir, name)));
    }

    await page.setViewportSize({ width: 440, height: 280 });
    await page.setContent(await promoHtml(locale), { waitUntil: "load" });
    await page.screenshot({ path: path.join(dir, "promo-440x280.png") });
    console.log("promo:", path.relative(ROOT, path.join(dir, "promo-440x280.png")));
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  await browser.close();
}

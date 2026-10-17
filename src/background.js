// バックグラウンド（service worker）。
// - ポップアップからの「開く」を受けてタブを作り、そのタブだけに自動入力の値を渡す
// - 初回インストール時に管理画面の初回案内を開き、v1 からの更新時はデータを移行する
importScripts("lib/storage.js", "lib/vault.js");

const PENDING_KEY = "pendingLaunches";
const PENDING_TTL_MS = 2 * 60 * 1000; // 2分を過ぎた受け渡しは破棄する

// 受け渡しの値（パスワードを含む）は storage.session に置く。メモリ上にだけあり、
// service worker が止まっても消えず、既定ではコンテンツスクリプトから直接は読めない
async function readPending() {
  const r = await chrome.storage.session.get(PENDING_KEY);
  const all = r[PENDING_KEY] || {};
  const now = Date.now();
  const fresh = {};
  for (const [tabId, entry] of Object.entries(all)) {
    if (now - entry.createdAt < PENDING_TTL_MS) fresh[tabId] = entry;
  }
  return fresh;
}

async function writePending(all) {
  await chrome.storage.session.set({ [PENDING_KEY]: all });
}

function isAwsSigninUrl(url) {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      (u.hostname === "signin.aws.amazon.com" || u.hostname.endsWith(".signin.aws.amazon.com"))
    );
  } catch {
    return false;
  }
}

async function handleLaunch(itemId) {
  const items = await getItems();
  const item = items.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: "notFound" };

  const url = launchUrlFor(item);
  if (!isSafeHttpsUrl(url)) return { ok: false, error: "badUrl" };

  let entry;
  if (item.type === "switchRole") {
    entry = { kind: "switch" };
  } else {
    let password = "";
    try {
      password = await decryptItemPassword(item);
    } catch (e) {
      if (e instanceof VaultLockedError) return { ok: false, locked: true };
      return { ok: false, error: "decrypt" };
    }
    entry = {
      kind: "fill",
      accountId: item.accountId || "",
      username: item.username || "",
      password,
    };
  }

  // 受け渡しの値を登録してから AWS のページへ移る（v1 と同じく「値を用意 → 開く」の順にし、
  // ページの読み込みが速くても、コンテンツスクリプトが値を取りに来たときに必ず用意できているようにする）
  const tab = await chrome.tabs.create({ url: "about:blank" });
  const all = await readPending();
  all[String(tab.id)] = { ...entry, createdAt: Date.now() };
  await writePending(all);
  await chrome.tabs.update(tab.id, { url });
  return { ok: true };
}

// コンテンツスクリプトからの要求は、作ったタブ・AWSサインインのページ・トップフレームからだけ受け付ける
function trustedSenderTabId(sender) {
  if (!sender.tab || sender.frameId !== 0) return null;
  if (!isAwsSigninUrl(sender.url || sender.tab.url)) return null;
  return String(sender.tab.id);
}

async function handlePeek(sender, kind) {
  const tabId = trustedSenderTabId(sender);
  if (!tabId) return null;
  const all = await readPending();
  const entry = all[tabId];
  if (!entry || entry.kind !== kind) return null;
  const { createdAt, ...payload } = entry;
  return payload;
}

async function handleDone(sender) {
  const tabId = trustedSenderTabId(sender);
  if (!tabId) return;
  const all = await readPending();
  delete all[tabId];
  await writePending(all);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 拡張機能の外（Webページ）から送られたメッセージは受け付けない
  if (sender.id !== chrome.runtime.id) return false;

  const respond = (promise) => {
    promise.then(sendResponse, () => sendResponse({ ok: false, error: "internal" }));
    return true; // 非同期で応答する
  };

  switch (message && message.type) {
    case "launch":
      // ポップアップ・管理画面（拡張機能のページ）からだけ受け付ける
      if (sender.tab && !String(sender.url || "").startsWith(chrome.runtime.getURL(""))) return false;
      return respond(handleLaunch(message.itemId));
    case "peekPending":
      return respond(handlePeek(sender, message.kind));
    case "pendingDone":
      return respond(handleDone(sender).then(() => ({ ok: true })));
    default:
      return false;
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const all = await readPending();
  if (all[String(tabId)]) {
    delete all[String(tabId)];
    await writePending(all);
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await migrateLegacyData();
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html#welcome") });
  }
});

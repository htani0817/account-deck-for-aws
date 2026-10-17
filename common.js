// popup.js / options.js から共通で使うストレージ操作とURL生成ロジック

const STORAGE_KEY = "awsEnvItems";

/**
 * 登録済みの環境情報一覧を取得する
 * @returns {Promise<Array<Object>>}
 */
function getItems() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
    });
  });
}

/**
 * 環境情報一覧を保存する
 * @param {Array<Object>} items
 * @returns {Promise<void>}
 */
function saveItems(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: items }, () => resolve());
  });
}

function generateId() {
  return (
    "item-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

// --- 設定のエクスポート/インポート ---
const EXPORT_SCHEMA_VERSION = 1;

/**
 * エクスポート用のJSON文字列を組み立てる
 * @param {Array<Object>} items
 * @returns {string}
 */
function buildExportPayload(items) {
  const payload = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    items,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * エクスポートされたJSON文字列を検証し、登録可能な環境情報配列に変換する。
 * 不明なフィールドは取り込まず、必須項目（type/displayName/accountId）を
 * 満たさないエントリは読み飛ばす。IDは衝突を避けるため採番し直す。
 * @param {string} text
 * @returns {Array<Object>}
 */
function parseImportPayload(text) {
  const parsed = JSON.parse(text);
  const rawItems = Array.isArray(parsed) ? parsed : parsed.items;
  if (!Array.isArray(rawItems)) {
    throw new Error("items配列が見つかりません");
  }

  const now = Date.now();
  return rawItems
    .filter(
      (item) =>
        item &&
        (item.type === "login" || item.type === "switchRole") &&
        item.displayName &&
        item.accountId
    )
    .map((item) => ({
      id: generateId(),
      type: item.type,
      displayName: String(item.displayName),
      accountId: String(item.accountId),
      url: item.url ? String(item.url) : "",
      username: item.username ? String(item.username) : "",
      password: item.password ? String(item.password) : "",
      memo: item.memo ? String(item.memo) : "",
      roleName: item.roleName ? String(item.roleName) : "",
      color: item.color ? String(item.color) : "",
      createdAt: typeof item.createdAt === "number" ? item.createdAt : now,
      updatedAt: now,
    }));
}

/**
 * ログイン用URLを新規タブで開く
 * @param {string} url
 */
function openUrlInNewTab(url) {
  chrome.tabs.create({ url });
}

/**
 * スイッチロール用のAWSコンソールURLを組み立てる
 * 前提: 既にAWSマネジメントコンソールへログイン済みであること
 * @param {{accountId: string, roleName: string, displayName: string, color?: string}} item
 * @returns {string}
 */
function buildSwitchRoleUrl(item) {
  const params = new URLSearchParams();
  params.set("account", (item.accountId || "").replace(/-/g, ""));
  params.set("roleName", item.roleName || "");
  params.set("displayName", item.displayName || "");
  if (item.color) {
    params.set("color", item.color.replace(/^#/, ""));
  }
  return `https://signin.aws.amazon.com/switchrole?${params.toString()}`;
}

/**
 * クリップボードへテキストをコピーする
 * @param {string} text
 */
async function copyToClipboard(text) {
  await navigator.clipboard.writeText(text || "");
}

// --- AWSサインイン画面への自動入力用の受け渡しキュー ---
// ポップアップでURLを開いた直後に、アカウントID/ユーザー名/パスワードを一時的にキューへ積んでおき、
// 遷移先のAWSサインインページ(content-fill.js)が先頭（登録が早い順）のエントリを1回だけ取り出して入力する。
// AWSはリージョンサブドメイン（例: ap-southeast-2.signin.aws.amazon.com）へリダイレクトすることがあり、
// 登録URLと実際に開くページのホスト名が一致しない場合があるため、ホスト名はマッチングに使用しない。
const PENDING_FILL_KEY = "pendingFillQueue";
const PENDING_FILL_TTL_MS = 2 * 60 * 1000; // 2分を過ぎたエントリは破棄する

/**
 * 自動入力用のアカウントID/ユーザー名/パスワードをキューに積む
 * @param {{url: string, accountId?: string, username?: string, password?: string}} item
 */
async function queuePendingFill(item) {
  if (!item.accountId && !item.username && !item.password) return;

  const now = Date.now();
  const stored = await chrome.storage.local.get(PENDING_FILL_KEY);
  const queue = Array.isArray(stored[PENDING_FILL_KEY])
    ? stored[PENDING_FILL_KEY]
    : [];
  const freshQueue = queue.filter(
    (entry) => now - entry.createdAt < PENDING_FILL_TTL_MS
  );
  freshQueue.push({
    accountId: item.accountId || "",
    username: item.username || "",
    password: item.password || "",
    createdAt: now,
  });
  await chrome.storage.local.set({ [PENDING_FILL_KEY]: freshQueue });
}

/**
 * キューの先頭（登録が早い）エントリを取り出す（1回限り）。
 * 同時に複数タブを開いた場合は先に開いた方が優先される。
 * @returns {Promise<{accountId: string, username: string, password: string} | null>}
 */
async function consumePendingFill() {
  const now = Date.now();
  const stored = await chrome.storage.local.get(PENDING_FILL_KEY);
  const queue = Array.isArray(stored[PENDING_FILL_KEY])
    ? stored[PENDING_FILL_KEY]
    : [];
  const freshQueue = queue.filter(
    (entry) => now - entry.createdAt < PENDING_FILL_TTL_MS
  );

  if (freshQueue.length === 0) {
    if (freshQueue.length !== queue.length) {
      await chrome.storage.local.set({ [PENDING_FILL_KEY]: freshQueue });
    }
    return null;
  }

  const [matched, ...rest] = freshQueue;
  await chrome.storage.local.set({ [PENDING_FILL_KEY]: rest });
  return {
    accountId: matched.accountId || "",
    username: matched.username,
    password: matched.password,
  };
}

// --- スイッチロール画面での「Switch Role」自動押下用の受け渡しキュー ---
// ポップアップで「スイッチロールで開く」を押した直後だけ積んでおき、
// 遷移先のcontent-switchrole.jsが先頭のエントリを1回だけ取り出してボタンを自動押下する。
const PENDING_SWITCH_KEY = "pendingSwitchRoleQueue";
const PENDING_SWITCH_TTL_MS = 2 * 60 * 1000; // 2分を過ぎたエントリは破棄する

/**
 * スイッチロール自動押下の予約をキューに積む
 */
async function queuePendingSwitchRoleSubmit() {
  const now = Date.now();
  const stored = await chrome.storage.local.get(PENDING_SWITCH_KEY);
  const queue = Array.isArray(stored[PENDING_SWITCH_KEY])
    ? stored[PENDING_SWITCH_KEY]
    : [];
  const freshQueue = queue.filter(
    (entry) => now - entry.createdAt < PENDING_SWITCH_TTL_MS
  );
  freshQueue.push({ createdAt: now });
  await chrome.storage.local.set({ [PENDING_SWITCH_KEY]: freshQueue });
}

/**
 * キューの先頭（登録が早い）予約を取り出す（1回限り）
 * @returns {Promise<boolean>} 予約があった場合はtrue
 */
async function consumePendingSwitchRoleSubmit() {
  const now = Date.now();
  const stored = await chrome.storage.local.get(PENDING_SWITCH_KEY);
  const queue = Array.isArray(stored[PENDING_SWITCH_KEY])
    ? stored[PENDING_SWITCH_KEY]
    : [];
  const freshQueue = queue.filter(
    (entry) => now - entry.createdAt < PENDING_SWITCH_TTL_MS
  );

  if (freshQueue.length === 0) {
    if (freshQueue.length !== queue.length) {
      await chrome.storage.local.set({ [PENDING_SWITCH_KEY]: freshQueue });
    }
    return false;
  }

  const [, ...rest] = freshQueue;
  await chrome.storage.local.set({ [PENDING_SWITCH_KEY]: rest });
  return true;
}


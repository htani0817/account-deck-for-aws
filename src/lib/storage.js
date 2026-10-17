// 登録データの読み書きと、URL生成・入力値の整形など暗号に関係しない共通ロジック。
// ポップアップ・管理画面・バックグラウンドの全てから読み込む（グローバル関数として公開する）。

const STORAGE_KEY = "awsEnvItems";
const SCHEMA_VERSION_KEY = "schemaVersion";
const CURRENT_SCHEMA_VERSION = 2;
const ITEM_TYPES = ["login", "switchRole"];
const LABEL_MAX_LENGTH = 8;

// スイッチロール画面で選べる5色（AWSコンソールの表示色と揃える）
const COLOR_PRESETS = ["#F2B0A9", "#FBBF93", "#FAD791", "#B7CA9D", "#99BCE3"];

/**
 * 登録済みの環境一覧を取得する
 * @returns {Promise<Array<Object>>}
 */
async function getItems() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
}

/**
 * 環境一覧を保存する
 * @param {Array<Object>} items
 */
async function saveItems(items) {
  await chrome.storage.local.set({
    [STORAGE_KEY]: items,
    [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION,
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

// --- 入力値の整形と検証 ---

/**
 * アカウントIDを保存用の形にそろえる。
 * 数字だけなら区切り（ハイフン・空白）を外し、それ以外はアカウントエイリアスとして小文字にする
 */
function normalizeAccountId(value) {
  const v = String(value || "").trim();
  const compact = v.replace(/[\s-]/g, "");
  if (/^\d+$/.test(compact)) return compact;
  return v.toLowerCase();
}

/** 12桁のアカウントID、またはアカウントエイリアス（英小文字・数字・ハイフン 3〜63文字）か */
function isValidAccountId(value) {
  if (/^\d{12}$/.test(value)) return true;
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value) && !/^\d+$/.test(value);
}

/** 表示用に 1234-5678-9012 の形へ区切る（12桁の数字でなければそのまま返す） */
function formatAccountId(value) {
  const id = normalizeAccountId(value);
  if (!/^\d{12}$/.test(id)) return id;
  return `${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8)}`;
}

/** アカウントIDからIAMユーザー用のサインインURLを作る */
function defaultLoginUrl(accountId) {
  const digits = normalizeAccountId(accountId);
  return digits ? `https://${digits}.signin.aws.amazon.com/console` : "";
}

/** https のURLだけを受け付ける（javascript: 等を開かないため） */
function isSafeHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** #RGB / #RRGGBB を #RRGGBB（大文字）にそろえる。不正なら空文字 */
function normalizeColor(value) {
  const v = String(value || "").trim();
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  const full = /^#?([0-9a-f]{6})$/i.exec(v);
  return full ? `#${full[1]}`.toUpperCase() : "";
}

function normalizeLabel(value) {
  return Array.from(String(value || "").trim()).slice(0, LABEL_MAX_LENGTH).join("");
}

/**
 * スイッチロール用のAWSコンソールURLを組み立てる
 * 前提: 既にAWSマネジメントコンソールへログイン済みであること
 * @param {{accountId: string, roleName: string, displayName: string, color?: string}} item
 * @returns {string}
 */
function buildSwitchRoleUrl(item) {
  const params = new URLSearchParams();
  params.set("account", normalizeAccountId(item.accountId));
  params.set("roleName", item.roleName || "");
  params.set("displayName", item.displayName || "");
  if (item.color) {
    params.set("color", item.color.replace(/^#/, ""));
  }
  return `https://signin.aws.amazon.com/switchrole?${params.toString()}`;
}

/** 開く先のURL（ログインは登録URL、スイッチロールは組み立てたURL） */
function launchUrlFor(item) {
  if (item.type === "switchRole") return buildSwitchRoleUrl(item);
  return item.url || defaultLoginUrl(item.accountId);
}

/** 検索語に一致するか（表示名・アカウントID・ロール名・ラベル・ユーザー名・メモ） */
function itemMatches(item, keyword) {
  const kw = String(keyword || "").trim().toLowerCase();
  if (!kw) return true;
  const fields = [item.displayName, item.roleName, item.label, item.username, item.memo];
  if (fields.filter(Boolean).some((v) => String(v).toLowerCase().includes(kw))) {
    return true;
  }
  // アカウントIDはハイフンの有無を問わず照合する
  return normalizeAccountId(item.accountId).includes(normalizeAccountId(kw));
}

/**
 * 外部から来た1件分のデータを、保存できる形に整える。必須項目が欠けていれば null。
 * パスワード関連（password / passwordEnc）はここでは扱わない（vault.js 側で処理する）。
 */
function sanitizeItem(raw, now) {
  if (!raw || !ITEM_TYPES.includes(raw.type)) return null;
  const displayName = String(raw.displayName || "").trim();
  const accountId = normalizeAccountId(raw.accountId);
  if (!displayName || !accountId) return null;
  if (raw.type === "switchRole" && !String(raw.roleName || "").trim()) return null;

  const url = raw.url ? String(raw.url).trim() : "";
  return {
    id: generateId(),
    type: raw.type,
    displayName,
    accountId,
    url: raw.type === "login" && isSafeHttpsUrl(url) ? url : "",
    username: raw.username ? String(raw.username) : "",
    memo: raw.memo ? String(raw.memo) : "",
    roleName: raw.roleName ? String(raw.roleName).trim() : "",
    color: normalizeColor(raw.color),
    label: normalizeLabel(raw.label),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: now,
  };
}

/** 一覧の並び替え: fromId の項目を toId の項目の前（after=true なら後）へ移す */
function moveItemTo(items, fromId, toId, after) {
  const from = items.findIndex((i) => i.id === fromId);
  if (from === -1 || fromId === toId) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  let to = next.findIndex((i) => i.id === toId);
  if (to === -1) return items;
  if (after) to += 1;
  next.splice(to, 0, moved);
  return next;
}

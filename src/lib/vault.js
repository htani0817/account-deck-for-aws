// パスワードの暗号化（AES-GCM-256）と鍵の管理。storage.js の後に読み込む。
//
// 保存するパスワードは必ず暗号化する（Chrome ウェブストアのユーザーデータポリシー）。鍵は2種類ある。
// - device モード: 拡張機能が作ったランダムな鍵を chrome.storage.local に置く。入力の手間はないが、
//   鍵と暗号文が同じ端末にあるので、端末そのものを他人に触られた場合の守りにはならない
// - master モード: マスターパスワードから PBKDF2 で鍵を作る。鍵は端末に保存せず、ロック解除中だけ
//   chrome.storage.session（メモリ上。ブラウザを閉じると消え、既定でコンテンツスクリプトからは読めない）に置く
// 暗号化するのはパスワードだけで、表示名・アカウントID・ユーザー名は平文のまま（ロック中でも一覧を出すため）。

const VAULT_KEY = "vault";
const DEVICE_KEY_KEY = "vaultDeviceKey";
const SESSION_KEY_KEY = "vaultSessionKey";
const PBKDF2_ITERATIONS = 600000;
const VERIFIER_PLAINTEXT = "account-deck:verifier:v1";
const DEFAULT_AUTO_LOCK_MINUTES = 15;
const AUTO_LOCK_CHOICES = [15, 60, 0]; // 0 = ブラウザを閉じるまで
const MASTER_PASSWORD_MIN_LENGTH = 8;
const EXPORT_FORMAT = "account-deck-backup";
const EXPORT_SCHEMA_VERSION = 2;

class VaultLockedError extends Error {
  constructor() {
    super("vault is locked");
    this.name = "VaultLockedError";
  }
}

class WrongPasswordError extends Error {
  constructor() {
    super("wrong password");
    this.name = "WrongPasswordError";
  }
}

// --- 低レベルの暗号処理 ---

function bytesToBase64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function deriveKeyFromPassword(password, salt, iterations) {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

function generateAesKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

async function exportKeyRaw(key) {
  return bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

function importKeyRaw(b64) {
  return crypto.subtle.importKey("raw", base64ToBytes(b64), { name: "AES-GCM" }, true, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptText(key, text) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(text)
  );
  return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

async function decryptText(key, blob) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(blob.iv) },
    key,
    base64ToBytes(blob.ct)
  );
  return new TextDecoder().decode(pt);
}

/** 検証用の暗号文が復号できるか（＝パスワードが正しいか） */
async function verifierMatches(key, verifier) {
  try {
    return (await decryptText(key, verifier)) === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

// ファイルから読んだ反復回数は、極端な値で固まったり弱くなったりしないよう範囲に収める
function clampIterations(value) {
  const n = Number(value) || PBKDF2_ITERATIONS;
  return Math.min(Math.max(n, 100000), 5000000);
}

// --- 鍵の状態 ---

async function getVaultMeta() {
  const r = await chrome.storage.local.get(VAULT_KEY);
  return r[VAULT_KEY] || null;
}

function autoLockMinutesOf(meta) {
  const m = meta && meta.autoLockMinutes;
  return AUTO_LOCK_CHOICES.includes(m) ? m : DEFAULT_AUTO_LOCK_MINUTES;
}

async function createDeviceVault(autoLockMinutes) {
  const key = await generateAesKey();
  const meta = { version: 1, mode: "device", autoLockMinutes };
  await chrome.storage.local.set({
    [VAULT_KEY]: meta,
    [DEVICE_KEY_KEY]: await exportKeyRaw(key),
  });
  return meta;
}

/** 鍵の設定がまだ無ければ device モードで作る */
async function ensureVault() {
  const meta = await getVaultMeta();
  return meta || createDeviceVault(DEFAULT_AUTO_LOCK_MINUTES);
}

async function storeSessionKey(key, minutes) {
  await chrome.storage.session.set({
    [SESSION_KEY_KEY]: {
      raw: await exportKeyRaw(key),
      expiresAt: minutes > 0 ? Date.now() + minutes * 60000 : null,
    },
  });
}

async function readSessionEntry() {
  const r = await chrome.storage.session.get(SESSION_KEY_KEY);
  const entry = r[SESSION_KEY_KEY];
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    await chrome.storage.session.remove(SESSION_KEY_KEY);
    return null;
  }
  return entry;
}

/** 今使える鍵を返す。master モードでロック中なら null。使うたびに自動ロックの期限を延ばす */
async function getActiveKey() {
  const meta = await getVaultMeta();
  if (!meta) return null;
  if (meta.mode === "device") {
    const r = await chrome.storage.local.get(DEVICE_KEY_KEY);
    return r[DEVICE_KEY_KEY] ? importKeyRaw(r[DEVICE_KEY_KEY]) : null;
  }
  const entry = await readSessionEntry();
  if (!entry) return null;
  const key = await importKeyRaw(entry.raw);
  await storeSessionKey(key, autoLockMinutesOf(meta));
  return key;
}

async function requireKey() {
  await ensureVault();
  const key = await getActiveKey();
  if (!key) throw new VaultLockedError();
  return key;
}

/** @returns {Promise<{mode: "none"|"device"|"master", locked: boolean, autoLockMinutes: number}>} */
async function getVaultState() {
  const meta = await getVaultMeta();
  if (!meta) return { mode: "none", locked: false, autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES };
  const locked = meta.mode === "master" ? !(await readSessionEntry()) : false;
  return { mode: meta.mode, locked, autoLockMinutes: autoLockMinutesOf(meta) };
}

/** @returns {Promise<boolean>} パスワードが正しければ true */
async function unlockVault(password) {
  const meta = await getVaultMeta();
  if (!meta || meta.mode !== "master") return true;
  const key = await deriveKeyFromPassword(
    password,
    base64ToBytes(meta.salt),
    clampIterations(meta.iterations)
  );
  if (!(await verifierMatches(key, meta.verifier))) return false;
  await storeSessionKey(key, autoLockMinutesOf(meta));
  return true;
}

async function lockVault() {
  await chrome.storage.session.remove(SESSION_KEY_KEY);
}

async function setAutoLockMinutes(minutes) {
  const meta = await ensureVault();
  const next = { ...meta, autoLockMinutes: AUTO_LOCK_CHOICES.includes(minutes) ? minutes : DEFAULT_AUTO_LOCK_MINUTES };
  await chrome.storage.local.set({ [VAULT_KEY]: next });
  const entry = await readSessionEntry();
  if (entry) await storeSessionKey(await importKeyRaw(entry.raw), next.autoLockMinutes);
}

// --- 鍵の切り替え ---

async function reencryptItems(items, oldKey, newKey) {
  const next = [];
  for (const item of items) {
    if (item.passwordEnc) {
      const plain = await decryptText(oldKey, item.passwordEnc);
      next.push({ ...item, passwordEnc: await encryptText(newKey, plain) });
    } else {
      next.push(item);
    }
  }
  return next;
}

/** マスターパスワードを設定する（device → master）／変更する（master → master）。要ロック解除 */
async function setMasterPassword(newPassword) {
  if (String(newPassword).length < MASTER_PASSWORD_MIN_LENGTH) {
    throw new Error("master password too short");
  }
  const meta = await ensureVault();
  const oldKey = await requireKey();
  const salt = randomBytes(16);
  const newKey = await deriveKeyFromPassword(newPassword, salt, PBKDF2_ITERATIONS);
  const items = await reencryptItems(await getItems(), oldKey, newKey);
  const nextMeta = {
    version: 1,
    mode: "master",
    salt: bytesToBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    verifier: await encryptText(newKey, VERIFIER_PLAINTEXT),
    autoLockMinutes: autoLockMinutesOf(meta),
  };
  // 暗号文と鍵の情報は1回の set でまとめて書き、途中で止まっても食い違わないようにする
  await chrome.storage.local.set({
    [STORAGE_KEY]: items,
    [VAULT_KEY]: nextMeta,
    [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION,
  });
  await chrome.storage.local.remove(DEVICE_KEY_KEY);
  await storeSessionKey(newKey, nextMeta.autoLockMinutes);
}

/** マスターパスワードをやめて device モードに戻す。要ロック解除 */
async function removeMasterPassword() {
  const meta = await getVaultMeta();
  if (!meta || meta.mode !== "master") return;
  const oldKey = await requireKey();
  const newKey = await generateAesKey();
  const items = await reencryptItems(await getItems(), oldKey, newKey);
  await chrome.storage.local.set({
    [STORAGE_KEY]: items,
    [VAULT_KEY]: { version: 1, mode: "device", autoLockMinutes: autoLockMinutesOf(meta) },
    [DEVICE_KEY_KEY]: await exportKeyRaw(newKey),
    [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION,
  });
  await lockVault();
}

/**
 * マスターパスワードを忘れたとき: 保存したパスワードだけを消し、device モードで作り直す。
 * @returns {Promise<number>} パスワードを消した件数
 */
async function resetForgottenMasterPassword() {
  const meta = await getVaultMeta();
  const items = await getItems();
  let removed = 0;
  const next = items.map((item) => {
    if (!item.passwordEnc) return item;
    removed += 1;
    const { passwordEnc, ...rest } = item;
    return rest;
  });
  await saveItems(next);
  await lockVault();
  await createDeviceVault(autoLockMinutesOf(meta));
  return removed;
}

// --- 項目ごとのパスワード ---

async function encryptPassword(plain) {
  return encryptText(await requireKey(), plain);
}

/** 保存済みパスワードを復号する。無ければ空文字。ロック中なら VaultLockedError */
async function decryptItemPassword(item) {
  if (!item || !item.passwordEnc) return "";
  const key = await getActiveKey();
  if (!key) throw new VaultLockedError();
  return decryptText(key, item.passwordEnc);
}

function itemHasPassword(item) {
  return Boolean(item && item.passwordEnc);
}

/**
 * 旧版（AWS環境ランチャー。平文の password を保存していた）からの移行。平文を暗号化して消し、古い受け渡しキューも消す。
 * @returns {Promise<number>} 暗号化した件数
 */
async function migrateLegacyData() {
  await chrome.storage.local.remove(["pendingFillQueue", "pendingSwitchRoleQueue"]);
  const items = await getItems();
  if (!items.some((i) => Object.prototype.hasOwnProperty.call(i, "password"))) return 0;

  await ensureVault();
  const key = await getActiveKey();
  if (!key) return 0; // master モードでロック中。解除後にもう一度呼ばれる
  let migrated = 0;
  const next = [];
  for (const item of items) {
    const { password, ...rest } = item;
    if (typeof password === "string" && password) {
      rest.passwordEnc = await encryptText(key, password);
      migrated += 1;
    }
    if (!rest.color) rest.color = "";
    if (!rest.label) rest.label = "";
    next.push(rest);
  }
  await saveItems(next);
  return migrated;
}

// --- バックアップ（エクスポート / インポート） ---

/**
 * バックアップ用のJSON文字列を作る。
 * filePassword を渡すと、パスワードをそのファイル専用の鍵で暗号化して含める（端末の鍵は別の端末で使えないため）。
 * null ならパスワードは含めない。
 */
async function buildExportPayload(items, filePassword) {
  let protection = null;
  let fileKey = null;
  let key = null;
  if (filePassword) {
    key = await requireKey();
    const salt = randomBytes(16);
    fileKey = await deriveKeyFromPassword(filePassword, salt, PBKDF2_ITERATIONS);
    protection = {
      kdf: "PBKDF2-SHA256",
      cipher: "AES-GCM-256",
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      verifier: await encryptText(fileKey, VERIFIER_PLAINTEXT),
    };
  }

  const exported = [];
  for (const item of items) {
    const { id, passwordEnc, password, ...rest } = item;
    const out = { ...rest };
    if (fileKey && passwordEnc) {
      out.passwordEnc = await encryptText(fileKey, await decryptText(key, passwordEnc));
    }
    exported.push(out);
  }

  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      protection,
      items: exported,
    },
    null,
    2
  );
}

/**
 * バックアップファイルを読み、取り込める項目を調べる（旧版の平文形式・現行の形式の両方に対応）。
 * 不明なフィールドは取り込まず、必須項目を満たさない項目は読み飛ばす。IDは採番し直す。
 */
function inspectImportPayload(text) {
  const parsed = JSON.parse(text);
  const rawItems = Array.isArray(parsed) ? parsed : parsed && parsed.items;
  if (!Array.isArray(rawItems)) throw new Error("items array not found");

  const p = !Array.isArray(parsed) && parsed.protection;
  const protection = p && p.salt && p.verifier ? p : null;
  const now = Date.now();
  const entries = [];
  for (const raw of rawItems) {
    const item = sanitizeItem(raw, now);
    if (!item) continue;
    const enc = raw.passwordEnc;
    entries.push({
      item,
      plainPassword: typeof raw.password === "string" ? raw.password : "",
      encPassword: protection && enc && enc.iv && enc.ct ? { iv: String(enc.iv), ct: String(enc.ct) } : null,
    });
  }
  return {
    entries,
    protection,
    needsFilePassword: entries.some((e) => e.encPassword),
    hasPasswords: entries.some((e) => e.plainPassword || e.encPassword),
  };
}

/**
 * 調べた結果を、今の鍵で暗号化し直した保存用の項目にする。
 * ファイル用パスワードが違えば WrongPasswordError、ロック中なら VaultLockedError。
 */
async function finalizeImport(inspected, filePassword) {
  let fileKey = null;
  if (inspected.needsFilePassword) {
    const p = inspected.protection;
    fileKey = await deriveKeyFromPassword(
      String(filePassword || ""),
      base64ToBytes(p.salt),
      clampIterations(p.iterations)
    );
    if (!(await verifierMatches(fileKey, p.verifier))) throw new WrongPasswordError();
  }
  const key = inspected.hasPasswords ? await requireKey() : null;

  const out = [];
  for (const { item, plainPassword, encPassword } of inspected.entries) {
    let plain = plainPassword;
    if (encPassword) plain = await decryptText(fileKey, encPassword);
    out.push(plain ? { ...item, passwordEnc: await encryptText(key, plain) } : item);
  }
  return out;
}

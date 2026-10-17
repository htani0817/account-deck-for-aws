import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLib } from "./helpers.mjs";

async function addLoginItem(get, password) {
  const item = {
    id: get("generateId")(),
    type: "login",
    displayName: "本番",
    accountId: "123456789012",
    username: "ops",
    passwordEnc: await get("encryptPassword")(password),
  };
  await get("saveItems")([item]);
  return item;
}

async function firstPassword(get) {
  const [item] = await get("getItems")();
  return get("decryptItemPassword")(item);
}

test("device モード: 何もしなくても暗号化して保存し、復号できる", async () => {
  const { get, chrome } = loadLib();
  await addLoginItem(get, "p@ssw0rd!");
  const stored = chrome.storage.local.dump();
  assert.equal(stored.vault.mode, "device");
  assert.ok(stored.vaultDeviceKey);
  assert.ok(!JSON.stringify(stored.awsEnvItems).includes("p@ssw0rd!"), "平文が保存されていない");
  assert.equal(await firstPassword(get), "p@ssw0rd!");
  assert.equal((await get("getVaultState")()).locked, false);
});

test("master モード: 設定・ロック・解除・変更・やめるの間でパスワードが失われない", async () => {
  const { get, chrome } = loadLib();
  const VaultLockedError = get("VaultLockedError");
  await addLoginItem(get, "secret-1");

  await get("setMasterPassword")("correct horse");
  let stored = chrome.storage.local.dump();
  assert.equal(stored.vault.mode, "master");
  assert.equal(stored.vaultDeviceKey, undefined, "端末の鍵は消える");
  assert.equal(await firstPassword(get), "secret-1");

  await get("lockVault")();
  assert.equal((await get("getVaultState")()).locked, true);
  await assert.rejects(firstPassword(get), (e) => e instanceof VaultLockedError);

  assert.equal(await get("unlockVault")("wrong password"), false);
  assert.equal(await get("unlockVault")("correct horse"), true);
  assert.equal(await firstPassword(get), "secret-1");

  await get("setMasterPassword")("battery staple");
  await get("lockVault")();
  assert.equal(await get("unlockVault")("correct horse"), false, "古いマスターパスワードは使えない");
  assert.equal(await get("unlockVault")("battery staple"), true);
  assert.equal(await firstPassword(get), "secret-1");

  await get("removeMasterPassword")();
  stored = chrome.storage.local.dump();
  assert.equal(stored.vault.mode, "device");
  assert.equal((await get("getVaultState")()).locked, false);
  assert.equal(await firstPassword(get), "secret-1");
});

test("マスターパスワードは8文字未満を受け付けない", async () => {
  const { get } = loadLib();
  await assert.rejects(get("setMasterPassword")("short"));
});

test("自動ロックの期限を過ぎるとロックされる", async () => {
  const { get, chrome } = loadLib();
  await addLoginItem(get, "secret");
  await get("setMasterPassword")("correct horse");
  const { vaultSessionKey } = await chrome.storage.session.get("vaultSessionKey");
  await chrome.storage.session.set({ vaultSessionKey: { ...vaultSessionKey, expiresAt: Date.now() - 1 } });
  assert.equal((await get("getVaultState")()).locked, true);
  assert.equal((await chrome.storage.session.get("vaultSessionKey")).vaultSessionKey, undefined, "期限切れの鍵は消える");
});

test("「ブラウザを閉じるまで」は期限を持たない", async () => {
  const { get, chrome } = loadLib();
  await get("setAutoLockMinutes")(0);
  await get("setMasterPassword")("correct horse");
  const { vaultSessionKey } = await chrome.storage.session.get("vaultSessionKey");
  assert.equal(vaultSessionKey.expiresAt, null);
});

test("マスターパスワードを忘れたら、パスワードだけ消して作り直せる", async () => {
  const { get, chrome } = loadLib();
  await addLoginItem(get, "secret");
  await get("setMasterPassword")("correct horse");
  await get("lockVault")();
  assert.equal(await get("resetForgottenMasterPassword")(), 1);
  const [item] = await get("getItems")();
  assert.equal(item.passwordEnc, undefined);
  assert.equal(item.username, "ops");
  assert.equal(chrome.storage.local.dump().vault.mode, "device");
});

test("v1 の平文パスワードを暗号化して移行し、古い受け渡しキューを消す", async () => {
  const { get, chrome } = loadLib();
  await chrome.storage.local.set({
    awsEnvItems: [
      { id: "item-1", type: "login", displayName: "本番", accountId: "123456789012", url: "https://123456789012.signin.aws.amazon.com/console", username: "ops", password: "legacy-secret", memo: "" },
      { id: "item-2", type: "switchRole", displayName: "dev", accountId: "210987654321", roleName: "Admin", color: "#f2b0a9" },
    ],
    pendingFillQueue: [{ password: "legacy-secret", createdAt: 1 }],
    pendingSwitchRoleQueue: [{ createdAt: 1 }],
  });
  assert.equal(await get("migrateLegacyData")(), 1);
  const stored = chrome.storage.local.dump();
  assert.ok(!JSON.stringify(stored).includes("legacy-secret"), "平文がどこにも残っていない");
  assert.equal(stored.pendingFillQueue, undefined);
  assert.equal(stored.pendingSwitchRoleQueue, undefined);
  assert.equal(await firstPassword(get), "legacy-secret");
  assert.equal(await get("migrateLegacyData")(), 0, "2回目は何もしない");
});

test("バックアップ: ファイル用パスワード付きで書き出し、別の環境で読み込める", async () => {
  const a = loadLib();
  await addLoginItem(a.get, "secret-a");
  await a.get("setMasterPassword")("master of a");
  const json = await a.get("buildExportPayload")(await a.get("getItems")(), "file password");
  assert.ok(!json.includes("secret-a"));
  const parsed = JSON.parse(json);
  assert.equal(parsed.format, "account-deck-backup");
  assert.equal(parsed.items[0].id, undefined, "ID は書き出さない");

  const b = loadLib();
  const inspected = b.get("inspectImportPayload")(json);
  assert.equal(inspected.needsFilePassword, true);
  await assert.rejects(b.get("finalizeImport")(inspected, "wrong"), (e) => e instanceof b.get("WrongPasswordError"));
  const imported = await b.get("finalizeImport")(inspected, "file password");
  await b.get("saveItems")(imported);
  assert.equal(await firstPassword(b.get), "secret-a");
});

test("バックアップ: パスワードを含めない書き出し", async () => {
  const { get } = loadLib();
  await addLoginItem(get, "secret");
  const json = await get("buildExportPayload")(await get("getItems")(), null);
  const parsed = JSON.parse(json);
  assert.equal(parsed.protection, null);
  assert.equal(parsed.items[0].passwordEnc, undefined);
  assert.equal(parsed.items[0].username, "ops");
});

test("バックアップ: v1 の平文ファイルを読み込むと暗号化して保存する", async () => {
  const { get, chrome } = loadLib();
  const v1 = JSON.stringify({
    schemaVersion: 1,
    exportedAt: "2026-01-01T00:00:00.000Z",
    items: [
      { id: "item-x", type: "login", displayName: "本番", accountId: "123456789012", url: "https://123456789012.signin.aws.amazon.com/console", username: "ops", password: "v1-secret" },
      { id: "item-y", type: "login", displayName: "", accountId: "1" },
    ],
  });
  const inspected = get("inspectImportPayload")(v1);
  assert.equal(inspected.entries.length, 1, "必須項目が欠けた項目は読み飛ばす");
  assert.equal(inspected.needsFilePassword, false);
  const imported = await get("finalizeImport")(inspected, null);
  assert.notEqual(imported[0].id, "item-x", "ID は採番し直す");
  await get("saveItems")(imported);
  assert.ok(!JSON.stringify(chrome.storage.local.dump()).includes("v1-secret"));
  assert.equal(await firstPassword(get), "v1-secret");
});

test("壊れたファイルは読み込まない", () => {
  const { get } = loadLib();
  assert.throws(() => get("inspectImportPayload")("not json"));
  assert.throws(() => get("inspectImportPayload")(JSON.stringify({ foo: 1 })));
});

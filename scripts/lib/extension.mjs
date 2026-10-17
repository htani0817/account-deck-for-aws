// 画像の書き出しと E2E 確認で共通の部品: 拡張機能を読み込んだ Chromium の起動と、サンプルデータの登録。
// Chrome 正式版は --load-extension を受け付けないので、Playwright の Chromium を使う
// （事前に `npm install` と `npx playwright-core install chromium`）。

import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SRC = path.join(ROOT, "src");
export const WORK = path.join(ROOT, "store-assets", "_work");

// 画面写真と確認に使う架空のデータ（実在のアカウントIDではない）
export const SAMPLE_ITEMS = [
  { type: "login", displayName: "本番環境", displayNameEn: "Production", accountId: "111122223333", label: "PROD", labelJa: "本番", color: "#F2B0A9", username: "ops-admin", password: "sample-password-1" },
  { type: "login", displayName: "ステージング", displayNameEn: "Staging", accountId: "444455556666", label: "STG", color: "#FAD791", username: "ops-admin", password: "sample-password-2" },
  { type: "login", displayName: "開発環境", displayNameEn: "Development", accountId: "777788889999", label: "DEV", color: "#B7CA9D", username: "dev-user", password: "sample-password-3" },
  { type: "login", displayName: "検証用サンドボックス", displayNameEn: "Sandbox", accountId: "123412341234", label: "", color: "#99BCE3", username: "sandbox" },
  { type: "switchRole", displayName: "本番 読み取り専用", displayNameEn: "Prod read-only", accountId: "111122223333", label: "PROD", labelJa: "本番", color: "#F2B0A9", roleName: "ReadOnlyAccess" },
  { type: "switchRole", displayName: "ログ集約アカウント", displayNameEn: "Log archive", accountId: "222233334444", label: "LOG", color: "#99BCE3", roleName: "LogReader" },
  { type: "switchRole", displayName: "開発 管理者", displayNameEn: "Dev admin", accountId: "777788889999", label: "DEV", color: "#B7CA9D", roleName: "AdministratorRole" },
];

/** 拡張機能を読み込んだ Chromium を起動し、拡張機能のIDを返す */
export async function launchWithExtension({ locale = "ja", colorScheme = "light", extraArgs = [] } = {}) {
  const userDataDir = path.join(os.tmpdir(), `account-deck-profile-${process.pid}-${Date.now()}`);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    locale,
    colorScheme,
    args: [
      "--headless=new",
      `--disable-extensions-except=${SRC}`,
      `--load-extension=${SRC}`,
      `--lang=${locale}`,
      ...extraArgs,
    ],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  // 初回インストールで開く案内のタブは少し遅れて開くので、開くのを待ってから閉じる
  // （残すと撮影中に前面を奪い、ほかのタブの描画が止まって撮影がタイムアウトする）
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const welcome = context.pages().find((p) => p.url().includes("options.html"));
    if (welcome) {
      await welcome.close();
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { context, worker, extensionId, userDataDir, base: `chrome-extension://${extensionId}` };
}

/** 拡張機能のページの中で lib の関数を使って、サンプルデータを登録する */
export async function seedSampleData(page, { lang = "ja", master = null } = {}) {
  await page.evaluate(
    async ({ samples, lang, master }) => {
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();
      await ensureVault();
      const now = Date.now();
      const items = [];
      for (const s of samples) {
        const item = {
          id: generateId(),
          type: s.type,
          displayName: lang === "ja" ? s.displayName : s.displayNameEn,
          accountId: s.accountId,
          label: lang === "ja" && s.labelJa ? s.labelJa : s.label,
          color: s.color,
          memo: "",
          createdAt: now,
          updatedAt: now,
        };
        if (s.type === "login") {
          item.url = "";
          item.username = s.username;
          if (s.password) item.passwordEnc = await encryptPassword(s.password);
        } else {
          item.roleName = s.roleName;
        }
        items.push(item);
      }
      await saveItems(items);
      await chrome.storage.local.set({ onboardingDone: true });
      if (master) await setMasterPassword(master);
    },
    { samples: SAMPLE_ITEMS, lang, master }
  );
}

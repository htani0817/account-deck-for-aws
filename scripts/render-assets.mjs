// アイコン PNG・確認用の画面写真・ストア掲載用の画像を書き出す。
//   node scripts/render-assets.mjs icons        … icons-src/icon.svg → src/icons/icon{16,32,48,128}.png
//   node scripts/render-assets.mjs review       … 拡張機能を読み込み、画面を撮って store-assets/_work/review/ に保存
//   node scripts/render-assets.mjs screenshots  … ストア用のスクリーンショット（1280×800）とプロモ画像（440×280）
// 拡張機能の読み込みには Playwright の Chromium を使う（Chrome 正式版は --load-extension を受け付けないため）。
// 事前に `npm install` と `npx playwright-core install chromium` を実行しておく。

import { chromium } from "playwright-core";
import { mkdir, readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { ROOT, SRC, WORK, launchWithExtension, seedSampleData } from "./lib/extension.mjs";

async function renderIcons() {
  const svg = await readFile(path.join(ROOT, "icons-src", "icon.svg"), "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style>` +
        `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}">`
    );
    const out = path.join(SRC, "icons", `icon${size}.png`);
    await page.screenshot({ path: out, omitBackground: true });
    console.log("icon:", path.relative(ROOT, out));
  }
  await browser.close();
}

async function review() {
  const outDir = path.join(WORK, "review");
  await mkdir(outDir, { recursive: true });
  for (const colorScheme of ["light", "dark"]) {
    for (const locale of ["ja", "en"]) {
      const { context, extensionId, userDataDir } = await launchWithExtension({ locale, colorScheme });
      const base = `chrome-extension://${extensionId}`;
      const tag = `${locale}-${colorScheme}`;
      const errors = [];

      const options = await context.newPage();
      options.on("pageerror", (e) => errors.push(`options: ${e.message}`));
      options.on("console", (m) => m.type() === "error" && errors.push(`options console: ${m.text()}`));
      await options.setViewportSize({ width: 1100, height: 760 });
      await options.bringToFront();
      await options.goto(`${base}/options.html#welcome`);
      await options.waitForTimeout(400);
      await options.screenshot({ path: path.join(outDir, `welcome-${tag}.png`) });

      await seedSampleData(options, { lang: locale });
      await options.goto(`${base}/options.html#environments`);
      await options.waitForTimeout(300);
      await options.screenshot({ path: path.join(outDir, `options-${tag}.png`), fullPage: true });

      await options.click("#addBtn");
      await options.waitForTimeout(300);
      await options.screenshot({ path: path.join(outDir, `dialog-${tag}.png`) });
      await options.keyboard.press("Escape");

      await options.goto(`${base}/options.html#settings`);
      await options.waitForTimeout(300);
      await options.screenshot({ path: path.join(outDir, `settings-${tag}.png`), fullPage: true });

      const popup = await context.newPage();
      popup.on("pageerror", (e) => errors.push(`popup: ${e.message}`));
      popup.on("console", (m) => m.type() === "error" && errors.push(`popup console: ${m.text()}`));
      await popup.setViewportSize({ width: 380, height: 520 });
      await popup.bringToFront();
      await popup.goto(`${base}/popup.html`);
      await popup.waitForTimeout(300);
      await popup.keyboard.press("ArrowDown");
      await popup.screenshot({ path: path.join(outDir, `popup-${tag}.png`) });
      await popup.click('[data-type="switchRole"]');
      await popup.waitForTimeout(150);
      await popup.screenshot({ path: path.join(outDir, `popup-role-${tag}.png`) });

      console.log(`${tag}: ${errors.length ? errors.join("\n  ") : "エラーなし"}`);
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  }
  console.log("saved:", path.relative(ROOT, outDir));
}

const mode = process.argv[2];
if (mode === "icons") await renderIcons();
else if (mode === "review") await review();
else if (mode === "screenshots") {
  const { renderStoreAssets } = await import(pathToFileURL(path.join(ROOT, "scripts", "store-assets.mjs")).href);
  await renderStoreAssets();
} else {
  console.error("使い方: node scripts/render-assets.mjs <icons|review|screenshots>");
  process.exitCode = 1;
}


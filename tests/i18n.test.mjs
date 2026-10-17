// 画面とスクリプトが使う文言キーが、英語・日本語の両方にそろっているか
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { SRC } from "./helpers.mjs";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const locales = Object.fromEntries(
  ["en", "ja"].map((l) => [l, JSON.parse(readFileSync(path.join(SRC, "_locales", l, "messages.json"), "utf8"))])
);

function usedKeys() {
  const keys = new Set();
  for (const file of walk(SRC)) {
    if (!/\.(html|js|json)$/.test(file) || file.includes("_locales")) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)) keys.add(m[1]);
    for (const m of text.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of m[1].split(";")) {
        const key = (pair.split(":")[1] || "").trim();
        if (/^[A-Za-z0-9_]+$/.test(key)) keys.add(key);
      }
    }
    for (const m of text.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) keys.add(m[1]);
    for (const m of text.matchAll(/accountDeckToast\(\s*"([A-Za-z0-9_]+)"/g)) keys.add(m[1]);
    for (const m of text.matchAll(/finish\(\s*"([A-Za-z0-9_]+)"/g)) keys.add(m[1]);
    for (const m of text.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) keys.add(m[1]);
    // t(条件 ? "a" : "b") のような書き方も拾う
    for (const m of text.matchAll(/t\([^)]*?\?\s*"([A-Za-z0-9_]+)"\s*:\s*"([A-Za-z0-9_]+)"/g)) {
      keys.add(m[1]);
      keys.add(m[2]);
    }
  }
  return keys;
}

test("使っている文言キーが en と ja の両方にある", () => {
  const missing = [];
  for (const key of usedKeys()) {
    for (const [lang, messages] of Object.entries(locales)) {
      if (!messages[key]) missing.push(`${lang}:${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("en と ja のキーが一致している", () => {
  const en = Object.keys(locales.en).sort();
  const ja = Object.keys(locales.ja).sort();
  assert.deepEqual(
    en.filter((k) => !ja.includes(k)).concat(ja.filter((k) => !en.includes(k))),
    []
  );
});

test("ストアの説明文は132文字以内", () => {
  for (const messages of Object.values(locales)) {
    assert.ok(messages.extDescription.message.length <= 132, messages.extDescription.message.length);
    assert.ok(messages.extName.message.length <= 75);
  }
});

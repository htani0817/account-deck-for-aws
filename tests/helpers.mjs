// テスト用: lib/*.js を vm の中に読み込み、chrome.storage をメモリ上の偽物に差し替える
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SRC = path.join(ROOT, "src");

function makeArea() {
  let data = {};
  return {
    async get(keys) {
      if (keys === null || keys === undefined) return structuredClone(data);
      const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) data[k] = structuredClone(v);
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete data[k];
    },
    async clear() {
      data = {};
    },
    dump: () => structuredClone(data),
  };
}

/** lib/storage.js と lib/vault.js を読み込んだ新しい環境を作る */
export function loadLib() {
  const chrome = { storage: { local: makeArea(), session: makeArea() } };
  const context = vm.createContext({
    chrome,
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    URL,
    URLSearchParams,
    console,
    structuredClone,
  });
  for (const file of ["lib/storage.js", "lib/vault.js"]) {
    vm.runInContext(readFileSync(path.join(SRC, file), "utf8"), context, { filename: file });
  }
  // const / class で宣言したものは context のプロパティにならないので、名前で取り出す
  const get = (name) => vm.runInContext(name, context);
  return { chrome, get };
}

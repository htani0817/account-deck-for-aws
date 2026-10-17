// 画面の文言を _locales/<言語>/messages.json から差し込む。
// HTML 側は data-i18n="キー"（本文）と data-i18n-attr="属性:キー; 属性:キー"（属性）で指定する。
//
// まれに、インストール直後に開いたページで chrome.i18n.getMessage がずっと空文字を返すことがある
// （初回案内がキー名のまま表示される）。そのときは loadI18n() で文言ファイルを直接読み、そちらを使う。

let fallbackMessages = null;

function uiLang() {
  const lang = (chrome.i18n.getUILanguage() || navigator.language || "en").toLowerCase();
  return lang.startsWith("ja") ? "ja" : "en";
}

/** getMessage が使えない状態なら、文言ファイルを読み込んでおく。画面を組み立てる前に呼ぶ */
async function loadI18n() {
  if (chrome.i18n.getMessage("extName")) return;
  try {
    const res = await fetch(chrome.runtime.getURL(`_locales/${uiLang()}/messages.json`));
    fallbackMessages = await res.json();
  } catch {
    fallbackMessages = null;
  }
}

/** messages.json の書式どおり、$1〜$9 を差し込み、$$ を $ にする */
function formatMessage(message, substitutions) {
  const list = substitutions === undefined || substitutions === null ? [] : [].concat(substitutions);
  return message.replace(/\$(\$|[1-9])/g, (_, d) => (d === "$" ? "$" : String(list[Number(d) - 1] ?? "")));
}

function t(key, substitutions) {
  const message = chrome.i18n.getMessage(key, substitutions);
  if (message) return message;
  const entry = fallbackMessages && fallbackMessages[key];
  return entry ? formatMessage(entry.message, substitutions) : key;
}

function applyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  scope.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":").map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
  if (!root) document.documentElement.lang = uiLang();
}

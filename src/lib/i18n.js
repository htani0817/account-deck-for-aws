// 画面の文言を _locales/<言語>/messages.json から差し込む。
// HTML 側は data-i18n="キー"（本文）と data-i18n-attr="属性:キー; 属性:キー"（属性）で指定する。

function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

function uiLang() {
  return chrome.i18n.getUILanguage().toLowerCase().startsWith("ja") ? "ja" : "en";
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

// AWSのページ上に出す通知と、バックグラウンドへの問い合わせの共通部品。
// 通知はページ側のCSSに崩されないよう Shadow DOM の中に描く。
// fill.js / switchrole.js から呼ぶ（コンテンツスクリプト同士は同じ空間を共有する）。

/**
 * このタブ用の受け渡しの値をバックグラウンドに尋ねる。無ければ null。
 * service worker の起動直後などで問い合わせが失敗したときは、少し待ってやり直す
 */
// eslint-disable-next-line no-unused-vars
async function accountDeckPeek(kind) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await chrome.runtime.sendMessage({ type: "peekPending", kind });
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return null;
}

// getMessage が空文字を返したときの予備（_locales と同じ文言。変えるときは両方直す）
const ACCOUNT_DECK_TOAST_FALLBACK = {
  en: {
    extName: "Account Deck for AWS",
    toastFilled: "Filled in your sign-in details. Check them and sign in.",
    toastFilledPartly: "Filled in some fields. Enter the rest yourself.",
    toastFillFailed: "Couldn't find the sign-in fields. Enter your details yourself.",
    toastSigningIn: "Filled in your sign-in details. Signing in…",
    toastSubmitNotFound: "Couldn't find the Sign in button. Press it yourself.",
    toastSwitched: "Switching role…",
    toastSwitchFailed: "Couldn't find the Switch Role button. Press it yourself.",
  },
  ja: {
    extName: "Account Deck for AWS",
    toastFilled: "サインイン情報を入力しました。確かめてからサインインしてください。",
    toastFilledPartly: "一部の欄だけ入力しました。残りは手で入力してください。",
    toastFillFailed: "入力欄が見つかりませんでした。手で入力してください。",
    toastSigningIn: "サインイン情報を入力して、サインインしています…",
    toastSubmitNotFound: "サインインボタンが見つかりませんでした。手で押してください。",
    toastSwitched: "ロールを切り替えています…",
    toastSwitchFailed: "Switch Role ボタンが見つかりませんでした。手で押してください。",
  },
};

function accountDeckMessage(key) {
  const message = chrome.i18n.getMessage(key);
  if (message) return message;
  const lang = (chrome.i18n.getUILanguage() || navigator.language || "en").toLowerCase().startsWith("ja") ? "ja" : "en";
  return ACCOUNT_DECK_TOAST_FALLBACK[lang][key] || key;
}

// eslint-disable-next-line no-unused-vars
function accountDeckToast(messageKey, tone) {
  const text = accountDeckMessage(messageKey);
  const host = document.createElement("div");
  host.setAttribute("data-account-deck", "");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .toast {
        --bg: #ffffff; --ink: #18202b; --muted: #4a5565; --edge: #0b6e69; --line: #d5dbe2;
        position: fixed; top: 16px; right: 16px; z-index: 2147483647;
        display: flex; gap: 10px; align-items: stretch;
        max-width: 360px; padding: 10px 14px 10px 0;
        background: var(--bg); color: var(--ink);
        border: 1px solid var(--line); border-radius: 10px;
        box-shadow: 0 8px 24px rgba(16, 24, 40, 0.18);
        font: 13px/1.5 "Segoe UI Variable Text", "Segoe UI", "Yu Gothic UI", "Hiragino Sans", "Meiryo UI", system-ui, sans-serif;
        animation: in 180ms ease-out;
      }
      .toast.warn { --edge: #b42318; }
      .edge { width: 4px; border-radius: 0 3px 3px 0; background: var(--edge); flex: none; }
      .name { display: block; font-size: 11px; color: var(--muted); }
      @media (prefers-color-scheme: dark) {
        .toast { --bg: #1a1f27; --ink: #e7ebf0; --muted: #b3bcc8; --edge: #5cc8be; --line: #2e3542; }
        .toast.warn { --edge: #f2867b; }
      }
      @keyframes in { from { opacity: 0; transform: translateY(-6px); } }
      @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
    </style>
    <div class="toast" role="status">
      <span class="edge"></span>
      <span><span class="name"></span><span class="msg"></span></span>
    </div>`;
  const box = root.querySelector(".toast");
  if (tone === "warn") box.classList.add("warn");
  root.querySelector(".name").textContent = accountDeckMessage("extName");
  root.querySelector(".msg").textContent = text;
  document.documentElement.appendChild(host);
  setTimeout(() => host.remove(), 5000);
}

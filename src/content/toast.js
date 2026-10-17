// AWSのページ上に出す通知。ページ側のCSSに崩されないよう Shadow DOM の中に描く。
// fill.js / switchrole.js から accountDeckToast() を呼ぶ（コンテンツスクリプト同士は同じ空間を共有する）。

// eslint-disable-next-line no-unused-vars
function accountDeckToast(messageKey, tone) {
  const text = chrome.i18n.getMessage(messageKey) || messageKey;
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
  root.querySelector(".name").textContent = chrome.i18n.getMessage("extName");
  root.querySelector(".msg").textContent = text;
  document.documentElement.appendChild(host);
  setTimeout(() => host.remove(), 5000);
}

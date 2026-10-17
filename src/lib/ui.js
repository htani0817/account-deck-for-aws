// ポップアップと管理画面で共通の部品（アイコン・環境色のタブ・トースト・コピー）。

const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  settings:
    '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8M16 7l2.5 2.5M13.5 9.5 15.5 11.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  edit: '<path d="M4 20h4.5L19 9.5 14.5 5 4 15.5z"/><path d="m13 6.5 4.5 4.5"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 13h9l1-13M9.5 7V4.5h5V7"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff:
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/><path d="M4 4l16 16"/>',
  open: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  role: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v4h14v-4"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 15v4h14v-4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};

function icon(name) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  // パスは上の固定文字列だけ（利用者の入力は入らない）
  svg.innerHTML = ICON_PATHS[name] || "";
  return svg;
}

/** 小さな要素生成ヘルパー: el("button", {class: "btn", onclick}, [子要素や文字列]) */
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of [].concat(children || [])) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

/** 背景色に対して読みやすい文字色（濃い墨か白）を選ぶ */
function readableInkFor(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return null;
  const lin = (c) => {
    const s = parseInt(c, 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
  // 墨(#18202B)と白のどちらがコントラスト比で勝つか
  const inkLum = 0.0144;
  return (lum + 0.05) / (inkLum + 0.05) >= 1.05 / (lum + 0.05) ? "#18202B" : "#FFFFFF";
}

/** 行の左端に差し込む環境色のタブ */
function envTab(item) {
  const tab = el("span", { class: "env-tab", "aria-hidden": "true" });
  const color = normalizeColor(item.color);
  if (color) {
    tab.style.setProperty("--env", color);
    tab.style.setProperty("--env-ink", readableInkFor(color));
  }
  if (item.label) tab.append(el("span", { text: item.label }));
  return tab;
}

/** 画面下に一時的な通知を出す。actionLabel を渡すと「元に戻す」等のボタンを付ける */
function createToaster(container) {
  let timer = null;
  return function showToast(message, options) {
    const opts = options || {};
    clearTimeout(timer);
    container.replaceChildren();
    const box = el("div", { class: "toast" + (opts.tone === "warn" ? " is-warn" : ""), role: "status" }, [
      el("span", { text: message }),
    ]);
    if (opts.actionLabel && opts.onAction) {
      box.append(
        el("button", {
          type: "button",
          text: opts.actionLabel,
          onclick: () => {
            clearTimeout(timer);
            container.replaceChildren();
            opts.onAction();
          },
        })
      );
    }
    container.append(box);
    timer = setTimeout(() => container.replaceChildren(), opts.duration || 2200);
  };
}

async function copyText(text) {
  await navigator.clipboard.writeText(text || "");
}

/** コピー等の直後にボタンのアイコンを一瞬だけチェックに変える */
function flashDone(button) {
  const original = button.querySelector("svg");
  if (!original) return;
  const done = icon("check");
  button.classList.add("is-done");
  original.replaceWith(done);
  setTimeout(() => {
    done.replaceWith(original);
    button.classList.remove("is-done");
  }, 1200);
}

/** 拡張機能のメッセージ送信（バックグラウンドへ） */
function sendToBackground(message) {
  return chrome.runtime.sendMessage(message);
}

// ポップアップ画面: 登録済み環境の一覧表示・起動・クリップボードコピーのみを担当する
// 登録・編集・削除は options.html（管理画面）で行う

const ACTIVE_TAB_STORAGE_KEY = "popupActiveTab";

let allItems = [];
let activeType = "login";

const itemListEl = document.getElementById("itemList");
const emptyStateEl = document.getElementById("emptyState");
const emptyStateTextEl = emptyStateEl.querySelector("p");
const searchInputEl = document.getElementById("searchInput");
const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
const toastEl = document.getElementById("toast");

document.getElementById("openOptionsBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
document.getElementById("emptyStateAddBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
searchInputEl.addEventListener("input", () => renderList(searchInputEl.value));

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveType(btn.dataset.type);
  });
});

function setActiveType(type) {
  activeType = type;
  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });
  chrome.storage.local.set({ [ACTIVE_TAB_STORAGE_KEY]: type });
  renderList(searchInputEl.value);
}

async function init() {
  // storage.localへのアクセスを1回にまとめ、往復コストを減らす
  const stored = await chrome.storage.local.get([
    STORAGE_KEY,
    ACTIVE_TAB_STORAGE_KEY,
  ]);
  allItems = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  const initialType =
    stored[ACTIVE_TAB_STORAGE_KEY] === "switchRole" ? "switchRole" : "login";
  setActiveType(initialType);
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  setTimeout(() => {
    toastEl.hidden = true;
  }, 1500);
}

function filterItems(keyword) {
  const kw = keyword.trim().toLowerCase();
  const byType = allItems.filter((item) => item.type === activeType);
  if (!kw) return byType;
  return byType.filter((item) => {
    return [item.displayName, item.accountId, item.roleName]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(kw));
  });
}

function renderList(keyword) {
  const items = filterItems(keyword || "");
  itemListEl.innerHTML = "";

  if (items.length === 0) {
    emptyStateTextEl.textContent =
      activeType === "switchRole"
        ? "登録されたスイッチロールがありません。"
        : "登録されたログイン環境がありません。";
    emptyStateEl.hidden = false;
    return;
  }
  emptyStateEl.hidden = true;

  for (const item of items) {
    itemListEl.appendChild(buildItemCard(item));
  }
}

function buildItemCard(item) {
  const li = document.createElement("li");
  li.className = "item-card";

  const titleRow = document.createElement("div");
  titleRow.className = "item-title-row";

  const nameEl = document.createElement("span");
  nameEl.className = "item-name";
  nameEl.textContent = item.displayName || "(表示名未設定)";
  titleRow.appendChild(nameEl);

  li.appendChild(titleRow);

  const subEl = document.createElement("div");
  subEl.className = "item-sub";
  subEl.textContent =
    item.type === "switchRole"
      ? `アカウントID: ${item.accountId || "-"} / ロール: ${item.roleName || "-"}`
      : `アカウントID: ${item.accountId || "-"}`;
  li.appendChild(subEl);

  const actions = document.createElement("div");
  actions.className = "item-actions";

  if (item.type === "switchRole") {
    const openBtn = document.createElement("button");
    openBtn.className = "open-btn";
    openBtn.textContent = "スイッチロールで開く";
    openBtn.addEventListener("click", async () => {
      await queuePendingSwitchRoleSubmit();
      openUrlInNewTab(buildSwitchRoleUrl(item));
    });
    actions.appendChild(openBtn);
  } else {
    const openBtn = document.createElement("button");
    openBtn.className = "open-btn";
    openBtn.textContent = "開く";
    openBtn.addEventListener("click", async () => {
      await queuePendingFill(item);
      openUrlInNewTab(item.url);
    });
    actions.appendChild(openBtn);

    if (item.username) {
      const copyUserBtn = document.createElement("button");
      copyUserBtn.textContent = "ユーザー名コピー";
      copyUserBtn.addEventListener("click", async () => {
        await copyToClipboard(item.username);
        showToast("ユーザー名をコピーしました");
      });
      actions.appendChild(copyUserBtn);
    }

    if (item.password) {
      const copyPassBtn = document.createElement("button");
      copyPassBtn.textContent = "パスワードコピー";
      copyPassBtn.addEventListener("click", async () => {
        await copyToClipboard(item.password);
        showToast("パスワードをコピーしました");
      });
      actions.appendChild(copyPassBtn);
    }
  }

  li.appendChild(actions);
  return li;
}

init();

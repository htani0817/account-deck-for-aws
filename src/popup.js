// ポップアップ: 登録済み環境の一覧・検索・起動・コピー。登録や編集は管理画面（options.html）で行う。

const ACTIVE_TAB_STORAGE_KEY = "popupActiveTab";

const state = {
  items: [],
  type: "login",
  query: "",
  selected: 0,
  vault: { mode: "none", locked: false },
};

const $ = (id) => document.getElementById(id);
const listEl = $("list");
const searchEl = $("search");
const tabButtons = Array.from(document.querySelectorAll("#typeTabs [role=tab]"));
const showToast = createToaster($("toast"));

let afterUnlock = null;

// --- 表示 ---

function itemsOfType(type) {
  return state.items.filter((i) => i.type === type && itemMatches(i, state.query));
}

function visibleItems() {
  return itemsOfType(state.type);
}

function render() {
  for (const btn of tabButtons) {
    const active = btn.dataset.type === state.type;
    btn.setAttribute("aria-selected", String(active));
    btn.tabIndex = active ? 0 : -1;
    btn.querySelector(".count").textContent = String(itemsOfType(btn.dataset.type).length);
  }
  renderLockButton();

  const items = visibleItems();
  state.selected = Math.min(state.selected, Math.max(items.length - 1, 0));
  listEl.replaceChildren(...items.map((item, index) => buildRow(item, index)));
  renderEmpty(items.length === 0);
  $("keys").hidden = items.length === 0;
}

function renderLockButton() {
  const btn = $("lockBtn");
  btn.hidden = state.vault.mode !== "master";
  if (btn.hidden) return;
  const label = t(state.vault.locked ? "popupUnlock" : "popupLockNow");
  btn.replaceChildren(icon(state.vault.locked ? "lock" : "unlock"));
  btn.setAttribute("aria-label", label);
  btn.title = label;
}

function renderEmpty(isEmpty) {
  const box = $("empty");
  box.hidden = !isEmpty;
  if (!isEmpty) return;
  const actions = $("emptyActions");
  actions.replaceChildren();

  if (state.items.length === 0) {
    $("emptyTitle").textContent = t("popupEmptyTitle");
    $("emptyBody").textContent = t("popupEmptyBody");
    actions.append(
      el("button", { class: "btn btn-primary", type: "button", text: t("actionAddEnv"), onclick: () => openOptions("add") }),
      el("button", { class: "btn", type: "button", text: t("actionImport"), onclick: () => openOptions("import") })
    );
    return;
  }

  if (state.query.trim()) {
    $("emptyTitle").textContent = t("popupNoMatchTitle", [state.query.trim()]);
    const other = state.type === "login" ? "switchRole" : "login";
    const otherCount = itemsOfType(other).length;
    if (otherCount > 0) {
      $("emptyBody").textContent = t(other === "login" ? "popupMatchesInLogin" : "popupMatchesInSwitchRole", [String(otherCount)]);
      actions.append(
        el("button", { class: "btn", type: "button", text: t(other === "login" ? "typeLogin" : "typeSwitchRole"), onclick: () => setType(other) })
      );
    } else {
      $("emptyBody").textContent = t("popupNoMatchBody");
    }
    return;
  }

  $("emptyTitle").textContent = t(state.type === "login" ? "popupNoLoginTitle" : "popupNoSwitchRoleTitle");
  $("emptyBody").textContent = t(state.type === "login" ? "popupNoLoginBody" : "popupNoSwitchRoleBody");
  actions.append(
    el("button", { class: "btn btn-primary", type: "button", text: t("actionAddEnv"), onclick: () => openOptions("add") })
  );
}

function buildRow(item, index) {
  const selected = index === state.selected;
  const row = el("li", {
    class: "row",
    role: "option",
    "aria-selected": String(selected),
    "data-id": item.id,
    onclick: () => launch(item),
    onmousemove: () => {
      if (state.selected !== index) select(index, false);
    },
  });

  const meta = el("div", { class: "meta" }, [
    el("button", {
      class: "acct-btn acct",
      type: "button",
      title: t("popupCopyAccountId"),
      "aria-label": t("popupCopyAccountIdOf", [item.displayName]),
      text: formatAccountId(item.accountId),
      onclick: (e) => {
        e.stopPropagation();
        copyAndTell(normalizeAccountId(item.accountId), "toastCopiedAccountId");
      },
    }),
  ]);
  if (item.type === "switchRole") {
    meta.append(el("span", { class: "role", title: item.roleName }, [icon("role"), el("span", { text: item.roleName })]));
  }

  row.append(
    envTab(item),
    el("div", { class: "row-body" }, [el("span", { class: "name", text: item.displayName }), meta])
  );

  const actions = el("div", { class: "row-actions" });
  if (item.type === "login") {
    if (item.username) {
      actions.append(
        iconButton("user", t("popupCopyUsernameOf", [item.displayName]), t("popupCopyUsername"), (btn) =>
          copyAndTell(item.username, "toastCopiedUsername", btn)
        )
      );
    }
    if (itemHasPassword(item)) {
      actions.append(
        iconButton("key", t("popupCopyPasswordOf", [item.displayName]), t("popupCopyPassword"), (btn) => copyPassword(item, btn))
      );
    }
  }
  actions.append(
    el("button", {
      class: "btn btn-primary open-btn",
      type: "button",
      text: t("actionOpen"),
      "aria-label": t("popupOpenOf", [item.displayName]),
      onclick: (e) => {
        e.stopPropagation();
        launch(item);
      },
    })
  );
  row.append(actions);
  return row;
}

function iconButton(name, ariaLabel, title, onClick) {
  const btn = el("button", {
    class: "icon-btn",
    type: "button",
    title,
    "aria-label": ariaLabel,
    onclick: (e) => {
      e.stopPropagation();
      onClick(btn);
    },
  });
  btn.append(icon(name));
  return btn;
}

function select(index, scroll) {
  const rows = listEl.children;
  if (!rows.length) return;
  state.selected = (index + rows.length) % rows.length;
  Array.from(rows).forEach((row, i) => row.setAttribute("aria-selected", String(i === state.selected)));
  if (scroll !== false) rows[state.selected].scrollIntoView({ block: "nearest" });
}

function setType(type) {
  state.type = type;
  state.selected = 0;
  chrome.storage.local.set({ [ACTIVE_TAB_STORAGE_KEY]: type });
  render();
}

// --- 操作 ---

async function copyAndTell(text, messageKey, button) {
  try {
    await copyText(text);
    if (button) flashDone(button);
    showToast(t(messageKey));
  } catch {
    showToast(t("toastCopyFailed"), { tone: "warn" });
  }
}

async function copyPassword(item, button) {
  try {
    const password = await decryptItemPassword(item);
    await copyAndTell(password, "toastCopiedPassword", button);
  } catch (e) {
    if (e instanceof VaultLockedError) {
      askUnlock(() => copyPassword(item, button));
    } else {
      showToast(t("toastDecryptFailed"), { tone: "warn" });
    }
  }
}

async function launch(item) {
  let res;
  try {
    res = await sendToBackground({ type: "launch", itemId: item.id });
  } catch {
    res = { ok: false };
  }
  if (res && res.locked) {
    askUnlock(() => launch(item));
    return;
  }
  if (!res || !res.ok) {
    showToast(t(res && res.error === "badUrl" ? "toastBadUrl" : "toastOpenFailed"), { tone: "warn" });
    return;
  }
  window.close();
}

function openOptions(section) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${section ? "#" + section : ""}`) });
  window.close();
}

// --- ロック解除 ---

function askUnlock(next) {
  afterUnlock = next;
  $("unlockError").hidden = true;
  $("unlockInput").removeAttribute("aria-invalid");
  $("unlockInput").value = "";
  $("unlock").hidden = false;
  $("unlockInput").focus();
}

function closeUnlock() {
  $("unlock").hidden = true;
  afterUnlock = null;
  searchEl.focus();
}

$("unlock").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("unlockInput");
  const submit = $("unlockSubmit");
  submit.disabled = true;
  const ok = await unlockVault(input.value);
  submit.disabled = false;
  if (!ok) {
    $("unlockError").hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.select();
    return;
  }
  state.vault = await getVaultState();
  // 解除前に平文の旧データが残っていれば、ここで暗号化しておく
  await migrateLegacyData();
  const next = afterUnlock;
  closeUnlock();
  render();
  showToast(t("toastUnlocked"));
  if (next) next();
});

$("unlockCancel").addEventListener("click", closeUnlock);

$("lockBtn").addEventListener("click", async () => {
  if (state.vault.locked) {
    askUnlock(null);
    return;
  }
  await lockVault();
  state.vault = await getVaultState();
  render();
  showToast(t("toastLocked"));
});

// --- キー操作 ---

document.addEventListener("keydown", (e) => {
  if (!$("unlock").hidden) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeUnlock();
    }
    return;
  }
  const items = visibleItems();
  switch (e.key) {
    case "ArrowDown":
    case "ArrowUp":
      if (!items.length) return;
      e.preventDefault();
      select(state.selected + (e.key === "ArrowDown" ? 1 : -1));
      break;
    case "Enter":
      // ボタンにフォーカスがあるときはそのボタンの動作に任せる
      if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
      if (!items.length) return;
      e.preventDefault();
      launch(items[state.selected]);
      break;
    case "Escape":
      if (searchEl.value) {
        e.preventDefault();
        searchEl.value = "";
        state.query = "";
        state.selected = 0;
        render();
      }
      break;
    default:
      break;
  }
});

searchEl.addEventListener("input", () => {
  state.query = searchEl.value;
  state.selected = 0;
  render();
});

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => setType(btn.dataset.type));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = state.type === "login" ? "switchRole" : "login";
      setType(next);
      tabButtons.find((b) => b.dataset.type === next).focus();
    }
  });
});

$("optionsBtn").addEventListener("click", () => openOptions(""));

// 管理画面で登録内容が変わったら一覧を作り直す
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    state.items = Array.isArray(changes[STORAGE_KEY].newValue) ? changes[STORAGE_KEY].newValue : [];
    render();
  }
  if ((area === "local" && changes[VAULT_KEY]) || (area === "session" && changes[SESSION_KEY_KEY])) {
    state.vault = await getVaultState();
    renderLockButton();
  }
});

async function init() {
  await loadI18n();
  applyI18n();
  $("searchIcon").append(icon("search"));
  $("optionsBtn").append(icon("settings"));

  await migrateLegacyData();
  const stored = await chrome.storage.local.get([STORAGE_KEY, ACTIVE_TAB_STORAGE_KEY]);
  state.items = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  state.type = stored[ACTIVE_TAB_STORAGE_KEY] === "switchRole" ? "switchRole" : "login";
  state.vault = await getVaultState();
  render();
  searchEl.focus();
}

init();

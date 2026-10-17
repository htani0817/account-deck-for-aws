// 管理画面: 環境の登録・編集・削除・並べ替え、パスワードの守り方（マスターパスワード）、バックアップ、初回案内。

// 紹介ページ（Official-Site）はストア公開後に作るので、それまではリンクしない
const LINKS = {
  privacy: "https://github.com/htani0817/account-deck-for-aws/blob/main/PRIVACY.md",
  source: "https://github.com/htani0817/account-deck-for-aws",
  issues: "https://github.com/htani0817/account-deck-for-aws/issues",
};
const ONBOARDING_KEY = "onboardingDone";
const SECTIONS = ["environments", "settings", "about"];

const state = {
  items: [],
  filter: "all",
  query: "",
  vault: { mode: "none", locked: false, autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES },
  editingId: null,
  dragId: null,
};

const $ = (id) => document.getElementById(id);
const showToast = createToaster($("toast"));

async function persist() {
  await saveItems(state.items);
}

/** ロック中に鍵が要る処理を呼んだら、解除を求めてからもう一度実行する */
async function withUnlock(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof VaultLockedError)) throw e;
    if (!(await ensureUnlocked())) return undefined;
    return fn();
  }
}

// --- 区画の切り替え ---

function showSection(name) {
  const target = SECTIONS.includes(name) ? name : "environments";
  document.querySelectorAll("main > section").forEach((s) => {
    s.hidden = s.dataset.section !== target;
  });
  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.dataset.section === target) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function route() {
  const hash = location.hash.replace("#", "");
  // 案内を開いたまま別の区画へ移ったら、案内は閉じる（完了の印は付けない）
  if (hash !== "welcome" && !$("welcome").hidden) {
    $("welcome").hidden = true;
    document.body.style.overflow = "";
  }
  if (hash === "welcome") {
    showSection("environments");
    openWelcome();
    return;
  }
  if (hash === "add") {
    showSection("environments");
    history.replaceState(null, "", "#environments");
    openItemDialog(null);
    return;
  }
  if (hash === "import") {
    showSection("settings");
    history.replaceState(null, "", "#settings");
    $("importBtn").focus();
    return;
  }
  showSection(hash);
}

// --- 一覧 ---

function matchesFilter(item, filter) {
  return (filter === "all" || item.type === filter) && itemMatches(item, state.query);
}

function filteredItems() {
  return state.items.filter((i) => matchesFilter(i, state.filter));
}

function renderList() {
  document.querySelectorAll("#filterTabs [role=tab]").forEach((btn) => {
    const active = btn.dataset.filter === state.filter;
    btn.setAttribute("aria-selected", String(active));
    btn.tabIndex = active ? 0 : -1;
    btn.querySelector(".count").textContent = String(
      state.items.filter((i) => matchesFilter(i, btn.dataset.filter)).length
    );
  });

  const items = filteredItems();
  $("envList").replaceChildren(...items.map((item, index) => buildEnvRow(item, index, items.length)));
  $("reorderHint").hidden = items.length < 2;
  renderEmpty(items.length === 0);
}

function renderEmpty(isEmpty) {
  $("envEmpty").hidden = !isEmpty;
  if (!isEmpty) return;
  const actions = $("envEmptyActions");
  actions.replaceChildren();

  if (state.items.length === 0) {
    $("envEmptyTitle").textContent = t("optionsEmptyTitle");
    $("envEmptyBody").textContent = t("optionsEmptyBody");
    actions.append(
      el("button", { class: "btn", type: "button", text: t("actionImport"), onclick: () => $("importFile").click() }),
      el("button", { class: "btn btn-primary", type: "button", text: t("actionAddEnv"), onclick: () => openItemDialog(null) })
    );
  } else if (state.query.trim()) {
    $("envEmptyTitle").textContent = t("popupNoMatchTitle", [state.query.trim()]);
    $("envEmptyBody").textContent = t("popupNoMatchBody");
  } else {
    $("envEmptyTitle").textContent = t(state.filter === "login" ? "popupNoLoginTitle" : "popupNoSwitchRoleTitle");
    $("envEmptyBody").textContent = t(state.filter === "login" ? "popupNoLoginBody" : "popupNoSwitchRoleBody");
    actions.append(
      el("button", { class: "btn btn-primary", type: "button", text: t("actionAddEnv"), onclick: () => openItemDialog(null) })
    );
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function buildEnvRow(item, index, total) {
  const row = el("li", {
    class: "env-row",
    draggable: "true",
    "data-id": item.id,
    onclick: (e) => {
      if (!e.target.closest("button")) openItemDialog(item);
    },
  });

  const meta = el("div", { class: "env-meta" }, [el("span", { class: "acct", text: formatAccountId(item.accountId) })]);
  if (item.type === "login") {
    meta.append(el("span", { title: item.url || defaultLoginUrl(item.accountId) }, [icon("open"), hostOf(item.url || defaultLoginUrl(item.accountId))]));
    if (item.username) meta.append(el("span", {}, [icon("user"), item.username]));
    if (itemHasPassword(item)) meta.append(el("span", {}, [icon("key"), t("optionsPasswordSaved")]));
  } else {
    meta.append(el("span", {}, [icon("role"), item.roleName]));
  }
  if (item.memo) meta.append(el("span", { title: item.memo, text: item.memo }));

  const actions = el("div", { class: "env-actions" }, [
    actionButton("up", t("actionMoveUp"), () => moveBy(item, -1), index === 0, "up"),
    actionButton("down", t("actionMoveDown"), () => moveBy(item, 1), index === total - 1, "down"),
    actionButton("edit", t("actionEdit"), () => openItemDialog(item)),
    actionButton("trash", t("actionDelete"), () => deleteItem(item), false, null, "danger"),
  ]);

  row.append(
    el("span", { class: "grip", title: t("optionsDragHint"), "aria-hidden": "true" }, [icon("grip")]),
    envTab(item),
    el("div", { class: "env-main" }, [
      el("div", { class: "env-title" }, [
        el("span", { class: "env-name", text: item.displayName }),
        el("span", { class: "env-type", text: t(item.type === "login" ? "typeLogin" : "typeSwitchRole") }),
      ]),
      meta,
    ]),
    actions
  );

  row.addEventListener("dragstart", (e) => {
    state.dragId = item.id;
    row.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.id);
  });
  row.addEventListener("dragend", () => {
    state.dragId = null;
    document.querySelectorAll(".env-row").forEach((r) => r.classList.remove("is-dragging", "drop-before", "drop-after"));
  });
  row.addEventListener("dragover", (e) => {
    if (!state.dragId || state.dragId === item.id) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    row.classList.toggle("drop-after", after);
    row.classList.toggle("drop-before", !after);
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
  row.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (!state.dragId) return;
    const after = row.classList.contains("drop-after");
    row.classList.remove("drop-before", "drop-after");
    state.items = moveItemTo(state.items, state.dragId, item.id, after);
    await persist();
    renderList();
  });
  return row;
}

function actionButton(iconName, label, onClick, disabled, moveKey, extraClass) {
  const btn = el("button", {
    class: "icon-btn" + (extraClass ? " " + extraClass : ""),
    type: "button",
    title: label,
    "aria-label": label,
    disabled: Boolean(disabled),
    "data-move": moveKey || null,
    onclick: (e) => {
      e.stopPropagation();
      onClick();
    },
  });
  btn.append(icon(iconName));
  return btn;
}

async function moveBy(item, direction) {
  const visible = filteredItems();
  const index = visible.findIndex((i) => i.id === item.id);
  const target = visible[index + direction];
  if (!target) return;
  state.items = moveItemTo(state.items, item.id, target.id, direction > 0);
  await persist();
  renderList();
  // 移動したあとも同じボタンにフォーカスを残し、続けて動かせるようにする
  const row = $("envList").querySelector(`[data-id="${CSS.escape(item.id)}"]`);
  if (row) {
    const same = row.querySelector(`[data-move="${direction > 0 ? "down" : "up"}"]`);
    const other = row.querySelector(`[data-move="${direction > 0 ? "up" : "down"}"]`);
    (same && !same.disabled ? same : other).focus();
  }
}

async function deleteItem(item) {
  const index = state.items.findIndex((i) => i.id === item.id);
  if (index === -1) return;
  state.items = state.items.filter((i) => i.id !== item.id);
  await persist();
  renderList();
  showToast(t("toastDeleted", [item.displayName]), {
    actionLabel: t("actionUndo"),
    duration: 7000,
    onAction: async () => {
      const next = state.items.slice();
      next.splice(Math.min(index, next.length), 0, item);
      state.items = next;
      await persist();
      renderList();
      showToast(t("toastRestored"));
    },
  });
}

// --- 追加・編集ダイアログ ---

const form = $("itemForm");

function currentType() {
  return form.querySelector('input[name="type"]:checked').value;
}

function syncTypeFields() {
  const type = currentType();
  form.querySelectorAll(".type-fields").forEach((f) => {
    f.hidden = f.dataset.for !== type;
  });
  $("typeHint").textContent = t(type === "login" ? "typeLoginHint" : "typeSwitchRoleHint");
  updateUrlPlaceholder();
}

function updateUrlPlaceholder() {
  $("fUrl").placeholder = defaultLoginUrl(normalizeAccountId($("fAccount").value) || "123456789012");
}

function buildSwatches() {
  const box = $("swatches");
  const make = (value, cls, title, extra) => {
    const label = el("label", { class: "swatch" + (cls ? " " + cls : ""), title }, [
      el("input", { type: "radio", name: "color", value, "aria-label": title }),
    ]);
    if (value && value !== "custom") label.style.setProperty("--sw", value);
    if (extra) label.append(...extra);
    return label;
  };
  box.append(make("", "none", t("colorNone")));
  COLOR_PRESETS.forEach((c, i) => box.append(make(c, "", t("colorPreset", [String(i + 1)]))));
  const picker = el("input", { type: "color", id: "fCustomColor", value: "#7FB3D5", "aria-label": t("colorCustom") });
  picker.addEventListener("input", () => {
    box.querySelector('input[value="custom"]').checked = true;
  });
  box.append(make("custom", "custom", t("colorCustom"), [picker, el("span", { text: t("colorCustom") })]));
}

function setColor(value) {
  const c = normalizeColor(value);
  const box = $("swatches");
  if (!c) {
    box.querySelector('input[value=""]').checked = true;
  } else if (COLOR_PRESETS.includes(c)) {
    box.querySelector(`input[value="${c}"]`).checked = true;
  } else {
    box.querySelector('input[value="custom"]').checked = true;
    $("fCustomColor").value = c.toLowerCase();
  }
}

function getColor() {
  const checked = $("swatches").querySelector('input[name="color"]:checked');
  if (!checked) return "";
  return checked.value === "custom" ? normalizeColor($("fCustomColor").value) : checked.value;
}

function setFieldError(inputId, errorId, message) {
  const input = $(inputId);
  const err = $(errorId);
  if (message) {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", errorId);
    err.textContent = message;
    err.hidden = false;
  } else {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
    err.hidden = true;
  }
}

function setPasswordVisible(visible) {
  $("fPass").type = visible ? "text" : "password";
  const label = t(visible ? "actionHidePassword" : "actionShowPassword");
  $("togglePass").replaceChildren(icon(visible ? "eyeOff" : "eye"));
  $("togglePass").setAttribute("aria-label", label);
  $("togglePass").title = label;
}

function openItemDialog(item) {
  state.editingId = item ? item.id : null;
  form.reset();
  ["errName", "errAccount", "errUrl", "errRole"].forEach((id) => {
    $(id).hidden = true;
  });
  form.querySelectorAll("[aria-invalid]").forEach((n) => n.removeAttribute("aria-invalid"));

  $("itemDialogTitle").textContent = t(item ? "dialogEditTitle" : "dialogAddTitle");
  const type = item ? item.type : state.filter === "switchRole" ? "switchRole" : "login";
  form.querySelector(`input[name="type"][value="${type}"]`).checked = true;

  $("fName").value = item ? item.displayName : "";
  $("fAccount").value = item ? item.accountId : "";
  $("fLabel").value = item ? item.label || "" : "";
  $("fUrl").value = item && item.type === "login" ? item.url || "" : "";
  $("fUser").value = item && item.type === "login" ? item.username || "" : "";
  $("fPass").value = "";
  $("fRole").value = item && item.type === "switchRole" ? item.roleName || "" : "";
  $("fMemo").value = item ? item.memo || "" : "";

  const hasSaved = Boolean(item && item.type === "login" && itemHasPassword(item));
  $("fPass").placeholder = hasSaved ? "••••••••" : "";
  $("passHint").textContent = t(hasSaved ? "passwordSavedHint" : "passwordEncryptedHint");
  $("clearPassRow").hidden = !hasSaved;
  setPasswordVisible(false);
  setColor(item ? item.color : "");
  syncTypeFields();

  $("itemDialog").showModal();
  $("fName").focus();
}

function validateForm() {
  const type = currentType();
  const name = $("fName").value.trim();
  const account = normalizeAccountId($("fAccount").value);
  const url = $("fUrl").value.trim();
  const role = $("fRole").value.trim();

  const errors = [
    ["fName", "errName", name ? "" : t("errorNameRequired")],
    ["fAccount", "errAccount", !account ? t("errorAccountRequired") : isValidAccountId(account) ? "" : t("errorAccountInvalid")],
    ["fUrl", "errUrl", type === "login" && url && !isSafeHttpsUrl(url) ? t("errorUrlInvalid") : ""],
    ["fRole", "errRole", type === "switchRole" && !role ? t("errorRoleRequired") : ""],
  ];
  let first = null;
  for (const [inputId, errorId, message] of errors) {
    setFieldError(inputId, errorId, message);
    if (message && !first) first = inputId;
  }
  if (first) $(first).focus();
  return !first;
}

async function saveForm() {
  if (!validateForm()) return;
  const type = currentType();
  const prev = state.editingId ? state.items.find((i) => i.id === state.editingId) : null;
  const now = Date.now();
  const item = {
    id: prev ? prev.id : generateId(),
    type,
    displayName: $("fName").value.trim(),
    accountId: normalizeAccountId($("fAccount").value),
    label: normalizeLabel($("fLabel").value),
    color: getColor(),
    memo: $("fMemo").value.trim(),
    createdAt: prev ? prev.createdAt : now,
    updatedAt: now,
  };

  if (type === "login") {
    item.url = $("fUrl").value.trim();
    item.username = $("fUser").value.trim();
    const typed = $("fPass").value;
    if (typed) {
      const enc = await withUnlock(() => encryptPassword(typed));
      if (!enc) return; // 解除を取りやめた
      item.passwordEnc = enc;
    } else if (prev && prev.type === "login" && prev.passwordEnc && !$("fClearPass").checked) {
      item.passwordEnc = prev.passwordEnc;
    }
  } else {
    item.roleName = $("fRole").value.trim();
  }

  if (prev) {
    state.items = state.items.map((i) => (i.id === prev.id ? item : i));
  } else {
    state.items = state.items.concat(item);
  }
  await persist();
  $("itemDialog").close();
  renderList();
  showToast(t(prev ? "toastUpdated" : "toastAdded", [item.displayName]));
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  saveForm();
});
form.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener("change", syncTypeFields));
$("fAccount").addEventListener("input", updateUrlPlaceholder);
$("fAccount").addEventListener("blur", () => {
  const v = $("fAccount").value;
  if (v.trim()) $("fAccount").value = normalizeAccountId(v);
});
$("togglePass").addEventListener("click", () => setPasswordVisible($("fPass").type === "password"));

document.addEventListener("click", (e) => {
  const closer = e.target.closest("[data-close]");
  if (closer) closer.closest("dialog").close();
});

// --- 汎用ダイアログ ---

/**
 * パスワードを1つ（confirm なら確認欄も）尋ねる。check を渡すと、エラー文言を返す間は閉じない。
 * @returns {Promise<string|null>} 取りやめたら null
 */
function askPassword(opts) {
  return new Promise((resolve) => {
    const dlg = $("passwordDialog");
    const pwForm = $("pwForm");
    const input = $("pwInput");
    const confirmInput = $("pwConfirm");
    const error = $("pwError");
    const submit = $("pwSubmit");

    $("pwTitle").textContent = opts.title;
    $("pwBody").textContent = opts.body || "";
    $("pwBody").hidden = !opts.body;
    $("pwLabel").textContent = opts.label;
    submit.textContent = opts.submitLabel;
    $("pwConfirmField").hidden = !opts.confirm;
    $("pwNote").textContent = opts.note || "";
    $("pwNote").hidden = !opts.note;
    input.autocomplete = opts.confirm ? "new-password" : "current-password";
    input.value = "";
    confirmInput.value = "";
    error.hidden = true;
    input.removeAttribute("aria-invalid");

    const showError = (message) => {
      error.textContent = message;
      error.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.select();
    };

    const finish = (value) => {
      pwForm.removeEventListener("submit", onSubmit);
      dlg.removeEventListener("close", onClose);
      if (dlg.open) dlg.close();
      resolve(value);
    };

    const onSubmit = async (e) => {
      e.preventDefault();
      const value = input.value;
      if (opts.minLength && value.length < opts.minLength) {
        showError(t("errorPasswordTooShort", [String(opts.minLength)]));
        return;
      }
      if (opts.confirm && value !== confirmInput.value) {
        showError(t("errorPasswordMismatch"));
        return;
      }
      if (opts.check) {
        submit.disabled = true;
        let message = null;
        try {
          message = await opts.check(value);
        } finally {
          submit.disabled = false;
        }
        if (message) {
          showError(message);
          return;
        }
      }
      finish(value);
    };
    const onClose = () => finish(null);

    pwForm.addEventListener("submit", onSubmit);
    dlg.addEventListener("close", onClose);
    dlg.showModal();
    input.focus();
  });
}

/** @returns {Promise<boolean>} */
function confirmAction(opts) {
  return new Promise((resolve) => {
    const dlg = $("confirmDialog");
    const cfForm = $("cfForm");
    $("cfTitle").textContent = opts.title;
    $("cfBody").textContent = opts.body;
    $("cfSubmit").textContent = opts.confirmLabel;
    $("cfSubmit").className = "btn " + (opts.danger ? "btn-danger" : "btn-primary");

    const finish = (value) => {
      cfForm.removeEventListener("submit", onSubmit);
      dlg.removeEventListener("close", onClose);
      if (dlg.open) dlg.close();
      resolve(value);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      finish(true);
    };
    const onClose = () => finish(false);
    cfForm.addEventListener("submit", onSubmit);
    dlg.addEventListener("close", onClose);
    dlg.showModal();
    // 取り返しのつかない操作では、既定のフォーカスを「キャンセル」に置く
    (opts.danger ? cfForm.querySelector("[data-close]") : $("cfSubmit")).focus();
  });
}

// --- セキュリティ ---

async function ensureUnlocked() {
  state.vault = await getVaultState();
  if (!state.vault.locked) return true;
  const value = await askPassword({
    title: t("unlockTitle"),
    body: t("unlockBody"),
    label: t("fieldMasterPassword"),
    submitLabel: t("actionUnlock"),
    check: async (pw) => ((await unlockVault(pw)) ? null : t("errorWrongMasterPassword")),
  });
  if (value === null) return false;
  await migrateLegacyData();
  await renderSecurity();
  return true;
}

async function renderSecurity() {
  const v = (state.vault = await getVaultState());
  const status = $("securityStatus");
  const actions = $("securityActions");
  actions.replaceChildren();
  status.className = "status";

  if (v.mode === "master") {
    status.classList.add(v.locked ? "is-locked" : "is-unlocked");
    $("securityStatusText").textContent = t(v.locked ? "securityMasterLocked" : "securityMasterUnlocked");
    $("securityHelp").textContent = t("securityMasterHelp");
    actions.append(
      v.locked
        ? el("button", { class: "btn btn-primary", type: "button", text: t("actionUnlock"), onclick: () => ensureUnlocked() })
        : el("button", {
            class: "btn",
            type: "button",
            text: t("actionLockNow"),
            onclick: async () => {
              await lockVault();
              await renderSecurity();
              showToast(t("toastLocked"));
            },
          }),
      el("button", { class: "btn", type: "button", text: t("actionChangeMaster"), onclick: changeMasterPassword }),
      el("button", { class: "btn btn-quiet", type: "button", text: t("actionRemoveMaster"), onclick: stopMasterPassword })
    );
    $("autoLockRow").hidden = false;
    $("autoLock").value = String(v.autoLockMinutes);
    $("forgotBox").hidden = false;
  } else {
    status.classList.add("is-device");
    $("securityStatusText").textContent = t("securityDevice");
    $("securityHelp").textContent = t("securityDeviceHelp");
    actions.append(el("button", { class: "btn btn-primary", type: "button", text: t("actionSetMaster"), onclick: startMasterPassword }));
    $("autoLockRow").hidden = true;
    $("forgotBox").hidden = true;
  }
}

function askNewMasterPassword(titleKey) {
  return askPassword({
    title: t(titleKey),
    body: t("setMasterBody"),
    label: t("fieldMasterPassword"),
    submitLabel: t("actionSave"),
    confirm: true,
    minLength: MASTER_PASSWORD_MIN_LENGTH,
    note: t("masterPasswordWarning"),
  });
}

async function startMasterPassword() {
  const pw = await askNewMasterPassword("setMasterTitle");
  if (!pw) return;
  await withUnlock(() => setMasterPassword(pw));
  state.items = await getItems();
  await renderSecurity();
  showToast(t("toastMasterSet"));
}

async function changeMasterPassword() {
  if (!(await ensureUnlocked())) return;
  const pw = await askNewMasterPassword("changeMasterTitle");
  if (!pw) return;
  await withUnlock(() => setMasterPassword(pw));
  state.items = await getItems();
  await renderSecurity();
  showToast(t("toastMasterChanged"));
}

async function stopMasterPassword() {
  if (!(await ensureUnlocked())) return;
  const ok = await confirmAction({
    title: t("removeMasterTitle"),
    body: t("removeMasterBody"),
    confirmLabel: t("actionRemoveMaster"),
    danger: true,
  });
  if (!ok) return;
  await withUnlock(() => removeMasterPassword());
  state.items = await getItems();
  await renderSecurity();
  showToast(t("toastMasterRemoved"));
}

$("resetVaultBtn").addEventListener("click", async () => {
  const ok = await confirmAction({
    title: t("forgotTitle"),
    body: t("forgotConfirmBody"),
    confirmLabel: t("forgotAction"),
    danger: true,
  });
  if (!ok) return;
  const removed = await resetForgottenMasterPassword();
  state.items = await getItems();
  renderList();
  await renderSecurity();
  showToast(t("toastVaultReset", [String(removed)]), { duration: 5000 });
});

$("autoLock").addEventListener("change", async () => {
  await setAutoLockMinutes(Number($("autoLock").value));
  showToast(t("toastSaved"));
});

// --- バックアップ ---

function syncExportFields() {
  const include = $("exForm").querySelector('input[name="exPass"]:checked').value === "include";
  $("exPassFields").hidden = !include;
}

$("exportBtn").addEventListener("click", () => {
  if (state.items.length === 0) {
    showToast(t("toastNothingToExport"));
    return;
  }
  const exForm = $("exForm");
  exForm.reset();
  const anyPassword = state.items.some(itemHasPassword);
  exForm.querySelector(`input[name="exPass"][value="${anyPassword ? "include" : "exclude"}"]`).checked = true;
  $("exError").hidden = true;
  syncExportFields();
  $("exportDialog").showModal();
});

$("exForm").querySelectorAll('input[name="exPass"]').forEach((r) => r.addEventListener("change", syncExportFields));

$("exForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const include = $("exForm").querySelector('input[name="exPass"]:checked').value === "include";
  const p1 = $("exPass1").value;
  const p2 = $("exPass2").value;
  const showError = (message) => {
    $("exError").textContent = message;
    $("exError").hidden = false;
  };
  if (include && p1.length < MASTER_PASSWORD_MIN_LENGTH) {
    showError(t("errorPasswordTooShort", [String(MASTER_PASSWORD_MIN_LENGTH)]));
    return;
  }
  if (include && p1 !== p2) {
    showError(t("errorPasswordMismatch"));
    return;
  }
  $("exportDialog").close();
  const payload = await withUnlock(() => buildExportPayload(state.items, include ? p1 : null));
  if (payload === undefined) return;

  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const a = el("a", { href: url, download: `account-deck-backup_${stamp}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(t("toastExported"));
});

$("importBtn").addEventListener("click", () => $("importFile").click());

$("importFile").addEventListener("change", async () => {
  const file = $("importFile").files[0];
  $("importFile").value = ""; // 同じファイルを続けて選び直せるようにする
  if (!file) return;

  let inspected;
  try {
    inspected = inspectImportPayload(await file.text());
  } catch {
    showToast(t("errorImportFormat"), { tone: "warn" });
    return;
  }
  if (inspected.entries.length === 0) {
    showToast(t("errorImportEmpty"), { tone: "warn" });
    return;
  }
  // 取り込むパスワードを今の鍵で暗号化するので、先にロックを解いておく
  if (inspected.hasPasswords && !(await ensureUnlocked())) return;

  let imported = null;
  try {
    if (inspected.needsFilePassword) {
      const value = await askPassword({
        title: t("importPasswordTitle"),
        body: t("importPasswordBody"),
        label: t("fieldFilePassword"),
        submitLabel: t("actionImportConfirm"),
        check: async (pw) => {
          try {
            imported = await finalizeImport(inspected, pw);
            return null;
          } catch (err) {
            return err instanceof WrongPasswordError ? t("errorWrongFilePassword") : t("errorImportFailed");
          }
        },
      });
      if (value === null) return;
    } else {
      imported = await withUnlock(() => finalizeImport(inspected, null));
      if (!imported) return;
    }
  } catch {
    showToast(t("errorImportFailed"), { tone: "warn" });
    return;
  }

  const ids = new Set(imported.map((i) => i.id));
  state.items = state.items.concat(imported);
  await persist();
  renderList();
  const hadPlain = inspected.entries.some((e) => e.plainPassword);
  showToast(t(hadPlain ? "toastImportedPlain" : "toastImported", [String(imported.length)]), {
    actionLabel: t("actionUndo"),
    duration: hadPlain ? 10000 : 7000,
    onAction: async () => {
      state.items = state.items.filter((i) => !ids.has(i.id));
      await persist();
      renderList();
      showToast(t("toastImportUndone"));
    },
  });
});

// --- 初回案内 ---

function showWelcomeStep(step) {
  document.querySelectorAll(".steps li").forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle("is-current", n === step);
    li.classList.toggle("is-done", n < step);
  });
  $("welcomeStep1").hidden = step !== 1;
  $("welcomeStep2").hidden = step !== 2;
  const first = step === 1 ? $("welcomeStep1").querySelector("input:checked") : $("welcomeAdd");
  if (first) first.focus();
}

function syncWelcomeFields() {
  const master = $("welcomeStep1").querySelector('input[name="protect"]:checked').value === "master";
  $("welcomeMasterFields").hidden = !master;
}

async function openWelcome() {
  $("welcome").hidden = false;
  document.body.style.overflow = "hidden";
  const v = await getVaultState();
  syncWelcomeFields();
  showWelcomeStep(v.mode === "master" ? 2 : 1);
}

async function closeWelcome() {
  $("welcome").hidden = true;
  document.body.style.overflow = "";
  await chrome.storage.local.set({ [ONBOARDING_KEY]: true });
  history.replaceState(null, "", "#environments");
  showSection("environments");
  await renderSecurity();
}

$("welcomeStep1").querySelectorAll('input[name="protect"]').forEach((r) => r.addEventListener("change", syncWelcomeFields));

$("welcomeStep1").addEventListener("submit", async (e) => {
  e.preventDefault();
  const master = $("welcomeStep1").querySelector('input[name="protect"]:checked').value === "master";
  const error = $("welcomeError");
  error.hidden = true;
  if (master) {
    const p1 = $("wPass1").value;
    if (p1.length < MASTER_PASSWORD_MIN_LENGTH) {
      error.textContent = t("errorPasswordTooShort", [String(MASTER_PASSWORD_MIN_LENGTH)]);
      error.hidden = false;
      $("wPass1").focus();
      return;
    }
    if (p1 !== $("wPass2").value) {
      error.textContent = t("errorPasswordMismatch");
      error.hidden = false;
      $("wPass2").focus();
      return;
    }
    $("welcomeNext").disabled = true;
    try {
      await withUnlock(() => setMasterPassword(p1));
    } finally {
      $("welcomeNext").disabled = false;
    }
    $("wPass1").value = "";
    $("wPass2").value = "";
  } else {
    await ensureVault();
  }
  showWelcomeStep(2);
});

$("welcomeLater").addEventListener("click", closeWelcome);
$("welcomeAdd").addEventListener("click", async () => {
  await closeWelcome();
  openItemDialog(null);
});
$("welcomeImport").addEventListener("click", () => {
  // ファイル選択はクリック直後でないと開けないので、先に開いてから案内を閉じる
  $("importFile").click();
  closeWelcome();
});

// --- このツールについて ---

async function renderAbout() {
  $("aboutVersion").textContent = chrome.runtime.getManifest().version;
  $("linkPrivacy").href = LINKS.privacy;
  $("linkSource").href = LINKS.source;
  $("linkIssues").href = LINKS.issues;
  let shortcut = "";
  try {
    const commands = await chrome.commands.getAll();
    const action = commands.find((c) => c.name === "_execute_action");
    shortcut = action && action.shortcut;
  } catch {
    shortcut = "";
  }
  $("aboutShortcut").textContent = shortcut || t("aboutShortcutNone");
}

$("shortcutBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

// --- 起動 ---

document.querySelectorAll("#filterTabs [role=tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.filter = btn.dataset.filter;
    renderList();
  });
});

$("search").addEventListener("input", () => {
  state.query = $("search").value;
  renderList();
});

$("addBtn").addEventListener("click", () => openItemDialog(null));

window.addEventListener("hashchange", route);

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    state.items = Array.isArray(changes[STORAGE_KEY].newValue) ? changes[STORAGE_KEY].newValue : [];
    renderList();
  }
  if ((area === "local" && changes[VAULT_KEY]) || (area === "session" && changes[SESSION_KEY_KEY])) {
    await renderSecurity();
  }
});

async function init() {
  applyI18n();
  $("searchIcon").append(icon("search"));
  $("addBtn").append(icon("plus"), t("actionAddEnv"));
  $("exportBtn").append(icon("download"), t("actionExport"));
  $("importBtn").append(icon("upload"), t("actionImport"));
  form.querySelector("[data-close].icon-btn").append(icon("close"));
  buildSwatches();

  await migrateLegacyData();
  state.items = await getItems();
  renderList();
  await renderSecurity();
  await renderAbout();

  const stored = await chrome.storage.local.get(ONBOARDING_KEY);
  if (!location.hash && !stored[ONBOARDING_KEY] && state.items.length === 0) {
    history.replaceState(null, "", "#welcome");
  }
  route();
}

init();

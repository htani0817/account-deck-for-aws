// 管理画面: 環境情報の登録・編集・削除を担当する

let allItems = [];

const formEl = document.getElementById("itemForm");
const editingIdEl = document.getElementById("editingId");
const displayNameEl = document.getElementById("displayName");
const accountIdEl = document.getElementById("accountId");
const urlEl = document.getElementById("url");
const usernameEl = document.getElementById("username");
const passwordEl = document.getElementById("password");
const memoEl = document.getElementById("memo");
const roleNameEl = document.getElementById("roleName");
const colorEl = document.getElementById("color");
const loginFieldsEl = document.getElementById("loginFields");
const switchRoleFieldsEl = document.getElementById("switchRoleFields");
const saveBtnEl = document.getElementById("saveBtn");
const cancelEditBtnEl = document.getElementById("cancelEditBtn");
const itemTableBodyEl = document.getElementById("itemTableBody");
const emptyMessageEl = document.getElementById("emptyMessage");
const toastEl = document.getElementById("toast");
const exportBtnEl = document.getElementById("exportBtn");
const importBtnEl = document.getElementById("importBtn");
const importFileInputEl = document.getElementById("importFileInput");

function getSelectedType() {
  return formEl.querySelector('input[name="type"]:checked').value;
}

function setSelectedType(type) {
  formEl.querySelector(`input[name="type"][value="${type}"]`).checked = true;
  toggleTypeFields(type);
}

function toggleTypeFields(type) {
  loginFieldsEl.hidden = type !== "login";
  switchRoleFieldsEl.hidden = type !== "switchRole";
  urlEl.required = type === "login";
  roleNameEl.required = type === "switchRole";
}

formEl.querySelectorAll('input[name="type"]').forEach((radio) => {
  radio.addEventListener("change", () => toggleTypeFields(getSelectedType()));
});

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  setTimeout(() => {
    toastEl.hidden = true;
  }, 1800);
}

async function init() {
  allItems = await getItems();
  toggleTypeFields(getSelectedType());
  renderTable();
}

function resetForm() {
  formEl.reset();
  editingIdEl.value = "";
  colorEl.value = "#f2b0a9";
  setSelectedType("login");
  saveBtnEl.textContent = "登録する";
  cancelEditBtnEl.hidden = true;
}

cancelEditBtnEl.addEventListener("click", resetForm);

exportBtnEl.addEventListener("click", () => {
  const payload = buildExportPayload(allItems);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const a = document.createElement("a");
  a.href = url;
  a.download = `aws-env-launcher-backup_${timestamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  showToast("エクスポートしました");
});

importBtnEl.addEventListener("click", () => {
  importFileInputEl.click();
});

importFileInputEl.addEventListener("change", async () => {
  const file = importFileInputEl.files[0];
  importFileInputEl.value = ""; // 同じファイルを連続で選び直せるようにリセット
  if (!file) return;

  try {
    const text = await file.text();
    const importedItems = parseImportPayload(text);
    if (importedItems.length === 0) {
      showToast("インポート可能な環境情報が見つかりませんでした");
      return;
    }
    allItems = allItems.concat(importedItems);
    await saveItems(allItems);
    renderTable();
    showToast(`${importedItems.length}件の環境をインポートしました（既存データに追加）`);
  } catch (e) {
    showToast("インポートに失敗しました（JSON形式を確認してください）");
  }
});

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();

  const type = getSelectedType();
  const displayName = displayNameEl.value.trim();
  const accountId = accountIdEl.value.trim();

  if (!displayName || !accountId) {
    showToast("表示名とアカウントIDは必須です");
    return;
  }

  const editingId = editingIdEl.value;
  const item = {
    id: editingId || generateId(),
    type,
    displayName,
    accountId,
    updatedAt: Date.now(),
  };

  if (type === "login") {
    const url = urlEl.value.trim();
    if (!url) {
      showToast("ログインURLは必須です");
      return;
    }
    item.url = url;
    item.username = usernameEl.value.trim();
    item.password = passwordEl.value;
    item.memo = memoEl.value.trim();
  } else {
    const roleName = roleNameEl.value.trim();
    if (!roleName) {
      showToast("ロール名は必須です");
      return;
    }
    item.roleName = roleName;
    item.color = colorEl.value;
  }

  if (editingId) {
    const idx = allItems.findIndex((i) => i.id === editingId);
    if (idx !== -1) {
      item.createdAt = allItems[idx].createdAt;
      allItems[idx] = item;
    }
  } else {
    item.createdAt = Date.now();
    allItems.push(item);
  }

  await saveItems(allItems);
  renderTable();
  resetForm();
  showToast(editingId ? "更新しました" : "登録しました");
});

function startEdit(item) {
  editingIdEl.value = item.id;
  setSelectedType(item.type);
  displayNameEl.value = item.displayName || "";
  accountIdEl.value = item.accountId || "";

  if (item.type === "login") {
    urlEl.value = item.url || "";
    usernameEl.value = item.username || "";
    passwordEl.value = item.password || "";
    memoEl.value = item.memo || "";
  } else {
    roleNameEl.value = item.roleName || "";
    colorEl.value = item.color || "#f2b0a9";
  }

  saveBtnEl.textContent = "更新する";
  cancelEditBtnEl.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteItem(id) {
  const target = allItems.find((i) => i.id === id);
  const label = target ? target.displayName : "この環境";
  if (!window.confirm(`「${label}」を削除します。よろしいですか？`)) {
    return;
  }
  allItems = allItems.filter((i) => i.id !== id);
  await saveItems(allItems);
  renderTable();
  showToast("削除しました");
}

// 同じ種別(ログイン/スイッチロール)の中だけで並び順を入れ替える
async function moveItem(id, direction) {
  const item = allItems.find((i) => i.id === id);
  if (!item) return;

  const sameTypeIndices = allItems
    .map((_, idx) => idx)
    .filter((idx) => allItems[idx].type === item.type);
  const posInType = sameTypeIndices.indexOf(allItems.indexOf(item));
  const swapPosInType = direction === "up" ? posInType - 1 : posInType + 1;
  if (swapPosInType < 0 || swapPosInType >= sameTypeIndices.length) return;

  const idxA = sameTypeIndices[posInType];
  const idxB = sameTypeIndices[swapPosInType];
  [allItems[idxA], allItems[idxB]] = [allItems[idxB], allItems[idxA]];

  await saveItems(allItems);
  renderTable();
}

function renderTable() {
  itemTableBodyEl.innerHTML = "";

  if (allItems.length === 0) {
    emptyMessageEl.hidden = false;
    return;
  }
  emptyMessageEl.hidden = true;

  for (const item of allItems) {
    itemTableBodyEl.appendChild(buildRow(item));
  }
}

function buildRow(item) {
  const tr = document.createElement("tr");

  const typeTd = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `badge ${item.type}`;
  badge.textContent = item.type === "switchRole" ? "スイッチロール" : "ログイン";
  typeTd.appendChild(badge);
  tr.appendChild(typeTd);

  const nameTd = document.createElement("td");
  nameTd.textContent = item.displayName || "";
  tr.appendChild(nameTd);

  const accountTd = document.createElement("td");
  accountTd.textContent = item.accountId || "";
  tr.appendChild(accountTd);

  const detailTd = document.createElement("td");
  detailTd.textContent =
    item.type === "switchRole"
      ? `ロール: ${item.roleName || "-"}`
      : `${item.url || ""}${item.username ? " / " + item.username : ""}`;
  tr.appendChild(detailTd);

  const actionTd = document.createElement("td");

  const sameTypeIndices = allItems
    .map((_, idx) => idx)
    .filter((idx) => allItems[idx].type === item.type);
  const posInType = sameTypeIndices.indexOf(allItems.indexOf(item));

  const upBtn = document.createElement("button");
  upBtn.textContent = "↑";
  upBtn.title = "上に移動";
  upBtn.disabled = posInType <= 0;
  upBtn.addEventListener("click", () => moveItem(item.id, "up"));
  actionTd.appendChild(upBtn);

  const downBtn = document.createElement("button");
  downBtn.textContent = "↓";
  downBtn.title = "下に移動";
  downBtn.disabled = posInType >= sameTypeIndices.length - 1;
  downBtn.addEventListener("click", () => moveItem(item.id, "down"));
  actionTd.appendChild(downBtn);

  const editBtn = document.createElement("button");
  editBtn.textContent = "編集";
  editBtn.addEventListener("click", () => startEdit(item));
  actionTd.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "削除";
  deleteBtn.addEventListener("click", () => deleteItem(item.id));
  actionTd.appendChild(deleteBtn);

  tr.appendChild(actionTd);
  return tr;
}

init();

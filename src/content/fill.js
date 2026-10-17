// AWSサインインページ(signin.aws.amazon.com)に埋め込まれるコンテンツスクリプト。
// ポップアップの「開く」で作られたタブでだけ、バックグラウンドから受け取ったアカウントID/ユーザー名/パスワードを
// 自動入力する。値はタブごとに用意され、入力を終えたら（または時間切れで）バックグラウンドに破棄を頼む。
// AWSはリダイレクトをはさむことがあるので、値は受け取った時点では消さない（途中のページで使い切らないため）。
//
// AWS側はReact(Next.js)でサインインフォームを画面表示後に動的生成し、id/name等の属性名も
// 固定ではないため、構造的な手掛かり（type="password"を起点に、同じフォーム内にある空の
// テキスト系inputをプレースホルダ/ラベル文言で判別）を使って検出する。
// AWS側のページ構造変更で判別できない場合は何もしない（コピー&ペーストで手動入力すれば良い）。

(function () {
  const FILL_TIMEOUT_MS = 15000;

  const ACCOUNT_HINTS = ["account", "alias", "アカウント", "エイリアス"];
  const USERNAME_HINTS = ["username", "user", "iam", "ユーザー"];

  function isFillable(el) {
    return (
      el instanceof HTMLInputElement &&
      !el.disabled &&
      !el.readOnly &&
      el.offsetParent !== null &&
      el.value === ""
    );
  }

  // id/name/placeholder/aria-label/紐づくlabel文言をまとめて手掛かりテキスト化する
  function collectHintText(el) {
    const parts = [el.id, el.name, el.placeholder, el.getAttribute("aria-label")];

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => {
        const labelEl = document.getElementById(id);
        if (labelEl) parts.push(labelEl.textContent);
      });
    }
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) parts.push(label.textContent);
    }
    const closestLabel = el.closest("label");
    if (closestLabel) parts.push(closestLabel.textContent);

    return parts.filter(Boolean).join(" ").toLowerCase();
  }

  function matchesHints(el, hints) {
    const text = collectHintText(el);
    return hints.some((hint) => text.includes(hint));
  }

  function findPasswordField() {
    const byId = document.getElementById("password");
    if (byId instanceof HTMLInputElement && byId.type === "password" && isFillable(byId)) {
      return byId;
    }
    return (
      Array.from(document.querySelectorAll('input[type="password"]')).find(
        isFillable
      ) || null
    );
  }

  // AWSサインインページで確認済みのid（account/username）を優先的に使うファストパス
  function findFieldById(id) {
    const el = document.getElementById(id);
    return isFillable(el) ? el : null;
  }

  // パスワード欄と同じフォーム内にある、空のテキスト系input(account/usernameの候補)を集める
  function findTextCandidates(passwordField) {
    const scope = (passwordField && passwordField.closest("form")) || document;
    const excludedTypes = [
      "password",
      "hidden",
      "checkbox",
      "radio",
      "submit",
      "button",
      "file",
      "image",
    ];
    return Array.from(scope.querySelectorAll("input")).filter(
      (el) =>
        el !== passwordField &&
        !excludedTypes.includes(el.type) &&
        isFillable(el)
    );
  }

  function pickCandidate(candidates, hints, exclude) {
    return (
      candidates.find((el) => el !== exclude && matchesHints(el, hints)) ||
      null
    );
  }

  // React等が管理するinputはvalueを直接代入してもUI状態に反映されないため、
  // ネイティブのvalue setterを使ってからinput/changeイベントを発火させる
  function setNativeValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const prototypeSetter = Object.getOwnPropertyDescriptor(
      prototype,
      "value"
    )?.set;
    if (prototypeSetter) {
      prototypeSetter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function tryFillOnce(entry, filled) {
    let didFill = false;

    if (entry.password && !filled.password) {
      const passwordField = findPasswordField();
      if (passwordField) {
        setNativeValue(passwordField, entry.password);
        filled.password = true;
        didFill = true;
      }
    }

    const needAccount = entry.accountId && !filled.account;
    const needUsername = entry.username && !filled.username;

    if (needAccount || needUsername) {
      const candidates = findTextCandidates(findPasswordField());

      let accountField = needAccount
        ? findFieldById("account") || pickCandidate(candidates, ACCOUNT_HINTS)
        : null;
      let usernameField = needUsername
        ? findFieldById("username") ||
          pickCandidate(candidates, USERNAME_HINTS, accountField)
        : null;

      // ヒント文言で判別できない場合は、表示順(先頭=アカウント、次=ユーザー名)を仮定して割り当てる
      if (needAccount && !accountField && needUsername && !usernameField) {
        if (candidates.length >= 2) {
          accountField = candidates[0];
          usernameField = candidates[1];
        }
      } else if (needUsername && !usernameField && !needAccount) {
        usernameField = candidates.find((el) => el !== accountField) || null;
      } else if (needAccount && !accountField && !needUsername) {
        accountField = candidates.find((el) => el !== usernameField) || null;
      }

      if (accountField && accountField !== usernameField) {
        setNativeValue(accountField, entry.accountId);
        filled.account = true;
        didFill = true;
      }
      if (usernameField) {
        setNativeValue(usernameField, entry.username);
        filled.username = true;
        didFill = true;
      }
    }

    return didFill;
  }

  // account欄は存在しない構成（サブドメインに埋め込み済み）の場合があるため必須項目には含めない
  function isDone(entry, filled) {
    const usernameDone = !entry.username || filled.username;
    const passwordDone = !entry.password || filled.password;
    return usernameDone && passwordDone;
  }

  function finish(messageKey, tone) {
    chrome.runtime.sendMessage({ type: "pendingDone" }).catch(() => {});
    accountDeckToast(messageKey, tone);
  }

  async function watchAndFill(entry) {
    const filled = { account: false, username: false, password: false };

    if (await tryFillOnce(entry, filled)) {
      if (isDone(entry, filled)) {
        finish("toastFilled");
        return;
      }
    }

    let settled = false;
    const observer = new MutationObserver(async () => {
      if (settled) return;
      const didFill = await tryFillOnce(entry, filled);
      if (didFill && isDone(entry, filled)) {
        settled = true;
        observer.disconnect();
        finish("toastFilled");
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    setTimeout(() => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (filled.username || filled.password || filled.account) {
        finish("toastFilledPartly");
      } else {
        finish("toastFillFailed", "warn");
      }
    }, FILL_TIMEOUT_MS);
  }

  (async function main() {
    let entry = null;
    try {
      entry = await chrome.runtime.sendMessage({ type: "peekPending", kind: "fill" });
    } catch {
      return; // 拡張機能の更新直後などでバックグラウンドに届かない
    }
    if (!entry) return;
    watchAndFill(entry);
  })();
})();

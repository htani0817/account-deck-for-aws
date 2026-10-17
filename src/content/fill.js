// AWSサインインページ(signin.aws.amazon.com)に埋め込まれるコンテンツスクリプト。
// ポップアップの「開く」で作られたタブでだけ、バックグラウンドから受け取ったアカウントID/ユーザー名/パスワードを
// 自動入力し、ユーザー名とパスワードがそろっていればサインインボタンを1回だけ押す。
// 値はタブごとに用意され、押した時点で（または時間切れで）バックグラウンドに破棄を頼む。
// AWSはリダイレクトをはさむことがあるので、値は受け取った時点では消さない（途中のページで使い切らないため）。
// サインインボタンは何度も押さない（パスワードが違うときに繰り返し失敗し、アカウントがロックされるのを避ける）。
//
// AWS側はReact(Next.js)でサインインフォームを画面表示後に動的生成し、id/name等の属性名も
// 固定ではないため、構造的な手掛かり（type="password"を起点に、同じフォーム内にある空の
// テキスト系inputをプレースホルダ/ラベル文言で判別）を使って検出する。
// AWS側のページ構造変更で判別できない場合は何もしない（コピー&ペーストで手動入力すれば良い）。

(function () {
  const FILL_TIMEOUT_MS = 15000; // 入力欄が見つかるまで待つ時間
  const STABILIZE_MS = 8000; // 入力し終えたあと、画面の作り直しで消されないか見張る時間（押さない場合）
  // 入力した値がこの時間消されずに残っていたら、React が欄を管理し始めたとみなしてサインインボタンを押す
  // （管理を始める前に押すと、押したことが無視されたり、空の値で送られたりする）
  const SUBMIT_DELAY_MS = 1200;
  const CHECK_INTERVAL_MS = 250;

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

  // filled には、入力済みかどうかに加えて入力した要素も覚えておく（あとで消されていないか確かめるため）
  function markFilled(filled, key, element) {
    filled[key] = true;
    filled.elements[key] = element;
  }

  /**
   * 入力したはずの欄が、画面の作り直しで空に戻されたり別の要素に差し替わったりしていたら、未入力に戻す。
   * AWS のサインイン画面は React で作られていて、React が欄を管理し始める前（ハイドレーション前）に
   * 入力すると、管理を始めたときに React が持っている初期値（空）で上書きされる。
   */
  function resetIfCleared(filled) {
    let cleared = false;
    for (const key of ["account", "username", "password"]) {
      const el = filled.elements[key];
      if (filled[key] && (!el || !el.isConnected || el.value === "")) {
        filled[key] = false;
        filled.elements[key] = null;
        cleared = true;
      }
    }
    return cleared;
  }

  const SUBMIT_TEXT = /sign\s*in|log\s*in|サインイン|ログイン/i;

  /** パスワード欄と同じフォームの送信ボタン（無ければ文言が「サインイン」のボタン）を探す */
  function findSubmitButton(passwordField) {
    const form = passwordField && passwordField.closest("form");
    const scope = form || document;
    const buttons = Array.from(scope.querySelectorAll('button, input[type="submit"]')).filter(
      (b) => !b.disabled && b.offsetParent !== null
    );
    const label = (b) => `${b.textContent || ""} ${b.value || ""} ${b.getAttribute("aria-label") || ""}`;
    return (
      buttons.find((b) => b.type === "submit" && (form || SUBMIT_TEXT.test(label(b)))) ||
      buttons.find((b) => SUBMIT_TEXT.test(label(b))) ||
      null
    );
  }

  async function tryFillOnce(entry, filled) {
    let didFill = false;

    if (entry.password && !filled.password) {
      const passwordField = findPasswordField();
      if (passwordField) {
        setNativeValue(passwordField, entry.password);
        markFilled(filled, "password", passwordField);
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
        markFilled(filled, "account", accountField);
        didFill = true;
      }
      if (usernameField) {
        setNativeValue(usernameField, entry.username);
        markFilled(filled, "username", usernameField);
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
    if (messageKey) accountDeckToast(messageKey, tone);
  }

  async function watchAndFill(entry) {
    const filled = {
      account: false,
      username: false,
      password: false,
      elements: { account: null, username: null, password: null },
    };
    const startedAt = Date.now();
    let completedAt = null; // すべて入力し終えた時刻（押さない場合、ここから STABILIZE_MS のあいだ見張る）
    let stableSince = null; // 入力した値が消されずに残り始めた時刻
    // ユーザー名とパスワードが両方保存されているときだけサインインボタンを押す
    const canSubmit = Boolean(entry.username && entry.password);
    let settled = false;
    let running = false;
    let userTyped = false;

    // 利用者が自分でキーを打ち始めたら、手で直した値を上書きしないよう見張りをやめる
    // （拡張機能が送る input イベントは isTrusted が false なので区別できる）
    const onUserInput = (e) => {
      if (e.isTrusted) userTyped = true;
    };
    document.addEventListener("keydown", onUserInput, true);

    function stop(messageKey, tone) {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearInterval(timer);
      document.removeEventListener("keydown", onUserInput, true);
      finish(messageKey, tone);
    }

    async function check() {
      if (settled || running) return;
      running = true;
      try {
        if (userTyped) {
          stop(completedAt ? null : "toastFilledPartly");
          return;
        }
        if (resetIfCleared(filled)) stableSince = null;
        await tryFillOnce(entry, filled);

        if (isDone(entry, filled)) {
          if (!stableSince) stableSince = Date.now();
          if (canSubmit) {
            if (Date.now() - stableSince < SUBMIT_DELAY_MS) return;
            const button = findSubmitButton(filled.elements.password);
            if (!button) {
              stop("toastSubmitNotFound", "warn");
              return;
            }
            // 先に受け渡しの値を破棄してから押す（失敗して同じ画面が出ても、もう一度は押さない）
            stop("toastSigningIn");
            button.click();
            return;
          }
          if (!completedAt) {
            completedAt = Date.now();
            accountDeckToast("toastFilled");
          } else if (Date.now() - completedAt > STABILIZE_MS) {
            stop(null); // 入力した値がしばらく消されなかったので終わる（通知は済んでいる）
          }
          return;
        }
        if (Date.now() - startedAt > FILL_TIMEOUT_MS) {
          const any = filled.username || filled.password || filled.account;
          stop(any ? "toastFilledPartly" : "toastFillFailed", any ? undefined : "warn");
        }
      } finally {
        running = false;
      }
    }

    // 欄が現れる・作り直される変化は MutationObserver で、値だけが消される変化は一定間隔の確認で拾う
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    check();
  }

  (async function main() {
    const entry = await accountDeckPeek("fill");
    if (!entry) return;
    watchAndFill(entry);
  })();
})();

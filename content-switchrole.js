// AWSスイッチロール画面(signin.aws.amazon.com/switchrole)に埋め込まれるコンテンツスクリプト。
// ポップアップの「スイッチロールで開く」から遷移した直後だけ、
// 画面上の「Switch Role」ボタンを1回だけ自動クリックする。
//
// このページはロール名・アカウントID・表示名がURLパラメータで渡され、画面表示後に
// Reactが `.switch-roles` コンテナへフォームを動的挿入する。さらに、入力欄への値の反映
// (URLパラメータ→フォームstateへの反映)はinput.valueへの直接代入でありDOM構造の変更を
// 伴わないため、MutationObserverだけでは検知できない。そのためポーリングで
// 「ボタンが押せる状態」かつ「入力欄に値が入っている状態」になるまで待ってからクリックする。

(function () {
  if (!location.pathname.startsWith("/switchrole")) return;

  const CLICK_TIMEOUT_MS = 15000;
  const POLL_INTERVAL_MS = 200;
  const BUTTON_HINTS = ["switch role", "スイッチロール", "ロールの切り替え"];

  function isClickable(el) {
    return el instanceof HTMLButtonElement && !el.disabled && el.offsetParent !== null;
  }

  function matchesButtonHint(btn) {
    const text = (btn.textContent || "").trim().toLowerCase();
    const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
    return BUTTON_HINTS.some((hint) => text.includes(hint) || aria.includes(hint));
  }

  function getScope() {
    return document.querySelector(".switch-roles") || document;
  }

  // 送信ボタン(type="submit")を起点に、文言が一致するものを優先し、
  // 1件しかない場合はそれをSwitch Roleボタンとみなす
  function findSwitchRoleButton(scope) {
    const submitButtons = Array.from(
      scope.querySelectorAll('button[type="submit"]')
    ).filter(isClickable);

    if (submitButtons.length === 0) return null;

    const hinted = submitButtons.find(matchesButtonHint);
    if (hinted) return hinted;

    return submitButtons.length === 1 ? submitButtons[0] : null;
  }

  // アカウントID/ロール名欄がURLパラメータの値でまだ埋まっていない状態で
  // 送信すると「Account ID is Required」等のバリデーションエラーになるため、
  // 表示されているテキスト系inputが全て入力済みになるまで待つ
  function areTextFieldsPopulated(scope) {
    const excludedTypes = [
      "submit",
      "button",
      "checkbox",
      "radio",
      "hidden",
      "file",
      "image",
    ];
    const textInputs = Array.from(scope.querySelectorAll("input")).filter(
      (el) => !excludedTypes.includes(el.type) && el.offsetParent !== null
    );
    if (textInputs.length === 0) return true; // 判定できない場合はブロックしない
    return textInputs.every((el) => el.value.trim() !== "");
  }

  function showToast(message, isError) {
    const toast = document.createElement("div");
    toast.textContent = `AWS環境ランチャー: ${message}`;
    Object.assign(toast.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: "2147483647",
      background: isError ? "#d13212" : "#232f3e",
      color: "#fff",
      padding: "8px 14px",
      borderRadius: "4px",
      fontSize: "13px",
      fontFamily: "Meiryo UI, sans-serif",
      boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
    });
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  function watchAndClick() {
    const startedAt = Date.now();
    let settled = false;

    function attempt() {
      if (settled) return;

      const scope = getScope();
      const btn = findSwitchRoleButton(scope);
      if (btn && areTextFieldsPopulated(scope)) {
        settled = true;
        clearInterval(intervalId);
        btn.click();
        showToast("スイッチロールを実行しました");
        return;
      }

      if (Date.now() - startedAt > CLICK_TIMEOUT_MS) {
        settled = true;
        clearInterval(intervalId);
        showToast(
          "ボタンが見つからず自動実行できませんでした（手動で押してください）",
          true
        );
      }
    }

    const intervalId = setInterval(attempt, POLL_INTERVAL_MS);
    attempt();
  }

  (async function main() {
    const shouldSubmit = await consumePendingSwitchRoleSubmit();
    if (!shouldSubmit) return;
    watchAndClick();
  })();
})();

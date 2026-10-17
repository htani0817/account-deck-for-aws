// AWSスイッチロール画面(signin.aws.amazon.com/switchrole)に埋め込まれるコンテンツスクリプト。
// ポップアップの「開く」で作られたタブでだけ、画面上の「Switch Role」ボタンを自動クリックする
// （押したことが無視されて画面が変わらないときは、数回まで押し直す）。
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

  function finish(messageKey, tone) {
    chrome.runtime.sendMessage({ type: "pendingDone" }).catch(() => {});
    accountDeckToast(messageKey, tone);
  }

  // 押せる状態がこの時間続いてから押す（React が画面を管理し始める前に押すと、押したことが無視される）
  const READY_DELAY_MS = 700;
  // 押したのに画面が変わらなければ（押したことが無視された）、この間隔で押し直す。何度押しても同じロールに切り替わるだけ
  const RETRY_INTERVAL_MS = 4000;
  const MAX_CLICKS = 3;

  function watchAndClick() {
    const startedAt = Date.now();
    let readySince = null;
    let clicks = 0;
    let lastClickAt = 0;
    let settled = false;

    function stop() {
      settled = true;
      clearInterval(intervalId);
    }

    function attempt() {
      if (settled) return;

      const scope = getScope();
      const btn = findSwitchRoleButton(scope);
      const ready = Boolean(btn) && areTextFieldsPopulated(scope);
      if (!ready) {
        readySince = null;
      } else if (!readySince) {
        readySince = Date.now();
      }

      if (ready && Date.now() - readySince >= READY_DELAY_MS) {
        if (clicks === 0) {
          // 初回だけ受け渡しの値を破棄して通知する。押し直しは同じページに残っている間だけ行う
          finish("toastSwitched");
        }
        if (clicks < MAX_CLICKS && Date.now() - lastClickAt >= RETRY_INTERVAL_MS) {
          clicks += 1;
          lastClickAt = Date.now();
          btn.click();
        }
        if (clicks >= MAX_CLICKS && Date.now() - lastClickAt >= RETRY_INTERVAL_MS) stop();
        return;
      }

      if (clicks === 0 && Date.now() - startedAt > CLICK_TIMEOUT_MS) {
        stop();
        finish("toastSwitchFailed", "warn");
      }
    }

    const intervalId = setInterval(attempt, POLL_INTERVAL_MS);
    attempt();
  }

  (async function main() {
    const entry = await accountDeckPeek("switch");
    if (!entry) return;
    watchAndClick();
  })();
})();

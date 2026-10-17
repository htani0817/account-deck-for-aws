# ストア掲載文

Chrome ウェブストアのデベロッパー ダッシュボードに貼る文面です。「ストアの掲載情報」は言語ごとに入力します（既定の言語は English、追加で日本語）。

## 日本語

### 名前（manifest から自動で入る）

Account Deck for AWS

### 概要（manifest から自動で入る。132文字以内）

AWS のサインインURLとスイッチロールを一覧にまとめ、ワンクリックで開きます。Amazon Web Services の公式ツールではありません。

### 説明

```text
AWS のサインイン画面とスイッチロールを一覧にまとめ、ツールバーからワンクリックで開く拡張機能です。複数の AWS アカウントを行き来するとき、目当ての環境にすぐ行けて、本番と開発を取り違えにくくなります。

■ できること
・サインイン: 「開く」を押すと AWS のサインイン画面を開き、アカウントID・IAM ユーザー名・パスワードを入力して、サインインボタンまで押します。MFA を設定している場合は、そのあとでコードを入力します
・スイッチロール: アカウントIDとロール名から切り替え画面を開き、Switch Role ボタンまで押します
・色とラベル: 環境ごとに色とラベル（本番、STG など）を付けられます。色はスイッチロール画面と同じ5色から選べます
・キーボード操作: ポップアップを開いたらすぐに検索でき、↑↓ と Enter で開けます。ポップアップ自体も Alt+Shift+A で開けます
・並べ替えとバックアップ: ドラッグで並べ替えられます。JSON ファイルへの書き出しと読み込みで、別のブラウザへ移せます

■ パスワードの守り方
保存するパスワードは、必ず AES-GCM（256 ビット）で暗号化します。マスターパスワードを使うかどうかは、初回の案内で選べます。使う場合、鍵は端末に保存されず、ブラウザを閉じるか、一定の時間が過ぎるとロックされます。

■ データの扱い
登録した内容は、すべてこの端末のブラウザの中に保存し、外部へは送りません。アクセス解析や広告もありません。動作するのは signin.aws.amazon.com のページだけです。

■ そのほか
・日本語と英語に対応しています。ライトとダークは OS の設定に合わせます
・ソースコードは GitHub で公開しています（MIT ライセンス）: https://github.com/htani0817/account-deck-for-aws
・プライバシーポリシー: https://github.com/htani0817/account-deck-for-aws/blob/main/PRIVACY.md

Account Deck for AWS は個人が開発したツールで、Amazon Web Services, Inc. およびその関連会社とは関係がありません。AWS、Amazon Web Services は Amazon.com, Inc. またはその関連会社の商標です。
```

### 画像

- スクリーンショット: `store-assets/ja/01-popup.png` 〜 `05-switch-role.png`（番号順）
- 小さいプロモーション タイル: `store-assets/ja/promo-440x280.png`

## English

### Name (filled in from the manifest)

Account Deck for AWS

### Summary (filled in from the manifest, up to 132 characters)

Keep your AWS sign-in URLs and switch roles in one list and open them in one click. Unofficial; not affiliated with AWS.

### Description

```text
Account Deck for AWS keeps your AWS sign-in pages and switch roles in one list, ready to open from the toolbar in one click. When you move between many AWS accounts, it gets you to the right one quickly and helps you keep production and development apart.

WHAT IT DOES
- Sign in: Open takes you to the AWS sign-in page, fills in the account ID, IAM user name and password, and presses Sign in. If you use MFA, you enter the code afterwards.
- Switch roles: Builds the switch-role page from the account ID and role name, and presses Switch Role for you.
- Colors and labels: Give each environment a color and a short label such as PROD or STG. Colors match the five used on the AWS switch-role page.
- Keyboard: Start typing as soon as the popup opens, then use the arrow keys and Enter. Alt+Shift+A opens the popup itself.
- Reorder and back up: Drag to reorder. Export to and import from a JSON file to move to another browser.

PASSWORD PROTECTION
Saved passwords are always encrypted with AES-GCM (256-bit). On first run you choose whether to use a master password. With one, the key is never stored, and saved passwords lock when the browser closes or after a set time.

YOUR DATA
Everything you register stays in your browser on this device and is never sent anywhere. No analytics, no ads. The extension only runs on signin.aws.amazon.com pages.

ALSO
- Available in English and Japanese. Light and dark themes follow your OS setting.
- Open source (MIT): https://github.com/htani0817/account-deck-for-aws
- Privacy policy: https://github.com/htani0817/account-deck-for-aws/blob/main/PRIVACY.md

Account Deck for AWS is an independent tool and is not affiliated with, endorsed by or sponsored by Amazon Web Services, Inc. AWS and Amazon Web Services are trademarks of Amazon.com, Inc. or its affiliates.
```

### Images

- Screenshots: `store-assets/en/01-popup.png` to `05-switch-role.png` (in order)
- Small promo tile: `store-assets/en/promo-440x280.png`

# プライバシーポリシー / Privacy Policy

Account Deck for AWS（以下「本拡張機能」）

制定日: 2026年10月17日

[English follows Japanese.](#english)

## 日本語

### 扱うデータ

本拡張機能は、利用者が自分で登録した次の情報を扱います。

- 表示名、AWS アカウントID（またはアカウントエイリアス）、サインインURL、IAM ユーザー名、ロール名、ラベル、色、メモ
- IAM ユーザーのパスワード（登録した場合のみ）
- 設定（マスターパスワードを使うかどうか、自動ロックの時間、ポップアップで最後に選んだタブ）

マスターパスワードそのものは保存しません。

### 保存場所と保護

- すべてのデータは、利用者の端末のブラウザ内（`chrome.storage.local`）に保存します。Google アカウントなどでの同期はしません。
- パスワードは必ず AES-GCM（256 ビット）で暗号化して保存します。鍵は、マスターパスワードを使う場合はマスターパスワードから PBKDF2-SHA256 で作り、端末には保存しません。使わない場合は本拡張機能が作ったランダムな鍵を端末内に保存します。
- ロックを解除している間の鍵と、サインイン画面へ渡す入力値は、ブラウザのメモリ上（`chrome.storage.session`）にだけ置き、ブラウザを閉じると消えます。入力値は2分で破棄します。

### 外部への送信

本拡張機能は、データを開発者や第三者のサーバーへ送信しません。アクセス解析や広告、外部のスクリプトも使いません。

利用者が「開く」を押したときに限り、登録したアカウントID・ユーザー名・パスワードを、本拡張機能が開いたタブの AWS サインイン画面（`signin.aws.amazon.com` とそのサブドメイン）の入力欄に入力し、サインインボタンを1回押します。これにより、入力した内容はサインインのために AWS へ送られます（AWS のサインイン画面を手で使ったときと同じ送り先です）。パスワードを保存していない環境では、入力だけでボタンは押しません。

### 権限

- `storage`: 上記のデータを端末内に保存するため
- `https://signin.aws.amazon.com/*`、`https://*.signin.aws.amazon.com/*` へのコンテンツスクリプト: サインイン画面への入力と、スイッチロール画面のボタン操作のため。ほかのサイトでは動作しません

### クリップボード

利用者がコピーのボタンを押したときに限り、アカウントID・ユーザー名・パスワードをクリップボードへ書き込みます。クリップボードの内容は読み取りません。

### データの削除と書き出し

- 登録内容は管理画面からいつでも削除できます。本拡張機能をアンインストールすると、すべてのデータがブラウザから消えます。
- バックアップの書き出しは、利用者が操作したときだけ行い、ファイルは利用者の端末に保存されます。パスワードを含める場合は、利用者が決めたファイル用のパスワードで暗号化します。

### 変更とお問い合わせ

このポリシーを変更する場合は、このページを更新し、改定日を記載します。お問い合わせは [GitHub の Issues](https://github.com/htani0817/account-deck-for-aws/issues) で受け付けます。

本拡張機能は個人が開発したもので、Amazon Web Services, Inc. およびその関連会社とは関係がありません。

## English

Effective date: October 17, 2026

### Data the extension handles

Account Deck for AWS ("the extension") handles only information that you enter yourself:

- Display names, AWS account IDs (or account aliases), sign-in URLs, IAM user names, role names, labels, colors and notes
- IAM user passwords, if you choose to save them
- Settings (whether you use a master password, the auto-lock time and the last tab you chose in the popup)

Your master password itself is never stored.

### Where it is stored and how it is protected

- All data is stored in your browser on your device (`chrome.storage.local`). It is not synced through your Google account or any other service.
- Passwords are always encrypted with AES-GCM (256-bit). With a master password, the key is derived from it with PBKDF2-SHA256 and is never stored. Without one, the extension generates a random key and keeps it on your device.
- While unlocked, the key, and the values handed to a sign-in page, are kept only in browser memory (`chrome.storage.session`) and are cleared when the browser closes. Values for a sign-in page are discarded after two minutes.

### Data sent outside your device

The extension does not send your data to the developer or any third party. It uses no analytics, no advertising and no remote scripts.

Only when you press Open, the extension fills your saved account ID, user name and password into the AWS sign-in page (`signin.aws.amazon.com` and its subdomains) in the tab the extension opened, and presses the Sign in button once. This sends what was filled in to AWS to sign you in, the same destination as when you use the AWS sign-in page by hand. For environments without a saved password, it only fills the form and does not press the button.

### Permissions

- `storage`: to save the data above on your device
- Content scripts on `https://signin.aws.amazon.com/*` and `https://*.signin.aws.amazon.com/*`: to fill the sign-in form and press the Switch Role button. The extension does not run on any other site.

### Clipboard

The extension writes an account ID, user name or password to the clipboard only when you press a copy button. It never reads the clipboard.

### Deleting and exporting data

- You can delete entries at any time from the management page. Uninstalling the extension removes all of its data from your browser.
- Backups are exported only when you ask for one and are saved on your device. If you include passwords, they are encrypted with a file password you choose.

### Changes and contact

If this policy changes, this page will be updated with the revision date. Please contact us through [GitHub Issues](https://github.com/htani0817/account-deck-for-aws/issues).

The extension is developed by an individual and is not affiliated with Amazon Web Services, Inc. or its affiliates.

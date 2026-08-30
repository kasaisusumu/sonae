# そなえ（MVP）

予定を入れるだけで準備リストを自動生成し、編集を学習して「自分専用マニュアル」に育てるアプリ。
検証用プロトタイプ。詳細仕様は [docs/CLAUDE.md](docs/CLAUDE.md)。

## 技術スタック

- Next.js 16 (App Router) + TypeScript / Tailwind CSS v4
- Prisma + SQLite（永続ディスク前提。将来 Postgres へ移行可能）
- Google Calendar API + OAuth 2.0（`googleapis`、スコープ `calendar.readonly`）
- 準備リスト生成: OpenAI API（`gpt-4o-mini`、未設定時はカテゴリ別テンプレート）
- 通知: Web Push（PWA / Service Worker + `web-push` + VAPID）
- 新規予定の検知: `/api/cron/poll` を Cron から数分おきに叩くポーリング

## ローカル開発

```bash
npm install
cp .env.example .env        # 値を編集
npx prisma migrate dev      # SQLite 初期化
npm run dev                 # http://localhost:3000
```

Google 連携なしで試すには、トップページの「開発用ログイン」（本番では自動的に無効）。

## 環境変数（`.env` / `.env.example` 参照）

| 変数 | 用途 |
| --- | --- |
| `DATABASE_URL` | SQLite 接続先。ローカル `file:./dev.db`、本番 `file:/data/prod.db` |
| `SESSION_SECRET` | セッション Cookie 署名鍵（長いランダム文字列） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console の OAuth クライアント（ウェブアプリ） |
| `GOOGLE_REDIRECT_URI` | `<APP_BASE_URL>/api/auth/google/callback`。Console にも同値を登録 |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | 準備リスト生成。未設定でもテンプレートで動作 |
| `APP_BASE_URL` | 公開 URL。OAuth・通知リンク・Cron が使う |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push。`npx web-push generate-vapid-keys` で生成 |
| `CRON_SECRET` | `/api/cron/poll` を叩くときの共有シークレット |
| `ENABLE_DEV_LOGIN` | 本番で開発用ログインを使いたいときだけ `true` |

## モバイル / PWA

- レスポンシブ。モバイルは下部タブバー、デスクトップは上部ナビ。
- `public/manifest.webmanifest` + `public/icons/*` で「ホーム画面に追加」に対応（`display: standalone`）。
- iOS は Safari で「ホーム画面に追加」して開いた場合のみ Web Push を受信できる（iOS 16.4+）。Android は通常のブラウザで可。

## 通知の仕組み

1. ユーザーが設定画面で「通知をオンにする」→ ブラウザが購読を作成 → `PushSubscription` に保存。
2. Cron が `/api/cron/poll`（`x-cron-secret` 必須）を叩く → 全ユーザーの Google カレンダーを `syncUserCalendar` で取り込み。
3. 新規予定が見つかったユーザーの全端末へ「新しい予定が追加されました」を Web Push で送信（初回同期時は送らない）。
4. 手動の「カレンダーから取り込む」ボタンでも同様に新規分だけ通知。

## デプロイ（Render / Docker）

`render.yaml`（Blueprint）で **Web サービス + Cron** を定義済み。

1. このリポジトリを GitHub に push。
2. Google Cloud Console で OAuth 同意画面を「テスト」で用意し、テストユーザーに利用者の Google アカウントを追加。
   Calendar API 有効化、スコープ `calendar.readonly` / `openid` / `email` / `profile`。
3. Render で **New + → Blueprint** → このリポジトリを選択。`starter` プラン以上（永続ディスクのため）。
4. 初回デプロイで URL が確定したら、Render ダッシュボードで `sync:false` の環境変数を設定:
   - `APP_BASE_URL` = `https://<service>.onrender.com`
   - `GOOGLE_REDIRECT_URI` = `https://<service>.onrender.com/api/auth/google/callback`（Google Console の「承認済みリダイレクト URI」にも追加）
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `OPENAI_API_KEY`
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`
   - `CRON_SECRET`（Web と Cron で同じ値）
   - Cron サービスにも `APP_BASE_URL` と `CRON_SECRET` を設定
5. 再デプロイ。`docker-entrypoint.sh` が `prisma migrate deploy` を実行してから起動する。

**「誰でも」の制約**: `calendar.readonly` は Google の制限付きスコープで、一般公開には Google の審査が必要。
当面は OAuth 同意画面を「テストモード」で運用する（テストユーザー最大 100 名、リフレッシュトークンは 7 日で失効＝再ログインで復帰）。

## スクリプト

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run build` | `prisma generate` + `next build` |
| `npm start` | 本番サーバー |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:deploy` | `prisma migrate deploy`（本番） |

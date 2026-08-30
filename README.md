# そなえ（MVP）

予定を入れるだけで準備リストを自動生成し、編集を学習して「自分専用マニュアル」に育てるアプリ。
検証用プロトタイプ。詳細仕様は [docs/CLAUDE.md](docs/CLAUDE.md)。デプロイ手順は [docs/デプロイ手順.md](docs/デプロイ手順.md)。

## 技術スタック

- Next.js 16 (App Router) + TypeScript / Tailwind CSS v4
- Prisma + **PostgreSQL**（本番 = Neon 無料枠。ローカルも Neon 接続文字列を使用）
- Google Calendar API + OAuth 2.0（`googleapis`、スコープ `calendar.readonly`）
- 準備リスト生成: OpenAI API（`gpt-4o-mini`、未設定時はカテゴリ別テンプレート）
- 通知: Web Push（PWA / Service Worker + `web-push` + VAPID）
- 新規予定の検知: GitHub Actions（`.github/workflows/poll.yml`）が数分おきに `/api/cron/poll` を叩く
- ホスティング: Vercel（無料 Hobby）

## ローカル開発

```bash
npm install
cp .env.example .env         # DATABASE_URL / DIRECT_URL に Neon の接続文字列を入れる
npm run db:deploy            # Neon にテーブル作成（初回・スキーマ変更時）
npm run dev                  # http://localhost:3000
```

Google 連携なしで試すには、トップページの「開発用ログイン」（本番では自動的に無効）。

## 環境変数（`.env` / `.env.example` 参照）

| 変数 | 用途 |
| --- | --- |
| `DATABASE_URL` | Neon の **Pooled** 接続文字列（アプリ実行用） |
| `DIRECT_URL` | Neon の **Direct** 接続文字列（マイグレーション用） |
| `SESSION_SECRET` | セッション Cookie 署名鍵（長いランダム文字列） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console の OAuth クライアント |
| `GOOGLE_REDIRECT_URI` | `<APP_BASE_URL>/api/auth/google/callback`。Console にも同値を登録 |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | 準備リスト生成。未設定でもテンプレートで動作 |
| `APP_BASE_URL` | 公開 URL（OAuth・通知リンク・cron が使用） |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push。`npx web-push generate-vapid-keys` |
| `CRON_SECRET` | `/api/cron/poll` を叩くときの共有シークレット |
| `ENABLE_DEV_LOGIN` | 本番で開発用ログインを使いたいときだけ `true` |

## モバイル / PWA

- レスポンシブ。モバイルは下部タブバー、デスクトップは上部ナビ。
- `public/manifest.webmanifest` + `public/icons/*` で「ホーム画面に追加」に対応（`display: standalone`）。
- iOS は Safari で「ホーム画面に追加」して開いた場合のみ Web Push を受信可（iOS 16.4+）。Android は通常のブラウザで可。

## 通知の仕組み

1. ユーザーが設定画面で「通知をオンにする」→ ブラウザが購読を作成 → `PushSubscription` に保存。
2. GitHub Actions が `/api/cron/poll`（`x-cron-secret` 必須）を数分おきに叩く → 全ユーザーのカレンダーを `syncUserCalendar` で取り込み。
3. 新規予定が見つかったユーザーの全端末へ Web Push（初回同期時は送らない）。
4. 手動の「カレンダーから取り込む」ボタンでも新規分だけ通知。

## デプロイ

[docs/デプロイ手順.md](docs/デプロイ手順.md) に、Neon → Google Console → Vercel → GitHub Actions →
スマホ設定まで、コピペ値つきの詳細手順があります。

## スクリプト

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run build` | `prisma generate` + `next build` |
| `npm start` | 本番サーバー |
| `npm run db:migrate` | `prisma migrate dev`（スキーマ変更時） |
| `npm run db:deploy` | `prisma migrate deploy` |

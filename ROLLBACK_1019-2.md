# 本番昇格（テスト環境のver1/ver2切替版を本番へ移行） 巻き戻しの記録（作業名「1019-2」）

この文書は作業の**着手前**に記録したもの。ユーザーが「1019-2に戻して」と言ったときに、
ここに書いた手順で着手前の状態へ戻せるようにしておく。

> **注**: この文書には接続文字列（パスワードを含む）を書かない。必要な接続文字列は
> そのつど `npx neonctl connection-string <ブランチ名> --project-id snowy-night-35247032`
> で取得する（Neon にログイン済みの端末からのみ取得可能）。

## 1. 基準点（2026-10-19 着手前）

### 1.1 コード（git）

- 本番ブランチ: `main`
- 着手直前のコミット: `c78043ba823e7ba2b548bd5a6fee89fb7c43e5d4`
  （「予定詳細で枠の並び替え時に古いハッシュ（#failure-check等）へ飛ばされる不具合を修正」）
- タグ: `pre-prod-migration-1019-2`（上記コミットに付与・push済み）
  ```
  git tag -a pre-prod-migration-1019-2 -m "本番昇格着手前の基準点" c78043ba823e7ba2b548bd5a6fee89fb7c43e5d4
  git push origin pre-prod-migration-1019-2
  ```
- 作業ブランチ: `migration/1019-2-promote-test-to-main`（`main` から分岐）。
  このブランチで `test`（テスト環境のver1/ver2切替版）をマージし、検証後に `main` へ
  マージ（`--no-ff`）する。

### 1.2 DB（Neon）

- プロジェクト: `sonae`（project id: `snowy-night-35247032`、org: みどり /
  `org-purple-rain-46154020`）
- 本番ブランチ: `production`（`br-gentle-silence-a7fm2l9o`、primary/default）→ ホスト
  `ep-delicate-darkness-a7kptnav.ap-southeast-2.aws.neon.tech`。ローカル `.env` の
  `DATABASE_URL` もこれと同じホストを指している。
  **ローカルで `prisma migrate deploy` 等を直接実行すると本番に当たるので、
  作業時以外は絶対に行わない。**
- **バックアップ用ブランチ**（`production` から作成、着手前の状態をそのままコピーオンライトで保持）:
  - 名前: `production-pre-1019-2`
  - id: `br-holy-bread-a797rfso`（親: `br-gentle-silence-a7fm2l9o`）
  - エンドポイント: `ep-orange-boat-a78ve791.ap-southeast-2.aws.neon.tech`
  - 接続文字列: `npx neonctl connection-string production-pre-1019-2 --project-id snowy-night-35247032 --pooled`
    で取得（この文書には埋め込まない。パスワードが本番ブランチと共通のため）。
  - 作成コマンド:
    ```
    npx neonctl branches create --project-id snowy-night-35247032 \
      --parent production --name production-pre-1019-2
    ```
  - このブランチは、作業完了後も**消さずに残す**（本番の「完全な巻き戻し」用の保険）。
- **基準値**（`scripts/migration-baseline-1019-2.json` に記録済み・コミット対象。
  生成スクリプト: `scripts/migration-baseline-1019-2.mjs`）:
  - 全テーブルの行数
  - 主要テーブル（User, Event, ChecklistItem, EditRecord, LearnedRule, Category,
    FailureLog, SavingsEntry）の内容ハッシュ
  - 適用済みマイグレーション一覧
- **調査で判明した重要な事実**: ドキュメント（`機能仕様_本番との差分_エンジニア向け.md`）
  では test 側の新規マイグレーション9件がすべて本番未適用と記載されていたが、実際に
  本番DBを調べたところ、次の **5件は既に本番へ適用済み**だった（テーブル自体は存在するが
  0行、使われていないだけ。実害なし）:
  - `20260930150000_future_messages`
  - `20261004100000_checklist_scope`
  - `20261010120000_scope_hint`
  - `20261012100000_event_future_message_done`
  - `20261013110000_future_message_proposal_cache`

  今回の作業で**新たに本番へ適用するマイグレーション**は次の4件
  （＋ featureMode既定値修正の新規マイグレーション1件、下記2章参照）:
  - `20261014090000_feature_mode`
  - `20261018195634_add_last_written_content_hash`
  - `20261018210215_add_item_scope_categories`
  - `20261018210944_add_list_template_default_scope`

### 1.3 Vercel

- プロジェクト: `sonae`（スコープ `kasaisusumus-projects`）
- 着手直前の本番デプロイ:
  - deployment id: `dpl_4AwmXYimPFub4iiecfkvKJvX9d2f`
  - URL: `https://sonae-ramsbt9wz-kasaisusumus-projects.vercel.app`
  - `sonae-teal.vercel.app`（本番エイリアス）はこのデプロイを指している
  - 作成時刻: 2026-10-19 12:31:57 JST（git commit `c78043b` から自動デプロイされたもの）
  - ロールバック時は `npx vercel rollback https://sonae-ramsbt9wz-kasaisusumus-projects.vercel.app`
    で即時に戻せる。

### 1.4 環境変数

- 新しく追加する環境変数は無し（`DATABASE_URL`/`DIRECT_URL` は本番の既存の値のまま、
  featureMode 等はすべて DB の列として持たせる設計のため）。

## 2. 今回の実装で特有の対応（既存の「機能モード切替」実装との違い）

- `20261014090000_feature_mode` は `User.featureMode` を `DEFAULT 'test'` で追加する。
  これをそのまま本番へ適用すると、**既存の本番ユーザー全員が自動的に ver2
  （未来の自分へのメッセージ・3択）扱いになってしまう**。
  ユーザー確認の結果、これは望まない（既存・新規ユーザーとも既定は ver1）。
- 対応: 新しいマイグレーション `<timestamp>_default_feature_mode_production` を追加し、
  (a) `ALTER TABLE "User" ALTER COLUMN "featureMode" SET DEFAULT 'production'`
  （今後の新規ユーザーの既定も ver1 に）、
  (b) `UPDATE "User" SET "featureMode" = 'production' WHERE "featureMode" = 'test'`
  （本マイグレーション適用時点の既存ユーザー全員を ver1 に戻す）を実行する。
  `prisma/schema.prisma` の `featureMode` の既定値も `"production"` に修正済み。
- down SQL（戻すとき）: このマイグレーションの down は
  `ALTER TABLE "User" ALTER COLUMN "featureMode" SET DEFAULT 'test'` のみ
  （(b)のUPDATEは、どのユーザーが元々 'test' だったか記録が無いため逆変換できない。
  実害は無い想定: 本番昇格前は featureMode 列自体が存在しなかったため、
  「元が test だった本番ユーザー」は存在しない）。

## 3. 巻き戻しの方法

### 3.1 軽い巻き戻し（既定）— 作業後に作られた実データ（利用者の予定・編集など）は残す

1. マージコミットを戻す:
   ```
   git checkout main
   git revert -m 1 <mainへのマージコミットhash>
   git push origin main
   ```
2. DB を戻す（今回追加した各マイグレーションの down SQL を、本番に向けて実行する。
   `prisma/rollback/` 以下に用意。実行前に dry-run で対象件数を確認する安全策を入れる）。
3. Vercel: `npx vercel rollback https://sonae-ramsbt9wz-kasaisusumus-projects.vercel.app`
   で、デプロイだけ即時に前の状態へ戻すこともできる（DB・コードの巻き戻しと並行して、
   まず表に見える部分だけ即座に戻したい場合）。
4. `public/sw.js` を変更していた場合は、バージョン番号を進める（戻す方向でも進める）。

### 3.2 完全な巻き戻し — 作業後に利用者が行った操作もすべて失う

バックアップ用ブランチ `production-pre-1019-2`（`br-holy-bread-a797rfso`）の内容で
`production`（`br-gentle-silence-a7fm2l9o`）を丸ごと置き換える。Neon の「ブランチを
リストア」操作、または接続文字列の切り替えで行う。**実行前に、着手後に実際の利用者が
行った操作（新しい予定・編集・学習内容など）が失われることを必ず表示してから実行する。**
ユーザーが「完全に」と明示したときだけ行う。

### 3.3 検証

戻した後、`scripts/migration-baseline-1019-2.json` の値と一致するか
（テーブル行数・主要テーブルのハッシュ・適用済みマイグレーション一覧）を確認する。

## 4. 実装の記録（作業完了後に追記）

（ここに、実際のマージコミットhash・適用したマイグレーション・デプロイ結果・
検証結果を追記する。）

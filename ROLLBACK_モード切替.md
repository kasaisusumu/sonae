# 機能モード切替（テスト版／本番版） 巻き戻しの記録

この文書は「機能モード切替」実装の**着手前**に記録したもの。私（Claude）が後で
この機能を壊したり、ユーザーが「戻して」と言ったときに、ここに書いた手順で
実装前の状態へ戻せるようにしておく。

## 1. 基準点（2026-10-14 着手前）

### 1.1 コード（git）
- ブランチ: `test`
- 着手直前のコミット: `aae6991276afc2380293cb42145d0dca3b72c98f`
  （「AI利用金額の節に、全13箇所の利用場所・用途・無駄打ち対策の一覧表を追加」）
- タグ: `pre-mode-switch-2026-10-14`（上記コミットに付与・push 済み）
  ```
  git tag -a pre-mode-switch-2026-10-14 -m "機能モード切替着手前の基準点" aae6991276afc2380293cb42145d0dca3b72c98f
  git push origin pre-mode-switch-2026-10-14
  ```

### 1.2 DB（Neon）
- プロジェクト: `sonae`（project id: `snowy-night-35247032`、org: みどり / `org-purple-rain-46154020`）
- ブランチ構成（Neon 上のブランチ。git のブランチとは別物）:
  - `production`（`br-gentle-silence-a7fm2l9o`、primary/default）→ ホスト
    `ep-delicate-darkness-a7kptnav.ap-southeast-2.aws.neon.tech`（＝本番 `sonae` が使う DB。
    ローカル `.env` の `DATABASE_URL` もこれと同じホストを指している。**ローカルで
    `prisma migrate deploy` 等を直接実行すると本番に当たるので絶対に行わない**）
  - `test`（`br-bold-credit-a7vvz8fg`、親は `production`）→ ホスト
    `ep-bitter-queen-a7bsqfo8.ap-southeast-2.aws.neon.tech`（＝ `sonae-test` が使う DB。
    今回の作業対象）
- **バックアップ用ブランチ**（`test` から作成、着手前の状態をそのままコピーオンライトで保持）:
  - 名前: `test-pre-mode-switch-2026-10-14`
  - id: `br-fragrant-voice-a77o78bl`（親: `br-bold-credit-a7vvz8fg`）
  - エンドポイント: `ep-patient-hall-a7nrlxdc.ap-southeast-2.aws.neon.tech`
  - 作成コマンド:
    ```
    npx neonctl branches create --project-id snowy-night-35247032 \
      --parent test --name test-pre-mode-switch-2026-10-14
    ```
  - このブランチは、今回の作業が終わってロールバック検証が済むまで（§8）は消さない。
    検証後も「完全な巻き戻し」用の保険として残す。
- **基準値**（`scripts/mode-switch-baseline-2026-10-14.json` に記録済み・コミット対象）:
  - 全24テーブルの行数（合計 10,173 行。詳細はファイル参照）
  - 主要テーブル（User, Event, ChecklistItem, EditRecord, LearnedRule,
    ChecklistScopeRule, EventChecklistScope, FutureMessage, EventFutureMessage）の
    内容ハッシュ（`md5(string_agg(row_to_json(x)::text, '|' order by x.id))`）
  - 適用済みマイグレーション一覧（45件、`_prisma_migrations` より）

### 1.3 Vercel
- プロジェクト: `sonae-test`（スコープ `team_G8xsQj03cCwf0rLubvpIAUYE`）
- 着手直前の本番デプロイ:
  - deployment id: `dpl_6PN26hxiMhqTS1iTY5Cjc3HqaMA7`
  - URL: `https://sonae-test-gzrtwusqn-kasaisusumus-projects.vercel.app`
  - `sonae-test.vercel.app`（エイリアス）はこのデプロイを指している
  - 作成時刻: 2026-10-14 07:34:04 JST

### 1.4 環境変数
- 新しく追加した環境変数は無し（`User.featureMode` は DB の列として持たせる設計にしたため、
  環境変数は増やさない方針。実装中にこれが崩れたらここに追記する）。

## 2. 巻き戻しの方法

### 2.1 軽い巻き戻し（既定）— 作業後に作ったデータは残す
1. マージコミットを `git revert -m 1 <マージコミットのハッシュ>` で戻す
   （マージコミットのハッシュは実装完了後にこの節へ追記する）。
2. `prisma/rollback/<マイグレーション名>.down.sql` を、適用したマイグレーションの
   **逆順**で実行する（追加した列・テーブル・インデックスを削除）。
3. モード切替で作った「自動変換の派生行」（`autoConverted=true` の行）だけを削除する
   （元データ・ユーザーが手で触った行は消さない）。
4. `scripts/rollback-mode-switch.mjs --execute` を実行する（既定は dry-run。
   接続先が `test` ブランチ以外なら即中止する安全策あり）。
5. `public/sw.js` を変更していた場合は、バージョン番号を進める（戻す方向でも進める。
   同じ番号に戻すと端末の古いキャッシュが残るため）。

### 2.2 完全な巻き戻し — 作業後に作ったデータも含めて失う
バックアップ用ブランチ `test-pre-mode-switch-2026-10-14`（`br-fragrant-voice-a77o78bl`）の
内容で `test`（`br-bold-credit-a7vvz8fg`）を丸ごと置き換える。Neon の「ブランチをリストア」
操作、または新しい接続文字列への切り替えで行う。**実行前に、着手後に作成・編集された
データ（予定・メッセージ・編集など）が失われることを必ず表示してから実行する。**
私が「完全に」と明示したときだけ行う。

### 2.3 検証
戻した後、`scripts/mode-switch-baseline-2026-10-14.json` の値と一致するか
（テーブル行数・主要テーブルのハッシュ・適用済みマイグレーション一覧）を確認する。

## 3. 実装の記録

- 実装ブランチ: `feature/mode-switch`（`test` から分岐。push 済み）
- マイグレーション（追加のみ、test ブランチの実DBに適用済み）:
  `20261014090000_feature_mode`（`User.featureMode`、`LearnedRule`/`ChecklistScopeRule`
  の変換用列、`FeatureModeChange` テーブル）
- down SQL: `prisma/rollback/20261014090000_feature_mode.down.sql`
- `test` へのマージコミット: （マージ実行後にこの行へ追記する）
- `sonae-test` への反映デプロイ: （マージ実行後にこの行へ追記する）

## 4. 巻き戻しの検証結果（実装後・2026-10-14 実施）

§8 の手順どおり、バックアップ用ブランチ `test-pre-mode-switch-2026-10-14`
（`br-fragrant-voice-a77o78bl`）からさらに一時ブランチ `_tmp-rollback-verify-2026-10-14`
（`br-soft-glitter-a7ragtcb`、検証後に削除済み）を作り、そこにマイグレーション
`20261014090000_feature_mode` を適用してから `scripts/rollback-mode-switch.mjs --execute`
を実行した。結果、`scripts/mode-switch-baseline-2026-10-14.json`（着手前の基準値）と比較して:

- テーブル一覧: 一致
- 全テーブルの行数: **不一致 0 件**
- 主要9テーブル（User, Event, ChecklistItem, EditRecord, LearnedRule,
  ChecklistScopeRule, EventChecklistScope, FutureMessage, EventFutureMessage）の
  内容ハッシュ: **不一致 0 件**
- 適用済みマイグレーション一覧: 一致
- `User`/`LearnedRule`/`ChecklistScopeRule` に機能モード関連の列が残っていない: 確認済み
- `FeatureModeChange` テーブルが削除された: 確認済み

→ **着手前の状態と完全に一致することを確認した。**

検証中に、`scripts/rollback-mode-switch.mjs` の dry-run 表示で down SQL の文を
1文（`FeatureModeChange` の外部キー制約の削除）数え落としていた不具合を発見・修正した
（コメント行が直後の文とまとめて除外されていたため。実害は無かった＝その文の対象
テーブル自体を直後に DROP TABLE するので、どちらにせよ制約は一緒に消えていた）。
あわせて、自動変換の派生行（`autoConverted=true`）を down SQL の列削除より前に
削除する処理も追加した（列が消えると判別できなくなるため、順序が重要）。

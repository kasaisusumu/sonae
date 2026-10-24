# ロールバック手順: 1023-1（急ぎ/そのうちタグ・ホーム一覧・ショートカットAPI）

作業は `test` ブランチで行い、`sonae-test` で確認してから本番（`main`）へ反映する。
「1023-1に戻して」と言われたら、この作業の**前の状態**に戻す。

## 基準点（着手前）

- git タグ: `pre-1023-1`（コミット `11d7714`）。`main`・`test` は着手時点で同一内容。
- 本番 Neon DBブランチ: この時点ではまだ何もマイグレーションを当てていない
  （DB側の基準点は、本番へ実際に反映する直前に別途記録する。現時点ではコードの
  変更だけが対象）。
- テスト Neon DBブランチ（`test`）: 今回の作業用に新しいマイグレーションを追加で
  当てる。既存データは変更しない前提（追加のみのマイグレーション）。

## ⚠️ インシデント記録（2026-10-24）: `20261023054147_item_priority_and_shortcut_token` が誤って本番DBにも適用された

ver2.1用の新しいマイグレーション（`priorityExtrasEnabled`列）を作ろうとして
`npx prisma migrate dev` を実行した際、このコマンドが `.env.local`（テストDBを
指す）ではなく `.env`（本番DBを指す）だけを読み込む仕様だったため、意図せず
本番Neonブランチに接続し、その時点で未適用だった3件のマイグレーション
（`20261023054147_item_priority_and_shortcut_token`・
`20261023071821_lock_screen_image`・`20261023143655_standalone_priority_item`）
が本番DBに適用されてしまった。

- 3件とも追加のみ（`CREATE TABLE`・null許容列の追加）で、既存データの削除・変更は
  無い。本番の実際のコード（`main`）はこれらの新テーブルを一切参照しないため、
  アプリの動作への実害は無いと判断。
- ユーザーに確認の上、**「実害が無いなら残していい」**との指示を得て、本番DBの
  この3テーブル・列はそのまま残すことにした（巻き戻していない）。
- 以後、`prisma migrate` 系コマンドを対話的に（`--name`付きの`migrate dev`等で）
  実行するときは、`.env.local`に頼らず**必ずコマンドに`DATABASE_URL`/`DIRECT_URL`を
  明示的に渡す**（`docs/テスト環境構築手順.md`の「マイグレーションの当て方」に
  元々明記されていた方法。今回それを怠ったのが原因）。

この結果、上の「本番 Neon DBブランチ: まだ何も当てていない」という記述は、
この3件に関してはもう正確ではない（本番にテーブル・列としては存在するが、
本番のコードからは使われていない、という状態）。

## 戻し方（コード）

```
git checkout main   # または test
git reset --hard pre-1023-1
git push origin main --force-with-lease   # 本番へ反映していた場合
git push origin test --force-with-lease
```

`test` ブランチだけで作業中（本番へ未反映）の間は、`test` だけを `pre-1023-1` に
戻せばよい。`main` へ反映した後に戻す場合は、両方を戻す。

## 戻し方（DB・テスト環境）

今回追加するマイグレーションは全て追加のみ（新規テーブル・新規列）の想定。
各マイグレーションの `down.sql` を `prisma/rollback/` に用意する（本体の
マイグレーションと同じコミットで追加）。テスト環境のDBだけ戻す場合は、
該当の down SQL をテスト用Neonブランチに実行し、`_prisma_migrations` から
該当行を削除するか `prisma migrate resolve --rolled-back <name>` を使う。

## 戻し方（DB・本番）

4件のマイグレーション（うち3件は§「インシデント記録」の事故で、残り1件
`20261024075306_priority_extras_enabled`は2026-10-24の正式な昇格作業で）、
いずれも本番Neonブランチに適用済み。全て追加のみ（新規テーブル・新規列）
なので、戻す場合は各`down.sql`（`prisma/rollback/`配下）を本番Neonブランチに
対して`DATABASE_URL`/`DIRECT_URL`を明示的に本番の値に指定して実行し、
`_prisma_migrations`から該当行を削除するか`prisma migrate resolve
--rolled-back <name>`を使う。本番Neonブランチの別ブランチへのバックアップは
作成していない（4件とも追加のみで、既存データへの影響が無いため不要と判断）。

## 完了後の更新

**2026-10-24に本番へ反映済み**。git側は`test`を`main`へ`git merge`
（コンフリクト無し）し、`promote-ver2.1-to-main`ブランチ経由でfast-forwardで
`main`へpush（マージコミット`28ee19b`）。昇格直前の`main`は
tag `pre-ver2.1-promotion`（コミット`e93b807`）に残してある。
DB側は上記のとおり4件とも本番Neonブランチに適用済み。Vercelのビルド・
デプロイも成功を確認（`https://sonae-teal.vercel.app/`が200で応答、
サーバーログにエラー無し）。昇格後、本番の既存ユーザー全員（8名）が
`priorityExtrasEnabled=false`のままであることを確認した（見た目は変わらない）。

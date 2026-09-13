/**
 * アプリの表示名・説明文はここに集約する。名前や紹介文を変えるときは、
 * まずここを直せば、ページタイトル・OGP/検索プレビュー・通知文言・カレンダー
 * 説明欄マーカーなど、ここから import している箇所は自動で追随する。
 *
 * ただし次は静的ファイル（JS から import できない）ため、名前を変えるたびに
 * 手動で合わせて直すこと:
 * - public/manifest.webmanifest（"name" / "short_name" / "description"）
 * - public/sw.js（先頭コメント・通知タイトルのフォールバック文言）
 * - README.md / docs/*.md（説明文中の名称）
 *
 * lib/description.ts の LEGACY_MARKS（過去の名前の履歴）は、ここには連動させず
 * 名前を変えるたびに「直前までの APP_NAME の値」を手で追記していく
 * （カレンダーに書き込み済みの過去のマーカーを引き続き認識するため）。
 */
export const APP_NAME = "私のマニュアル「そなえ」さん";
export const APP_TAGLINE = "予定の準備リスト";
export const APP_DESCRIPTION =
  "予定を入れるだけで準備リストを自動生成。編集を学習して自分専用マニュアルに育てます。";

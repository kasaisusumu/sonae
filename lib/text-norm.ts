/** 項目タイトルの照合キー（空白と大文字小文字を無視）。checklist/学習/範囲ルールで共通に使う。 */
export const normTitle = (s: string) =>
  s.toLowerCase().replace(/\s+/g, "").trim();

/**
 * 日付・番号・時刻などを含む、明らかにその回に固有の内容か（AI を呼ぶまでもない足切り）。
 * `lib/pattern-classify.ts`（汎用パターン判定）・`lib/item-scope.ts`（「次回の出し方」推奨）の
 * 両方で、「一度きりの内容」と確信できるケースを AI 抜きで判定するのに使う。
 */
export function looksTooSpecific(title: string): boolean {
  return /\d{1,4}\s*(年|月|日|時|号|番|階)/.test(title);
}

/**
 * 予定名から、キーワード候補を1つ選ぶ。「この名前の予定だけ」クイック選択の
 * 自動キーワードに使う。サーバー・クライアントどちらでも使えるよう純粋な文字列処理
 * だけにしてある（prisma/openai 等への依存なし）。
 * 予定名そのもの（トリムのみ）を使う（ユーザー指摘により2026-10-20再修正: 以前は
 * 区切りで分けた最初のトークンだけを使っていたため、例えば「〇〇社 定例会議」のような
 * タイトルで「〇〇社」だけがキーワードになり、「〇〇社」を含む全く別の予定にまで広く
 * 一致してしまっていた＝「この名前」のはずが「似た予定」のように振る舞う不具合があった。
 * 「この名前」は予定名そのものへの一致が最も正確）。
 */
export function pickKeyword(eventTitle: string): string {
  const trimmed = eventTitle.trim();
  return (trimmed || eventTitle).slice(0, 60);
}

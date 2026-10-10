/** 項目タイトルの照合キー（空白と大文字小文字を無視）。checklist/学習/範囲ルールで共通に使う。 */
export const normTitle = (s: string) =>
  s.toLowerCase().replace(/\s+/g, "").trim();

/**
 * 予定名から、キーワード候補を1つ選ぶ（区切りで分けた最初の2文字以上）。
 * 「この名前の予定だけ」クイック選択の自動キーワードに使う。サーバー・クライアントどちらでも
 * 使えるよう純粋な文字列処理だけにしてある（prisma/openai 等への依存なし）。
 */
export function pickKeyword(eventTitle: string): string {
  const parts = eventTitle
    .split(/[\s　・／/（）()「」【】『』,、]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  return (parts[0] ?? eventTitle.trim()).slice(0, 30);
}

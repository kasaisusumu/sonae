/** 項目タイトルの照合キー（空白と大文字小文字を無視）。checklist/学習/範囲ルールで共通に使う。 */
export const normTitle = (s: string) =>
  s.toLowerCase().replace(/\s+/g, "").trim();

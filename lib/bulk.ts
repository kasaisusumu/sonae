/**
 * メモ帳などから貼り付けたテキストを 1 行 1 項目のタイトル配列にする。
 * 行頭の記号・番号・チェック記号・末尾の「（…前）」などは落とす。重複は除去。
 * クライアント・サーバー両方から使うため依存なし。
 */
export function parseBulkTitles(text: string): string[] {
  let lines = text.split(/\r?\n/);
  if (lines.length === 1 && /[、,]/.test(lines[0])) {
    lines = lines[0].split(/[、,]/);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    let line = raw.replace(/[　 ]/g, " ").trim();
    if (!line) continue;
    line = line
      .replace(
        /^(?:[-*・•‣▸▹>＞○●◦]|\[[ xX]\]|[☐☑✅⬜◻◼■□▪▫]|\d+[.)、]|[（(]\d+[）)])\s*/,
        "",
      )
      .trim();
    line = line.replace(/^(?:済み?|done|[✓✔☑])\s*[:：\-]?\s*/i, "").trim();
    line = line.replace(/[（(]\s*[^（()）]{1,16}\s*[）)]\s*$/, "").trim();
    if (!line) continue;
    const key = line.toLowerCase().replace(/\s+/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line.slice(0, 120));
  }
  return out;
}

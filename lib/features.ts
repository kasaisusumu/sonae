export interface EventFeatureData {
  isOverseas: boolean | null;
  durationNights: number | null;
  isWeekday: boolean;
  keywords: string[];
}

const OVERSEAS_HINTS = [
  "海外", "国際", "国際線", "出国", "入国", "パスポート", "ビザ", "visa",
  "両替", "時差", "現地時間", "esim", "海外sim", "ローミング", "overseas", "abroad",
  "ハワイ", "グアム", "サイパン", "台湾", "台北", "韓国", "ソウル", "釜山", "香港",
  "上海", "北京", "シンガポール", "バンコク", "タイ", "ベトナム", "ハノイ", "ホーチミン",
  "バリ", "セブ", "マニラ", "インド", "ドバイ", "トルコ", "イスタンブール",
  "ハワイ島", "ニューヨーク", "ロサンゼルス", "サンフランシスコ", "ラスベガス",
  "ロンドン", "パリ", "ローマ", "ミラノ", "バルセロナ", "マドリード", "ベルリン",
  "ミュンヘン", "アムステルダム", "ウィーン", "プラハ", "フランクフルト",
  "シドニー", "メルボルン", "ケアンズ", "オークランド",
];

const DOMESTIC_HINTS = [
  "国内", "日帰り", "都内", "県内", "市内", "近場", "日帰り出張",
];

const STOPWORDS = new Set([
  "する", "こと", "ため", "もの", "など", "その", "この", "あの", "そして",
  "予定", "打ち合わせ", "ミーティング", "会議", "面談", "訪問", "確認", "対応",
  "から", "まで", "への", "にて", "につ", "ついて", "および",
  "am", "pm", "the", "and", "for", "with", "meeting", "call",
]);

/** タイトル・メモから海外かどうかを推定（不明なら null）。 */
function inferOverseas(text: string): boolean | null {
  const t = text.toLowerCase();
  const overseas = OVERSEAS_HINTS.some((k) => t.includes(k.toLowerCase()));
  const domestic = DOMESTIC_HINTS.some((k) => t.includes(k));
  if (overseas && !domestic) return true;
  if (domestic && !overseas) return false;
  if (overseas && domestic) return null;
  return null;
}

/** 日付範囲・タイトルから宿泊数を推定（日帰り=0、不明なら null）。 */
function inferNights(
  start: Date,
  end: Date | null | undefined,
  text: string,
): number | null {
  // 明示テキスト優先
  if (/日帰り/.test(text)) return 0;
  const paku = text.match(/(\d+)\s*泊/);
  if (paku) return Math.max(0, Number(paku[1]));
  const weeks = text.match(/(\d+)\s*週間/);
  if (weeks) return Math.max(0, Number(weeks[1]) * 7 - 1);

  if (end) {
    const d0 = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const d1 = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const nights = Math.round((d1.getTime() - d0.getTime()) / 86400000);
    if (Number.isFinite(nights)) return Math.max(0, nights);
  }
  return null;
}

/** タイトル・メモから主要キーワードを抽出（最大8語）。 */
function extractKeywords(text: string): string[] {
  const tokens =
    text.match(/[一-龠々〆ヵヶ]{2,}|[ァ-ヴ]{2,}|[a-zA-Z][a-zA-Z0-9]{1,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokens) {
    const w = raw.toLowerCase();
    if (w.length < 2 || STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(raw);
    if (out.length >= 8) break;
  }
  return out;
}

export function extractEventFeature(event: {
  title: string;
  memo?: string | null;
  eventDatetime: Date;
  endDatetime?: Date | null;
}): EventFeatureData {
  const text = `${event.title}\n${event.memo ?? ""}`;
  const day = event.eventDatetime.getDay();
  return {
    isOverseas: inferOverseas(text),
    durationNights: inferNights(event.eventDatetime, event.endDatetime, text),
    isWeekday: day >= 1 && day <= 5,
    keywords: extractKeywords(text),
  };
}

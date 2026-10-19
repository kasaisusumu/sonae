/**
 * 「似た予定」（scope="similar"）の一致判定を、事前定義したカテゴリ語彙に基づいて行う
 * （ユーザー指摘により2026-10-19導入。lib/item-scope.ts の buildRuleData・
 * lib/scope-match.ts の matchScopeRule から使われる）。
 *
 * 設計:
 * - リスト項目を「似た予定」に設定したタイミングで、AI を1回だけ呼び出し、
 *   この語彙の中から最大10個のカテゴリを選んで ChecklistScopeRule.categories に保存する
 *   （classifyItemCategories）。以後そのルールが生きている間は再生成しない。
 * - 新しい予定が追加されたときは、予定名・説明文からこの語彙をキーワードで
 *   ルールベースに判定するだけ（inferCategoriesFromText）。AI は一切呼ばない。
 * - 一致判定（lib/scope-match.ts）は、保存済みカテゴリと推定カテゴリが
 *   2つ以上重なったときだけ「一致」とみなす。1つだけの一致（単一の広いカテゴリに
 *   偶然触れただけ）では追加しない。
 */
import OpenAI from "openai";
import { recordAiUsage } from "@/lib/ai-usage";
import { normalizeMatchText } from "@/lib/future-messages";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * カテゴリ → そのカテゴリに属すると判定するキーワード（正規化前の表記）。
 * 新しい予定の本文にこれらの語が含まれていれば、そのカテゴリに該当するとみなす
 * （inferCategoriesFromText。AI は使わない）。
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  交通: ["電車", "新幹線", "バス", "飛行機", "空港", "駅", "タクシー", "車", "自動車", "高速", "乗り換え", "切符", "改札", "搭乗", "運転", "駐車", "自転車", "船", "フェリー"],
  移動: ["移動", "出発", "到着", "向かう", "集合", "乗る", "降りる"],
  宿泊: ["ホテル", "旅館", "宿", "チェックイン", "チェックアウト", "民宿", "予約番号"],
  旅行: ["旅行", "観光", "ツアー", "パスポート", "海外", "出張"],
  書類: ["書類", "資料", "申込書", "契約書", "印刷", "コピー", "証明書", "提出", "記入"],
  印鑑サイン: ["印鑑", "はんこ", "サイン", "署名", "実印", "認印"],
  身分証: ["身分証", "免許証", "マイナンバー", "保険証", "パスポート"],
  支払い: ["支払い", "料金", "費用", "会費", "振込", "精算", "領収書", "請求書"],
  現金カード: ["現金", "財布", "小銭", "クレジットカード", "カード", "ICカード", "電子マネー"],
  予約チケット: ["予約", "チケット", "券", "座席", "予約番号", "予約確認"],
  時間集合: ["時間", "集合", "開始", "締切", "期限", "早め", "前日", "当日"],
  連絡報告: ["連絡", "電話", "メール", "報告", "確認の連絡", "返信"],
  子ども: ["子ども", "子供", "赤ちゃん", "園児", "幼稚園", "保育園", "送迎", "おむつ", "ベビーカー"],
  ペット: ["ペット", "犬", "猫", "動物病院", "ケージ", "リード"],
  医療健康: ["病院", "通院", "診察", "薬", "処方箋", "検査", "健康診断", "歯医者", "予防接種"],
  仕事会議: ["会議", "打ち合わせ", "商談", "プレゼン", "資料", "名刺", "出社", "出勤"],
  学校: ["学校", "授業", "宿題", "提出物", "試験", "テスト", "部活", "入学", "卒業"],
  行事式典: ["式", "結婚式", "入学式", "卒業式", "葬儀", "法事", "お祝い", "パーティー", "イベント"],
  贈り物: ["プレゼント", "贈り物", "お土産", "ギフト", "お礼", "のし"],
  食事: ["食事", "ランチ", "ディナー", "予約席", "弁当", "飲み会", "食材", "レストラン"],
  服装身だしなみ: ["服装", "スーツ", "制服", "着替え", "ネクタイ", "靴", "身だしなみ", "化粧", "散髪"],
  天候対策: ["天気", "雨", "傘", "暑さ", "寒さ", "日焼け止め", "防寒", "熱中症"],
  運動スポーツ: ["運動", "スポーツ", "試合", "練習", "ユニフォーム", "ジム", "ヨガ"],
  電子機器充電: ["充電", "バッテリー", "スマホ", "パソコン", "カメラ", "モバイルバッテリー", "電源"],
  鍵入室: ["鍵", "カギ", "暗証番号", "入館証", "セキュリティ"],
  片付け返却: ["片付け", "返却", "掃除", "ゴミ出し", "戻す", "返す"],
  買い物準備: ["買い物", "購入", "補充", "買い足す", "注文"],
  引っ越し: ["引っ越し", "荷造り", "段ボール", "搬入", "搬出"],
  家電家事: ["洗濯", "家電", "掃除機", "冷蔵庫", "エアコン"],
  保険役所手続き: ["保険", "役所", "手続き", "申請", "届け出", "住民票"],
  安全防犯: ["防犯", "安全", "避難", "緊急連絡先"],
  趣味娯楽: ["趣味", "映画", "ライブ", "コンサート", "ゲーム", "読書"],
  美容: ["美容院", "美容室", "ネイル", "エステ"],
};

export const ITEM_CATEGORY_VOCAB = Object.keys(CATEGORY_KEYWORDS);

const KEYWORD_INDEX: { norm: string; category: string }[] = Object.entries(
  CATEGORY_KEYWORDS,
).flatMap(([category, words]) =>
  words.map((w) => ({ norm: normalizeMatchText(w), category })),
);

/** 予定名・説明文などのテキストから、該当する語彙カテゴリをルールベースで推定する。AI は使わない。 */
export function inferCategoriesFromText(text: string): string[] {
  const norm = normalizeMatchText(text);
  if (!norm) return [];
  const hit = new Set<string>();
  for (const { norm: kw, category } of KEYWORD_INDEX) {
    if (kw && norm.includes(kw)) hit.add(category);
  }
  return [...hit];
}

const SYSTEM = `あなたは準備リストの項目を分類します。
与えられた項目名・予定の文脈から、次の事前定義カテゴリの中から当てはまるものを
最大10個選んでください（0個でもよい）。カテゴリはこのリストの表記そのまま使うこと。
カテゴリ一覧: ${ITEM_CATEGORY_VOCAB.join("、")}
出力は必ず次の JSON のみ: {"categories":["カテゴリ名", "..."]}`;

/**
 * リスト項目が「似た予定」に設定されたタイミングで1回だけ呼ぶ。
 * AI の出力は必ず ITEM_CATEGORY_VOCAB に含まれるものだけに絞る（最大10個）。
 * OpenAI 未設定・失敗時は、項目名自体をルールベースで推定したカテゴリにフォールバックする。
 */
export async function classifyItemCategories(
  itemTitle: string,
  eventContext: string,
  userId?: string | null,
): Promise<string[]> {
  const fallback = inferCategoriesFromText(`${itemTitle}\n${eventContext}`).slice(0, 10);
  if (!process.env.OPENAI_API_KEY) return fallback;
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 12000,
      maxRetries: 0,
    });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 150,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            項目名: itemTitle,
            予定の文脈: eventContext.slice(0, 300),
          }),
        },
      ],
    });
    recordAiUsage(userId, "item-scope-categories", MODEL, completion.usage);
    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      categories?: unknown;
    };
    const picked = Array.isArray(raw.categories)
      ? raw.categories.map((c) => String(c).trim())
      : [];
    const valid = picked.filter((c) => ITEM_CATEGORY_VOCAB.includes(c));
    const uniq = [...new Set(valid)].slice(0, 10);
    return uniq.length > 0 ? uniq : fallback;
  } catch (e) {
    console.error("[item-categories] classifyItemCategories 失敗", e);
    return fallback;
  }
}

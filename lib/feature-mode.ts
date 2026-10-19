/**
 * 機能モード切替（テスト版／本番版）。2026-10-14 追加（テスト環境のみ）。
 *
 * - テスト版: 未来の自分へのメッセージ・次回の出し方（3択・AIで分別）。
 * - 本番版: 失敗ログ・節約額ダッシュボード・旧来の自動学習（LearnedRule）だけ。
 *
 * 分岐は必ずこのファイルの関数を通す（UI・Server Action・cron・通知・説明欄書き込み、
 * すべて同じ判定を使うこと）。モードで使えない機能の Server Action は、サーバー側でも
 * 拒否する（UI を隠すだけにしない）。
 */
import { prisma } from "@/lib/prisma";

export const FEATURE_MODES = ["test", "production"] as const;
export type FeatureMode = (typeof FEATURE_MODES)[number];

export function normalizeFeatureMode(raw: string | null | undefined): FeatureMode {
  return raw === "production" ? "production" : "test";
}

/** ユーザーの現在のモード。User.featureMode を読むだけ（既定 "test"）。 */
export async function getFeatureMode(userId: string): Promise<FeatureMode> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { featureMode: true },
  });
  return normalizeFeatureMode(user?.featureMode);
}

/** すでに User 行を読んでいるときに使う同期版。 */
export function featureModeOf(user: { featureMode: string }): FeatureMode {
  return normalizeFeatureMode(user.featureMode);
}

// ── 機能ごとのフラグ関数 ──
// 今は単純に2値の排他なので実装は同じだが、将来どちらのモードでも使う機能が
// 出てきたときに、ここだけ変えれば済むようにしてある。

/** 失敗ログ・節約額ダッシュボード（本番版）。 */
export function isFailureLogEnabled(mode: FeatureMode): boolean {
  return mode === "production";
}

/** 未来の自分へのメッセージ（テスト版）。 */
export function isFutureMessageEnabled(mode: FeatureMode): boolean {
  return mode === "test";
}

/** 準備リストの項目ごとの「次回の出し方」（3択・範囲ルール・AIで分別）（テスト版）。 */
export function isScopeRuleEnabled(mode: FeatureMode): boolean {
  return mode === "test";
}

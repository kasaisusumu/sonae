/**
 * ver2.1（2026-10-24追加、テスト環境のみ）。急ぎ/そのうちタグ・ホーム一覧・
 * 予定に紐づかない項目・完了した項目コーナー・ショートカット連携（トークン・
 * 概要API・ロック画面壁紙）をまとめたON/OFF。
 *
 * featureMode（ver1/ver2）とは独立した別軸: ver1のままでもver2でも、
 * 付けるかどうかを別に選べる（ユーザー指定: 「ver2は、今までの本番環境のver2の
 * 機能と同じで」＝ver2自体は従来どおりのまま、これらの機能はver2.1という
 * 別の追加スイッチにする）。
 *
 * 分岐は必ずこのファイルの関数を通す（UI・Server Action・ショートカットAPI、
 * すべて同じ判定を使うこと）。機能が使えない状態の Server Action は、
 * サーバー側でも拒否する（UI を隠すだけにしない。lib/feature-mode.ts と同じ方針）。
 */
import { prisma } from "@/lib/prisma";

/** ユーザーの現在のON/OFF。User.priorityExtrasEnabled を読むだけ（既定 false）。 */
export async function isPriorityExtrasEnabled(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { priorityExtrasEnabled: true },
  });
  return !!user?.priorityExtrasEnabled;
}

/** すでに User 行を読んでいるときに使う同期版。 */
export function priorityExtrasEnabledOf(user: { priorityExtrasEnabled: boolean }): boolean {
  return !!user.priorityExtrasEnabled;
}

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { featureModeOf, isFailureLogEnabled } from "@/lib/feature-mode";
import { trackEvent } from "@/lib/track";
import { FailuresPageProduction } from "./failures-production";
import { FailuresPageTest } from "./failures-test";

/**
 * /failures は機能モードで内容が丸ごと変わる（§5 lib/feature-mode.ts）。
 * - 本番版: 失敗ログ・節約額ダッシュボード（failures-production.tsx、main 由来）
 * - テスト版: 未来の自分へのメッセージ（failures-test.tsx）
 */
export default async function FailuresPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  trackEvent(user.id, "page:/failures");

  const mode = featureModeOf(user);
  return isFailureLogEnabled(mode) ? (
    <FailuresPageProduction userId={user.id} />
  ) : (
    <FailuresPageTest userId={user.id} />
  );
}

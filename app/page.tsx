import Link from "next/link";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isDevLoginEnabled } from "@/lib/dev-login";
import { getPendingMessageReviews } from "@/lib/future-messages";
import { primeNotifiedChecklists } from "@/lib/checklist";
import { trackEvent } from "@/lib/track";
import { GettingStarted } from "@/app/components/getting-started";
import { Landing } from "@/app/components/landing";

export const maxDuration = 60;

const STEPS = [
  "Google カレンダーに予定を入れる（またはアプリで手動追加）",
  "予定ごとに「準備すること」と「持ち物」が自動で用意される",
  "いる／いらない・タイミングを直すと、次から精度が上がる",
  "思い出したいことは「未来の自分へ」に記録 → 似た予定で自動的に知らせる",
];

function HowTo({ open = false }: { open?: boolean }) {
  return (
    <details
      open={open}
      data-coach="how-to"
      className="rounded-2xl bg-surface p-5 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="cursor-pointer list-none text-sm font-semibold text-teal-dark">
        このアプリの使い方
      </summary>
      <ol className="mt-3 space-y-2 text-sm text-muted">
        {STEPS.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-soft text-xs font-semibold text-teal-dark">
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted">
        学習でリストが「太る」ことはありません。増えた情報は、出す項目・タイミングの精度を上げるために使います。
      </p>
    </details>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ auth?: string; loggedout?: string }>;
}) {
  const { auth, loggedout } = await searchParams;
  const user = await getCurrentUser();
  const authMessage =
    auth === "config"
      ? "Google 連携の設定（環境変数）が未完了です。GOOGLE_CLIENT_ID などを確認してください。"
      : auth === "failed"
        ? "ログインに失敗しました。もう一度お試しください。"
        : null;

  if (!user) {
    return (
      <Landing
        loggedout={!!loggedout}
        authMessage={authMessage}
        devLogin={isDevLoginEnabled()}
      />
    );
  }

  const pendingReviews = await getPendingMessageReviews(user.id);

  trackEvent(user.id, "page:/");
  after(() => primeNotifiedChecklists(user.id));

  return (
    <div className="space-y-6">
      {/* 未オンボーディングのときだけ出る。出ているならこれがこのページの主役。 */}
      <GettingStarted userId={user.id} />

      {pendingReviews.length > 0 && (
        <Link
          href="/failures#review"
          data-coach="message-review-nudge"
          className="block rounded-2xl border border-teal/30 bg-teal-soft px-4 py-3 text-sm text-teal-dark no-underline hover:opacity-90"
        >
          💌 未来の自分へのメッセージ、{pendingReviews.length}件の確定待ちがあります
        </Link>
      )}

      {/* 使い方は一番下に、たたんで置く */}
      <HowTo />
    </div>
  );
}

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { createFutureMessageAction } from "@/app/actions";
import { listFutureMessages, getPendingMessageReviews } from "@/lib/future-messages";
import { buildMessageProposal } from "@/lib/message-proposal";
import { SubmitButton } from "@/app/components/submit-button";
import { InfoHint } from "@/app/components/info-hint";
import { MessageReviewCard } from "@/app/components/message-review-card";
import { trackEvent } from "@/lib/track";
import { MessageDictationInput } from "./message-dictation-input";
import { MessageList } from "./message-list";

// 確定カードごとに AI 提案を作るため、1回のページ表示で試す上限（コスト・速度対策）。
const MAX_REVIEW_PROPOSALS = 10;

export default async function FuturesMessagesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  trackEvent(user.id, "page:/failures");

  const [pendingReviews, messages, categories, events] = await Promise.all([
    getPendingMessageReviews(user.id),
    listFutureMessages(user.id),
    prisma.category.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    prisma.event.findMany({
      where: { userId: user.id },
      orderBy: { eventDatetime: "desc" },
      take: 80,
      select: { id: true, title: true, eventDatetime: true },
    }),
  ]);

  const reviewsToShow = pendingReviews.slice(0, MAX_REVIEW_PROPOSALS);
  const reviewCards = await Promise.all(
    reviewsToShow.map(async (r) => {
      const event = await prisma.event.findUnique({
        where: { id: r.eventId },
        select: { memo: true, categoryId: true },
      });
      return {
        review: r,
        proposal: await buildMessageProposal({
          userId: user.id,
          eventTitle: r.eventTitle,
          eventMemo: event?.memo ?? null,
          categoryId: event?.categoryId ?? null,
          current: {
            body: r.body,
            keywords: r.keywords,
            genres: r.genres,
            categoryIds: r.categoryIds,
            scope: r.scope,
          },
        }),
      };
    }),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">未来の自分へ</h1>
        <p className="mt-1 text-sm text-muted">
          いつ入るか分からない予定のために、思い出したいことを書いておくページです。
          該当する予定が入ったときに知らせます。
          <InfoHint id="failures-intro">
            使うほど直す量が減っていきます。次に同じ種類の予定が来たとき、内容を見直すか
            聞かれるので、直すところだけ直せば育っていきます。
          </InfoHint>
        </p>
      </div>

      {reviewCards.length > 0 && (
        <section id="review" className="scroll-mt-4 space-y-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            🤔 結果を記録しよう（{pendingReviews.length}件）
            <InfoHint id="failures-review-queue">
              終わった予定のメッセージを見直しましょう。全項目に提案が入っているので、
              直すところだけ直して確定するだけでOKです。
            </InfoHint>
          </h2>
          <div className="space-y-4">
            {reviewCards.map(({ review, proposal }) => (
              <MessageReviewCard
                key={review.linkId}
                linkId={review.linkId}
                eventTitle={review.eventTitle}
                categoryOptions={categories}
                proposal={proposal}
              />
            ))}
          </div>
        </section>
      )}

      <section
        data-coach="message-new"
        className="rounded-2xl border border-border bg-surface p-5"
      >
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          ✍️ メッセージを書く
          <InfoHint id="failures-quick-record">
            予定が未定でも作れます。キーワード・ジャンル・カテゴリのどれかに一致する
            予定が入ったとき、自動で知らせます。
          </InfoHint>
        </h2>
        <form action={createFutureMessageAction} className="mt-3 space-y-3">
          <textarea
            name="body"
            required
            rows={2}
            placeholder="次に思い出したいこと（例: 前回のギブアンドテイクを忘れない）"
            className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
          />
          <input
            name="keywords"
            placeholder="キーワード（読点区切り・任意。例: 田中、A社）"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          />
          <input
            name="genres"
            placeholder="ジャンル（〇〇系。読点区切り・任意。例: 飲み会系）"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          />
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              {categories.map((c) => (
                <label key={c.id} className="flex items-center gap-1">
                  <input type="checkbox" name="categoryIds" value={c.id} />
                  {c.name}
                </label>
              ))}
            </div>
          )}
          <label className="block text-xs text-muted">
            一致条件
            <select
              name="scope"
              defaultValue="keyword"
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="keyword">キーワード一致のみ</option>
              <option value="similar">似た予定で提案</option>
              <option value="once">今回だけ</option>
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton>作成する</SubmitButton>
            <MessageDictationInput
              events={events.map((e) => ({
                id: e.id,
                title: e.title,
                eventDatetime: e.eventDatetime,
              }))}
            />
          </div>
        </form>
      </section>

      <section data-coach="message-list" className="space-y-3">
        <h2 className="text-lg font-semibold">これまでの記録</h2>
        <MessageList
          messages={messages.map((m) => ({
            id: m.id,
            body: m.body,
            keywords: m.keywords,
            genres: m.genres,
            categoryIds: m.categoryIds,
            scope: m.scope,
            archivedAt: m.archivedAt,
            confirmedCount: m.confirmedCount,
            upcomingEvents: m.upcomingEvents,
          }))}
          categoryOptions={categories}
        />
      </section>
    </div>
  );
}

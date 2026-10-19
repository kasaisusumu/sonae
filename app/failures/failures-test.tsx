import { Check } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { createFutureMessageAction } from "@/app/actions";
import { listFutureMessages, getPendingMessageReviews } from "@/lib/future-messages";
import { getCachedOrBuildMessageProposal } from "@/lib/message-proposal";
import { MessageCreateSubmit } from "./message-create-submit";
import { InfoHint } from "@/app/components/info-hint";
import { MessageReviewCard } from "@/app/components/message-review-card";
import { MessageDictationInput } from "./message-dictation-input";
import { MessageList } from "./message-list";

// 確定カードごとに AI 提案を作るため、1回のページ表示で試す上限（コスト・速度対策）。
const MAX_REVIEW_PROPOSALS = 10;

/** テスト版モードの /failures（未来の自分へのメッセージ）。 */
export async function FailuresPageTest({ userId }: { userId: string }) {
  const [pendingReviews, messages] = await Promise.all([
    getPendingMessageReviews(userId),
    listFutureMessages(userId),
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
        proposal: await getCachedOrBuildMessageProposal(r.linkId, {
          userId,
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
            予定が終わるたびに、書いた内容を見直すか聞かれます（最初に書いた予定でも、
            次に似た予定が来たときでも同じです）。直すところだけ直せば、使うほど
            直す量が減っていきます。
          </InfoHint>
        </p>
      </div>

      {reviewCards.length > 0 && (
        <section id="review" className="scroll-mt-4 space-y-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            🤔 結果を記録しよう({pendingReviews.length}件)
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
            予定が未定でも作れます。キーワードを書けば、それに一致する予定が入ったとき
            自動で知らせます。キーワードを書かなければ、自動では一致しません
            （あとでキーワードを足せば効くようになります）。
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
            placeholder="キーワード（任意・読点区切り。例: 田中、A社）"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          />

          <div className="flex flex-wrap items-center gap-2">
            <MessageCreateSubmit>作成する</MessageCreateSubmit>
            <MessageDictationInput />
          </div>
        </form>
      </section>

      <section data-coach="message-list" className="space-y-3">
        <h2 className="flex items-center gap-1.5 text-lg font-semibold">
          これまでの記録
          <InfoHint id="future-message-delete-vs-remove">
            <p className="mb-3 flex items-center gap-1 text-sm font-semibold text-foreground">
              削除・この予定から外す・
              <Check aria-hidden className="h-4 w-4 shrink-0" />
              の違い
            </p>

            <div className="mb-1">
              <span className="text-[11px] text-warn underline">削除</span>
              <span className="ml-1 text-[11px] text-muted">（このページのボタン）</span>
            </div>
            <p className="mb-3 text-[13px]">
              メッセージ自体を完全に削除します。
              <strong className="text-foreground">以後どの予定にも二度と提案されません</strong>。
              例えば「田中さんとの前回の件を忘れない」を削除すると、次に田中さんが
              関わる予定が来ても、もう出てきません。
            </p>

            <div className="mb-1">
              <span className="text-[11px] text-muted underline">この予定から外す</span>
              <span className="ml-1 text-[11px] text-muted">（予定詳細のボタン）</span>
            </div>
            <p className="mb-3 text-[13px]">
              <strong className="text-foreground">その予定からだけ</strong>外れます。
              メッセージ自体は残るので、例えば「来月の田中さんとの打ち合わせ」には
              引き続き提案されます。
            </p>

            <div className="mb-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked
                readOnly
                className="h-5 w-5 shrink-0 accent-[var(--teal)]"
              />
              <span className="text-sm text-muted">（予定詳細のチェック）</span>
            </div>
            <p className="text-[13px]">
              その予定での完了の印だけ。
              <strong className="text-foreground">チェックしても次回の提案は変わりません</strong>。
            </p>
          </InfoHint>
        </h2>
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
            sourceEventTitle: m.sourceEventTitle,
          }))}
        />
      </section>
    </div>
  );
}

import { createFailureLog } from "@/app/actions";
import { SubmitButton } from "@/app/components/submit-button";

/**
 * 予定詳細ページから、その予定の「うっかり失敗」を直接記録するフォーム。
 * カテゴリと日付は予定から自動で入るので、内容（と任意で金額）だけ書けばよい。
 */
export function EventFailureLog({ eventId }: { eventId: string }) {
  return (
    <details className="rounded-2xl bg-surface p-5 [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer list-none text-sm font-semibold text-muted">
        この予定で失敗を記録する
      </summary>
      <p className="mt-2 text-xs text-muted">
        責めるためではなく、次に似た予定が来たときに先回りするためです。金額は分からなければ空でOK。
      </p>
      <form action={createFailureLog} className="mt-3 space-y-3">
        <input type="hidden" name="eventId" value={eventId} />
        <label className="block text-sm">
          <span className="text-muted">何が起きた？</span>
          <textarea
            name="description"
            required
            rows={2}
            placeholder="例: 集合時間に遅刻した／保険証を忘れた"
            className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
          />
        </label>
        <label className="block text-sm sm:max-w-xs">
          <span className="text-muted">推定損失額（円・任意）</span>
          <input
            type="number"
            name="estimatedLossYen"
            min={0}
            step={100}
            placeholder="なくてもOK"
            className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
          />
        </label>
        <SubmitButton>記録する</SubmitButton>
      </form>
    </details>
  );
}

"use client";

import {
  createFailureLog,
  deleteFailureLog,
  updateFailureLog,
} from "@/app/actions";
import { formatDateOnly, toDateInputValue } from "@/lib/format";
import { SubmitButton } from "@/app/components/submit-button";
import { ConfirmButton } from "@/app/components/confirm-button";

type F = {
  id: string;
  description: string;
  occurredAt: Date;
  estimatedLossYen: number;
  outcome: string | null;
};

function meta(o: string | null): { icon: string; label: string } {
  switch (o) {
    case "prevented":
      return { icon: "🛡", label: "防げた" };
    case "not_prevented":
      return { icon: "😓", label: "防げなかった" };
    case "irrelevant":
      return { icon: "—", label: "今回は関係ない" };
    case "linked":
      return { icon: "🔗", label: "紐付け" };
    default:
      return { icon: "・", label: "未確認" };
  }
}

/**
 * 学習内容ページの葉で使う、失敗ログのその場編集。予定詳細の <EventFailureLog> と
 * 同じ形式（コンパクト行 → 開いて編集／削除、＋で追加）。データは props 経由なので
 * 葉ごとに追加クエリを出さない。
 */
export function FailureLogEditor({
  eventId,
  failures,
}: {
  eventId: string;
  failures: F[];
}) {
  return (
    <div className="mt-3">
      <p className="text-[11px] font-semibold text-warn">
        失敗ログ（{failures.length}）
      </p>

      {failures.length > 0 && (
        <ul className="mt-1 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {failures.map((l) => {
            const m = meta(l.outcome);
            return (
              <li key={l.id}>
                <details className="[&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm hover:bg-surface-muted">
                    <span className="shrink-0">{m.icon}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {l.description}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">
                      {m.label} ・ {formatDateOnly(l.occurredAt)}
                    </span>
                    <span className="shrink-0 text-xs text-muted">▾</span>
                  </summary>
                  <div className="space-y-2 border-t border-border px-3 py-3">
                    <form action={updateFailureLog} className="space-y-2">
                      <input type="hidden" name="id" value={l.id} />
                      <label className="block text-xs text-muted">
                        失敗内容
                        <textarea
                          name="description"
                          required
                          rows={2}
                          defaultValue={l.description}
                          className="mt-0.5 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
                        />
                      </label>
                      <label className="block text-xs text-muted">
                        結果・状態
                        <select
                          name="outcome"
                          defaultValue={l.outcome ?? ""}
                          className="mt-0.5 w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
                        >
                          <option value="">未確認</option>
                          <option value="linked">
                            紐付け（この予定で起こりうる）
                          </option>
                          <option value="prevented">防げた</option>
                          <option value="not_prevented">防げなかった</option>
                          <option value="irrelevant">今回は関係ない</option>
                        </select>
                      </label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block text-xs text-muted">
                          金額（円）
                          <input
                            type="number"
                            name="estimatedLossYen"
                            min={0}
                            step={100}
                            defaultValue={l.estimatedLossYen || ""}
                            placeholder="任意"
                            className="mt-0.5 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="block text-xs text-muted">
                          日付
                          <input
                            type="date"
                            name="occurredAt"
                            defaultValue={toDateInputValue(l.occurredAt)}
                            className="mt-0.5 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                      <SubmitButton variant="ghost">更新</SubmitButton>
                    </form>
                    <form action={deleteFailureLog}>
                      <input type="hidden" name="id" value={l.id} />
                      <ConfirmButton
                        message="この失敗ログを削除しますか？"
                        className="text-[11px] text-muted underline hover:text-warn"
                      >
                        削除
                      </ConfirmButton>
                    </form>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      <details className="mt-2 [&_summary::-webkit-details-marker]:hidden">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1 text-xs text-muted hover:border-foreground/40 hover:text-foreground">
          ＋ 失敗を追加
        </summary>
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
              placeholder="なければ空欄（0）"
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            />
          </label>
          <SubmitButton>記録する</SubmitButton>
        </form>
      </details>
    </div>
  );
}

import { archiveScopeRuleAction } from "@/app/actions";
import { ConfirmButton } from "@/app/components/confirm-button";
import { ScopeChip } from "@/app/components/scope-chip";
import { describeScopeRule, type ItemScope } from "@/lib/item-scope";

/**
 * 学習内容の上に出す「次回の出し方（範囲つきルール）」の一覧。
 * 文章で見せ、削除は確認ポップアップのあとだけ（ルールは外れて、予定側の表示は「自動」に戻る）。
 */
export function ScopeRuleList({
  rules,
}: {
  rules: {
    id: string;
    action: string;
    kind: string;
    title: string;
    scope: string;
    keywords: string;
    genres: string;
    reason: string | null;
  }[];
}) {
  if (rules.length === 0) return null;
  return (
    <details className="rounded-2xl bg-surface p-4">
      <summary className="cursor-pointer text-base font-semibold">
        次回の出し方のルール
        <span className="ml-2 text-xs font-normal text-muted">{rules.length}件</span>
      </summary>
      <ul className="mt-3 space-y-2">
        {rules.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background/60 px-3 py-2"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <ScopeChip scope={r.scope as ItemScope} status="chosen" />
              <p className="text-sm">{describeScopeRule(r)}</p>
              {r.reason && <p className="text-[11px] text-muted">{r.reason}</p>}
            </div>
            <form action={archiveScopeRuleAction}>
              <input type="hidden" name="ruleId" value={r.id} />
              <ConfirmButton
                message="このルールを外します。予定側の表示は『自動』に戻ります。よろしいですか？"
                className="text-[11px] text-muted underline hover:text-warn"
              >
                ルールを外す
              </ConfirmButton>
            </form>
          </li>
        ))}
      </ul>
    </details>
  );
}

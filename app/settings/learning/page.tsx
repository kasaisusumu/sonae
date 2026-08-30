import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getLearningOverview, type RuleType } from "@/lib/learning";
import { RuleActions } from "./rule-actions";

const TYPE_LABEL: Record<RuleType, string> = {
  fixed_item: "固定",
  exclude_item: "除外",
  timing_override: "タイミング",
};

interface Rule {
  id: string;
  ruleType: RuleType;
  target: string;
  value: string | null;
  effectiveConfidence: number;
  isUserLocked: boolean;
}

function RuleRow({ r }: { r: Rule }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm">
          {r.ruleType === "timing_override"
            ? `${r.target} → ${r.value ?? ""}`
            : r.target}
          {r.ruleType === "fixed_item" && r.value ? `（${r.value}）` : ""}
        </p>
        <p className="text-[11px] text-muted">
          {r.isUserLocked
            ? "固定中"
            : `確信度 ${Math.round(r.effectiveConfidence * 100)}%`}
        </p>
      </div>
      <RuleActions ruleId={r.id} locked={r.isUserLocked} />
    </li>
  );
}

export default async function LearningOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const groups = await getLearningOverview(user.id);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/settings"
          className="text-sm text-muted no-underline hover:text-teal-dark"
        >
          ← 設定
        </Link>
        <h1 className="mt-2 text-xl font-semibold">学習内容の確認</h1>
        <p className="mt-1 text-sm text-muted">
          何を学習しているか、なぜその項目が出る/消えるかを確認できます。個別に固定・リセットできます。
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-xl bg-surface px-4 py-8 text-center text-sm text-muted">
          まだ学習内容はありません。
          <br />
          予定の準備リストを何度か編集すると、ここに出てきます。
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.categoryId} className="rounded-2xl bg-surface p-5">
            <h2 className="text-base font-semibold">{g.categoryName}</h2>

            {g.fixed.length > 0 && (
              <div className="mt-3">
                <h3 className="text-xs font-semibold text-muted">固定されている項目</h3>
                <ul className="divide-y divide-border">
                  {g.fixed.map((r) => (
                    <RuleRow key={r.id} r={r} />
                  ))}
                </ul>
              </div>
            )}

            {g.excluded.length > 0 && (
              <div className="mt-3">
                <h3 className="text-xs font-semibold text-muted">よく削除される項目</h3>
                <ul className="divide-y divide-border">
                  {g.excluded.map((r) => (
                    <RuleRow key={r.id} r={r} />
                  ))}
                </ul>
              </div>
            )}

            {g.timing.length > 0 && (
              <div className="mt-3">
                <h3 className="text-xs font-semibold text-muted">タイミングの調整</h3>
                <ul className="divide-y divide-border">
                  {g.timing.map((r) => (
                    <RuleRow key={r.id} r={r} />
                  ))}
                </ul>
              </div>
            )}

            {g.tentative.length > 0 && (
              <div className="mt-3">
                <h3 className="text-xs font-semibold text-muted">
                  まだ仮の状態の項目（確信度が低い）
                </h3>
                <ul className="divide-y divide-border">
                  {g.tentative.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-start justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-muted">
                          [{TYPE_LABEL[r.ruleType]}]{" "}
                          {r.ruleType === "timing_override"
                            ? `${r.target} → ${r.value ?? ""}`
                            : r.target}
                        </p>
                        <p className="text-[11px] text-muted">
                          確信度 {Math.round(r.effectiveConfidence * 100)}%
                        </p>
                      </div>
                      <RuleActions ruleId={r.id} locked={r.isUserLocked} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}

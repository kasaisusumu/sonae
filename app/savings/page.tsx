import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  getLearningNameTree,
  parseNotifyValue,
  type EditChangeView,
  type EditRecordView,
  type LeafListItem,
  type LearnedRuleView,
  type NameTreeLeaf,
  type NameTreeNode,
  type RuleType,
} from "@/lib/learning";
import { leadLabel } from "@/lib/notify-items";
import { RuleActions } from "./rule-actions";
import { LearningSearch } from "./learning-search";

const TYPE_LABEL: Record<RuleType, string> = {
  fixed_item: "入れる",
  exclude_item: "出さない",
  timing_override: "タイミング",
  notify_override: "通知",
};

const CHANGE_LABEL: Record<EditChangeView["kind"], string> = {
  added: "追加",
  removed: "削除",
  retimed: "タイミング",
  renotified: "通知",
};

function notifyText(value: string | null): string {
  const m = parseNotifyValue(value);
  return m === null ? "通知なし" : leadLabel(m);
}

function ruleMain(r: LearnedRuleView): string {
  if (r.ruleType === "timing_override") return `${r.target} → ${r.value ?? ""}`;
  if (r.ruleType === "notify_override")
    return `${r.target} → ${notifyText(r.value)}`;
  if (r.ruleType === "fixed_item" && r.value) return `${r.target}（${r.value}）`;
  return r.target;
}

function Keywords({ words }: { words: string[] }) {
  if (words.length === 0) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {words.slice(0, 8).map((w) => (
        <span
          key={w}
          className="rounded bg-surface-muted px-1 py-px text-[10px] text-muted"
        >
          {w}
        </span>
      ))}
    </span>
  );
}

function ListLine({ it }: { it: LeafListItem }) {
  const bits: string[] = [];
  if (it.timingLabel) bits.push(it.timingLabel);
  if (it.notifyLeadMinutes != null)
    bits.push(`🔔${leadLabel(it.notifyLeadMinutes)}`);
  return (
    <li className="text-[11px]">
      {it.title}
      {bits.length > 0 && (
        <span className="text-muted">（{bits.join(" ・ ")}）</span>
      )}
      {it.isUserAdded && <span className="ml-1 text-teal-dark">＋追加</span>}
    </li>
  );
}

function RuleLine({ r }: { r: LearnedRuleView }) {
  return (
    <li className="flex items-start justify-between gap-2 py-1">
      <div className="min-w-0 text-[11px]">
        <p>
          <span className="text-muted">[{TYPE_LABEL[r.ruleType]}]</span>{" "}
          {ruleMain(r)}
          {!r.forced && <span className="text-muted">（仮）</span>}
        </p>
        <p className="text-muted">
          {r.situationLabel} ・{" "}
          {r.isUserLocked
            ? "固定中"
            : `確信度 ${Math.round(r.effectiveConfidence * 100)}%`}
          {r.confirmedCount > 0 ? ` ・ 確認 ${r.confirmedCount}回` : ""}
          {r.contradictedCount > 0 ? ` ・ 矛盾 ${r.contradictedCount}回` : ""}
        </p>
      </div>
      <RuleActions ruleId={r.id} locked={r.isUserLocked} />
    </li>
  );
}

function EditLine({ rec }: { rec: EditRecordView }) {
  return (
    <li className="py-1">
      <p className="text-[11px] font-medium text-muted">
        {rec.when.toLocaleDateString("ja-JP")}{" "}
        {rec.when.toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
      <ul className="mt-0.5 space-y-0.5 pl-3">
        {rec.changes.map((ch, i) => (
          <li key={i} className="text-[11px]">
            <span className="text-muted">{CHANGE_LABEL[ch.kind]}: </span>
            {ch.kind === "retimed" || ch.kind === "renotified"
              ? `${ch.title} → ${ch.detail ?? ""}`
              : ch.detail
                ? `${ch.title}（${ch.detail}）`
                : ch.title}
          </li>
        ))}
      </ul>
    </li>
  );
}

function EventLeaf({ leaf }: { leaf: NameTreeLeaf }) {
  return (
    <details
      id={`ev-${leaf.eventId}`}
      className="scroll-mt-24 rounded-lg bg-surface p-2 transition-shadow"
    >
      <summary className="cursor-pointer text-xs font-medium">
        {leaf.title}
        <span className="ml-1 font-normal text-muted">
          {leaf.situationLabel}
          {leaf.editCount > 0 ? ` ・ 編集 ${leaf.editCount}回` : ""}
        </span>
        <Keywords words={leaf.keywords} />
      </summary>

      <div className="mt-2 space-y-3 border-l border-border pl-3">
        <div>
          <h5 className="text-[11px] font-semibold text-teal-dark">
            この予定のときのリスト
          </h5>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <div>
              <p className="text-[11px] text-muted">準備すること</p>
              <ul className="mt-0.5 space-y-0.5">
                {leaf.list.task.length === 0 ? (
                  <li className="text-[11px] text-muted">（なし）</li>
                ) : (
                  leaf.list.task.map((it, i) => <ListLine key={i} it={it} />)
                )}
              </ul>
            </div>
            <div>
              <p className="text-[11px] text-muted">持ち物</p>
              <ul className="mt-0.5 space-y-0.5">
                {leaf.list.belonging.length === 0 ? (
                  <li className="text-[11px] text-muted">（なし）</li>
                ) : (
                  leaf.list.belonging.map((it, i) => (
                    <ListLine key={i} it={it} />
                  ))
                )}
              </ul>
            </div>
          </div>
        </div>

        {leaf.rules.length > 0 && (
          <div>
            <h5 className="text-[11px] font-semibold text-muted">
              この予定に効いている学習
            </h5>
            <ul className="mt-0.5 divide-y divide-border">
              {leaf.rules.map((r) => (
                <RuleLine key={r.id} r={r} />
              ))}
            </ul>
          </div>
        )}

        {leaf.edits.length > 0 && (
          <div>
            <h5 className="text-[11px] font-semibold text-muted">
              この予定での編集の記録
            </h5>
            <ul className="mt-0.5 divide-y divide-border">
              {leaf.edits.map((rec) => (
                <EditLine key={rec.id} rec={rec} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

function NameBranch({ node }: { node: NameTreeNode }) {
  const single = node.count === 1 && node.leaves.length === 1;
  if (single) {
    // 語の枝に予定が 1 つだけなら、枝を省いて葉を直接出す
    return <EventLeaf leaf={node.leaves[0]} />;
  }
  return (
    <details className="rounded-xl bg-background p-2">
      <summary className="cursor-pointer text-sm font-medium">
        {node.label}
        <span className="ml-1.5 text-xs font-normal text-muted">
          {node.count}件
        </span>
      </summary>
      <div className="mt-1.5 space-y-1.5 border-l border-border pl-3">
        {node.children.map((c) => (
          <NameBranch key={c.path} node={c} />
        ))}
        {node.leaves.map((l) => (
          <EventLeaf key={l.eventId} leaf={l} />
        ))}
      </div>
    </details>
  );
}

export default async function LearningOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { categories, searchIndex } = await getLearningNameTree(user.id);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">学習内容</h1>
        <p className="mt-1 text-sm text-muted">
          <strong>カテゴリ → 予定名（語で枝分かれ）→ その予定のとき</strong>
          の順でたどれます。どの名前の予定のときにどんなリストになるか、そのもとに
          なった編集も見られます。上の検索バーに予定名を入れると、その枝へ飛べます。
          各ルールは個別に固定・リセットできます。
        </p>
      </div>

      {categories.length === 0 ? (
        <p className="rounded-xl bg-surface px-4 py-8 text-center text-sm text-muted">
          まだ学習内容はありません。
          <br />
          予定の準備リストを何度か編集すると、ここに出てきます。
        </p>
      ) : (
        <>
          <LearningSearch entries={searchIndex} />
          <div className="space-y-3">
            {categories.map((cat) => (
              <details
                key={cat.categoryId}
                className="rounded-2xl bg-surface p-4"
                open
              >
                <summary className="cursor-pointer text-base font-semibold">
                  {cat.categoryName}
                  <span className="ml-2 text-xs font-normal text-muted">
                    予定 {cat.eventCount}件 ・ 学習 {cat.ruleCount}件
                  </span>
                </summary>
                <div className="mt-3 space-y-1.5 border-l border-border pl-3">
                  {cat.node.children.map((c) => (
                    <NameBranch key={c.path} node={c} />
                  ))}
                  {cat.node.leaves.map((l) => (
                    <EventLeaf key={l.eventId} leaf={l} />
                  ))}
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

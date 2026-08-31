import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  getLearningNameTree,
  type LeafFailure,
  type NameTreeLeaf,
  type NameTreeNode,
} from "@/lib/learning";
import { formatYen } from "@/lib/format";
import { ChecklistEditor } from "@/app/events/[id]/checklist-editor";
import { LearningSearch } from "./learning-search";
import { LazyLeaf } from "./lazy-leaf";

const OUTCOME_LABEL: Record<string, string> = {
  prevented: "防げた",
  not_prevented: "防げなかった",
};

function FailureList({ failures }: { failures: LeafFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-[11px] font-semibold text-warn">
        失敗ログ（{failures.length}）
      </p>
      <ul className="mt-0.5 space-y-1">
        {failures.map((f) => (
          <li
            key={f.id}
            className="rounded bg-warn-soft px-2 py-1 text-[11px]"
          >
            <p className="whitespace-pre-wrap break-words">{f.description}</p>
            <p className="mt-0.5 text-muted">
              {f.occurredAt.toLocaleDateString("ja-JP")}
              {f.estimatedLossYen > 0
                ? ` ・ 推定 ${formatYen(f.estimatedLossYen)}`
                : ""}
              {" ・ "}
              {f.outcome ? OUTCOME_LABEL[f.outcome] ?? "未選択" : "未選択"}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
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

function EventLeaf({ leaf }: { leaf: NameTreeLeaf }) {
  const initial = (kind: "task" | "belonging") =>
    leaf.list[kind].map((it) => ({
      id: it.id,
      title: it.title,
      timingLabel: it.timingLabel,
      comment: it.comment,
      isDone: it.isDone,
      isUserAdded: it.isUserAdded,
      notifyLeadMinutes: it.notifyLeadMinutes,
    }));
  const keyOf = (kind: "task" | "belonging") =>
    `${leaf.eventId}-${kind}-${leaf.list[kind].map((i) => i.title).join("")}`;
  const siblings = leaf.siblingEventIds;

  return (
    <LazyLeaf
      id={`ev-${leaf.eventId}`}
      summary={
        <>
          {leaf.title}
          <span className="ml-1 font-normal text-muted">
            {leaf.situationLabel}
          </span>
          {leaf.failures.length > 0 && (
            <span className="ml-1 text-warn">⚠{leaf.failures.length}</span>
          )}
          <Keywords words={leaf.keywords} />
        </>
      }
    >
      {siblings.length > 0 && (
        <p className="mb-2 text-[11px] text-muted">
          時間帯・長さ違いで {leaf.mergedCount} 件をまとめています。ここでの編集は
          その全部に反映されます。
        </p>
      )}
      <p className="text-[11px] font-semibold text-teal-dark">準備すること</p>
      <ChecklistEditor
        key={keyOf("task")}
        eventId={leaf.eventId}
        kind="task"
        initialItems={initial("task")}
        applyToEventIds={siblings}
      />
      <p className="mt-3 text-[11px] font-semibold text-teal-dark">持ち物</p>
      <ChecklistEditor
        key={keyOf("belonging")}
        eventId={leaf.eventId}
        kind="belonging"
        initialItems={initial("belonging")}
        applyToEventIds={siblings}
      />
      <FailureList failures={leaf.failures} />
    </LazyLeaf>
  );
}

function NameBranch({ node }: { node: NameTreeNode }) {
  if (node.children.length === 0 && node.leaves.length === 1) {
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

export default async function LearningTreePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { categories, searchIndex } = await getLearningNameTree(user.id);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">学習内容</h1>
        <p className="mt-1 text-sm text-muted">
          <strong>カテゴリ → 予定名（語で枝分かれ）→ その予定</strong>
          をたどると、その予定で出てくる準備リスト・持ち物が見られます。
          ここでそのまま編集でき、編集は学習にも反映されます。同じ名前で同じ内容の予定
          （時間帯や長さだけ違うもの）は 1 つにまとめて表示します。上の検索バーに予定名を入れると、その枝へ飛べます。
        </p>
      </div>

      {categories.length === 0 ? (
        <p className="rounded-xl bg-surface px-4 py-8 text-center text-sm text-muted">
          まだ学習内容はありません。
          <br />
          予定の準備リストを何度か編集すると、ここに育っていきます。
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
                    {cat.node.count}件
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

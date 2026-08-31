import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  getLearningNameTree,
  type LeafListItem,
  type NameTreeLeaf,
  type NameTreeNode,
} from "@/lib/learning";
import { leadLabel } from "@/lib/notify-items";
import { LearningSearch } from "./learning-search";

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
    <li className="text-xs">
      {it.title}
      {bits.length > 0 && (
        <span className="text-muted">（{bits.join(" ・ ")}）</span>
      )}
      {it.isUserAdded && <span className="ml-1 text-teal-dark">＋追加</span>}
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
        <span className="ml-1 font-normal text-muted">{leaf.situationLabel}</span>
        <Keywords words={leaf.keywords} />
      </summary>

      <div className="mt-2 grid gap-2 border-l border-border pl-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold text-teal-dark">準備すること</p>
          <ul className="mt-0.5 space-y-0.5">
            {leaf.list.task.length === 0 ? (
              <li className="text-[11px] text-muted">（なし）</li>
            ) : (
              leaf.list.task.map((it, i) => <ListLine key={i} it={it} />)
            )}
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-teal-dark">持ち物</p>
          <ul className="mt-0.5 space-y-0.5">
            {leaf.list.belonging.length === 0 ? (
              <li className="text-[11px] text-muted">（なし）</li>
            ) : (
              leaf.list.belonging.map((it, i) => <ListLine key={i} it={it} />)
            )}
          </ul>
        </div>
      </div>
    </details>
  );
}

function NameBranch({ node }: { node: NameTreeNode }) {
  if (node.count === 1 && node.leaves.length === 1) {
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
          をたどると、その予定でこれから出てくる準備リスト・持ち物が見られます。
          使うほど、あなたに合ったリストに育ちます。上の検索バーに予定名を入れると、その枝へ飛べます。
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
                    予定 {cat.eventCount}件
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

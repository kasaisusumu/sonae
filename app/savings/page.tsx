import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  getLearningNameTree,
  type LeafFailure,
  type NameTreeLeaf,
  type NameTreeNode,
} from "@/lib/learning";
import { formatDateOnly, formatYen } from "@/lib/format";
import { formatLead } from "@/lib/lead-time";
import { getUserTemplates } from "@/lib/templates";
import { type SearchEntry } from "./learning-search";
import { LearningExplorer } from "./learning-explorer";
import { LazyLeaf } from "./lazy-leaf";
import { LeafBody, type LeafItem, type LeafSectionData } from "./leaf-body";
import { KindGroup } from "./templates-panel";

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
              {formatDateOnly(f.occurredAt)}
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

function CompactLine({ it }: { it: LeafItem }) {
  const lead =
    it.notifyLeadMinutes != null ? `🔔${formatLead(it.notifyLeadMinutes)}` : "";
  return (
    <li
      className={`text-[11px] ${it.isDone ? "text-muted line-through" : ""}`}
    >
      {it.title}
      {lead && <span className="text-muted">（{lead}）</span>}
      {it.isUserAdded && <span className="ml-1 text-teal-dark">＋追加</span>}
    </li>
  );
}

function CompactList({ sections }: { sections: LeafSectionData[] }) {
  const prog = (arr: LeafItem[]) =>
    arr.length ? ` ${arr.filter((i) => i.isDone).length}/${arr.length}` : "";
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {sections.map((s) => (
        <div key={s.key}>
          <p className="text-[11px] font-semibold text-teal-dark">
            {s.label}
            <span className="text-muted">{prog(s.items)}</span>
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {s.items.length === 0 ? (
              <li className="text-[11px] text-muted">（なし）</li>
            ) : (
              s.items.map((it) => <CompactLine key={it.id} it={it} />)
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EventLeaf({ leaf }: { leaf: NameTreeLeaf }) {
  const sections: LeafSectionData[] = leaf.sections.map((s) => ({
    key: s.key,
    label: s.label,
    items: s.items
      .map((it) => ({
        id: it.id,
        title: it.title,
        comment: it.comment,
        isDone: it.isDone,
        isUserAdded: it.isUserAdded,
        notifyLeadMinutes: it.notifyLeadMinutes,
      }))
      // 未チェックを上・チェック済みを下（安定ソート）
      .sort((a, b) => (a.isDone ? 1 : 0) - (b.isDone ? 1 : 0)),
  }));

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
      {leaf.mergedCount > 1 && (
        <p className="mb-2 text-[11px] text-muted">
          同じ名前の未編集の予定 {leaf.mergedCount} 件をまとめています。ここでの編集は
          その全部に反映され、別の 1 件を違う内容に編集するとそこで分かれます。
        </p>
      )}
      <LeafBody
        eventId={leaf.eventId}
        compact={<CompactList sections={sections} />}
        sections={sections}
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

  const [{ categories, searchIndex }, templates] = await Promise.all([
    getLearningNameTree(user.id),
    getUserTemplates(user.id),
  ]);

  const searchEntries: SearchEntry[] = [
    ...searchIndex.map((e) => ({
      kind: "event" as const,
      anchor: `ev-${e.eventId}`,
      title: e.title,
      crumb: e.crumb,
      keywords: e.keywords,
      items: e.items,
    })),
    ...templates.map((t) => ({
      kind: "template" as const,
      tplKind: t.kind,
      anchor: `tpl-${t.id}`,
      title: t.name,
      crumb:
        t.kind === "belonging"
          ? "テンプレート › 持ち物"
          : "テンプレート › 準備すること",
      keywords: [],
      items: t.items.map((i) => i.title),
    })),
  ];

  const tree = (
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
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">学習内容</h1>
        <p className="mt-1 text-sm text-muted">
          自動で覚えた「どの予定でどんな準備リストになるか」と、名前を付けて保存したテンプレートを確認・編集できます。
          上の検索は両方をまとめて探します。
        </p>
      </div>

      <LearningExplorer
        entries={searchEntries}
        hasTree={categories.length > 0}
        taskCount={templates.filter((t) => t.kind === "task").length}
        belongingCount={templates.filter((t) => t.kind === "belonging").length}
        tree={tree}
        templatesTask={<KindGroup kind="task" templates={templates} />}
        templatesBelonging={
          <KindGroup kind="belonging" templates={templates} />
        }
      />
    </div>
  );
}

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  getLearningNameTree,
  type NameTreeLeaf,
  type NameTreeNode,
} from "@/lib/learning";
import { formatLead } from "@/lib/lead-time";
import { getUserTemplates } from "@/lib/templates";
import { sectionLabel } from "@/lib/sections";
import { InfoHint } from "@/app/components/info-hint";
import { type SearchEntry } from "./learning-search";
import { LearningExplorer } from "./learning-explorer";
import { LazyLeaf } from "./lazy-leaf";
import { LeafBody, type LeafItem, type LeafSectionData } from "./leaf-body";
import { TemplatesGroup } from "./templates-panel";
import {
  FailureListEditor,
  type FLRow,
} from "@/app/events/[id]/failure-list-editor";

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

function EventLeaf({
  leaf,
  depth = 1,
}: {
  leaf: NameTreeLeaf;
  depth?: number;
}) {
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
      tone={depth % 2 === 1 ? "muted" : "surface"}
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
      {/* 失敗ログは一番上に。予定詳細と同じ形式でその場編集・追加できる。 */}
      <FailureListEditor
        eventId={leaf.eventId}
        label="失敗ログ"
        variant="warn"
        initial={leaf.failures satisfies FLRow[]}
      />
      {leaf.mergedCount > 1 && !leaf.cleared && (
        <p className="mb-2 mt-3 flex items-center gap-1 text-[11px] text-muted">
          同じ名前の未編集 {leaf.mergedCount} 件をまとめて編集
          <InfoHint>
            ここでの編集はその全部に反映されます。別の1件を違う内容に編集すると、
            そこで分かれます。
          </InfoHint>
        </p>
      )}
      {leaf.cleared ? (
        <p className="mt-3 flex items-center gap-1 rounded-lg bg-surface-muted p-3 text-xs text-muted">
          準備リストは空（内容なしとして学習）
          <InfoHint>
            似た予定でも何も出しません。同じ名前でも、中身のある予定とは分けて覚えています。
          </InfoHint>
        </p>
      ) : (
        <div className="mt-3">
          <LeafBody
            eventId={leaf.eventId}
            compact={<CompactList sections={sections} />}
            sections={sections}
          />
        </div>
      )}
    </LazyLeaf>
  );
}

function NameBranch({
  node,
  depth = 1,
}: {
  node: NameTreeNode;
  depth?: number;
}) {
  if (node.children.length === 0 && node.leaves.length === 1) {
    return <EventLeaf leaf={node.leaves[0]} depth={depth} />;
  }
  // 階層ごとに白／グレーを交互に。
  const muted = depth % 2 === 1;
  return (
    <details
      className={`rounded-xl border border-border p-2.5 shadow-sm ${
        muted ? "bg-surface-muted" : "bg-surface"
      }`}
    >
      <summary className="cursor-pointer text-sm font-medium">
        {node.label}
        <span className="ml-1.5 text-xs font-normal text-muted">
          {node.count}件
        </span>
      </summary>
      <div className="mt-1.5 space-y-1.5 border-l border-border pl-3">
        {node.children.map((c) => (
          <NameBranch key={c.path} node={c} depth={depth + 1} />
        ))}
        {node.leaves.map((l) => (
          <EventLeaf key={l.eventId} leaf={l} depth={depth + 1} />
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
      anchor: `tpl-${t.id}`,
      title: t.name,
      crumb: `テンプレート › ${sectionLabel(t.kind)}`,
      keywords: [],
      items: t.items.map((i) => i.title),
    })),
  ];

  const tree = (
    <div data-coach="learning-tree" className="space-y-3">
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
          予定ごとに覚えた準備リストと、保存したテンプレートを確認・編集できます。
          <InfoHint>
            自動で覚えた「どの予定でどんなリストになるか」と、名前を付けて保存した
            セットの両方。上の検索はまとめて探します。
          </InfoHint>
        </p>
      </div>

      <LearningExplorer
        entries={searchEntries}
        hasTree={categories.length > 0}
        templateCount={templates.length}
        tree={tree}
        templates={<TemplatesGroup templates={templates} />}
      />
    </div>
  );
}

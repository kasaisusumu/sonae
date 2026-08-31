"use client";

import { useState, type ReactNode } from "react";
import { LearningSearch, type SearchEntry } from "./learning-search";

type View = "tree" | "templates";
type TplKind = "task" | "belonging";

function scrollToAnchor(anchor: string) {
  const el = document.getElementById(anchor);
  if (!el) return;
  let node: HTMLElement | null = el;
  while (node) {
    if (node instanceof HTMLDetailsElement) node.open = true;
    node = node.parentElement;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-teal");
  window.setTimeout(() => el.classList.remove("ring-2", "ring-teal"), 2200);
}

function Seg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-teal text-white shadow-sm"
          : "text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * 学習内容ページの中身。
 * - 一番上に横断検索（学習内容＋名前付きテンプレートの両方を検索）
 * - その下に「学習内容 / 名前付きテンプレート」の切り替え
 * - テンプレート側はさらに「準備すること / 持ち物」の切り替え
 */
export function LearningExplorer({
  entries,
  tree,
  templatesTask,
  templatesBelonging,
  hasTree,
  taskCount,
  belongingCount,
}: {
  entries: SearchEntry[];
  tree: ReactNode;
  templatesTask: ReactNode;
  templatesBelonging: ReactNode;
  hasTree: boolean;
  taskCount: number;
  belongingCount: number;
}) {
  const [view, setView] = useState<View>(hasTree ? "tree" : "templates");
  const [tplKind, setTplKind] = useState<TplKind>("task");

  function handlePick(e: SearchEntry) {
    if (e.kind === "template") {
      setView("templates");
      if (e.tplKind) setTplKind(e.tplKind);
    } else {
      setView("tree");
    }
    // タブが切り替わって対象が表示されてからスクロールする
    requestAnimationFrame(() =>
      requestAnimationFrame(() => scrollToAnchor(e.anchor)),
    );
  }

  return (
    <div className="space-y-3">
      <LearningSearch entries={entries} onPick={handlePick} />

      {/* 学習内容 / 名前付きテンプレート */}
      <div className="inline-flex rounded-xl bg-surface p-1">
        <Seg active={view === "tree"} onClick={() => setView("tree")}>
          学習内容
        </Seg>
        <Seg active={view === "templates"} onClick={() => setView("templates")}>
          名前付きテンプレート
        </Seg>
      </div>

      {/* 学習内容 */}
      <div hidden={view !== "tree"}>
        {hasTree ? (
          tree
        ) : (
          <p className="rounded-xl bg-surface px-4 py-8 text-center text-sm text-muted">
            まだ学習内容はありません。
            <br />
            予定の準備リストを何度か編集すると、ここに育っていきます。
          </p>
        )}
      </div>

      {/* 名前付きテンプレート */}
      <div hidden={view !== "templates"} className="space-y-3">
        <div className="inline-flex rounded-xl bg-surface p-1">
          <Seg
            active={tplKind === "task"}
            onClick={() => setTplKind("task")}
          >
            準備すること（{taskCount}）
          </Seg>
          <Seg
            active={tplKind === "belonging"}
            onClick={() => setTplKind("belonging")}
          >
            持ち物（{belongingCount}）
          </Seg>
        </div>
        <div hidden={tplKind !== "task"}>{templatesTask}</div>
        <div hidden={tplKind !== "belonging"}>{templatesBelonging}</div>
      </div>
    </div>
  );
}

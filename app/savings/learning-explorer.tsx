"use client";

import { useState, type ReactNode } from "react";
import { LearningSearch, type SearchEntry } from "./learning-search";

type View = "tree" | "templates";

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
      className={`flex-1 rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors ${
        active
          ? "bg-foreground text-surface shadow-sm"
          : "text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * 学習されたマニュアルページの中身。
 * - 一番上に横断検索（学習内容＋名前付きマニュアルの両方を検索）
 * - その下に「学習内容 / 名前付きマニュアル」の切り替え
 * - マニュアル側はさらに「準備すること / 持ち物」の切り替え
 */
export function LearningExplorer({
  entries,
  tree,
  templates,
  hasTree,
  templateCount,
}: {
  entries: SearchEntry[];
  tree: ReactNode;
  templates: ReactNode;
  hasTree: boolean;
  templateCount: number;
}) {
  const [view, setView] = useState<View>(hasTree ? "tree" : "templates");

  function handlePick(e: SearchEntry) {
    setView(e.kind === "template" ? "templates" : "tree");
    // タブが切り替わって対象が表示されてからスクロールする
    requestAnimationFrame(() =>
      requestAnimationFrame(() => scrollToAnchor(e.anchor)),
    );
  }

  return (
    <div className="space-y-3">
      <div data-coach="learning-search">
        <LearningSearch entries={entries} onPick={handlePick} />
      </div>

      {/* 学習内容 / 名前付きマニュアル（画面幅を半分ずつ） */}
      <div
        data-coach="learning-tabs"
        className="flex w-full gap-1 rounded-xl bg-surface p-1"
      >
        <Seg active={view === "tree"} onClick={() => setView("tree")}>
          学習内容
        </Seg>
        <Seg active={view === "templates"} onClick={() => setView("templates")}>
          名前付きマニュアル（{templateCount}）
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

      {/* 名前付きマニュアル */}
      <div hidden={view !== "templates"}>{templates}</div>
    </div>
  );
}

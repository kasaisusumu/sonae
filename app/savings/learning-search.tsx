"use client";

import { useMemo, useState } from "react";

export interface SearchEntry {
  kind: "event" | "template";
  anchor: string; // スクロール先の DOM id（"ev-<id>" | "tpl-<id>"）
  title: string;
  crumb: string;
  keywords: string[];
  items: string[]; // リストの項目名
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

function bigrams(s: string): Map<string, number> {
  const t = norm(s);
  const m = new Map<string, number>();
  if (t.length === 1) m.set(t, 1);
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** 2つの文字列の近さ（0〜1）。日本語・タイプミスに強い bigram Dice 係数。 */
function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return norm(a) === norm(b) ? 1 : 0;
  let inter = 0;
  for (const [g, c] of A) {
    const d = B.get(g);
    if (d) inter += Math.min(c, d);
  }
  const sizeA = [...A.values()].reduce((x, y) => x + y, 0);
  const sizeB = [...B.values()].reduce((x, y) => x + y, 0);
  return (2 * inter) / (sizeA + sizeB);
}

type Scored = {
  e: SearchEntry;
  hitItem: string | null; // 項目名で一致したときのその項目
  hitKind: "title" | "item" | "keyword" | "fuzzy";
  sim: number;
};

export function LearningSearch({ entries }: { entries: SearchEntry[] }) {
  const [q, setQ] = useState("");

  const { results, maybe } = useMemo(() => {
    const s = norm(q);
    if (!s) return { results: [] as Scored[], maybe: [] as Scored[] };

    const direct: Scored[] = [];
    const fuzzy: Scored[] = [];

    for (const e of entries) {
      if (norm(e.title).includes(s)) {
        direct.push({ e, hitItem: null, hitKind: "title", sim: 1 });
        continue;
      }
      const kw = e.keywords.find((k) => norm(k).includes(s));
      const it = e.items.find((i) => norm(i).includes(s));
      if (it) {
        direct.push({ e, hitItem: it, hitKind: "item", sim: 0.9 });
        continue;
      }
      if (kw) {
        direct.push({ e, hitItem: null, hitKind: "keyword", sim: 0.8 });
        continue;
      }
      // 近い名前？ タイトル・語・項目名の最大類似度
      let sim = similarity(s, e.title);
      let via: string | null = null;
      for (const k of e.keywords) {
        const x = similarity(s, k);
        if (x > sim) {
          sim = x;
          via = null;
        }
      }
      for (const i of e.items) {
        const x = similarity(s, i);
        if (x > sim) {
          sim = x;
          via = i;
        }
      }
      if (sim >= 0.34) {
        fuzzy.push({ e, hitItem: via, hitKind: "fuzzy", sim });
      }
    }

    direct.sort((a, b) => b.sim - a.sim);
    fuzzy.sort((a, b) => b.sim - a.sim);
    return { results: direct.slice(0, 15), maybe: fuzzy.slice(0, 6) };
  }, [q, entries]);

  function jump(anchor: string) {
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
    setQ("");
  }

  const Row = ({ r }: { r: Scored }) => (
    <li className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => jump(r.e.anchor)}
        className="block w-full px-3 py-2 text-left hover:bg-surface-muted"
      >
        <span className="font-medium">
          {r.e.kind === "template" && (
            <span className="mr-1 rounded bg-accent-soft px-1 text-[10px] text-teal-dark">
              テンプレ
            </span>
          )}
          {r.e.title}
        </span>
        <span className="block text-[11px] text-muted">
          {r.e.crumb}
          {r.hitItem ? ` ・ 「${r.hitItem}」を含む` : ""}
        </span>
      </button>
    </li>
  );

  return (
    <div className="sticky top-0 z-20 -mx-1 rounded-xl bg-background/95 px-1 py-2 backdrop-blur">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="予定名・テンプレ名・リストの中身で検索"
        className="w-full rounded-lg border bg-surface px-3 py-2 text-sm"
      />

      {results.length > 0 && (
        <ul className="mt-1 max-h-72 overflow-auto rounded-lg border bg-surface text-sm shadow-lg">
          {results.map((r) => (
            <Row key={`${r.e.anchor}:${r.hitKind}`} r={r} />
          ))}
        </ul>
      )}

      {maybe.length > 0 && (
        <div className="mt-1 rounded-lg border bg-surface text-sm shadow-lg">
          <p className="px-3 py-1 text-[11px] font-semibold text-muted">
            これかも？（近い名前）
          </p>
          <ul>
            {maybe.map((r) => (
              <Row key={`m:${r.e.anchor}`} r={r} />
            ))}
          </ul>
        </div>
      )}

      {q.trim() && results.length === 0 && maybe.length === 0 && (
        <p className="mt-1 px-1 text-[11px] text-muted">
          一致するものがありません。
        </p>
      )}
    </div>
  );
}

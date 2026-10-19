"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { normalizeSearch } from "./haystack";

export interface SearchRow {
  id: string;
  haystack: string; // 正規化済みの検索対象テキスト
  dateKey: string; // 同じ暦日でまとめるキー
  dateLabel: string; // 小さく出す日付見出し
  node: ReactNode; // 既にサーバーで描画済みの <EventRow>（<li>）
}

/**
 * これからの予定一覧。名前・日付（曜日/相対表現も）・カテゴリ・持ち物や
 * 準備の内容など、いろんな言い方で検索できる。日付が変わるごとに区切り線＋
 * 小さな日付見出しを入れる。
 * `extraRows`（済んだ予定）は、検索していないときの既定表示には出さないが、
 * 検索語があるときは rows と一緒に検索対象にする（ユーザー指摘により2026-10-20:
 * 「予定ページでの検索は済んだ予定も込みで検索できるようにして」）。
 */
export function EventSearch({
  rows,
  extraRows = [],
}: {
  rows: SearchRow[];
  extraRows?: SearchRow[];
}) {
  const [q, setQ] = useState("");

  const terms = useMemo(
    () => normalizeSearch(q).split(" ").filter(Boolean),
    [q],
  );

  const filtered = useMemo(() => {
    if (terms.length === 0) return rows;
    // 検索時は済んだ予定も混ぜるため、日付順（昇順）に並べ直す
    // （rows は未来向け昇順、extraRows は済んだ予定で別の並びのため）。
    return [...rows, ...extraRows]
      .filter((r) => terms.every((t) => r.haystack.includes(t)))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }, [rows, extraRows, terms]);

  // 連続する同日をグループにまとめる（rows は日付昇順で渡す）。
  const groups = useMemo(() => {
    const out: { key: string; label: string; items: SearchRow[] }[] = [];
    for (const r of filtered) {
      const last = out[out.length - 1];
      if (last && last.key === r.dateKey) last.items.push(r);
      else out.push({ key: r.dateKey, label: r.dateLabel, items: [r] });
    }
    return out;
  }, [filtered]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="検索：名前・日付・曜日・「明日」「来週」・持ち物や内容 …"
          className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 pr-16 text-sm"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-muted"
          >
            クリア
          </button>
        )}
      </div>

      {terms.length > 0 && (
        <p className="px-1 text-[11px] text-muted">
          {filtered.length} 件ヒット
          {filtered.length === 0
            ? " — 別の言い方（曜日・日付・持ち物名など）でもお試しください"
            : ""}
        </p>
      )}

      {groups.map((g, gi) => (
        <section
          key={g.key}
          className={gi > 0 ? "border-t border-border pt-3" : ""}
        >
          <p className="px-1 pb-1.5 text-[11px] font-medium text-muted">
            {g.label}
          </p>
          <ul className="space-y-2.5">
            {g.items.map((it) => (
              <Fragment key={it.id}>{it.node}</Fragment>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

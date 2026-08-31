"use client";

import { useState, useTransition } from "react";
import { acceptSuggestion, rejectSuggestion } from "@/app/actions";

import { formatLead, parseLead } from "@/lib/lead-time";

export interface SuggestionItem {
  id: string;
  title: string;
  suggestionType: "exclude" | "add" | "timing" | null;
  suggestionValue: string | null;
}

function describe(s: SuggestionItem): { text: string; yes: string; no: string } {
  switch (s.suggestionType) {
    case "exclude":
      return {
        text: `「${s.title}」は前に何度か消していました。今回も外しますか？`,
        yes: "外す",
        no: "残す",
      };
    case "add":
      return {
        text: `「${s.title}」は前に足していました。今回も入れますか？`,
        yes: "入れる",
        no: "不要",
      };
    case "timing": {
      const lead = formatLead(parseLead(s.suggestionValue)) || "前回の設定";
      return {
        text: `「${s.title}」の通知を${lead}にしますか？`,
        yes: `${lead}にする`,
        no: "このまま",
      };
    }
    default:
      return { text: s.title, yes: "適用", no: "却下" };
  }
}

export function SuggestionList({ suggestions }: { suggestions: SuggestionItem[] }) {
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = suggestions.filter((s) => !hidden.has(s.id));
  if (visible.length === 0) return null;

  function act(id: string, kind: "accept" | "reject") {
    setHidden((h) => new Set(h).add(id));
    startTransition(async () => {
      if (kind === "accept") await acceptSuggestion(id);
      else await rejectSuggestion(id);
    });
  }

  return (
    <section className="rounded-2xl border border-dashed border-border bg-surface p-4">
      <p className="text-xs text-muted">
        まだ確信度が低い提案です（学習中）。選ぶと次回以降の精度が上がります。
      </p>
      <ul className="mt-3 space-y-3">
        {visible.map((s) => {
          const d = describe(s);
          return (
            <li key={s.id} className="text-sm">
              <p>{d.text}</p>
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(s.id, "accept")}
                  className="rounded-lg bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-dark disabled:opacity-60"
                >
                  {d.yes}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(s.id, "reject")}
                  className="rounded-lg bg-surface-muted px-3 py-1.5 text-xs hover:bg-border disabled:opacity-60"
                >
                  {d.no}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

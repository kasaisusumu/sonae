"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ChecklistEditor } from "@/app/events/[id]/checklist-editor";

export interface LeafItem {
  id: string;
  title: string;
  comment: string | null;
  isDone: boolean;
  isUserAdded: boolean;
  notifyLeadMinutes: number | null;
}

export interface LeafSectionData {
  key: string;
  label: string;
  items: LeafItem[];
}

/**
 * 樹形図の葉の中身。基本はコンパクトなリスト表示（compact）。
 * 「編集」を押すと、予定詳細と同じ内容編集画面（ChecklistEditor）を枠ごとに出す。
 */
export function LeafBody({
  eventId,
  compact,
  sections,
}: {
  eventId: string;
  compact: ReactNode;
  sections: LeafSectionData[];
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div>
        {compact}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2 rounded-lg border border-border px-3 py-1 text-[11px] text-muted hover:border-teal hover:text-teal-dark"
        >
          編集
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="mb-1 text-[11px] text-muted underline hover:text-foreground"
      >
        閉じる
      </button>
      {sections.map((s, i) => (
        <Fragment key={s.key}>
          {i > 0 && <div className="mt-3" />}
          <ChecklistEditor
            eventId={eventId}
            kind={s.key}
            label={s.label}
            initialItems={s.items}
          />
        </Fragment>
      ))}
    </div>
  );
}

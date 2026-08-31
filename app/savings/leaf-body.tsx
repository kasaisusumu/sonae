"use client";

import { useState, type ReactNode } from "react";
import { ChecklistEditor } from "@/app/events/[id]/checklist-editor";

export interface LeafItem {
  id: string;
  title: string;
  comment: string | null;
  isDone: boolean;
  isUserAdded: boolean;
  notifyLeadMinutes: number | null;
}

/**
 * 樹形図の葉の中身。基本はコンパクトなリスト表示（compact）。
 * 「編集」を押すと、予定詳細と同じ内容編集画面（ChecklistEditor）を出す。
 */
export function LeafBody({
  eventId,
  compact,
  taskInitial,
  belongingInitial,
}: {
  eventId: string;
  compact: ReactNode;
  taskInitial: LeafItem[];
  belongingInitial: LeafItem[];
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
      <ChecklistEditor
        eventId={eventId}
        kind="task"
        initialItems={taskInitial}
      />
      <div className="mt-3" />
      <ChecklistEditor
        eventId={eventId}
        kind="belonging"
        initialItems={belongingInitial}
      />
    </div>
  );
}

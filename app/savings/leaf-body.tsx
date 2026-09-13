"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ChecklistEditor } from "@/app/events/[id]/checklist-editor";
import {
  AddSectionButton,
  SectionControls,
} from "@/app/events/[id]/section-manager";
import { isBuiltinSection } from "@/lib/sections";
import { DeleteLearnedEventButton } from "./tree-delete-button";

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
  eventIds,
  compact,
  sections,
}: {
  eventId: string;
  /** 削除（学習を忘れる）の対象。同名グループなら siblingEventIds も含めて渡す。 */
  eventIds: string[];
  compact: ReactNode;
  sections: LeafSectionData[];
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div>
        {compact}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-border px-3 py-1 text-[11px] text-muted hover:border-teal hover:text-teal-dark"
          >
            編集
          </button>
          <DeleteLearnedEventButton eventIds={eventIds} />
        </div>
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
          {!isBuiltinSection(s.key) && (
            <div className="mb-1 flex items-center justify-end">
              <SectionControls eventId={eventId} sectionKey={s.key} />
            </div>
          )}
          <ChecklistEditor
            eventId={eventId}
            kind={s.key}
            label={s.label}
            initialItems={s.items}
            allowImages={false}
          />
        </Fragment>
      ))}
      <div className="mt-3">
        <AddSectionButton eventId={eventId} />
      </div>
    </div>
  );
}

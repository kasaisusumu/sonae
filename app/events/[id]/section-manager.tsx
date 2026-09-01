"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addChecklistSection,
  removeChecklistSection,
  renameChecklistSection,
} from "@/app/actions";

/** 「＋ 枠を追加」ボタン。押すと名前入力を出し、追加すると説明欄・学習にも即反映される。 */
export function AddSectionButton({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted hover:border-teal hover:text-teal-dark"
      >
        ＋ 枠を追加
      </button>
    );
  }

  const submit = () => {
    const v = name.trim();
    if (!v) return;
    start(async () => {
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("name", v);
      await addChecklistSection(fd);
      setName("");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setOpen(false);
            setName("");
          }
        }}
        maxLength={24}
        placeholder="枠の名前（例: 買うもの）"
        className="rounded-md border bg-background px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending || !name.trim()}
        className="rounded-md bg-teal px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        追加
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setName("");
        }}
        className="text-xs text-muted underline hover:text-foreground"
      >
        取消
      </button>
    </div>
  );
}

/** ユーザーが足した枠の「枠名を変更／枠を削除」。組み込みの2枠には出さない。 */
export function SectionControls({
  eventId,
  sectionKey,
}: {
  eventId: string;
  sectionKey: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const rename = () => {
    const to = window.prompt("枠の名前を変更", sectionKey);
    if (to == null) return;
    const v = to.trim();
    if (!v || v === sectionKey) return;
    start(async () => {
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("from", sectionKey);
      fd.set("to", v);
      await renameChecklistSection(fd);
      router.refresh();
    });
  };

  const remove = () => {
    if (
      !window.confirm(
        `枠「${sectionKey}」を中の項目ごと削除します。よろしいですか？`,
      )
    )
      return;
    start(async () => {
      const fd = new FormData();
      fd.set("eventId", eventId);
      fd.set("key", sectionKey);
      await removeChecklistSection(fd);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2 text-[11px] text-muted">
      <button
        type="button"
        onClick={rename}
        disabled={pending}
        className="underline hover:text-foreground disabled:opacity-50"
      >
        枠名を変更
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="underline hover:text-warn disabled:opacity-50"
      >
        枠を削除
      </button>
    </div>
  );
}

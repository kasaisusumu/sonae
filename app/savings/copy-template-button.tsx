"use client";

import { useState } from "react";

/** マニュアルの項目一覧を、1 行 1 項目でクリップボードにコピーする。 */
export function CopyTemplateButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // 一部環境では失敗する。フォールバックとして選択用の一時領域を使う。
          try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          } catch {
            return;
          }
        }
        setDone(true);
        window.setTimeout(() => setDone(false), 1500);
      }}
      className="rounded-md border border-border px-2 py-1 text-[11px] text-teal-dark hover:border-teal"
    >
      {done ? "コピーしました ✓" : "クリップボードにコピー"}
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "mm_caltip_dismissed_v1";

/**
 * 「Google カレンダーの説明欄にあるリンクから、各予定の準備リストへ直接飛べる」
 * ことを大きく説明するカード。目玉機能なので目立たせる。一度 ✕ で閉じたら
 * localStorage に覚えて出さない。
 */
export function CalendarLinkTip({ writeEnabled }: { writeEnabled: boolean }) {
  // "loading" のあいだは何も出さない（SSR と初回クライアントを一致させる）
  const [state, setState] = useState<"loading" | "show" | "hide">("loading");

  useEffect(() => {
    let stored = false;
    try {
      stored = localStorage.getItem(KEY) != null;
    } catch {
      stored = false;
    }
    // effect 内での同期 setState を避ける（Tutorial と同じやり方）
    queueMicrotask(() => setState(stored ? "hide" : "show"));
  }, []);

  if (state !== "show") return null;

  function close() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setState("hide");
  }

  return (
    <section
      data-coach="cal-link-tip"
      className="relative rounded-2xl border border-border bg-surface p-4"
    >
      <button
        type="button"
        onClick={close}
        aria-label="閉じる"
        className="absolute right-2.5 top-2.5 rounded-full px-2 py-0.5 text-sm text-muted hover:bg-surface-muted hover:text-foreground"
      >
        ✕
      </button>

      <div className="flex items-start gap-3 pr-6">
        <span aria-hidden className="text-2xl leading-none">
          🔗
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
            カレンダーの説明欄から、そのまま準備リストへ
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            各予定の説明欄に「準備リスト」のリンクを自動で書き込みます。
            スマホやパソコンのカレンダーでそのリンクをタップすると、
            <strong className="text-foreground">
              その予定の準備リストのページがそのまま開きます
            </strong>
            。アプリを探して開き直す必要はありません。
          </p>

          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface p-3 text-[11px] leading-relaxed text-muted">
            <p>（予定のメモ）</p>
            <p className="mt-2">--- 私のマネージャー ---</p>
            <p className="font-medium text-teal-dark underline">
              準備リスト: https://…/events/xxxx ← ここをタップ
            </p>
            <p className="mt-1">【準備すること】 1/3</p>
            <p>☑ お茶を買う（1時間前）</p>
            <p>☐ 集合時間を確認</p>
          </div>

          {!writeEnabled && (
            <p className="mt-2.5 text-xs text-warn">
              いまは説明欄への書き込みがオフです。
              <Link href="/settings" className="underline">
                設定
              </Link>
              でオンにすると使えます。
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

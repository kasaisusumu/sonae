"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InfoHint } from "@/app/components/info-hint";

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
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight text-foreground">
            カレンダーの説明欄から、そのまま準備リストへ
            <InfoHint>
              各予定の説明欄に「準備リスト」のリンクを自動で書き込みます。カレンダーで
              そのリンクをタップすると、その予定の準備リストがそのまま開きます。
              連携より前の予定は、アプリで1回編集するか「確認しました」を押すまで
              書き込まれません（勝手に書き換えないため）。
            </InfoHint>
          </h2>

          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface p-3 text-[11px] leading-relaxed text-muted">
            <p>（予定のメモ）</p>
            <p className="mt-2">--- 勝手に準備分解くん ---</p>
            <p className="font-medium text-teal-dark underline">
              準備リスト: https://…/events/xxxx ← ここをタップ
            </p>
            <p className="mt-1">【予想される失敗】</p>
            <p>⚠ 集合時間に遅刻した</p>
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
              でオンに。
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

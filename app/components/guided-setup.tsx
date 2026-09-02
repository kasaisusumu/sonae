"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { syncCalendar } from "@/app/actions";
import { SubmitButton } from "@/app/components/submit-button";

const HOME_KEY = "mm_added_to_home_v1";
const DISMISS_KEY = "mm_guided_setup_hidden_v1"; // このセッションは出さない
const TUTORIAL_KEY = "mm_tutorial_v3"; // 概念スライドが終わってから出す

const BTN =
  "inline-flex items-center justify-center rounded-lg bg-foreground px-5 py-2.5 text-sm font-semibold text-surface no-underline hover:opacity-90";
const BTN_OUTLINE =
  "inline-flex items-center justify-center rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-surface-muted";

type Props = {
  step1: boolean; // Google 連携ずみ
  step2: boolean; // 予定がある
  step3: boolean; // 準備リストができている
  step5: boolean; // 通知オン
};

/**
 * ログインしたての人を「はじめかた」に沿って1工程ずつポップアップで誘導する。
 * ・出すのは未完了の先頭ステップだけ。終わったステップは自動で次へ進む。
 * ・「あとで」でそのセッションは閉じる。全ステップ完了で二度と出ない。
 * ・概念チュートリアル（Tutorial）が終わるまでは出さない（順番に案内する）。
 * 下部の据え置きカード（GettingStartedClient）は進捗の一覧として残す。
 */
export function GuidedSetup({ step1, step2, step3, step5 }: Props) {
  const [ready, setReady] = useState(false);
  const [homeDone, setHomeDone] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let home = false;
    let hide = true;
    try {
      home = localStorage.getItem(HOME_KEY) === "1";
      const tutorialDone = !!localStorage.getItem(TUTORIAL_KEY);
      const dismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
      hide = !tutorialDone || dismissed;
    } catch {
      hide = true;
    }
    queueMicrotask(() => {
      setHomeDone(home);
      setHidden(hide);
      setReady(true);
    });
  }, []);

  function markHome() {
    try {
      localStorage.setItem(HOME_KEY, "1");
    } catch {
      /* ignore */
    }
    setHomeDone(true);
  }

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setHidden(true);
  }

  const steps: {
    key: string;
    title: string;
    lead: string;
    done: boolean;
    action: React.ReactNode;
  }[] = [
    {
      key: "connect",
      title: "Google カレンダーとつなぐ",
      lead: "予定を読み取り、説明欄に準備リストを書き込みます（日時・タイトルは変えません）。約30秒で終わります。",
      done: step1,
      action: (
        <a href="/api/auth/google" className={BTN}>
          つなぐ
        </a>
      ),
    },
    {
      key: "home",
      title: "ホーム画面に追加する",
      lead: "iPhone は Safari の共有ボタン、Android は Chrome のメニュー（︙）から「ホーム画面に追加」。アプリのように1タップでひらけます。",
      done: homeDone,
      action: (
        <button type="button" onClick={markHome} className={BTN_OUTLINE}>
          追加した
        </button>
      ),
    },
    {
      key: "notify",
      title: "通知をオンにする",
      lead: "新しい予定・準備のタイミング・予定のあとの振り返りだけ、必要なときにお知らせします。",
      done: step5,
      action: (
        <Link href="/settings" className={BTN}>
          設定をひらく
        </Link>
      ),
    },
    {
      key: "events",
      title: "予定を用意する",
      lead: "Google カレンダーにいつも通り予定を入れるだけ。数分でこのアプリに取り込まれます。今すぐ反映するには下のボタン。",
      done: step2,
      action: step1 ? (
        <form action={syncCalendar}>
          <SubmitButton>カレンダーから取り込む</SubmitButton>
        </form>
      ) : (
        <p className="text-xs text-muted">
          先に「Google カレンダーとつなぐ」を済ませてください。
        </p>
      ),
    },
    {
      key: "list",
      title: "準備リストを1つ見てみる",
      lead: "予定を1つひらくと「準備すること」「持ち物」が用意されています。いる／いらないを直すと、次の似た予定から精度が上がります。",
      done: step3,
      action: step2 ? (
        <Link href="/events" className={BTN}>
          予定を開く
        </Link>
      ) : (
        <p className="text-xs text-muted">
          先に「予定を用意する」を済ませてください。
        </p>
      ),
    },
  ];

  const total = steps.length;
  const doneCount = steps.filter((s) => s.done).length;
  const currentIndex = steps.findIndex((s) => !s.done);

  if (!ready || hidden) return null;
  if (currentIndex === -1) return null; // 全部おわった

  const cur = steps[currentIndex];

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            はじめかた ステップ {currentIndex + 1} / {total}
          </span>
          <button
            type="button"
            onClick={dismiss}
            className="text-xs text-muted hover:text-foreground"
          >
            あとで
          </button>
        </div>

        <h2 className="mt-2 text-lg font-semibold text-foreground">
          {cur.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{cur.lead}</p>

        <div className="mt-4">{cur.action}</div>

        <div className="mt-5 flex items-center gap-1.5">
          {steps.map((s, i) => (
            <span
              key={s.key}
              className={`h-1.5 flex-1 rounded-full ${
                s.done
                  ? "bg-foreground"
                  : i === currentIndex
                    ? "bg-foreground/40"
                    : "bg-border"
              }`}
            />
          ))}
        </div>
        <p className="mt-2 text-center text-[11px] text-muted">
          あと {total - doneCount} つ・終わったステップから自動で次へ進みます
        </p>
      </div>
    </div>
  );
}

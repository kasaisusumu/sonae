"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { syncCalendar } from "@/app/actions";
import { SubmitButton } from "@/app/components/submit-button";

const HOME_KEY = "mm_added_to_home_v1";

type Props = {
  step1: boolean; // Google 連携ずみ
  step2: boolean; // 予定がある
  step3: boolean; // 準備リストができている
  step5: boolean; // 通知オン（Push 購読あり）
};

export function GettingStartedClient({ step1, step2, step3, step5 }: Props) {
  // ホーム画面への追加はブラウザ側の操作で検知できないので、自己申告で覚える。
  const [step4, setStep4] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let added = false;
    try {
      added = localStorage.getItem(HOME_KEY) === "1";
    } catch {
      /* ignore */
    }
    queueMicrotask(() => {
      setStep4(added);
      setHydrated(true);
    });
  }, []);

  function markHome() {
    try {
      localStorage.setItem(HOME_KEY, "1");
    } catch {
      /* ignore */
    }
    setStep4(true);
  }

  const steps: { done: boolean; title: string; detail: React.ReactNode }[] = [
    {
      done: step1,
      title: "Google カレンダーとつなぐ",
      detail: (
        <>
          <p>
            「つなぐ」で Google のログイン画面がひらきます。
            カレンダーの<strong>読み取りだけ</strong>を許可します（予定の書き換えは既定でしません）。
            つなぐと、あなたの予定がこのアプリに並びます。
          </p>
          {!step1 && (
            <a
              href="/api/auth/google"
              className="mt-2 inline-block rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-surface no-underline hover:opacity-90"
            >
              つなぐ（約30秒）
            </a>
          )}
        </>
      ),
    },
    {
      done: step2,
      title: "予定を用意する",
      detail: (
        <>
          <p>
            Google カレンダーにいつも通り予定を入れるだけ。数分でこのアプリに自動で取り込まれます。
            今すぐ反映したいときは下のボタンを押してください。
          </p>
          {step1 ? (
            <form action={syncCalendar} className="mt-2">
              <SubmitButton>カレンダーから取り込む</SubmitButton>
            </form>
          ) : (
            <p className="mt-1 text-xs text-muted">
              先に「Google カレンダーとつなぐ」を済ませてください。
            </p>
          )}
        </>
      ),
    },
    {
      done: step3,
      title: "準備リストを1つ見てみる",
      detail: (
        <>
          <p>
            予定を1つひらくと「準備すること」と「持ち物」が自動で用意されています。
            いる／いらないを直す・足すと、次の似た予定から精度が上がります（リストが増えすぎることはありません）。
          </p>
          {step2 && (
            <Link
              href="/events"
              className="mt-2 inline-block rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-surface no-underline hover:opacity-90"
            >
              予定を開く
            </Link>
          )}
        </>
      ),
    },
    {
      done: step4,
      title: "ホーム画面に追加する",
      detail: (
        <>
          <p>
            ブラウザの共有・メニューから「ホーム画面に追加」。
            アプリのように1タップでひらけて、通知も受け取りやすくなります。
            iPhone は Safari の共有ボタン、Android は Chrome のメニュー（︙）からどうぞ。
          </p>
          {!step4 && (
            <button
              type="button"
              onClick={markHome}
              className="mt-2 inline-block rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted"
            >
              追加した
            </button>
          )}
        </>
      ),
    },
    {
      done: step5,
      title: "通知をオンにする",
      detail: (
        <>
          <p>
            新しい予定が入ったとき、準備のタイミング、予定のあとの「失敗はあった？」など、
            必要なときだけお知らせします。設定ページの「通知」からオンにできます。
          </p>
          <Link
            href="/settings"
            className="mt-2 inline-block rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-surface no-underline hover:opacity-90"
          >
            設定をひらく
          </Link>
        </>
      ),
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  // 全部おわったら消す（ハイドレート後に判定。step4 は localStorage 依存のため）。
  if (hydrated && doneCount === steps.length) return null;

  return (
    <section
      data-coach="getting-started"
      className="rounded-2xl border border-border bg-surface p-5"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-foreground">
          はじめかた（あと{steps.length - doneCount}つ）
        </h2>
        <span className="text-xs text-muted tabular-nums">
          {doneCount}/{steps.length}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        各手順をタップすると、くわしい説明がひらきます。
      </p>

      <ol className="mt-3 space-y-1.5">
        {steps.map((s, i) => {
          const isOpen = open === i;
          return (
            <li
              key={i}
              className="overflow-hidden rounded-xl border border-border"
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-muted"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    s.done
                      ? "bg-foreground text-surface"
                      : "border border-border bg-surface text-foreground"
                  }`}
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <span
                  className={`min-w-0 flex-1 text-sm font-medium ${
                    s.done ? "text-muted line-through" : "text-foreground"
                  }`}
                >
                  {s.title}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {isOpen ? "▲" : "▾"}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-1 border-t border-border bg-background px-3 py-3 text-sm text-muted">
                  {s.detail}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

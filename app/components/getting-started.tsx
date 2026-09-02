import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { syncCalendar } from "@/app/actions";
import { SubmitButton } from "@/app/components/submit-button";

/**
 * はじめての人向けの「3ステップ」カード。
 * 全部おわったら自動で消える。むずかしい説明はしない。
 */
export async function GettingStarted({ userId }: { userId: string }) {
  const [account, eventCount, itemCount] = await Promise.all([
    prisma.userGoogleAccount.findUnique({
      where: { userId },
      select: { userId: true },
    }),
    prisma.event.count({ where: { userId } }),
    prisma.checklistItem.count({ where: { event: { userId } } }),
  ]);

  const step1 = Boolean(account); // Google 連携ずみ
  const step2 = eventCount > 0; // 予定がある
  const step3 = itemCount > 0; // 準備リストができている
  if (step1 && step2 && step3) return null;

  const doneCount = [step1, step2, step3].filter(Boolean).length;

  return (
    <section
      data-coach="getting-started"
      className="rounded-2xl border border-teal/30 bg-teal-soft p-5"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-teal-dark">
          はじめかた（あと{3 - doneCount}つ）
        </h2>
        <span className="text-xs text-teal-dark/70">{doneCount}/3</span>
      </div>

      <ol className="mt-3 space-y-3">
        <Step n={1} done={step1} title="Google カレンダーとつなぐ">
          {!step1 && (
            <a
              href="/api/auth/google"
              className="mt-1.5 inline-block rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-surface no-underline hover:opacity-90"
            >
              つなぐ（約30秒）
            </a>
          )}
        </Step>

        <Step
          n={2}
          done={step2}
          title="予定を用意する"
        >
          {step1 && !step2 && (
            <div className="mt-1.5 space-y-1.5">
              <form action={syncCalendar}>
                <SubmitButton>カレンダーから取り込む</SubmitButton>
              </form>
              <p className="text-xs text-teal-dark/70">
                Google カレンダーに予定を入れると自動で取り込まれます。
              </p>
            </div>
          )}
          {!step1 && (
            <p className="mt-1 text-xs text-teal-dark/70">
              カレンダーをつなぐと、予定がここに並びます。
            </p>
          )}
        </Step>

        <Step
          n={3}
          done={step3}
          title="準備リストを1つ見てみる"
        >
          {step2 && !step3 && (
            <Link
              href="/events"
              className="mt-1.5 inline-block rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-surface no-underline hover:opacity-90"
            >
              予定を開く
            </Link>
          )}
          {step3 && (
            <p className="mt-1 text-xs text-teal-dark/80">
              予定を開くと「準備すること」と「持ち物」が出ます。いる／いらないを直すと、次から精度が上がります。
            </p>
          )}
        </Step>
      </ol>
    </section>
  );
}

function Step({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done
            ? "bg-foreground text-surface"
            : "border border-teal/40 bg-surface text-teal-dark"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <div className="min-w-0">
        <p
          className={`text-sm font-medium ${
            done ? "text-teal-dark/60 line-through" : "text-teal-dark"
          }`}
        >
          {title}
        </p>
        {children}
      </div>
    </li>
  );
}

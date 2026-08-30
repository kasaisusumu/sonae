import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  disableDescriptionWrite,
  disconnectGoogle,
  logout,
  setCalendarId,
  submitFeedback,
} from "@/app/actions";
import { listCalendars, type CalendarChoice } from "@/lib/google";
import { formatDateTime, formatYen } from "@/lib/format";
import { SubmitButton } from "@/app/components/submit-button";
import { PushControls } from "@/app/components/push-controls";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const account = user.googleAccount;
  const feedback = await prisma.feedback.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? null;

  let calendars: CalendarChoice[] = [];
  if (account) {
    try {
      calendars = await listCalendars(user.id);
    } catch {
      calendars = [];
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">設定</h1>

      <section className="rounded-2xl bg-surface p-5">
        <h2 className="text-sm font-semibold text-muted">アカウント</h2>
        <p className="mt-2 text-sm">
          {user.name ? `${user.name}（${user.email}）` : user.email}
        </p>
      </section>

      <Link
        href="/settings/learning"
        className="block rounded-2xl bg-surface p-5 no-underline transition-colors hover:bg-surface-muted"
      >
        <h2 className="text-sm font-semibold text-muted">学習内容の確認</h2>
        <p className="mt-2 text-sm">
          何を学習しているか（固定・除外・タイミング）を確認し、個別に固定/リセットできます →
        </p>
      </Link>

      <section className="rounded-2xl bg-surface p-5">
        <h2 className="text-sm font-semibold text-muted">Google カレンダー連携</h2>
        {account ? (
          <div className="mt-3 space-y-3 text-sm">
            <p>
              接続中: <span className="font-medium">{account.googleAccountEmail}</span>
            </p>
            <p className="text-xs text-muted">
              {account.lastSyncedAt
                ? `最終取り込み: ${formatDateTime(account.lastSyncedAt)}`
                : "まだ取り込んでいません"}
              {account.writeDescriptionEnabled
                ? " ・ 読み取り＋説明欄書き込み"
                : " ・ 読み取りのみ"}
            </p>
            {calendars.length > 0 && (
              <form action={setCalendarId} className="pt-1">
                <label className="text-xs text-muted">
                  同期するカレンダー
                  <div className="mt-1 flex gap-2">
                    <select
                      name="calendarId"
                      defaultValue={account.calendarId || "primary"}
                      className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
                    >
                      {calendars.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.summary}
                          {c.primary ? "（メイン）" : ""}
                        </option>
                      ))}
                    </select>
                    <SubmitButton variant="ghost">変更</SubmitButton>
                  </div>
                </label>
              </form>
            )}
            <div className="flex flex-wrap gap-3 pt-1">
              <a
                href="/api/auth/google"
                className="rounded-lg bg-surface-muted px-4 py-2 text-sm font-medium no-underline hover:bg-border"
              >
                再接続する
              </a>
              <form action={disconnectGoogle}>
                <SubmitButton variant="ghost">連携を解除する</SubmitButton>
              </form>
            </div>

            {/* 説明欄への書き込み（オプトイン） */}
            <div className="rounded-lg bg-surface-muted p-3">
              <p className="text-xs font-semibold">
                予定の説明欄に準備リストを書き込む
              </p>
              {account.writeDescriptionEnabled ? (
                <div className="mt-1 space-y-2">
                  <p className="text-xs text-muted">
                    有効です。準備リスト（リンク＋箇条書き）を予定の説明欄に自動で追記・更新します。
                    元の説明文は残し、「--- そなえ ---」ブロックだけ差し替えます。
                  </p>
                  <form action={disableDescriptionWrite}>
                    <SubmitButton variant="ghost">無効にする</SubmitButton>
                  </form>
                </div>
              ) : (
                <div className="mt-1 space-y-2">
                  <p className="text-xs text-muted">
                    デフォルトは OFF（読み取りのみ）。オンにすると予定の説明欄に準備リストを追記します。
                    有効化には Google で「予定の編集」権限の追加許可（再認証1回）が必要です。
                  </p>
                  <a
                    href="/api/auth/google?write=1"
                    className="inline-block rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white no-underline hover:bg-teal-dark"
                  >
                    有効にする
                  </a>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-muted">未接続です。</p>
            <a
              href="/api/auth/google"
              className="mt-3 inline-block rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white no-underline hover:bg-teal-dark"
            >
              Google カレンダーと接続
            </a>
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-surface p-5">
        <h2 className="text-sm font-semibold text-muted">通知</h2>
        <p className="mt-2 text-sm text-muted">
          Google カレンダーに新しい予定が追加されると、準備リストを確認するよう通知します（数分おきに確認）。
        </p>
        {vapidPublicKey ? (
          <PushControls publicKey={vapidPublicKey} />
        ) : (
          <p className="mt-2 text-sm text-muted">
            この環境では通知が未設定です（VAPID 鍵が未登録）。
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-surface p-5">
        <h2 className="text-sm font-semibold text-muted">フィードバック（WTP アンケート）</h2>
        <p className="mt-2 text-sm text-muted">
          このアプリが「自分に合ってきた」と感じますか？ 月いくらなら払ってもよいと思うか教えてください。
        </p>
        <form action={submitFeedback} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="screen" value="/settings" />
          <label className="text-sm">
            <span className="text-muted">月いくらなら払いたい？（円）</span>
            <input
              type="number"
              name="wtpYen"
              min={0}
              step={100}
              placeholder="500"
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">ひとこと（任意）</span>
            <input
              name="comment"
              placeholder="ここが良かった / ここが惜しい"
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
            />
          </label>
          <div className="sm:col-span-2">
            <SubmitButton>送信する</SubmitButton>
          </div>
        </form>

        {feedback.length > 0 && (
          <ul className="mt-4 space-y-1 text-xs text-muted">
            {feedback.map((f) => (
              <li key={f.id}>
                {f.createdAt.toLocaleDateString("ja-JP")}:{" "}
                {f.wtpYen !== null ? `月 ${formatYen(f.wtpYen)}` : "金額なし"}
                {f.comment ? ` — ${f.comment}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-surface p-5">
        <form action={logout}>
          <SubmitButton variant="ghost">ログアウト</SubmitButton>
        </form>
      </section>
    </div>
  );
}

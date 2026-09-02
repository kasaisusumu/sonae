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
import { formatDateOnly, formatDateTime, formatYen } from "@/lib/format";
import { SubmitButton } from "@/app/components/submit-button";
import { ConfirmLink } from "@/app/components/confirm-link";
import { PushControls } from "@/app/components/push-controls";
import { InfoHint } from "@/app/components/info-hint";

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
      <div>
        <h1 className="text-xl font-semibold">設定</h1>
        <p className="mt-1 text-sm text-muted">
          カレンダー連携・通知・アカウントの設定。
        </p>
      </div>

      <section className="rounded-2xl bg-surface p-5">
        <h2 className="text-sm font-semibold text-muted">アカウント</h2>
        <p className="mt-2 text-sm">
          {user.name ? `${user.name}（${user.email}）` : user.email}
        </p>
      </section>

      <section data-coach="settings-google" className="rounded-2xl bg-surface p-5">
        <h2 className="text-sm font-semibold text-muted">Google カレンダー連携</h2>
        {account ? (
          <div className="mt-3 space-y-3 text-sm">
            <p>
              接続中:{" "}
              <span className="font-medium">{account.googleAccountEmail}</span>
            </p>
            <p className="text-xs text-muted">
              {account.lastSyncedAt
                ? `最終取り込み ${formatDateTime(account.lastSyncedAt)}`
                : "未取り込み"}
            </p>
            {calendars.length > 0 && (
              <form action={setCalendarId} className="pt-1">
                <label className="block text-xs text-muted">
                  同期するカレンダー
                  <div className="mt-1 flex flex-wrap items-stretch gap-2">
                    <select
                      name="calendarId"
                      defaultValue={account.calendarId || "primary"}
                      className="min-w-0 flex-1 basis-48 truncate rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
                    >
                      {calendars.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.summary}
                          {c.primary ? "（メイン）" : ""}
                        </option>
                      ))}
                    </select>
                    <SubmitButton
                      variant="ghost"
                      confirm="同期するカレンダーを変更します。よろしいですか？"
                    >
                      変更
                    </SubmitButton>
                  </div>
                </label>
              </form>
            )}
            <div className="flex flex-wrap gap-3 pt-1">
              <ConfirmLink
                href="/api/auth/google"
                message="Google カレンダーに接続し直します（別アカウントにも切り替え可）。よろしいですか？"
                className="rounded-lg bg-surface-muted px-4 py-2 text-sm font-medium no-underline hover:bg-border"
              >
                再接続
              </ConfirmLink>
              <form action={disconnectGoogle}>
                <SubmitButton
                  variant="ghost"
                  confirm="連携を解除しますか？（取り込んだ予定と学習内容は残ります）"
                >
                  連携を解除
                </SubmitButton>
              </form>
            </div>

            <div
              data-coach="settings-desc"
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-surface-muted p-3"
            >
              <span className="text-xs font-semibold">
                説明欄に準備リストを書き込む
              </span>
              <InfoHint>
                予定の説明欄の末尾に「準備リストのリンク＋箇条書き」を追記・更新します。
                日時・タイトル・元の説明文は変更しません。連携より前の予定は、
                アプリで1回編集するか「確認しました」を押してから書き込まれます。
              </InfoHint>
              <span className="text-xs text-muted">
                {account.writeDescriptionEnabled ? "オン" : "オフ"}
              </span>
              <span className="ml-auto">
                {account.writeDescriptionEnabled ? (
                  <form action={disableDescriptionWrite}>
                    <SubmitButton
                      variant="ghost"
                      confirm="オフにします。書き込み済みの説明欄はそのまま残ります。よろしいですか？"
                    >
                      オフにする
                    </SubmitButton>
                  </form>
                ) : (
                  <ConfirmLink
                    href="/api/auth/google?write=1"
                    message="オンにします。必要なら Google で「予定の編集」権限の追加許可（再認証1回）を行います。進めますか？"
                    className="inline-block rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-surface no-underline hover:opacity-90"
                  >
                    オンにする
                  </ConfirmLink>
                )}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-muted">未接続です。</p>
            <ConfirmLink
              href="/api/auth/google"
              message="Google カレンダーと接続します。よろしいですか？"
              className="mt-3 inline-block rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-surface no-underline hover:opacity-90"
            >
              Google カレンダーと接続
            </ConfirmLink>
          </div>
        )}
      </section>

      <section data-coach="settings-notify" className="rounded-2xl bg-surface p-5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted">
          通知
          <InfoHint>
            新しい予定の取り込み、準備リストのリマインド、予定のあとの
            「失敗はあった？」を、必要なときだけ送ります（数分おきに確認）。
          </InfoHint>
        </h2>
        {vapidPublicKey ? (
          <PushControls publicKey={vapidPublicKey} />
        ) : (
          <p className="mt-2 text-sm text-muted">
            この環境では通知が未設定です。
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-surface p-5">
        <h2 className="text-sm font-semibold text-muted">
          フィードバック（WTP アンケート）
        </h2>
        <form action={submitFeedback} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="screen" value="/settings" />
          <label className="text-sm">
            <span className="text-muted">月いくらなら払ってもよい？（円）</span>
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
              placeholder="良かった点 / 惜しい点"
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
                {formatDateOnly(f.createdAt)}:{" "}
                {f.wtpYen !== null ? `月 ${formatYen(f.wtpYen)}` : "金額なし"}
                {f.comment ? ` — ${f.comment}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-surface p-5">
        <form action={logout}>
          <SubmitButton
            variant="ghost"
            confirm="ログアウトします。同じ Google アカウントで入り直せば元に戻ります。よろしいですか？"
          >
            ログアウト
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}

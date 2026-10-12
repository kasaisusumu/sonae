import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/session";
import {
  isAdminEmail,
  isAdminVerifiedCookieValid,
  ADMIN_VERIFIED_COOKIE,
} from "@/lib/admin-auth";

function adminLoginErrorMessage(
  err: string | undefined,
  who: string | undefined,
): string {
  if (err === "mismatch") {
    return `Google側で選んだアカウント（${who ?? "不明"}）は管理者として登録されていません。アカウント選択画面で正しいアカウントを選び直してください。`;
  }
  if (err === "state") {
    return "ログインの確認情報（state）が一致しませんでした。Cookieがブロックされていないか確認のうえ、もう一度お試しください。";
  }
  if (err === "exchange") {
    return "Googleとの認証処理中にエラーが発生しました。もう一度お試しください（続く場合は運営者にご連絡ください）。";
  }
  return "確認に失敗しました。もう一度お試しください。";
}

/**
 * /admin 配下の各ページの先頭で呼ぶ共通ガード（app/admin/page.tsx から抽出）。
 * - 管理者（ADMIN_EMAIL）でなければ 404。
 * - Google 再ログインから ADMIN_VERIFIED_MAX_AGE_MS 以内でなければ、再ログインへ
 *   飛ばす（直前の再ログイン失敗直後は理由を表示するページを返す）。
 * 両方通れば { ok: true, id, email }、通らなければ { ok: false, node }（呼び出し側は
 * そのまま return すること）を返す。
 */
export async function requireAdminVerified(
  searchParams: { err?: string; who?: string },
): Promise<
  | { ok: true; id: string; email: string }
  | { ok: false; node: React.ReactNode }
> {
  const me = await getCurrentUser();
  if (!me) redirect("/");
  if (!isAdminEmail(me.email)) notFound();

  const { err, who } = searchParams;
  const store = await cookies();
  const verified = isAdminVerifiedCookieValid(
    store.get(ADMIN_VERIFIED_COOKIE)?.value,
    me.id,
  );
  if (!verified) {
    if (err) {
      return {
        ok: false,
        node: (
          <main className="mx-auto max-w-md px-4 py-16 text-sm">
            <h1 className="mb-3 text-base font-semibold">管理者ログインの確認に失敗しました</h1>
            <p className="mb-4 text-muted">{adminLoginErrorMessage(err, who)}</p>
            <a
              href="/api/auth/google?dest=admin"
              className="inline-block rounded-lg bg-foreground px-4 py-2 font-medium text-surface hover:opacity-90"
            >
              もう一度ログインする
            </a>
          </main>
        ),
      };
    }
    redirect("/api/auth/google?dest=admin");
  }
  return { ok: true, id: me.id, email: me.email };
}

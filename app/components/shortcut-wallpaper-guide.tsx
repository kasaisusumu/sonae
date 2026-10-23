"use client";

import { InfoHint } from "@/app/components/info-hint";
import { trackFeatureUse } from "@/app/actions";

/**
 * /settings の「ロック画面ショートカット」導入ガイド（2026-10-23追加）。
 * 共有ショートカットのiCloudリンクは環境変数 SHORTCUT_SHARE_URL で管理し、
 * 未設定ならガイド全体を出さない（呼び出し元の /settings/page.tsx で判定）。
 * トークンの発行・再発行・無効化は、同じページの ShortcutTokenPanel を使う
 * （ここでは二重に作らず、そちらを使うよう案内するだけ）。
 */
export function ShortcutWallpaperGuide({ shareUrl }: { shareUrl: string }) {
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted">
        ロック画面ショートカット
        <InfoHint id="settings-lock-screen-shortcut-guide">
          <p className="mb-2 text-sm">
            このショートカットは、上の「ショートカット用トークン」を使って、
            登録した背景画像の上に直近の予定の準備リストと「急ぎ」「そのうち」を
            描き込んだ画像を取得し、ロック画面の壁紙に設定します。
          </p>
          <p className="text-[13px] text-muted">
            共有ショートカットにトークンは含まれていません。取り込むときに
            ショートカットアプリが「このショートカットが必要とする情報」として
            トークンの入力を求めます（インポートの質問）。そこに、上のトークンを
            貼ってください。
          </p>
        </InfoHint>
      </h2>

      <ol className="space-y-2 text-sm text-foreground">
        <li className="flex flex-wrap items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-soft text-xs font-semibold text-teal-dark">
            1
          </span>
          <a
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => void trackFeatureUse("feature:lock-screen-guide-open-share")}
            className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-surface no-underline hover:opacity-90"
          >
            共有ショートカットを開く
          </a>
          <span className="text-xs text-muted">（iPhoneのSafariで開いてください）</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-soft text-xs font-semibold text-teal-dark">
            2
          </span>
          <span>
            「ショートカットを追加」を押すと、トークンの入力を求められます。上の
            「ショートカット用トークン」で発行したトークンを貼ってください。
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-soft text-xs font-semibold text-teal-dark">
            3
          </span>
          <span>
            追加したショートカットを実行すると、最新のロック画面壁紙を取得して
            設定します（実行するたびに、その時点の最新の内容で描き直されます）。
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-soft text-xs font-semibold text-teal-dark">
            4
          </span>
          <span>
            自動で実行したい場合は、iPhoneの「ショートカット」アプリの「オートメーション」
            タブで「時刻」をきっかけに設定し、このショートカットを実行するようにしてください
            （例: 毎朝7時に自動で壁紙を更新）。
          </span>
        </li>
      </ol>
    </div>
  );
}

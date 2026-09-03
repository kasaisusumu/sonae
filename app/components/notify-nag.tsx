"use client";

import { useEffect, useState } from "react";
import { pushSupported, registerServiceWorker } from "@/lib/push-client";
import { NotifyEnableButton } from "./push-controls";

const KEY = "mm_notify_nag_v1"; // sessionStorage: この訪問では出さない
const TUTORIAL_KEY = "mm_tutorial_v3";

/**
 * 通知がオフのままの人に、ポップアップで「オンにして」と促す。
 * ポップアップの中の <NotifyEnableButton> からその場でオンにできる。
 *
 * - **ホーム画面に追加した状態（standalone）でのみ出す。** ふつうのブラウザ
 *   タブでは出さない（先に「ホーム画面に追加」が必要で、iPhone では特に
 *   ブラウザだと通知自体が使えないため）。
 * - サーバー側に購読があれば（`hasSubscription`）そもそも出さない。
 * - 端末側に購読があるときも出さない。
 * - 導入チュートリアルが終わるまで、また他のオンボーディング系ポップアップが
 *   出ている間は待つ（ポップアップを重ねない）。
 * - 「あとで」= その訪問（セッション）中は再表示しない。次回アクセスでまた促す。
 */

/** ホーム画面に追加したアイコンから開いているか（PWA standalone）。 */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mm = window.matchMedia?.("(display-mode: standalone)")?.matches;
  // iOS Safari は display-mode を返さないので navigator.standalone を見る
  const iosStandalone = (
    navigator as Navigator & { standalone?: boolean }
  ).standalone;
  return Boolean(mm || iosStandalone);
}
export function NotifyNag({
  publicKey,
  hasSubscription,
}: {
  publicKey: string | null;
  hasSubscription: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (hasSubscription || !publicKey) return;
    let cancelled = false;

    const blocked = () =>
      !!document.querySelector(
        "[data-mm-tutorial],[data-mm-guided],[data-mm-firstseen],[data-mm-prevent-goals],[data-mm-coach]",
      );

    const decide = async () => {
      try {
        if (sessionStorage.getItem(KEY)) return;
      } catch {
        return; // sessionStorage 不可の環境では出さない
      }
      if (!isStandalone()) return; // ブラウザタブでは出さない（要ホーム画面追加）
      if (!pushSupported()) return; // 非対応端末は「はじめかた」の導線に任せる
      try {
        // 導入チュートリアルが終わってから（未完ならそちらが先）
        if (!localStorage.getItem(TUTORIAL_KEY)) return;
      } catch {
        return;
      }
      try {
        const reg = await registerServiceWorker();
        const sub = await reg.pushManager.getSubscription();
        if (sub) return; // 端末側に購読あり → オン扱い
      } catch {
        /* 取得失敗時はそのまま促す */
      }

      const tryShow = (retries: number) => {
        if (cancelled) return;
        if (blocked()) {
          if (retries > 0) window.setTimeout(() => tryShow(retries - 1), 600);
          return;
        }
        setOpen(true);
      };
      tryShow(20); // 他のポップアップが引くのを最大 ~12 秒待つ
    };

    const t = window.setTimeout(decide, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [publicKey, hasSubscription]);

  if (!open) return null;

  return (
    <div
      data-mm-notify-nag
      className="fixed inset-0 z-[59] flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl">
        <h2 className="text-base font-semibold text-foreground">
          🔔 通知がオフのままです
        </h2>
        <p className="mt-2 text-sm text-muted">
          新しい予定の取り込みや、準備・失敗の先回りリマインドは通知で届きます。
          オフのままだと気づけません。下のボタンからオンにできます。
        </p>

        <div className="mt-4">
          <NotifyEnableButton
            publicKey={publicKey}
            onEnabled={() => setOpen(false)}
          />
        </div>

        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.setItem(KEY, "1");
            } catch {
              /* ignore */
            }
            setOpen(false);
          }}
          className="mt-3 text-xs text-muted hover:text-foreground"
        >
          あとで
        </button>
      </div>
    </div>
  );
}

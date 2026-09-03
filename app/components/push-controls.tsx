"use client";

import { useCallback, useEffect, useState } from "react";
import {
  pushSupported,
  registerServiceWorker,
  urlBase64ToUint8Array,
} from "@/lib/push-client";
import {
  removePushSubscription,
  savePushSubscription,
  sendTestPush,
} from "@/app/actions";

type Status = "loading" | "unsupported" | "denied" | "off" | "on";

/**
 * 「通知をオンにする」だけの小さなボタン。オンボーディングのポップアップや
 * はじめかたカードから、その場でブラウザ許可 → 購読 → サーバー登録まで行う。
 */
export function NotifyEnableButton({
  publicKey,
  onEnabled,
  className,
}: {
  publicKey: string | null;
  onEnabled?: () => void;
  className?: string;
}) {
  const [state, setState] = useState<
    "idle" | "busy" | "on" | "denied" | "unsupported" | "error"
  >("idle");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const decide = async (): Promise<typeof state> => {
      if (!publicKey || !pushSupported()) return "unsupported";
      if (Notification.permission === "denied") return "denied";
      try {
        const reg = await registerServiceWorker();
        const sub = await reg.pushManager.getSubscription();
        return sub ? "on" : "idle";
      } catch {
        return "idle";
      }
    };
    decide().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  async function enable() {
    if (!publicKey) return;
    setState("busy");
    setNote(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "idle");
        if (perm !== "denied")
          setNote("許可されませんでした。もう一度お試しください。");
        return;
      }
      const reg = await registerServiceWorker();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON();
      await savePushSubscription({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      });
      setState("on");
      setNote("通知をオンにしました。");
      onEnabled?.();
    } catch (e) {
      console.error(e);
      setState("error");
      setNote("通知の登録に失敗しました。時間をおいて再度お試しください。");
    }
  }

  if (state === "on") {
    return (
      <p className="text-sm font-medium text-teal-dark">✓ 通知はオンです</p>
    );
  }
  if (state === "unsupported") {
    return (
      <p className="text-xs text-muted">
        この端末では、先に「ホーム画面に追加」して、追加したアイコンから開くと
        通知をオンにできます（iPhone は特にこの順番が必要です）。
      </p>
    );
  }
  if (state === "denied") {
    return (
      <p className="text-xs text-warn">
        ブラウザで通知がブロックされています。サイトの設定から通知を「許可」に
        変更してください。
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={enable}
        disabled={state === "busy"}
        className={
          className ??
          "inline-flex items-center justify-center rounded-lg bg-foreground px-5 py-2.5 text-sm font-semibold text-surface hover:opacity-90 disabled:opacity-60"
        }
      >
        {state === "busy" ? "処理中…" : "通知をオンにする"}
      </button>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

export function PushControls({ publicKey }: { publicKey: string | null }) {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey || !pushSupported()) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    try {
      const reg = await registerServiceWorker();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // 端末側に購読があるのにサーバー側の行が消えている場合があるので、
        // 開くたびに登録し直す（upsert なので無害・これで通知が復活する）
        const json = sub.toJSON();
        try {
          await savePushSubscription({
            endpoint: sub.endpoint,
            p256dh: json.keys?.p256dh ?? "",
            auth: json.keys?.auth ?? "",
            userAgent:
              typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          });
        } catch {
          /* 一時的な失敗は無視（次回の起動で再試行される） */
        }
      }
      setStatus(sub ? "on" : "off");
    } catch {
      setStatus("off");
    }
  }, [publicKey]);

  useEffect(() => {
    // マウント時に一度だけ購読状態を確認する（非同期のため段階的に setState する）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  async function enable() {
    if (!publicKey) return;
    if (
      !window.confirm(
        "通知をオンにします。続けてブラウザの許可を求めます。よろしいですか？",
      )
    ) {
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await registerServiceWorker();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON();
      await savePushSubscription({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      });
      setStatus("on");
      setNote("通知をオンにしました。");
    } catch (e) {
      console.error(e);
      setNote("通知の登録に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (
      !window.confirm(
        "通知をオフにします。予定の追加やリマインドが届かなくなります。よろしいですか？",
      )
    ) {
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const reg = await registerServiceWorker();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus("off");
      setNote("通知をオフにしました。");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setNote(null);
    try {
      const r = await sendTestPush();
      if (!r.configured) {
        setNote(
          "サーバー側の通知設定（VAPID 鍵）が未登録です。デプロイ環境の環境変数を確認してください。",
        );
      } else if (r.subscriptions === 0) {
        setNote(
          "この端末がサーバーに登録されていません。いったん「オフにする」→「通知をオンにする」を試してください。",
        );
      } else if (r.sent === 0) {
        setNote(
          `送信できませんでした（登録 ${r.subscriptions} 件 / 無効化 ${r.removed} 件）。通知をオフ→オンで再登録してみてください。`,
        );
      } else {
        setNote(
          `テスト通知を送りました（${r.sent} 件）。数秒待っても届かない場合は端末の通知設定を確認してください。`,
        );
      }
    } catch {
      setNote("テスト通知の送信でエラーが発生しました。");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return <p className="mt-2 text-sm text-muted">確認中…</p>;
  }

  if (status === "unsupported") {
    return (
      <p className="mt-2 text-sm text-muted">
        この端末／ブラウザでは Web 通知を使えません。iPhone の場合は Safari
        でこのページを「ホーム画面に追加」し、追加したアイコンから開くと通知を有効にできます。
      </p>
    );
  }

  if (status === "denied") {
    return (
      <p className="mt-2 text-sm text-warn">
        通知がブラウザでブロックされています。サイトの設定から通知を「許可」に変更してください。
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {status === "on" ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-teal-dark">通知はオンです</span>
          <button
            type="button"
            onClick={test}
            disabled={busy}
            className="rounded-lg bg-surface-muted px-3 py-1.5 text-sm hover:bg-border disabled:opacity-60"
          >
            テスト通知を送る
          </button>
          <button
            type="button"
            onClick={disable}
            disabled={busy}
            className="text-sm text-muted underline hover:text-foreground disabled:opacity-60"
          >
            オフにする
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={enable}
          disabled={busy}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-surface hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "処理中…" : "通知をオンにする"}
        </button>
      )}
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

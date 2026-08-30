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
      await sendTestPush();
      setNote("テスト通知を送りました。数秒待っても届かない場合は端末の通知設定を確認してください。");
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
          className="rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white hover:bg-teal-dark disabled:opacity-60"
        >
          {busy ? "処理中…" : "通知をオンにする"}
        </button>
      )}
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

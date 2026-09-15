"use client";

import { useEffect, useRef } from "react";

/**
 * デバウンス中の自動保存を、画面を離れる／アプリがバックグラウンドになる／
 * タブやアプリを閉じる直前に、待たずに即座に走らせる。
 *
 * 自動保存は「入力が止まってからしばらく待って保存」という setTimeout の
 * デバウンスで実装している（checklist-editor.tsx 等）。React のクリーンアップは
 * アンマウント時にこのタイマーを clearTimeout するだけなので、編集した直後に
 * 画面を離れる／アプリを閉じると、保存が一度も走らずに変更が消えてしまっていた。
 *
 * `flush` には「保留中の変更があれば今すぐ保存する（無ければ何もしない）」関数を渡す。
 * 呼び出し側の setTimeout コールバックと同じ関数を使うのが基本（内部で ref に
 * 常に最新版を保持するので、依存配列を気にせず渡してよい）。
 *
 * - `visibilitychange`（`hidden` になった瞬間）: タブ切り替え・アプリの
 *   バックグラウンド化・画面ロックなどを広くカバーする。
 * - `pagehide`: タブを閉じる・ブラウザバック等（`beforeunload` よりモバイルで確実）。
 * - アンマウント時: アプリ内の画面遷移（SPA ナビゲーション）で setTimeout の
 *   クリーンアップが動く直前に、保留分を流す。
 *
 * 注: ページが実際に破棄される瞬間に発火したリクエストは、ブラウザ側の事情で
 * 完了前に打ち切られることがある（Web の一般的な制約。sendBeacon は Server Action
 * の呼び出し形式に使えないため代替できない）。それでも「1回も保存されない」より
 * 「できるだけ早く保存を試みる」方がずっと安全なので、この形にしている。
 */
export function useFlushOnHide(flush: () => void): void {
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  useEffect(() => {
    const run = () => flushRef.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", run);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", run);
      run(); // アンマウント（画面遷移含む）時も保留分を流す
    };
  }, []);
}

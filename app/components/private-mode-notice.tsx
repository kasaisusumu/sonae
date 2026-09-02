"use client";

import { useEffect, useState } from "react";

/**
 * シークレット / プライベートモードの注意書き。
 * このアプリは localStorage（チュートリアル進捗・「ホーム画面に追加」など）と
 * Cookie（ログイン）に依存するため、プライベートモードだと毎回リセットされる。
 * 常に控えめな一文を出し、プライベートの可能性が高いと分かったときは強めに出す。
 */
export function PrivateModeNotice() {
  const [likelyPrivate, setLikelyPrivate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let priv = false;
      try {
        const k = "__mm_pm_test__";
        localStorage.setItem(k, "1");
        localStorage.removeItem(k);
      } catch {
        priv = true; // 書き込み不可 ＝ ほぼプライベート／制限モード
      }
      if (!priv) {
        try {
          const est = await navigator.storage?.estimate?.();
          const quota = est?.quota;
          // Chrome のシークレットは quota を極端に絞る（数十〜120MB 程度）
          if (typeof quota === "number" && quota > 0 && quota < 300 * 1024 * 1024) {
            priv = true;
          }
        } catch {
          /* 判定不能なら控えめ表示のみ */
        }
      }
      if (!cancelled && priv) setLikelyPrivate(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto mt-4 max-w-md space-y-2 text-left">
      {likelyPrivate && (
        <p className="rounded-xl border border-foreground bg-surface px-4 py-3 text-xs font-medium text-foreground">
          ⚠ シークレット／プライベートモードで開いている可能性があります。
          このモードだと、ログイン状態や学習した内容が保存されず毎回リセットされます。
          ふだんの（通常の）ウィンドウで開き直してください。
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-muted">
        ※ シークレット／プライベートブラウズは避けてください。
        ログインや設定・学習した内容が保存されません。
      </p>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { switchFeatureModeAction } from "@/app/actions";
import { InfoHint } from "@/app/components/info-hint";

type Mode = "test" | "production";

const LABEL: Record<Mode, string> = {
  test: "テスト版",
  production: "本番版",
};

/**
 * 設定ページの「機能モード」切替ボタン。確認ダイアログ→切替→結果（変換・休眠件数）
 * を小さく表示する。二重送信は useTransition の pending で防ぐ。
 */
export function FeatureModeToggle({ current }: { current: string }) {
  const [mode, setMode] = useState<Mode>(current === "production" ? "production" : "test");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    converted: number;
    dormant: number;
    to: Mode;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function switchTo(target: Mode) {
    if (pending || target === mode) return;
    const ok = window.confirm(
      target === "production"
        ? "本番版モードに切り替えます。本番の機能（失敗ログ・節約額ダッシュボード）に切り替わります。予定・メモ・編集履歴などの元データは消えません。学習結果はルールに沿って引き継がれます（触っていないものだけ）。あとでテスト版に戻すこともできます。よろしいですか？"
        : "テスト版モードに切り替えます。テストの機能（未来の自分へ・次回の出し方3択）に切り替わります。予定・メモ・編集履歴などの元データは消えません。学習結果はルールに沿って引き継がれます（触っていないものだけ）。あとで本番版に戻すこともできます。よろしいですか？",
    );
    if (!ok) return;
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await switchFeatureModeAction(target);
      if (res.ok) {
        setMode(target);
        setResult({ converted: res.converted, dormant: res.dormant, to: target });
      } else {
        setError("切替に失敗しました。もう一度お試しください。");
      }
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {(["test", "production"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            disabled={pending}
            onClick={() => switchTo(m)}
            aria-pressed={mode === m}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              mode === m
                ? "border-teal bg-teal-soft text-teal-dark"
                : "border-border bg-surface text-muted hover:border-teal/50"
            }`}
          >
            {LABEL[m]}
          </button>
        ))}
        {pending && <span className="text-xs text-muted">切替中…</span>}
        <InfoHint id="feature-mode-toggle">
          <p className="mb-2 text-sm font-semibold text-foreground">機能モードとは</p>
          <p className="mb-2 text-[13px]">
            テスト版（未来の自分へ・次回の出し方3択）と本番版（失敗ログ・節約額ダッシュボード）を
            切り替えられます。予定・準備リスト・メモ・編集履歴などの元データは、どちらのモードでも
            共有され、切り替えても消えません。
          </p>
          <p className="text-[13px]">
            学習結果（自動で覚えた内容）は、あなたが直接選んだ・直したものはそのまま保たれ、
            まだ誰も触っていない分だけ、切り替えた先のモードの形に自動で反映されます。
          </p>
        </InfoHint>
      </div>
      {error && <p className="mt-2 text-xs text-warn">{error}</p>}
      {result && (
        <p className="mt-2 text-xs text-muted">
          {LABEL[result.to]}モードに切り替えました。学習結果を{result.converted}
          件反映、{result.dormant}件は休眠にしました（データは消えていません。
          いつでも元のモードに戻せます）。
        </p>
      )}
    </div>
  );
}

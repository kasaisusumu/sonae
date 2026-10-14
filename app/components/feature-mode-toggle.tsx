"use client";

import { useState, useTransition } from "react";
import { switchFeatureModeAction } from "@/app/actions";
import { InfoHint } from "@/app/components/info-hint";
import { ScopeChip } from "@/app/components/scope-chip";

type Mode = "test" | "production";

// 表示名は ver1（本番版の機能）／ver2（テスト版の機能）。内部の値（"production"/"test"）は
// そのまま（lib/feature-mode.ts の FeatureMode と一致させる。表示名だけの変更）。
const LABEL: Record<Mode, string> = {
  production: "ver1",
  test: "ver2",
};
// 左から ver1, ver2 の順で並べる。
const ORDER: Mode[] = ["production", "test"];

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
        ? "ver1に切り替えます。本番の機能（失敗ログ・節約額ダッシュボード）に切り替わります。予定・メモ・編集履歴などの元データは消えません。学習結果はルールに沿って引き継がれます（触っていないものだけ）。あとでver2に戻すこともできます。よろしいですか？"
        : "ver2に切り替えます。テストの機能（未来の自分へ・次回の出し方3択）に切り替わります。予定・メモ・編集履歴などの元データは消えません。学習結果はルールに沿って引き継がれます（触っていないものだけ）。あとでver1に戻すこともできます。よろしいですか？",
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
        {ORDER.map((m) => (
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
        <InfoHint
          id="feature-mode-toggle"
          pages={[
            <div key="p1">
              <p className="mb-2 text-sm font-semibold text-foreground">機能モードとは</p>
              <p className="mb-2 text-[13px]">
                ver1（本番の機能: 失敗ログ・節約額ダッシュボード）と ver2（テストの機能: 未来の
                自分へ・次回の出し方3択）を切り替えられます。予定・準備リスト・メモ・編集履歴
                などの元データは、どちらのモードでも共有され、切り替えても消えません。
              </p>
              <p className="mb-2 text-[13px]">
                学習結果（自動で覚えた内容）は、あなたが直接選んだ・直したものはそのまま保たれ、
                まだ誰も触っていない分だけ、切り替えた先のモードの形に自動で反映されます。
              </p>
              <p className="text-[13px]">
                切替直後に自動でカレンダーの説明欄を書き直すのは、今日以降の予定のうち
                <strong>直近20件まで</strong>です。それより先の予定は、その予定の準備リストを
                何か編集するなど説明欄が書き直されるタイミングまで、古いモードの表記のまま残ります。
              </p>
            </div>,
            <div key="p2">
              <p className="mb-3 text-sm font-semibold text-foreground">
                ver1 / ver2 で画面はどう変わる？
              </p>
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-[11px] font-semibold text-muted">
                    予定一覧の下のタブ
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="rounded-xl bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-teal-dark">
                      失敗ログ
                    </span>
                    <span className="text-[11px] text-muted">← ver1</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="rounded-xl bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-teal-dark">
                      未来の自分へ
                    </span>
                    <span className="text-[11px] text-muted">← ver2</span>
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-[11px] font-semibold text-muted">ホーム画面</p>
                  <p className="text-[12px]">
                    ver1: 節約額ダッシュボード＋気をつけたい予定の警告
                  </p>
                  <p className="text-[12px]">ver2: 確定待ちメッセージの案内</p>
                </div>

                <div>
                  <p className="mb-1 text-[11px] font-semibold text-muted">予定詳細ページ</p>
                  <p className="text-[12px]">ver1: ⚠ 警告パネル＋考えられる失敗</p>
                  <p className="text-[12px]">ver2: 💌 確定カード＋未来の自分へ枠</p>
                </div>

                <div>
                  <p className="mb-1 text-[11px] font-semibold text-muted">
                    項目の「次回の出し方」ボタン
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ScopeChip scope="event_only" />
                    <ScopeChip scope="similar" />
                    <ScopeChip scope="keyword" />
                    <span className="text-[11px] text-muted">← ver2だけ</span>
                  </div>
                  <p className="mt-1 text-[12px] text-muted">
                    ver1ではこのボタンは出ず、従来通りの自動学習だけで決まります。
                  </p>
                </div>

                <div>
                  <p className="mb-1 text-[11px] font-semibold text-muted">
                    カレンダーの説明欄に入る見出し
                  </p>
                  <p className="rounded-lg bg-surface-muted px-2 py-1 font-mono text-[11px]">
                    【予想される失敗】 ← ver1
                  </p>
                  <p className="mt-1 rounded-lg bg-surface-muted px-2 py-1 font-mono text-[11px]">
                    【未来の自分へ】 ← ver2
                  </p>
                </div>
              </div>
            </div>,
          ]}
        />
      </div>
      {error && <p className="mt-2 text-xs text-warn">{error}</p>}
      {result && (
        <p className="mt-2 text-xs text-muted">
          {LABEL[result.to]}に切り替えました。学習結果を{result.converted}
          件反映、{result.dormant}件は休眠にしました（データは消えていません。
          いつでも元のモードに戻せます）。
        </p>
      )}
    </div>
  );
}

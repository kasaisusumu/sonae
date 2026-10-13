"use client";

import { useState } from "react";
import { ScopeChip, SCOPE_CHIP } from "@/app/components/scope-chip";
import { InfoHint } from "@/app/components/info-hint";
import type { ItemScope } from "@/lib/item-scope";

/** トグルが表示・選択できる3値だけの型（item-scope の ItemScope のうち、この3つだけ使う）。 */
export type QuickScope = Extract<ItemScope, "event_only" | "similar" | "keyword">;

/**
 * 「次回の出し方」のクイック選択（3択）。項目（準備リスト）・未来の自分へ、共通で使う。
 * 詳細を開かなくても、ここをタップするだけで即切り替わる。
 * 「この名前の予定だけ」（keyword）をタップしたときの実際のキーワードは、呼び出し元が
 * 予定名から自動で決める（`pickKeyword`、`lib/text-norm.ts`）。呼び出し元の `onChange` が
 * それぞれの保存処理（キーワードの算出を含む）を行う。
 */
export const QUICK_SCOPES: QuickScope[] = ["event_only", "similar", "keyword"];

/** ⓘ の説明文の中身。`ScopeQuickToggle`・`ScopeEmojiToggle` の両方の InfoHint から共通で使う。 */
function ScopeHintBody() {
  return (
    <>
      <p className="mb-3 text-sm font-semibold text-foreground">
        「次回の出し方」の3つのボタン
      </p>

      <p className="mb-1">
        <ScopeChip scope="event_only" status="chosen" />
      </p>
      <p className="mb-3 text-[13px]">
        この予定の中だけ。次回以降の予定には影響しません。例えば「ホテルに電話する」
        のような、この予定限定の内容に向いています。
      </p>

      <p className="mb-1">
        <ScopeChip scope="similar" status="chosen" />
      </p>
      <p className="mb-3 text-[13px]">
        日時や長さではなく、用途が同じ種類の予定（例: バスも新幹線も「移動」）でも
        同じように出す／出さないようにします。種類はAIが自動で判断します。
        例えば「新幹線のチケットを確認」なら、バス移動・飛行機移動の予定にも
        同じように出るようにできます。
      </p>

      <p className="mb-1">
        <ScopeChip scope="keyword" status="chosen" />
      </p>
      <p className="text-[13px]">
        この予定の名前から自動でキーワードを決めて、次にそのキーワードを含む予定が
        来たときだけ出す／出さないようにします。例えば「田中さんと商談」なら
        キーワード「田中さん」が決まり、次に「田中さん」を含む予定が来たときだけ
        出ます。∨ を開くとキーワードを直せます。
      </p>
    </>
  );
}

export function ScopeQuickToggle({
  value,
  onChange,
  disabled,
  className = "",
  showHint = true,
  hintOpen,
  onHintOpenChange,
}: {
  /** 3択のどれかと一致すればハイライトする（keyword はカスタムの値でも3番目がハイライトする）。
   * それ以外の値（旧ジャンル・自動など）ならどれも非選択。 */
  value: string;
  onChange: (next: QuickScope) => void;
  disabled?: boolean;
  className?: string;
  /** 3つのボタンの横に ⓘ（説明）を出すか。既定は出す。同じ行に複数並ぶ画面だけ false にする。 */
  showHint?: boolean;
  /**
   * ⓘ の開閉状態を呼び出し元に持たせたいとき用（`InfoHint` の `open`/`onOpenChange` にそのまま渡す）。
   * 自動保存のたびに行が再マウントされる画面（準備リストの項目行など）では必須:
   * 内部 state のままだと、保存完了の瞬間に再マウントされて開いたポップアップが即閉じてしまう。
   */
  hintOpen?: boolean;
  onHintOpenChange?: (open: boolean) => void;
}) {
  return (
    <div className={`flex flex-nowrap items-center gap-1 ${className}`}>
      {QUICK_SCOPES.map((sc) => {
        const selected = value === sc;
        const meta = SCOPE_CHIP[sc];
        return (
          <button
            key={sc}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={(e) => {
              e.stopPropagation();
              onChange(sc);
            }}
            className="shrink-0 rounded-full disabled:opacity-40"
          >
            {selected ? (
              // 選んだものだけ色付き（塗りつぶし＋太字）。これ以外は無彩色にして、
              // 「同じ色の濃淡」ではなく「色が付いているかどうか」で選択状態を見分けられるようにする。
              <ScopeChip
                scope={sc}
                status="chosen"
                className="pointer-events-none font-semibold ring-2 ring-offset-1 ring-[var(--foreground)]/15"
              />
            ) : (
              <span className="pointer-events-none inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-px text-[11px] leading-tight text-muted">
                {meta.icon && <span aria-hidden>{meta.icon}</span>}
                <span className="truncate">{meta.label}</span>
              </span>
            )}
          </button>
        );
      })}
      {showHint && (
        <InfoHint id="scope-quick-toggle" open={hintOpen} onOpenChange={onHintOpenChange}>
          <ScopeHintBody />
        </InfoHint>
      )}
    </div>
  );
}

/**
 * 行に常時表示する、絵文字1つだけのコンパクトな「次回の出し方」ボタン（∨と同じ大きさ）。
 * タップすると3択＋ⓘのポップアップを出す（選ぶと即座に閉じる）。
 * ポップアップの開閉は呼び出し元に持たせる（`open`/`onOpenChange`）: 自動保存のたびに
 * 行が再マウントされる画面では、内部 state だと保存完了の瞬間に閉じてしまうため。
 */
export function ScopeEmojiToggle({
  value,
  onChange,
  open,
  onOpenChange,
  disabled,
  hintOpen,
  onHintOpenChange,
  className = "mt-0.5",
}: {
  value: string;
  onChange: (next: QuickScope) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  hintOpen?: boolean;
  onHintOpenChange?: (open: boolean) => void;
  /** 外側の余白調整用（既定 `mt-0.5`。他のボタンとまとめて並べる場合は呼び出し元で上書きする）。 */
  className?: string;
}) {
  const current = (QUICK_SCOPES as string[]).includes(value)
    ? SCOPE_CHIP[value as QuickScope]
    : SCOPE_CHIP.auto;
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`次回の出し方: ${current.label}（変更する）`}
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
        className={`rounded-md border px-1.5 py-1 text-sm leading-none transition-colors ${
          open
            ? "border-teal bg-teal-soft text-teal-dark"
            : "border-border text-muted hover:border-teal hover:text-teal-dark"
        }`}
      >
        <span aria-hidden>{current.icon || "🔘"}</span>
      </button>
      {open && (
        <span
          className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4"
          onClick={() => onOpenChange(false)}
        >
          <span
            className="block w-full max-w-xs rounded-2xl border border-border bg-surface p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">
                次回の出し方
              </span>
              <InfoHint id="scope-quick-toggle" open={hintOpen} onOpenChange={onHintOpenChange}>
                <ScopeHintBody />
              </InfoHint>
            </span>
            <span className="mt-3 block space-y-2">
              {QUICK_SCOPES.map((sc) => {
                const selected = value === sc;
                const meta = SCOPE_CHIP[sc];
                return (
                  <button
                    key={sc}
                    type="button"
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() => {
                      onChange(sc);
                      onOpenChange(false);
                    }}
                    className={`flex w-full flex-col items-center gap-0.5 rounded-xl border px-3 py-2.5 transition-colors disabled:opacity-40 ${
                      selected
                        ? "border-teal bg-teal-soft text-teal-dark"
                        : "border-border text-foreground hover:border-teal/50"
                    }`}
                  >
                    <span aria-hidden className="text-xl leading-none">
                      {meta.icon}
                    </span>
                    <span className="text-sm font-medium leading-none">
                      {meta.label}
                    </span>
                  </button>
                );
              })}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * キーワード条件を「文章」の形で設定する、任意のオプション欄（詳細を開いたときだけ出す）。
 * 「『＿＿』のとき」の空欄に書き込む形にして、生の項目名入力に見えないようにする。
 * 空にして確定すると、キーワード指定をやめる（呼び出し元の onClear）。
 */
export function KeywordSentenceField({
  initialKeyword,
  onCommit,
  onClear,
  pending,
  placeholder = "ホテル",
}: {
  initialKeyword: string;
  onCommit: (keyword: string) => void;
  onClear: () => void;
  pending?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState(initialKeyword);

  function commit() {
    const v = value.trim();
    if (!v) {
      if (initialKeyword) onClear();
      return;
    }
    if (v !== initialKeyword) onCommit(v);
  }

  return (
    <div className="flex flex-wrap items-center gap-1 text-sm text-foreground">
      <span className="text-muted">キーワードを直すなら「</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        disabled={pending}
        className="min-w-0 flex-1 basis-24 rounded-md border border-border bg-background px-2 py-0.5 text-sm text-foreground"
        aria-label="キーワード"
      />
      <span className="text-muted">」のとき</span>
      {pending && <span className="text-[11px] text-muted">保存中…</span>}
    </div>
  );
}

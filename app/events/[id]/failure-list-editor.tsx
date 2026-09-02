"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  clearEventFailureLogs,
  createFailureLog,
  deleteFailureLog,
  logRepeatedFailure,
  setFailureOutcome,
  updateFailureLog,
} from "@/app/actions";
import { formatDateOnly, formatYen, toDateInputValue } from "@/lib/format";
import { SubmitButton } from "@/app/components/submit-button";
import { ConfirmButton } from "@/app/components/confirm-button";

export type FLRow = {
  id: string;
  description: string;
  outcome: string | null;
  estimatedLossYen: number;
  occurredAt: Date;
};
export type FLOther = {
  id: string;
  description: string;
  occurredAt: Date;
  eventTitle: string | null;
};

function meta(o: string | null): { icon: string; label: string } {
  switch (o) {
    case "prevented":
      return { icon: "🛡", label: "防げた" };
    case "not_prevented":
      return { icon: "😓", label: "防げなかった" };
    case "irrelevant":
      return { icon: "—", label: "今回は関係ない" };
    case "linked":
      return { icon: "🔗", label: "紐付け" };
    default:
      return { icon: "・", label: "未確認" };
  }
}

/** 保存中だけ右上に出る小さなスピナー（他の自動保存と同じ見た目）。 */
function SavingPill() {
  return (
    <div className="fixed right-3 top-16 z-[70] flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted shadow-md">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-foreground" />
      自動保存中…
    </div>
  );
}

/**
 * 1 行ぶんの編集フォーム（内容・結果・金額・日付）＋削除。両表示で共通。
 * 「更新」ボタンはなく、変えたその場で自動保存する（内容・金額・日付は少し待って
 * から、結果／状態の選択は即時）。要領は準備リストの自動保存と同じ。
 * hideDate: この予定に紐づく失敗ログは日付が予定の日で確定しているので出さない。
 */
function RowEditForms({ r, hideDate = false }: { r: FLRow; hideDate?: boolean }) {
  const [desc, setDesc] = useState(r.description);
  const [outcome, setOutcome] = useState<string>(r.outcome ?? "");
  const [amount, setAmount] = useState(
    r.estimatedLossYen ? String(r.estimatedLossYen) : "",
  );
  const [date, setDate] = useState(toDateInputValue(r.occurredAt));
  const [pending, start] = useTransition();
  const firstRun = useRef(true);

  function buildFd(over: { outcome?: string } = {}): FormData {
    const fd = new FormData();
    fd.set("id", r.id);
    fd.set("description", desc);
    fd.set("estimatedLossYen", amount);
    if (!hideDate) fd.set("occurredAt", date);
    if (over.outcome !== undefined) fd.set("outcome", over.outcome);
    return fd;
  }

  // 内容・金額・日付は入力が落ち着いてから保存（結果の select は onChange で即時）。
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      start(() => updateFailureLog(buildFd()));
    }, 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desc, amount, date]);

  return (
    <>
      {pending && <SavingPill />}
      <div className="space-y-2">
        <textarea
          rows={2}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          aria-label="失敗の内容"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <select
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              start(() => updateFailureLog(buildFd({ outcome: e.target.value })));
            }}
            className="rounded-md border bg-background px-1.5 py-1 text-xs text-foreground"
            aria-label="結果・状態"
          >
            <option value="">未確認</option>
            <option value="linked">紐付け</option>
            <option value="prevented">防げた</option>
            <option value="not_prevented">防げなかった</option>
            <option value="irrelevant">今回は関係ない</option>
          </select>
          <input
            type="number"
            min={0}
            step={100}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="円"
            className="w-20 rounded-md border bg-background px-1.5 py-1 text-xs"
            aria-label="金額"
          />
          {!hideDate && (
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border bg-background px-1.5 py-1 text-xs"
              aria-label="日付"
            />
          )}
          <span className="text-[11px] text-muted">
            {pending ? "保存中…" : "変更は自動保存"}
          </span>
        </div>
      </div>
      <form action={deleteFailureLog}>
        <input type="hidden" name="id" value={r.id} />
        <ConfirmButton
          message="この失敗ログを削除しますか？"
          className="text-[11px] text-muted underline hover:text-warn"
        >
          削除
        </ConfirmButton>
      </form>
    </>
  );
}

/**
 * 予定詳細の失敗ログ枠。準備リストの各枠（ChecklistEditor）と同じ見た目・操作。
 * variant="warn"（学習内容ページ）は昔どおりの「赤いだけ」の簡素な一覧＋「編集」ボタン。
 */
export function FailureListEditor({
  eventId,
  label = "失敗ログ",
  initial,
  others = [],
  variant = "plain",
}: {
  eventId: string;
  label?: string;
  initial: FLRow[];
  others?: FLOther[];
  variant?: "plain" | "warn";
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  // 学習内容ページ：一度でも「編集」を押したら編集モード（追加ボタンも出す）。
  const [editMode, setEditMode] = useState(false);
  // 「今回は関係ない」にした失敗予測は、この予定からは消す。ただしその場では
  // 消さず、画面を離れて戻ってから消える（マウント時点で irrelevant だったものだけ隠す）。
  const [hiddenAtMount] = useState(
    () =>
      new Set(
        initial.filter((r) => r.outcome === "irrelevant").map((r) => r.id),
      ),
  );

  // ── 学習内容ページ用：昔どおり「ただ赤いだけ」の一覧。 ──
  //   「編集」を押すとその行が編集でき、以降「＋ 追加」も出る。
  if (variant === "warn") {
    if (initial.length === 0 && !editMode) {
      return (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => {
              setEditMode(true);
              setAdding(true);
            }}
            className="rounded-md border border-dashed border-border px-2.5 py-1 text-[11px] text-muted hover:border-foreground/40 hover:text-foreground"
          >
            ＋ 失敗ログを追加
          </button>
        </div>
      );
    }
    return (
      <div className="mt-3">
        <p className="text-[11px] font-semibold text-warn">
          失敗ログ（{initial.length}）
        </p>
        <ul className="mt-1 space-y-1">
          {initial.map((r) => {
            const m = meta(r.outcome);
            const open = openId === r.id;
            return (
              <li
                key={r.id}
                className="rounded bg-warn-soft px-2 py-1 text-[11px]"
              >
                <p className="whitespace-pre-wrap break-words text-foreground">
                  {r.description}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-muted">
                  <span>{formatDateOnly(r.occurredAt)}</span>
                  {r.estimatedLossYen > 0 && (
                    <span>・ 推定 {formatYen(r.estimatedLossYen)}</span>
                  )}
                  <span>・ {m.label}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditMode(true);
                      setOpenId(open ? null : r.id);
                    }}
                    className="ml-auto rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-muted hover:text-foreground"
                  >
                    {open ? "閉じる" : "編集"}
                  </button>
                </p>
                {open && (
                  <div className="mt-1.5 space-y-2 rounded bg-surface p-2">
                    <RowEditForms r={r} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {editMode &&
          (adding ? (
            <form
              action={createFailureLog}
              className="mt-2 space-y-2 rounded-lg border border-border bg-surface p-2"
            >
              <input type="hidden" name="eventId" value={eventId} />
              <textarea
                name="description"
                required
                rows={2}
                placeholder="何が起きた？（例: 集合時間に遅刻した）"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  name="estimatedLossYen"
                  min={0}
                  step={100}
                  placeholder="金額（円・任意）"
                  className="w-36 rounded-md border bg-background px-2 py-1 text-xs"
                  aria-label="金額"
                />
                <SubmitButton>記録する</SubmitButton>
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="text-[11px] text-muted underline hover:text-foreground"
                >
                  取消
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-2 rounded-md border border-foreground bg-foreground px-3 py-1 text-[11px] font-medium text-surface hover:opacity-90"
            >
              ＋ 追加
            </button>
          ))}
      </div>
    );
  }

  // ── 予定詳細ページ用：準備リストの枠と同じフル機能。 ──
  // 「今回は関係ない」で外したものは（次にこの画面へ来たときに）並びから消える。
  const rows = initial.filter((r) => !hiddenAtMount.has(r.id));
  return (
    <div className="rounded-2xl bg-surface p-3">
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        <span className="text-xs text-muted tabular-nums">{rows.length}</span>
        {rows.length > 0 && (
          <form action={clearEventFailureLogs} className="ml-auto">
            <input type="hidden" name="eventId" value={eventId} />
            <ConfirmButton
              message="「考えられる失敗」をすべて削除します。よろしいですか？"
              className="shrink-0 self-center rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:border-warn hover:text-warn"
            >
              全部消す
            </ConfirmButton>
          </form>
        )}
      </div>

      {rows.length > 0 && (
        <ul className="space-y-1">
          {rows.map((r) => {
            const m = meta(r.outcome);
            const open = openId === r.id;
            // 未確認（＝アプリが提案した先回り）は赤で目立たせる。
            const suggested = r.outcome === null;
            return (
              <li
                key={r.id}
                className={`px-2 py-1.5 ${
                  suggested && !open
                    ? "rounded-lg bg-warn-soft"
                    : "border-b border-border/70 last:border-0"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-sm">{m.icon}</span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words py-0.5 text-sm">
                    {r.description}
                  </span>
                  <span className="mt-1 shrink-0 text-[11px] text-muted">
                    {m.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : r.id)}
                    aria-label={open ? "閉じる" : "編集"}
                    className={`mt-0.5 shrink-0 rounded-md border px-2 py-1 text-sm leading-none ${
                      open
                        ? "border-teal bg-teal-soft text-teal-dark"
                        : "border-border text-muted hover:border-teal hover:text-teal-dark"
                    }`}
                  >
                    {open ? "∧" : "∨"}
                  </button>
                </div>

                {/* 提案（未確認）はワンタップ＋確認で採用／削除 */}
                {suggested && !open && (
                  <div className="ml-6 mt-1 flex flex-wrap items-center gap-2">
                    <form action={setFailureOutcome}>
                      <input type="hidden" name="failureLogId" value={r.id} />
                      <input type="hidden" name="outcome" value="linked" />
                      <ConfirmButton
                        message="この失敗をこの予定の注意点として採用しますか？"
                        className="rounded-md border border-foreground bg-foreground px-2.5 py-0.5 text-[11px] font-medium text-surface hover:opacity-90"
                      >
                        採用
                      </ConfirmButton>
                    </form>
                    <form action={deleteFailureLog}>
                      <input type="hidden" name="id" value={r.id} />
                      <ConfirmButton
                        message="この提案を消しますか？（この予定では再提案しません）"
                        className="rounded-md border border-border px-2.5 py-0.5 text-[11px] text-muted hover:border-warn hover:text-warn"
                      >
                        削除
                      </ConfirmButton>
                    </form>
                  </div>
                )}

                {open && (
                  <div className="ml-6 mt-1.5 space-y-2 rounded-lg bg-background/60 p-2">
                    <RowEditForms r={r} hideDate />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <form
          action={createFailureLog}
          className="mt-2 space-y-2 rounded-lg bg-background/60 p-2"
        >
          <input type="hidden" name="eventId" value={eventId} />
          <textarea
            name="description"
            required
            rows={2}
            placeholder="何が起きた？（例: 集合時間に遅刻した）"
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              name="estimatedLossYen"
              min={0}
              step={100}
              placeholder="金額（円・任意）"
              className="w-40 rounded-md border bg-background px-2 py-1 text-sm"
              aria-label="金額"
            />
            <SubmitButton>記録する</SubmitButton>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-xs text-muted underline hover:text-foreground"
            >
              取消
            </button>
          </div>
        </form>
      )}

      <div className="relative mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-xs font-medium text-surface hover:opacity-90"
        >
          ＋ 追加
        </button>
        {others.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted hover:border-foreground/40 hover:text-foreground"
            >
              その他 {moreOpen ? "▲" : "▾"}
            </button>
            {moreOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMoreOpen(false)}
                />
                <div className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      setPickOpen(true);
                    }}
                    className="block w-full px-3 py-2 text-left text-xs text-foreground hover:bg-surface-muted"
                  >
                    📆 過去の失敗から追加
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <p className="mt-1.5 text-[11px] text-muted">
        文言・追加・削除は自動保存
      </p>

      {pickOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPickOpen(false)}
        >
          <div
            className="w-full max-w-sm space-y-3 rounded-2xl bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">
              📆 過去の失敗から追加
            </h3>
            <form action={logRepeatedFailure} className="space-y-2">
              <input type="hidden" name="eventId" value={eventId} />
              <select
                name="failureLogId"
                required
                defaultValue=""
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              >
                <option value="" disabled>
                  選ぶ
                </option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {formatDateOnly(o.occurredAt)}
                    {o.eventTitle ? ` ・「${o.eventTitle}」` : ""} ・{" "}
                    {o.description.length > 30
                      ? `${o.description.slice(0, 30)}…`
                      : o.description}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPickOpen(false)}
                  className="rounded-lg px-3 py-1.5 text-sm text-muted"
                >
                  キャンセル
                </button>
                <SubmitButton>この予定に追加</SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

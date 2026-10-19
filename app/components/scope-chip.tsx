"use client";

import { Pin, Repeat, Tag, type LucideIcon } from "lucide-react";
import type { ItemScope } from "@/lib/item-scope";

/**
 * 「次回いつ出すか」の範囲チップ（項目・未来の自分へ・確定カード・学習内容で共通）。
 * 白黒基調の例外として、この 3 色だけを使う（globals.css の --scope-*）。
 * 色だけで意味を伝えず、必ず文言とアイコンを併記する。
 *   1 = 今回だけ（青・ピン）
 *   2 = 似た予定（緑・繰り返し、「似た予定のとき」の意味）
 *   3 = この名前（紫・タグ、「この名前の予定だけ」の意味。予定名から自動でキーワードを決める）
 *   自動 = 範囲を指定していない従来の自動学習（無彩色）
 * クイック選択3つを一列に収めるため、2026-10-10 にラベルを短縮した
 * （意味は icon・色・詳細の説明文で補う。長い言い回しは詳細側の文章に残す）。
 * 3つのアイコンは記号1つだけのボタン（`ScopeEmojiToggle`）でも使うため、
 * 見分けやすいアイコンにしている（2026-10-13〜。絵文字から lucide-react の
 * アイコンに置き換え、2026-10-19〜）。
 */
export const SCOPE_CHIP: Record<
  ItemScope,
  { label: string; icon: LucideIcon | null; tone: "event" | "genre" | "keyword" | "auto" }
> = {
  event_only: { label: "今回だけ", icon: Pin, tone: "event" },
  genre: { label: "この系の予定", icon: Repeat, tone: "genre" },
  similar: { label: "似た予定", icon: Repeat, tone: "genre" },
  keyword: { label: "この名前", icon: Tag, tone: "keyword" },
  auto: { label: "自動", icon: null, tone: "auto" },
};

const TONE_CLASS: Record<
  "event" | "genre" | "keyword" | "auto",
  { solid: string; outline: string }
> = {
  event: {
    solid: "border-[var(--scope-event)] bg-[var(--scope-event-soft)] text-[var(--scope-event)]",
    outline: "border-dashed border-[var(--scope-event)] text-[var(--scope-event)]",
  },
  genre: {
    solid: "border-[var(--scope-genre)] bg-[var(--scope-genre-soft)] text-[var(--scope-genre)]",
    outline: "border-dashed border-[var(--scope-genre)] text-[var(--scope-genre)]",
  },
  keyword: {
    solid: "border-[var(--scope-keyword)] bg-[var(--scope-keyword-soft)] text-[var(--scope-keyword)]",
    outline: "border-dashed border-[var(--scope-keyword)] text-[var(--scope-keyword)]",
  },
  auto: {
    solid: "border-border bg-surface-muted text-muted",
    outline: "border-dashed border-border text-muted",
  },
};

/**
 * status: chosen = ユーザーが選んだ（塗りつぶし）／proposed = AI の提案のまま適用中（枠線だけ＋「提案」）。
 * onClick を渡すと押せるチップになる（範囲の選び直しを開く）。
 */
export function ScopeChip({
  scope,
  status = "chosen",
  onClick,
  className = "",
}: {
  scope: ItemScope;
  status?: "chosen" | "proposed";
  onClick?: () => void;
  className?: string;
}) {
  const meta = SCOPE_CHIP[scope] ?? SCOPE_CHIP.auto;
  const tone = TONE_CLASS[meta.tone];
  const Icon = meta.icon;
  const cls = `inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-px text-[11px] leading-tight ${
    status === "proposed" ? tone.outline : tone.solid
  } ${onClick ? "hover:opacity-80" : ""} ${className}`;
  const body = (
    <>
      {Icon && <Icon aria-hidden className="h-3 w-3 shrink-0" />}
      {status === "proposed" && scope !== "auto" && (
        <span className="rounded bg-surface px-1 text-[10px]">提案</span>
      )}
      <span className="min-w-0 truncate">{meta.label}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls} aria-label={`次回の出し方: ${meta.label}（変更する）`}>
        {body}
      </button>
    );
  }
  return <span className={cls}>{body}</span>;
}

/** 範囲の選択肢（チップを開いたときの一覧）。 */
export const SCOPE_CHOICES: ItemScope[] = [
  "event_only",
  "genre",
  "keyword",
  "similar",
  "auto",
];

/** 未来の自分へのメッセージの一致条件（once / similar / keyword）を、3 段階のチップに対応させる。 */
export function messageScopeToItemScope(scope: string): ItemScope {
  if (scope === "once") return "event_only";
  if (scope === "similar") return "similar";
  return "keyword";
}

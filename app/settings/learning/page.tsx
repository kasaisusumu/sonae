import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  getLearningTree,
  parseNotifyValue,
  type EditChangeView,
  type EditRecordView,
  type LearnedRuleView,
  type RuleType,
  type SituationEventView,
} from "@/lib/learning";
import { leadLabel } from "@/lib/notify-items";
import { RuleActions } from "./rule-actions";

const TYPE_LABEL: Record<RuleType, string> = {
  fixed_item: "入れる",
  exclude_item: "出さない",
  timing_override: "タイミング",
  notify_override: "通知",
};

function notifyText(value: string | null): string {
  const m = parseNotifyValue(value);
  return m === null ? "通知なし" : leadLabel(m);
}

function ruleMain(r: LearnedRuleView): string {
  if (r.ruleType === "timing_override") return `${r.target} → ${r.value ?? ""}`;
  if (r.ruleType === "notify_override")
    return `${r.target} → ${notifyText(r.value)}`;
  if (r.ruleType === "fixed_item" && r.value) return `${r.target}（${r.value}）`;
  return r.target;
}

function Keywords({ words }: { words: string[] }) {
  if (words.length === 0) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {words.slice(0, 8).map((w) => (
        <span
          key={w}
          className="rounded bg-surface-muted px-1 py-px text-[10px] text-muted"
        >
          {w}
        </span>
      ))}
    </span>
  );
}

function RuleRow({ r, showType }: { r: LearnedRuleView; showType?: boolean }) {
  return (
    <li className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-sm">
          {showType && (
            <span className="mr-1 text-muted">[{TYPE_LABEL[r.ruleType]}]</span>
          )}
          {ruleMain(r)}
        </p>
        <p className="text-[11px] text-muted">
          {r.isUserLocked
            ? "固定中"
            : `確信度 ${Math.round(r.effectiveConfidence * 100)}%`}
          {r.confirmedCount > 0 ? ` ・ 確認 ${r.confirmedCount}回` : ""}
          {r.contradictedCount > 0 ? ` ・ 矛盾 ${r.contradictedCount}回` : ""}
          {" ・ 最終 "}
          {r.lastConfirmedAt.toLocaleDateString("ja-JP")}
        </p>
        {r.supportedBy.length > 0 && (
          <p className="text-[11px] text-muted">
            ← {r.supportedBy.map((t) => `「${t}」`).join("")}での編集から
          </p>
        )}
      </div>
      <RuleActions ruleId={r.id} locked={r.isUserLocked} />
    </li>
  );
}

function RuleGroup({
  title,
  rules,
  showType,
}: {
  title: string;
  rules: LearnedRuleView[];
  showType?: boolean;
}) {
  if (rules.length === 0) return null;
  return (
    <div className="mt-2">
      <h5 className="text-[11px] font-semibold text-muted">{title}</h5>
      <ul className="divide-y divide-border">
        {rules.map((r) => (
          <RuleRow key={r.id} r={r} showType={showType} />
        ))}
      </ul>
    </div>
  );
}

const CHANGE_LABEL: Record<EditChangeView["kind"], string> = {
  added: "追加",
  removed: "削除",
  retimed: "タイミング",
  renotified: "通知",
};

function ChangeLine({ ch }: { ch: EditChangeView }) {
  const kindTag =
    ch.itemKind === "belonging" ? "持ち物" : ch.itemKind === "task" ? "準備" : null;
  return (
    <li className="text-[11px]">
      <span className="text-muted">{CHANGE_LABEL[ch.kind]}: </span>
      {kindTag && <span className="text-muted">[{kindTag}] </span>}
      {ch.kind === "retimed" || ch.kind === "renotified"
        ? `${ch.title} → ${ch.detail ?? ""}`
        : ch.detail
          ? `${ch.title}（${ch.detail}）`
          : ch.title}
    </li>
  );
}

function EditRow({ rec }: { rec: EditRecordView }) {
  return (
    <li className="py-1">
      <p className="text-[11px] font-medium text-muted">
        {rec.when.toLocaleDateString("ja-JP")}{" "}
        {rec.when.toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
      <ul className="mt-0.5 space-y-0.5 pl-3">
        {rec.changes.map((ch, i) => (
          <ChangeLine key={i} ch={ch} />
        ))}
      </ul>
    </li>
  );
}

function EventNode({ ev }: { ev: SituationEventView }) {
  return (
    <details className="rounded-lg bg-surface p-2">
      <summary className="cursor-pointer text-xs font-medium">
        {ev.title}
        <span className="ml-1 font-normal text-muted">編集 {ev.editCount}回</span>
        <Keywords words={ev.keywords} />
      </summary>
      <ul className="mt-1 divide-y divide-border border-l border-border pl-3">
        {ev.edits.map((rec) => (
          <EditRow key={rec.id} rec={rec} />
        ))}
      </ul>
    </details>
  );
}

export default async function LearningOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const tree = await getLearningTree(user.id);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/settings"
          className="text-sm text-muted no-underline hover:text-teal-dark"
        >
          ← 設定
        </Link>
        <h1 className="mt-2 text-xl font-semibold">学習内容の確認</h1>
        <p className="mt-1 text-sm text-muted">
          自動で学習した内容を<strong>すべて</strong>、
          <strong>カテゴリ → どの場合 → 予定名 → 変更した項目</strong>
          の順に何層でもたどれます。「どの場合」は予定の性質（海外/国内・宿泊数・平日/休日・時間帯）
          ごとの枝で、性質が違えば学習も分かれます。各ルールは個別に固定・リセットできます。
        </p>
      </div>

      {tree.length === 0 ? (
        <p className="rounded-xl bg-surface px-4 py-8 text-center text-sm text-muted">
          まだ学習内容はありません。
          <br />
          予定の準備リストを何度か編集すると、ここに出てきます。
        </p>
      ) : (
        <div className="space-y-3">
          {tree.map((cat) => (
            <details
              key={cat.categoryId}
              className="rounded-2xl bg-surface p-4"
              open
            >
              <summary className="cursor-pointer text-base font-semibold">
                {cat.categoryName}
                <span className="ml-2 text-xs font-normal text-muted">
                  学習 {cat.ruleCount}件 ・ もとにした編集 {cat.editCount}回
                </span>
              </summary>

              <div className="mt-3 space-y-2 border-l border-border pl-3">
                {cat.situations.map((sit) => (
                  <details
                    key={sit.signature}
                    className="rounded-xl bg-background p-3"
                  >
                    <summary className="cursor-pointer text-sm font-medium">
                      {sit.label}
                      <span className="ml-2 text-xs font-normal text-muted">
                        学習 {sit.ruleCount}件 ・ 編集 {sit.editCount}回
                      </span>
                    </summary>
                    {sit.keywords.length > 0 && (
                      <p className="mt-1 text-[11px] text-muted">
                        この場合に出てきた予定名の語:
                        <Keywords words={sit.keywords} />
                      </p>
                    )}

                    {sit.kinds.length > 0 && (
                      <div className="mt-2 border-l border-border pl-3">
                        <h4 className="text-xs font-semibold text-teal-dark">
                          学習した内容
                        </h4>
                        {sit.kinds.map((k) => (
                          <div key={k.kind} className="mt-1.5">
                            <h5 className="text-[11px] font-semibold text-foreground">
                              {k.kind === "task" ? "準備すること" : "持ち物"}
                            </h5>
                            <RuleGroup title="毎回入れる" rules={k.fixed} />
                            <RuleGroup title="出さない" rules={k.excluded} />
                            <RuleGroup title="タイミング" rules={k.timing} />
                            <RuleGroup title="通知" rules={k.notify} />
                            <RuleGroup
                              title="仮の学習（確信度が低い）"
                              rules={k.tentative}
                              showType
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {sit.events.length > 0 && (
                      <div className="mt-3 border-l border-border pl-3">
                        <h4 className="text-xs font-semibold text-muted">
                          この場合に当てはまった予定と編集の記録
                        </h4>
                        <div className="mt-1.5 space-y-1.5">
                          {sit.events.map((ev) => (
                            <EventNode key={ev.eventId ?? ev.title} ev={ev} />
                          ))}
                        </div>
                      </div>
                    )}
                  </details>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

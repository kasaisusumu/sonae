/**
 * 管理画面（/admin）の「利用状況」で集計する対象の一覧（カタログ）。
 * ここに無い eventKey が記録されても集計自体は壊れないが、カタログに載せておくと
 * 「一度も使われていない（0回）」もランキングの最下位（ワースト）にちゃんと出せる。
 * 呼び出し側（InfoHint の id、各機能の trackFeatureUse 呼び出しなど）は、
 * ここに定義した定数を使うこと（文字列を直書きしない）。
 */

export interface TrackedKey {
  key: string;
  label: string;
}

/** 主要ページの閲覧。トップレベルのページを開くたびに1回記録する。 */
export const PAGE_KEYS: TrackedKey[] = [
  { key: "page:/", label: "ホーム" },
  { key: "page:/events", label: "予定一覧" },
  { key: "page:/events/[id]", label: "予定詳細" },
  { key: "page:/failures", label: "失敗ログ" },
  { key: "page:/savings", label: "マニュアル（学習内容）" },
  { key: "page:/settings", label: "設定" },
];

/** 個別の機能。押された・使われた回数を数える。 */
export const FEATURE_KEYS: TrackedKey[] = [
  { key: "feature:dictation", label: "話して作る（音声入力）" },
  { key: "feature:bulk-add", label: "メモから一括追加" },
  { key: "feature:template-apply", label: "マニュアルから追加" },
  { key: "feature:template-save", label: "名前をつけて保存" },
  { key: "feature:copy-from-event", label: "他の予定からコピー" },
  { key: "feature:category-create", label: "新しいカテゴリを作る" },
  { key: "feature:category-delete", label: "カテゴリを削除" },
  { key: "feature:learned-event-delete", label: "学習された予定を削除" },
  { key: "feature:failure-quick-record", label: "失敗をひとこと記録する" },
  { key: "feature:notification-test", label: "通知テスト" },
  { key: "feature:calendar-manual-sync", label: "カレンダーから取り込む" },
  { key: "feature:list-reminder-set", label: "リスト全体のリマインド設定" },
  { key: "feature:add-section", label: "枠を追加" },
  { key: "feature:clear-section", label: "枠を全部消す" },
  { key: "feature:add-item", label: "準備リストに項目を追加" },
  { key: "feature:template-tidy-add", label: "名前付きマニュアル: AIで整えて追加（音声入力）" },
  { key: "feature:failure-dictation", label: "失敗ログを話して記録する（音声入力）" },
  { key: "feature:countermeasure-tidy", label: "対策をAIで整える（音声入力）" },
];

/** ⓘ（InfoHint）の説明ポップアップ。開かれた回数を数える。 */
export const INFOHINT_KEYS: TrackedKey[] = [
  { key: "infohint:savings-merge-group", label: "マニュアル: 同じ名前をまとめて編集" },
  { key: "infohint:savings-cleared", label: "マニュアル: 準備リストは空" },
  { key: "infohint:savings-intro", label: "マニュアル: ページの説明" },
  { key: "infohint:failures-intro", label: "失敗ログ: ページの説明" },
  { key: "infohint:failures-quick-record", label: "失敗ログ: ひとこと記録する" },
  { key: "infohint:failures-review-queue", label: "失敗ログ: 結果を記録しよう" },
  { key: "infohint:settings-write-description", label: "設定: 説明欄への書き込み" },
  { key: "infohint:settings-notify", label: "設定: 通知" },
  { key: "infohint:events-upcoming", label: "予定一覧: これからの予定" },
  { key: "infohint:event-checklist-heading", label: "予定詳細: 準備リストの見出し" },
  { key: "infohint:checklist-autosave", label: "予定詳細: 自動保存の説明" },
  { key: "infohint:checklist-generate-existing", label: "予定詳細: 連携時の既存予定の説明" },
  { key: "infohint:checklist-unreviewed", label: "予定詳細: 未確認リストの説明" },
];

/**
 * 案内・チュートリアル系ポップアップ。「表示」「スキップ」「最後まで見た」を
 * それぞれ別の行として記録する（同じ仕組みで集計できるように eventKey に畳み込む）。
 */
export const POPUP_KEYS: TrackedKey[] = [
  { key: "popup:tutorial:shown", label: "導入チュートリアル: 表示" },
  { key: "popup:tutorial:skip", label: "導入チュートリアル: スキップ" },
  { key: "popup:tutorial:complete", label: "導入チュートリアル: 最後まで見た" },
  { key: "popup:guided:shown", label: "はじめかた誘導: 表示（いずれかの手順）" },
  { key: "popup:guided:dismiss", label: "はじめかた誘導: あとで（スキップ）" },
  { key: "popup:firstseen:failure_suggestions:shown", label: "初めての説明: 考えられる失敗（表示）" },
  { key: "popup:firstseen:failure_suggestions:ack", label: "初めての説明: 考えられる失敗（わかった）" },
  { key: "popup:coach:home_v5:shown", label: "コーチマーク: ホーム（表示）" },
  { key: "popup:coach:home_v5:skip", label: "コーチマーク: ホーム（スキップ）" },
  { key: "popup:coach:home_v5:complete", label: "コーチマーク: ホーム（最後まで）" },
  { key: "popup:coach:events_v3:shown", label: "コーチマーク: 予定一覧（表示）" },
  { key: "popup:coach:events_v3:skip", label: "コーチマーク: 予定一覧（スキップ）" },
  { key: "popup:coach:events_v3:complete", label: "コーチマーク: 予定一覧（最後まで）" },
  { key: "popup:coach:event_v5:shown", label: "コーチマーク: 予定詳細（表示）" },
  { key: "popup:coach:event_v5:skip", label: "コーチマーク: 予定詳細（スキップ）" },
  { key: "popup:coach:event_v5:complete", label: "コーチマーク: 予定詳細（最後まで）" },
  { key: "popup:coach:failures_v2:shown", label: "コーチマーク: 失敗ログ（表示）" },
  { key: "popup:coach:failures_v2:skip", label: "コーチマーク: 失敗ログ（スキップ）" },
  { key: "popup:coach:failures_v2:complete", label: "コーチマーク: 失敗ログ（最後まで）" },
  { key: "popup:coach:savings_v4:shown", label: "コーチマーク: マニュアル（表示）" },
  { key: "popup:coach:savings_v4:skip", label: "コーチマーク: マニュアル（スキップ）" },
  { key: "popup:coach:savings_v4:complete", label: "コーチマーク: マニュアル（最後まで）" },
  { key: "popup:coach:settings_v5:shown", label: "コーチマーク: 設定（表示）" },
  { key: "popup:coach:settings_v5:skip", label: "コーチマーク: 設定（スキップ）" },
  { key: "popup:coach:settings_v5:complete", label: "コーチマーク: 設定（最後まで）" },
  { key: "popup:desc-link-hint:shown", label: "説明欄リンクの案内: 表示" },
  { key: "popup:desc-link-hint:dismiss", label: "説明欄リンクの案内: 今後表示しない" },
];

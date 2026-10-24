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
  { key: "page:/failures", label: "未来の自分へ" },
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
  { key: "feature:message-quick-record", label: "未来の自分へ: ひとこと記録する" },
  { key: "feature:message-dictation", label: "未来の自分へ: 話して記録する（音声入力）" },
  { key: "feature:message-review-confirm", label: "未来の自分へ: 確定カードで確定" },
  { key: "feature:item-scope-choose", label: "準備リスト: 項目の次回の出し方を選び直す" },
  { key: "feature:item-scope-ai-sort-all", label: "準備リスト: 🤖AIで分別（予定内の全項目）" },
  { key: "feature:item-scope-keyword", label: "準備リスト: 次回の出し方をキーワードにする" },
  { key: "feature:checklist-item-check", label: "予定詳細: 準備リスト項目の✓完了チェック" },
  { key: "feature:checklist-item-delete", label: "予定詳細: 準備リスト項目の✕削除" },
  { key: "feature:future-message-check", label: "予定詳細: 未来の自分へ行の✓完了チェック" },
  { key: "feature:future-message-remove", label: "予定詳細: 未来の自分へ行の✕この予定から外す" },
  { key: "feature:mode-switch-test", label: "設定: 機能モードをテスト版に切替" },
  { key: "feature:mode-switch-production", label: "設定: 機能モードを本番版に切替" },
  { key: "feature:item-priority-set", label: "準備リスト: 急ぎ/そのうちタグを選ぶ" },
  { key: "feature:message-priority-set", label: "未来の自分へ: 急ぎ/そのうちタグを選ぶ" },
  { key: "feature:home-item-check", label: "ホーム: 急ぎ/そのうち一覧の✓完了チェック" },
  { key: "feature:shortcut-token-issue", label: "設定: ショートカット用トークンを発行" },
  { key: "feature:shortcut-token-revoke", label: "設定: ショートカット用トークンを無効化" },
  { key: "feature:lock-screen-image-save", label: "設定: ロック画面の背景画像を登録" },
  { key: "feature:lock-screen-image-delete", label: "設定: ロック画面の背景画像を削除" },
  { key: "feature:lock-screen-wallpaper-fetch", label: "ショートカット: ロック画面壁紙を取得" },
  { key: "feature:lock-screen-guide-open-share", label: "設定: 共有ショートカットを開く" },
  { key: "feature:standalone-priority-add", label: "ホーム: 予定に紐づかない急ぎ/そのうち項目を追加" },
  { key: "feature:standalone-priority-check", label: "ホーム: 予定に紐づかない項目の✓完了チェック" },
  { key: "feature:standalone-priority-delete", label: "ホーム: 予定に紐づかない項目を削除" },
  { key: "feature:home-completed-items-view", label: "ホーム: 急ぎ/そのうちの完了した項目を見る" },
  { key: "feature:priority-extras-on", label: "設定: ver2.1をONにする" },
  { key: "feature:priority-extras-off", label: "設定: ver2.1をOFFにする" },
];

/** ⓘ（InfoHint）の説明ポップアップ。開かれた回数を数える。 */
export const INFOHINT_KEYS: TrackedKey[] = [
  { key: "infohint:savings-merge-group", label: "マニュアル: 同じ名前をまとめて編集" },
  { key: "infohint:savings-cleared", label: "マニュアル: 準備リストは空" },
  { key: "infohint:savings-intro", label: "マニュアル: ページの説明" },
  { key: "infohint:savings-templates-intro", label: "マニュアル: 名前付きマニュアルの説明" },
  { key: "infohint:failures-intro", label: "/failures: ページの説明（モード共通id）" },
  { key: "infohint:failures-quick-record", label: "/failures: 記録・メッセージを書く（モード共通id）" },
  { key: "infohint:failures-review-queue", label: "/failures: 結果を記録しよう（テスト版）" },
  { key: "infohint:settings-write-description", label: "設定: 説明欄への書き込み" },
  { key: "infohint:settings-notify", label: "設定: 通知" },
  { key: "infohint:feature-mode-toggle", label: "設定: 機能モードとは" },
  { key: "infohint:priority-extras-toggle", label: "設定: ver2.1とは" },
  { key: "infohint:events-upcoming", label: "予定一覧: これからの予定" },
  { key: "infohint:event-checklist-heading", label: "予定詳細: 準備リストの見出し" },
  { key: "infohint:checklist-autosave", label: "予定詳細: 自動保存の説明" },
  { key: "infohint:checklist-generate-existing", label: "予定詳細: 連携時の既存予定の説明" },
  { key: "infohint:checklist-unreviewed", label: "予定詳細: 未確認リストの説明" },
  { key: "infohint:ai-sort-all", label: "予定詳細: 🤖AIで分別の説明" },
  { key: "infohint:future-message-done-vs-remove", label: "予定詳細: 未来の自分への✓と✕の違い" },
  { key: "infohint:future-message-delete-vs-remove", label: "未来の自分へ: 削除と外すの違い" },
  { key: "infohint:scope-quick-toggle", label: "次回の出し方: 説明（ⓘ）" },
  { key: "infohint:settings-shortcut-token", label: "設定: ショートカット用トークンの説明" },
  { key: "infohint:settings-lock-screen-image", label: "設定: ロック画面の背景画像の説明" },
  { key: "infohint:settings-lock-screen-shortcut-guide", label: "設定: ロック画面ショートカット導入ガイドの説明" },
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
  { key: "popup:coach:home_v6:shown", label: "コーチマーク: ホーム（表示）" },
  { key: "popup:coach:home_v6:skip", label: "コーチマーク: ホーム（スキップ）" },
  { key: "popup:coach:home_v6:complete", label: "コーチマーク: ホーム（最後まで）" },
  { key: "popup:coach:events_v4:shown", label: "コーチマーク: 予定一覧（表示）" },
  { key: "popup:coach:events_v4:skip", label: "コーチマーク: 予定一覧（スキップ）" },
  { key: "popup:coach:events_v4:complete", label: "コーチマーク: 予定一覧（最後まで）" },
  { key: "popup:coach:event_v7:shown", label: "コーチマーク: 予定詳細（表示）" },
  { key: "popup:coach:event_v7:skip", label: "コーチマーク: 予定詳細（スキップ）" },
  { key: "popup:coach:event_v7:complete", label: "コーチマーク: 予定詳細（最後まで）" },
  { key: "popup:coach:messages_v1:shown", label: "コーチマーク: 未来の自分へ（表示）" },
  { key: "popup:coach:messages_v1:skip", label: "コーチマーク: 未来の自分へ（スキップ）" },
  { key: "popup:coach:messages_v1:complete", label: "コーチマーク: 未来の自分へ（最後まで）" },
  { key: "popup:coach:savings_v4:shown", label: "コーチマーク: マニュアル（表示）" },
  { key: "popup:coach:savings_v4:skip", label: "コーチマーク: マニュアル（スキップ）" },
  { key: "popup:coach:savings_v4:complete", label: "コーチマーク: マニュアル（最後まで）" },
  { key: "popup:coach:settings_v5:shown", label: "コーチマーク: 設定（表示）" },
  { key: "popup:coach:settings_v5:skip", label: "コーチマーク: 設定（スキップ）" },
  { key: "popup:coach:settings_v5:complete", label: "コーチマーク: 設定（最後まで）" },
  { key: "popup:desc-link-hint:shown", label: "説明欄リンクの案内: 表示" },
  { key: "popup:desc-link-hint:dismiss", label: "説明欄リンクの案内: 今後表示しない" },
  { key: "popup:scope-hint:shown", label: "次回の出し方の案内: 表示" },
  { key: "popup:scope-hint:dismiss", label: "次回の出し方の案内: 今後表示しない" },
];

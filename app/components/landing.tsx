import Link from "next/link";
import { PrivateModeNotice } from "@/app/components/private-mode-notice";

// 黒背景に白文字を、確実に出るユーティリティで固定（token が効かない環境でも潰れない）。
const CTA_CLASS =
  "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-6 py-3.5 text-[15px] font-semibold text-white [text-decoration:none] shadow-sm transition-opacity hover:opacity-90";

function CtaButton({ loggedout }: { loggedout: boolean }) {
  return (
    <a href="/api/auth/google" className={CTA_CLASS}>
      {loggedout ? "Google で入り直す" : "Google ではじめる / ログイン"}
    </a>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
      {children}
    </p>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group border-b border-border py-4 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground">
        {q}
        <span className="shrink-0 text-muted transition-transform group-open:rotate-45">
          ＋
        </span>
      </summary>
      <div className="mt-2 text-[13px] leading-relaxed text-muted">{children}</div>
    </details>
  );
}

/** 見せ所① 学習：一般リスト → あなたが直す → 次回はあなた仕様、の3コマ。 */
function LearnMock() {
  const card = "rounded-xl border border-border bg-surface p-3 shadow-sm";
  return (
    <div className="mt-6 grid gap-2 text-left sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
      <div className={card}>
        <p className="text-[10px] font-medium text-muted">1回目（一般的なリスト）</p>
        <ul className="mt-1 space-y-0.5 text-[11px] text-muted">
          <li>☐ 着替え</li>
          <li>☐ 充電器</li>
          <li>☐ 名刺</li>
        </ul>
      </div>
      <div aria-hidden className="mx-auto text-muted">
        <span className="sm:hidden">↓</span>
        <span className="hidden sm:inline">→</span>
      </div>
      <div className={`${card} bg-surface-muted`}>
        <p className="text-[10px] font-medium text-foreground">あなたが直す</p>
        <ul className="mt-1 space-y-0.5 text-[11px]">
          <li className="text-muted line-through">✕ 名刺</li>
          <li className="text-foreground">＋ 常備薬</li>
          <li className="text-foreground">＋ モバイルバッテリー</li>
        </ul>
      </div>
      <div aria-hidden className="mx-auto text-muted">
        <span className="sm:hidden">↓</span>
        <span className="hidden sm:inline">→</span>
      </div>
      <div className={`${card} border-foreground/25`}>
        <p className="text-[10px] font-semibold text-foreground">
          次の似た予定（あなた仕様）
        </p>
        <ul className="mt-1 space-y-0.5 text-[11px] text-muted">
          <li>☐ 着替え</li>
          <li>☐ 充電器</li>
          <li>☐ 常備薬</li>
          <li>☐ モバイルバッテリー</li>
        </ul>
      </div>
    </div>
  );
}

/** 見せ所② 失敗ログ → 節約額。 */
function FailMock() {
  return (
    <div className="mt-6 grid gap-2 text-left sm:grid-cols-[1.3fr_auto_1fr] sm:items-center">
      <div className="rounded-xl border border-warn/30 bg-warn-soft p-3">
        <p className="text-[10px] font-semibold text-warn">失敗ログ（一言でOK）</p>
        <p className="mt-1 text-[12px] text-foreground">保険証を忘れて再受診に…</p>
        <p className="mt-0.5 text-[10px] text-muted">
          → 次の「通院」予定で事前にお知らせ
        </p>
      </div>
      <div aria-hidden className="mx-auto text-muted">
        <span className="sm:hidden">↓</span>
        <span className="hidden sm:inline">→</span>
      </div>
      <div className="rounded-xl border border-foreground/20 bg-foreground p-3 text-surface">
        <p className="text-[10px] text-surface/70">今月 防げた分（推定）</p>
        <p className="mt-0.5 text-2xl font-bold">¥3,200</p>
        <p className="text-[10px] text-surface/60">防げたうっかり 4 件</p>
      </div>
    </div>
  );
}

export function Landing({
  loggedout,
  authMessage,
  devLogin,
}: {
  loggedout: boolean;
  authMessage: string | null;
  devLogin: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      {/* ── ヒーロー ── */}
      <section className="pt-2 text-center sm:pt-6">
        <Eyebrow>予定の準備を、自分仕様で</Eyebrow>
        <h1 className="mx-auto mt-3 max-w-xl text-[30px] font-semibold leading-[1.18] tracking-tight text-foreground sm:text-[42px]">
          予定を書くだけ。
          <br />
          準備リストが、
          <span className="whitespace-nowrap">直すほど当たる。</span>
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted">
          カレンダーの予定ごとに「準備すること」と「持ち物」を用意。
          いる／いらないを直すだけで、次の似た予定から
          <strong className="text-foreground">あなた好み</strong>で出てきます。
        </p>

        {loggedout && (
          <p className="mx-auto mt-6 max-w-md rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm text-foreground">
            ログアウトしました。同じ Google アカウントで入り直すと、そのまま元に戻ります。
          </p>
        )}
        {authMessage && (
          <p className="mx-auto mt-6 max-w-md rounded-xl border border-foreground bg-surface px-4 py-3 text-sm font-medium text-foreground">
            {authMessage}
          </p>
        )}

        <div className="mx-auto mt-7 max-w-sm">
          <CtaButton loggedout={loggedout} />
          <p className="mt-2 text-xs text-muted">
            はじめての方も、使ったことがある方も、同じボタンでOK。
            カレンダーは<strong className="text-foreground">読み取りのみ</strong>・無料の検証版。
          </p>
          <PrivateModeNotice />
        </div>
      </section>

      {/* ── 見せ所① 学習する準備リスト ── */}
      <section className="mt-16 sm:mt-20">
        <Eyebrow>見せ所 ①</Eyebrow>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          「準備すること」「持ち物」は、直すほど当たる
        </h2>
        <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-muted">
          最初は一般的なリスト。「これはいらない」「これは毎回いる」を消す・足すだけで、
          次に似た予定が来たときに、あなた仕様で出てきます。通知のタイミングも学習します。
          <strong className="text-foreground">
            リストが増えて散らかることはありません
          </strong>
          — 出す項目とタイミングの精度だけが上がります。
        </p>
        <LearnMock />
      </section>

      {/* ── 見せ所② 失敗ログ → 節約額 ── */}
      <section className="mt-16 sm:mt-20">
        <Eyebrow>見せ所 ②</Eyebrow>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          うっかりを一度書けば、次は先回り。防げた額も見える
        </h2>
        <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-muted">
          「保険証を忘れた」「予約し忘れた」を一言メモするだけ。似た予定が来たら事前にお知らせ。
          予定のあと「防げた？」に答えると、避けられた損失（推定）が
          <strong className="text-foreground">「◯◯円 防げた」</strong>
          として積み上がって見えます。ミスが減って、成果も残ります。
        </p>
        <FailMock />
      </section>

      {/* ── 仕組み ── */}
      <section className="mt-16 sm:mt-20">
        <Eyebrow>仕組み</Eyebrow>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          やることは、つなぐだけ
        </h2>
        <ol className="mt-6 max-w-md space-y-5">
          {[
            [
              "Google カレンダーとつなぐ",
              "約30秒。読み取りだけなので、予定が書き換わることはありません。",
            ],
            [
              "いつも通り予定を入れる",
              "カレンダーに書くだけ。このアプリへの取り込みは自動です。",
            ],
            [
              "準備リストが出てくる → 直す",
              "予定を開くとリストが用意されています。直すたびに、次から賢くなります。",
            ],
          ].map(([t, b], i) => (
            <li key={i} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-foreground text-sm font-bold text-foreground">
                {i + 1}
              </span>
              <div className="pt-0.5">
                <p className="text-[15px] font-semibold text-foreground">{t}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
                  {b}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-6 max-w-lg text-[13px] leading-relaxed text-muted">
          🎤 スマホのキーボードのマイクで「着替えと充電器、宿の予約を確認、駅で弁当」
          と話すだけでも、AI が準備すること・持ち物・その他の枠に振り分けます。
        </p>
      </section>

      {/* ── FAQ ── */}
      <section className="mt-16 sm:mt-20">
        <Eyebrow>よくある質問</Eyebrow>
        <div className="mt-4">
          <Faq q="無料ですか？">はい。いまは無料の検証版です。</Faq>
          <Faq q="カレンダーの予定が書き換わりませんか？">
            予定の日時・タイトル・場所は変更しません。行うのは、説明欄の末尾に
            「準備リストのリンク＋箇条書き」を追記・更新することだけです。設定でオフにできます。
          </Faq>
          <Faq q="スマホだけで使えますか？">
            使えます。ブラウザの「ホーム画面に追加」で、アプリのように使えます。
          </Faq>
          <Faq q="シークレット／プライベートモードでも使えますか？">
            おすすめしません。ログイン状態や学習した内容が保存されず、毎回リセットされます。
          </Faq>
        </div>
      </section>

      {/* ── 最後の CTA ── */}
      <section className="mx-auto mt-16 max-w-sm text-center sm:mt-20">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          まずは1つ、予定をつないでみる
        </h2>
        <div className="mt-5">
          <CtaButton loggedout={loggedout} />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          続けると
          <Link href="/terms" className="underline">
            利用規約
          </Link>
          と
          <Link href="/privacy" className="underline">
            プライバシーポリシー
          </Link>
          に同意したものとみなします。
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          途中で「このアプリは確認されていません」と出たら、「詳細」→「（アプリ名）に移動」で進めます。
        </p>
        {devLogin && (
          <p className="mt-5 text-[11px] text-muted">
            <a href="/api/auth/dev-login" className="underline">
              開発用ログイン
            </a>
            （本番では無効）
          </p>
        )}
      </section>
    </div>
  );
}

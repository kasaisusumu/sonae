import Link from "next/link";
import { PrivateModeNotice } from "@/app/components/private-mode-notice";

// 黒背景に白文字を、確実に出るユーティリティ（text-white / 明示 no-underline）で固定。
// token の text-surface が万一効かない環境でも潰れないようにする。
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

/** カレンダーの予定 → 準備リスト の小さな見本。 */
function HeroMock() {
  return (
    <div className="mx-auto mt-10 grid max-w-sm gap-2 text-left sm:max-w-md sm:grid-cols-[1fr_auto_1.15fr] sm:items-center">
      <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
        <p className="text-[10px] font-medium text-muted">📅 カレンダーの予定</p>
        <p className="mt-1 text-sm font-medium text-foreground">大阪へ日帰り出張</p>
        <p className="text-[11px] text-muted">木 9:00〜</p>
      </div>
      <div aria-hidden className="mx-auto text-lg text-muted">
        <span className="sm:hidden">↓</span>
        <span className="hidden sm:inline">→</span>
      </div>
      <div className="rounded-xl border border-foreground/15 bg-surface-muted p-3">
        <p className="text-[10px] font-semibold text-foreground">
          自動でできる準備リスト
        </p>
        <ul className="mt-1 space-y-0.5 text-[11px] text-muted">
          <li>☐ 交通チケットを確認する（前日）</li>
          <li>☐ 経費精算のメモを用意（当日朝）</li>
          <li>☐ モバイルバッテリー</li>
          <li>☐ 名刺</li>
        </ul>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 text-left shadow-sm">
      <div className="text-2xl leading-none">{icon}</div>
      <h3 className="mt-3 text-[15px] font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-foreground text-sm font-bold text-foreground">
        {n}
      </span>
      <div className="pt-0.5">
        <p className="text-[15px] font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{body}</p>
      </div>
    </li>
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
        <Eyebrow>予定の準備を、自動で</Eyebrow>
        <h1 className="mx-auto mt-3 max-w-xl text-[32px] font-semibold leading-[1.15] tracking-tight text-foreground sm:text-[44px]">
          持ち物リストを、
          <br className="hidden sm:block" />
          もう毎回つくらない。
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted">
          カレンダーに予定を入れるだけ。「準備すること」と「持ち物」を AI が用意します。
          直すたびに学習して、<strong className="text-foreground">あなた専用の準備マニュアル</strong>
          に育ちます。
        </p>

        {loggedout && (
          <p className="mx-auto mt-6 max-w-md rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm text-foreground">
            ログアウトしました。データは保存されています。
            同じ Google アカウントで入り直すと、そのまま元に戻ります。
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
          </p>
          <PrivateModeNotice />
        </div>

        <HeroMock />

        <p className="mx-auto mt-6 max-w-md text-[11px] leading-relaxed text-muted">
          予定の<strong className="text-foreground">説明欄に準備リストのリンクを自動で追記</strong>します
          （予定の日時やタイトルは変更しません。設定でいつでもオフにできます）。
          無料の検証版です。
        </p>
      </section>

      {/* ── 困りごと ── */}
      <section className="mt-16 sm:mt-20">
        <div className="text-center">
          <Eyebrow>こんなこと、ありませんか</Eyebrow>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            準備は、いつも直前で慌てる
          </h2>
        </div>
        <ul className="mx-auto mt-6 max-w-md space-y-2.5 text-[14px] text-muted">
          <li className="flex gap-3 rounded-xl border border-border bg-surface p-3.5">
            <span aria-hidden>🌀</span>
            出かける直前に「あれ、持った？」と不安になる
          </li>
          <li className="flex gap-3 rounded-xl border border-border bg-surface p-3.5">
            <span aria-hidden>🔁</span>
            似た予定なのに、毎回ゼロから持ち物を思い出す
          </li>
          <li className="flex gap-3 rounded-xl border border-border bg-surface p-3.5">
            <span aria-hidden>💸</span>
            忘れ物や予約忘れで、地味な出費と時間のロス
          </li>
        </ul>
      </section>

      {/* ── 使い方 ── */}
      <section className="mt-16 sm:mt-20">
        <div className="text-center">
          <Eyebrow>使い方</Eyebrow>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            かんたん 3 ステップ
          </h2>
        </div>
        <ol className="mx-auto mt-7 max-w-md space-y-6">
          <Step
            n={1}
            title="Google カレンダーとつなぐ"
            body="連携は約30秒。読み取りだけなので、予定が書き換わることはありません。"
          />
          <Step
            n={2}
            title="いつも通り予定を入れる"
            body="カレンダーに書くだけ。このアプリへの取り込みは自動です。"
          />
          <Step
            n={3}
            title="準備リストが出てくる"
            body="予定ごとに「準備すること」「持ち物」が用意されます。直すと次から賢く。"
          />
        </ol>
      </section>

      {/* ── 違い ── */}
      <section className="mt-16 sm:mt-20">
        <div className="text-center">
          <Eyebrow>ここが違う</Eyebrow>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            ふつうのチェックリストとの差
          </h2>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <FeatureCard
            icon="🧠"
            title="育つチェックリスト"
            body="いる／いらないを直すだけ。次に似た予定が来たら、あなた好みで出てきます。"
          />
          <FeatureCard
            icon="🔗"
            title="カレンダーから直接ひらける"
            body="予定の説明欄に準備リストのリンクを自動記入。使い慣れたカレンダーからワンタップ。"
          />
          <FeatureCard
            icon="🛟"
            title="うっかりを先回り"
            body="失敗をひとこと記録すると似た予定で事前に注意。防げた分は節約額として見える化。"
          />
        </div>
      </section>

      {/* ── 目玉（濃い帯・端まで） ── */}
      <section className="mt-16 -mx-5 bg-foreground px-5 py-12 text-surface sm:mx-0 sm:rounded-3xl sm:px-10 sm:py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-surface/60">
          使うほど、あなた仕様に
        </p>
        <h2 className="mt-2 max-w-lg text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
          あなた専用の“準備マニュアル”に育っていく。
        </h2>
        <p className="mt-3 max-w-lg text-[13px] leading-relaxed text-surface/80">
          「これは毎回いる」「これはいらない」を直すたびに学習。
          リストが増えて散らかることはなく、出す項目とタイミングの精度だけが上がります。
        </p>
        <p className="mt-4 max-w-lg text-[13px] leading-relaxed text-surface/80">
          🎤 スマホのキーボードのマイクで「着替えと充電器、宿の予約を確認、駅で弁当」
          と話すだけでも、AI が準備すること・持ち物・その他の枠に振り分けます。
        </p>
      </section>

      {/* ── やさしい設計 ── */}
      <section className="mt-16 text-center sm:mt-20">
        <Eyebrow>設計のこだわり</Eyebrow>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          責めない、急かさない
        </h2>
        <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-muted">
          段取りが苦手でも続けられるよう、言葉づかいまでやさしく設計。
          できなかった日があっても大丈夫。淡々と、次に活かします。
        </p>
      </section>

      {/* ── FAQ ── */}
      <section className="mt-16 sm:mt-20">
        <div className="text-center">
          <Eyebrow>よくある質問</Eyebrow>
        </div>
        <div className="mx-auto mt-5 max-w-lg">
          <Faq q="無料ですか？">
            はい。いまは無料の検証版です。
          </Faq>
          <Faq q="カレンダーの予定が書き換わりませんか？">
            予定の日時・タイトル・場所は変更しません。行うのは、説明欄の末尾に
            「準備リストのリンク＋箇条書き」ブロックを追記・更新することだけです。
            元の説明文は残します。設定でいつでもオフにできます。
          </Faq>
          <Faq q="スマホだけで使えますか？">
            使えます。ブラウザの「ホーム画面に追加」で、アプリのように使えます。
          </Faq>
          <Faq q="シークレット／プライベートモードでも使えますか？">
            おすすめしません。そのモードだとログイン状態や学習した内容が保存されず、
            毎回リセットされます。ふだんの（通常の）ウィンドウでご利用ください。
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

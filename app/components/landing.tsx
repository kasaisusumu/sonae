const CTA_CLASS =
  "inline-flex w-full items-center justify-center rounded-xl bg-teal px-6 py-3.5 text-[15px] font-semibold text-white no-underline shadow-sm transition-colors hover:bg-teal-dark";

/** カレンダーの予定 → 準備リスト の小さな見本。 */
function HeroMock() {
  return (
    <div className="mx-auto mt-8 grid max-w-sm gap-2 text-left sm:grid-cols-[1fr_auto_1.2fr] sm:items-center">
      <div className="rounded-xl border border-border bg-surface p-3 shadow-sm">
        <p className="text-[10px] font-medium text-muted">📅 カレンダーの予定</p>
        <p className="mt-1 text-sm font-medium text-foreground">大阪へ日帰り出張</p>
        <p className="text-[11px] text-muted">木 9:00〜</p>
      </div>
      <div aria-hidden className="mx-auto text-lg text-teal-dark">
        <span className="sm:hidden">↓</span>
        <span className="hidden sm:inline">→</span>
      </div>
      <div className="rounded-xl border border-teal/25 bg-teal-soft p-3">
        <p className="text-[10px] font-semibold text-teal-dark">
          準備すること・持ち物
        </p>
        <ul className="mt-1 space-y-0.5 text-[11px] text-teal-dark/90">
          <li>☐ 交通チケットを確認する（前日）</li>
          <li>☐ 経費精算のメモを用意（当日朝）</li>
          <li>☐ モバイルバッテリー</li>
          <li>☐ 名刺</li>
        </ul>
      </div>
    </div>
  );
}

function DiffCard({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 text-left shadow-sm">
      <div className="text-2xl leading-none">{icon}</div>
      <h3 className="mt-2 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
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
    <div className="mx-auto max-w-xl">
      {/* ── ヒーロー ── */}
      <section className="text-center">
        <span className="inline-block rounded-full bg-teal-soft px-3 py-1 text-[11px] font-medium text-teal-dark">
          予定の“準備”を、あなた仕様で
        </span>
        <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-foreground">
          「準備すること」も「持ち物」も、
          <br className="hidden sm:block" />
          予定から自動で。
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted">
          カレンダーに予定を入れるだけ。あとは AI が下準備。
          <br />
          使うほど、<strong className="text-foreground">あなた専用の“準備マニュアル”</strong>
          に育ちます。
        </p>

        <HeroMock />

        {loggedout && (
          <p className="mx-auto mt-6 max-w-md rounded-xl bg-accent-soft px-4 py-3 text-sm text-teal-dark">
            ログアウトしました。データは保存されています。同じ Google
            アカウントで入り直すと、そのまま元に戻ります。
          </p>
        )}
        {authMessage && (
          <p className="mx-auto mt-6 max-w-md rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
            {authMessage}
          </p>
        )}

        <div className="mx-auto mt-7 max-w-sm">
          <a href="/api/auth/google" className={CTA_CLASS}>
            {loggedout ? "Google で入り直す" : "Google ではじめる（約30秒）"}
          </a>
          <p className="mt-2 text-xs text-muted">
            カレンダーは読み取りのみ。書き込みは設定で ON にしたときだけ。
          </p>
        </div>
      </section>

      {/* ── ここが違う ── */}
      <section className="mt-14">
        <h2 className="text-center text-lg font-semibold tracking-tight text-foreground">
          ふつうのチェックリストと、ここが違う
        </h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <DiffCard
            icon="🧠"
            title="育つチェックリスト"
            body="いる／いらないを直すだけ。次に似た予定が来たら、あなた好みで出てきます。毎回ゼロから作りません。"
          />
          <DiffCard
            icon="🔗"
            title="カレンダーから直接ひらける"
            body="予定の説明欄に準備リストのリンクを自動で記入。いつも使っているカレンダーアプリからワンタップで開けます。"
          />
          <DiffCard
            icon="🛟"
            title="うっかりを“先回り”に"
            body="失敗をひとこと記録すると、似た予定で事前に注意。防げた分は“節約できた額”として見える化します。"
          />
        </div>
      </section>

      {/* ── 使い方 ── */}
      <section className="mt-14">
        <h2 className="text-center text-lg font-semibold tracking-tight text-foreground">
          はじめかたは 3 ステップ
        </h2>
        <ol className="mx-auto mt-5 max-w-md space-y-3">
          {[
            ["つなぐ", "Google カレンダーと連携（約30秒）。読み取りだけ。"],
            [
              "予定を入れる",
              "いつも通りカレンダーに予定を書くだけ。取り込みは自動。",
            ],
            [
              "準備リストが出る",
              "予定ごとに「準備すること」「持ち物」が用意されます。直すと次から賢く。",
            ],
          ].map(([t, d], i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal text-sm font-semibold text-white">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">{t}</p>
                <p className="text-[13px] leading-relaxed text-muted">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── 音声入力 ── */}
      <section className="mt-14 rounded-2xl border border-teal/20 bg-teal-soft p-5 text-center">
        <div className="text-2xl">🎤</div>
        <h2 className="mt-1 text-base font-semibold text-teal-dark">
          話すだけでも作れます
        </h2>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-teal-dark/90">
          スマホのキーボードのマイクで「着替えと充電器、宿の予約を確認して、
          駅で弁当を買う」と話すと、AI が
          <strong>準備すること・持ち物・その他の枠</strong>に振り分けて追加します。
        </p>
      </section>

      {/* ── やさしい設計 ── */}
      <section className="mt-14 text-center">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          責めない・急かさない
        </h2>
        <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-muted">
          段取りが苦手でも続けられるように、言葉づかいまでやさしく設計しています。
          できなかった日があっても大丈夫。淡々と、次に活かします。
        </p>
      </section>

      {/* ── 最後の CTA ── */}
      <section className="mx-auto mt-12 max-w-sm text-center">
        <a href="/api/auth/google" className={CTA_CLASS}>
          {loggedout ? "Google で入り直す" : "Google ではじめる（約30秒）"}
        </a>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          カレンダーは読み取りのみ。予定の説明欄への書き込みは、設定で明示的に ON
          にしたときだけ行います。これは検証版です。
        </p>
        <p className="mt-2 text-[11px] text-muted">
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

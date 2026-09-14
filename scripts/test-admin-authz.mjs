/**
 * 管理者専用ページ（/admin）の権限テストスクリプト。
 *
 * このプロジェクトは Supabase を使っていない（Prisma + 独自の HMAC 署名 Cookie
 * セッション、管理者判定は lib/admin-auth.ts の isAdminEmail()）ため、
 * @supabase/supabase-js の Admin API の代わりに、このアプリの実際の認証の
 * 仕組みに合わせてテストする:
 *
 *   1. Prisma で一般ユーザー役（test-general@example.com）と、
 *      管理者ロール想定（test-admin@example.com。※ローカルの ADMIN_EMAIL に
 *      あらかじめ含めておく必要あり。下記「事前準備」参照）の 2 人を作成
 *   2. lib/session.ts と同じ HMAC 署名アルゴリズムで、それぞれの sonae_session
 *      Cookie を「サインイン済み」の状態として直接発行（Google の実ログインは
 *      自動化できないため、その代わりにこの方法でセッションを用意する）
 *   3. 両方のセッションで GET /admin を叩き、redirect: "manual" で
 *      レスポンスを比較する
 *   4. test-general 側が admin 用の入口を通過できてしまったら
 *      「権限の不備」として報告する
 *
 * 期待される結果:
 *   - test-general: 404（/admin の app/not-found.tsx。isAdminEmail() で弾かれる）
 *   - test-admin  : 307 で /api/auth/google?dest=admin へ（＝ isAdminEmail() は
 *                   通過できている。/admin は開くたびに毎回 Google 再ログインを
 *                   要求する仕様のため、実際の管理画面の中身までは
 *                   このスクリプトだけでは取得できない＝正常な仕様）
 *
 * 事前準備:
 *   1. ローカルで `npm run dev`（http://localhost:3000）を起動しておく
 *   2. .env の ADMIN_EMAIL に test-admin@example.com を含めておく
 *      例: ADMIN_EMAIL="kadomimo0504@gmail.com,test-admin@example.com"
 *      （本番 Vercel の環境変数は一切変更しない。ローカルの .env だけでよい）
 *
 * 実行:
 *   node scripts/test-admin-authz.mjs
 *
 * 後始末:
 *   作成した 2 人のテストユーザー（と紐づく AdminLoginToken 等）は、
 *   スクリプト終了時に必ず削除する（成功・失敗を問わず finally で実行）。
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// .env を簡易パース（このプロジェクトに dotenv 依存が無いため）。
function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}
loadEnv();

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const GENERAL_EMAIL = "test-general@example.com";
const ADMIN_ROLE_EMAIL = "test-admin@example.com";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 8) {
    throw new Error("SESSION_SECRET が未設定です。.env を確認してください。");
  }
  return s;
}

// lib/session.ts の sign()/serialize() と同じアルゴリズム。
function signSessionCookie(userId) {
  const sig = crypto.createHmac("sha256", secret()).update(userId).digest("hex");
  return `${userId}.${sig}`;
}

// lib/admin-auth.ts の allowedAdminEmails() と同じ正規化ロジック。
function allowedAdminEmails() {
  return (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase())
    .filter(Boolean);
}

async function main() {
  const { PrismaClient } = await import(
    pathToFileURL(path.join(ROOT, "generated", "prisma", "index.js")).href
  );
  const prisma = new PrismaClient();

  console.log(`対象: ${BASE_URL}`);
  console.log(`一般ユーザー役: ${GENERAL_EMAIL}`);
  console.log(`管理者ロール想定: ${ADMIN_ROLE_EMAIL}`);

  const adminEmails = allowedAdminEmails();
  const adminRoleIsConfigured = adminEmails.includes(ADMIN_ROLE_EMAIL.toLowerCase());
  if (!adminRoleIsConfigured) {
    console.warn(
      `\n⚠️  現在の ADMIN_EMAIL（${adminEmails.join(", ") || "(未設定)"}）に ` +
        `${ADMIN_ROLE_EMAIL} が含まれていません。\n` +
        `   このままでは test-admin も一般ユーザーと同じ扱い（404）になり、\n` +
        `   「一般ユーザーだけが弾かれている」ことの比較になりません。\n` +
        `   .env の ADMIN_EMAIL に ${ADMIN_ROLE_EMAIL} を追加してから\n` +
        `   dev サーバーを再起動して、もう一度実行してください。\n`,
    );
  }

  let generalUser;
  let adminUser;
  try {
    // 1. サーバー疎通確認
    try {
      await fetch(BASE_URL, { redirect: "manual" });
    } catch {
      throw new Error(
        `${BASE_URL} に接続できません。先に \`npm run dev\` でローカルサーバーを起動してください。`,
      );
    }

    // 2. テストユーザーを用意（Google 連携なしで Prisma に直接作成）
    generalUser = await prisma.user.upsert({
      where: { email: GENERAL_EMAIL },
      update: {},
      create: { email: GENERAL_EMAIL, name: "テスト一般ユーザー" },
    });
    adminUser = await prisma.user.upsert({
      where: { email: ADMIN_ROLE_EMAIL },
      update: {},
      create: { email: ADMIN_ROLE_EMAIL, name: "テスト管理者ロール" },
    });

    // 3. 実ログイン（Google OAuth）を経由せず、lib/session.ts と同じ方式で
    //    「サインイン済み」の sonae_session Cookie を直接発行する。
    const generalCookie = signSessionCookie(generalUser.id);
    const adminCookie = signSessionCookie(adminUser.id);

    async function probeAdmin(label, cookieValue) {
      const res = await fetch(`${BASE_URL}/admin`, {
        redirect: "manual",
        headers: { Cookie: `sonae_session=${cookieValue}` },
      });
      const location = res.headers.get("location");
      let bodySnippet = "";
      if (res.status === 200) {
        const body = await res.text();
        bodySnippet = body.slice(0, 200).replace(/\s+/g, " ");
      }
      console.log(
        `\n[${label}] GET /admin -> status=${res.status}` +
          (location ? ` location=${location}` : "") +
          (bodySnippet ? `\n  body: ${bodySnippet}...` : ""),
      );
      return { status: res.status, location, bodySnippet };
    }

    const generalResult = await probeAdmin("test-general（一般ユーザー役）", generalCookie);
    const adminResult = await probeAdmin("test-admin（管理者ロール想定）", adminCookie);

    // 4. 判定
    console.log("\n=== 判定 ===");
    const generalBlocked = generalResult.status === 404;
    const generalGotContent = generalResult.status === 200;
    const generalGotAdminRedirect =
      generalResult.status === 307 &&
      (generalResult.location ?? "").includes("dest=admin");

    if (generalGotContent || generalGotAdminRedirect) {
      console.error(
        "🚨 権限の不備がある: 一般ユーザー役のトークンで管理者専用ページの入口を通過できました。" +
          `(status=${generalResult.status})`,
      );
      process.exitCode = 1;
    } else if (generalBlocked) {
      console.log("✅ 一般ユーザー役は想定どおり 404 で弾かれました（isAdminEmail() が機能）。");
    } else {
      console.log(
        `ℹ️ 一般ユーザー役の結果が想定外です（status=${generalResult.status}）。手動で確認してください。`,
      );
    }

    if (!adminRoleIsConfigured) {
      console.log(
        "ℹ️ ADMIN_EMAIL に test-admin@example.com が含まれていないため、" +
          "管理者側の比較は参考情報です（上の警告を参照）。",
      );
    } else if (adminResult.status === 404) {
      console.log(
        "⚠️ 管理者ロール想定のトークンまで 404 になりました。" +
          "ADMIN_EMAIL の反映（dev サーバー再起動）や大文字小文字・空白を確認してください。",
      );
    } else if (adminResult.status === 307 && (adminResult.location ?? "").includes("dest=admin")) {
      console.log(
        "✅ 管理者ロール想定は isAdminEmail() を通過できました" +
          "（この先は毎回 Google 再ログインが必須の仕様のため、307 で正常です）。",
      );
    } else {
      console.log(`ℹ️ 管理者ロール想定の結果が想定外です（status=${adminResult.status}）。`);
    }
  } finally {
    // 後始末: 作成したテストユーザーとその関連レコードを必ず削除する。
    for (const u of [generalUser, adminUser]) {
      if (!u) continue;
      await prisma.adminLoginToken.deleteMany({ where: { userId: u.id } }).catch(() => {});
      await prisma.userGoogleAccount.deleteMany({ where: { userId: u.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
    }
    await prisma.$disconnect();
    console.log("\n後始末: テストユーザー2人を削除しました。");
  }
}

main().catch((e) => {
  console.error("\nエラー:", e.message ?? e);
  process.exitCode = 1;
});

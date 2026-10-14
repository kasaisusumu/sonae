#!/usr/bin/env node
/**
 * AiUsageEvent（lib/ai-usage.ts が記録する、このアプリのAI利用ログ）を、
 * 日(UTC)×モデルで集計してJSONに書き出す。OpenAI側の実績（Usage/Cost CSV）との
 * 照合（scripts/reconcile-ai-usage.mjs）の入力になる。
 *
 * 読み取り専用（SELECTのみ）。書き込み・更新・削除は一切行わない
 * （下の runReadOnlyQuery が素のSELECT文だけを発行することで保証する）。
 *
 * 使い方:
 *   CONFIRM_DB=1 DATABASE_URL=... DIRECT_URL=... node scripts/export-ai-usage-daily.mjs <env名>
 *   例: CONFIRM_DB=1 DATABASE_URL="postgresql://...ep-bitter-queen..." node scripts/export-ai-usage-daily.mjs test
 *
 * 本番（prod）の書き出しは、Claude Code からは実行しない（本番DBに接続しないため）。
 * 利用者自身が、本番のDATABASE_URL/DIRECT_URLを指定して実行すること。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envName = process.argv[2];

if (!envName || !/^[a-zA-Z0-9_-]+$/.test(envName)) {
  console.error("使い方: node scripts/export-ai-usage-daily.mjs <env名（例: prod / test / local）>");
  process.exit(1);
}
if (process.env.CONFIRM_DB !== "1") {
  console.error("SAFETY ABORT: CONFIRM_DB=1 が無いため実行しません。");
  console.error("接続先を必ず確認してから CONFIRM_DB=1 を付けて実行してください。");
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL || "";
let hostname = "(不明)";
try {
  hostname = new URL(DATABASE_URL.replace(/^postgresql:/, "postgres:")).hostname;
} catch {
  /* ignore */
}

console.log(`環境名: ${envName}`);
console.log(`接続先ホスト: ${hostname}`);
console.log("（接続先が正しいか確認してください。このスクリプトはSELECTのみ発行します。）");

async function main() {
  const { PrismaClient } = await import(
    pathToFileURL(path.join(ROOT, "generated", "prisma", "index.js")).href
  );
  const prisma = new PrismaClient();

  // 読み取り専用であることをコードでも保証する: $queryRawUnsafe しか使わず、
  // 発行する文字列も SELECT 固定（ユーザー入力を埋め込まない）。
  async function runReadOnlyQuery(sql) {
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith("SELECT")) {
      throw new Error("SAFETY ABORT: SELECT 以外のクエリは発行しない設計です。");
    }
    return prisma.$queryRawUnsafe(sql);
  }

  const rows = await runReadOnlyQuery(`
    SELECT
      to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
      model,
      count(*)::int AS requests,
      sum("inputTokens")::bigint AS "inputTokens",
      sum("outputTokens")::bigint AS "outputTokens",
      sum("estimatedCostYen")::float AS "estimatedCostYen"
    FROM "AiUsageEvent"
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);

  // 概算のUSD-TO-JPYレート（lib/ai-usage.tsと同じ固定値）で円→ドルに戻す
  // （保存時に USD*155 で円にしているので、155 で割れば往復で誤差なく戻る）。
  const USD_TO_JPY = 155;

  const out = {
    env: envName,
    generatedAt: new Date().toISOString(),
    sourceHost: hostname,
    note: "日付はUTC（createdAtをdate_truncで切った日）。estimatedCostUsdはestimatedCostYen/155（lib/ai-usage.tsのUSD_TO_JPYと同じ値）で逆算した概算。",
    rows: rows.map((r) => ({
      day: r.day,
      model: r.model,
      requests: Number(r.requests),
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      estimatedCostYen: Number(r.estimatedCostYen),
      estimatedCostUsd: Number(r.estimatedCostYen) / USD_TO_JPY,
    })),
  };

  const outDir = path.join(ROOT, "tmp", "ai-usage-export");
  fs.mkdirSync(outDir, { recursive: true });
  const dateTag = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outDir, `${envName}-${dateTag}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log(`書き出し件数（日×モデル）: ${out.rows.length}`);
  console.log(`出力先: ${outPath}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

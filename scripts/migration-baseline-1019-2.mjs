#!/usr/bin/env node
/**
 * 本番昇格（テスト環境のver1/ver2切替版を本番へ移行、作業名「1019-2」）着手前の基準値を記録する。
 * 全テーブルの行数・主要テーブルの内容ハッシュ・適用済みマイグレーション一覧を
 * scripts/migration-baseline-1019-2.json に書き出す（移行後の整合性確認・ロールバック検証用）。
 *
 * 接続先が本番ブランチ（ホスト名に ep-delicate-darkness を含む）以外なら即中止する安全策あり。
 *
 * 使い方:
 *   DATABASE_URL=<本番の接続文字列> DIRECT_URL=<本番の接続文字列> node scripts/migration-baseline-1019-2.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const DATABASE_URL = process.env.DATABASE_URL || "";
const DIRECT_URL = process.env.DIRECT_URL || DATABASE_URL;

function safetyCheck() {
  const ok = (url) => /ep-delicate-darkness/.test(url);
  if (!DATABASE_URL || !ok(DATABASE_URL) || !ok(DIRECT_URL)) {
    console.error(
      "SAFETY ABORT: DATABASE_URL/DIRECT_URL が本番ブランチ（ep-delicate-darkness）を指していません。",
    );
    console.error(
      "  DATABASE_URL:",
      DATABASE_URL ? DATABASE_URL.replace(/:[^:@]+@/, ":***@") : "(未設定)",
    );
    process.exit(1);
  }
}

const KEY_TABLES = [
  "User",
  "Event",
  "ChecklistItem",
  "EditRecord",
  "LearnedRule",
  "Category",
  "FailureLog",
  "SavingsEntry",
];

async function main() {
  safetyCheck();

  const { PrismaClient } = await import(
    pathToFileURL(path.join(ROOT, "generated", "prisma", "index.js")).href
  );
  const prisma = new PrismaClient({ datasourceUrl: DIRECT_URL });

  const tables = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations') ORDER BY tablename`,
  );

  const tableCounts = {};
  for (const { tablename } of tables) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS c FROM "${tablename}"`,
    );
    tableCounts[tablename] = rows[0].c;
  }

  const keyTableHashes = {};
  for (const t of KEY_TABLES) {
    if (!(t in tableCounts)) continue;
    const rows = await prisma.$queryRawUnsafe(
      `SELECT md5(COALESCE(string_agg(row_to_json(x)::text, '|' ORDER BY x.id), '')) AS h FROM "${t}" x`,
    );
    keyTableHashes[t] = rows[0].h;
  }

  const migrations = await prisma.$queryRawUnsafe(
    `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`,
  );

  const result = {
    takenAt: new Date().toISOString(),
    branch: "production (br-gentle-silence-a7fm2l9o)",
    tableCounts,
    keyTableHashes,
    appliedMigrations: migrations.map((m) => m.migration_name),
  };

  const outPath = path.join(ROOT, "scripts", "migration-baseline-1019-2.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log("written:", outPath);
  console.log(JSON.stringify(result, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * OpenAI の実績（Usage/Cost CSV、Usage画面からダウンロードしたもの）と、
 * このアプリの記録（scripts/export-ai-usage-daily.mjs の出力、複数環境ぶん合算）を
 * 日(UTC)×モデルで比較する。
 *
 * 入力:
 *   --cost <path>    OpenAIの「Cost」CSV（日別の金額。モデル別の内訳は無い）
 *   --usage <path>   OpenAIの「Usage」CSV（日別・モデル別のリクエスト数・トークン数）
 *   --env <path>     環境ごとの書き出しJSON（export-ai-usage-daily.mjsの出力）。
 *                    複数回指定すると合算してOpenAIの値と比べる。
 *   --out-md <path>  省略時 tmp/ai-usage-report.md
 *   --out-csv <path> 省略時 tmp/ai-usage-report.csv
 *
 * 比較の3段階（①→②→③の順でずれを見る。①が合っていないと②③の差は当然ずれる）:
 *   ① リクエスト数（モデル別）
 *   ② トークン数（入力・出力、モデル別）
 *   ③ 金額（USD。OpenAIのCost CSVはモデル別の内訳が無いため、日単位の合計で比較する）
 */
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const out = { env: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cost") out.cost = argv[++i];
    else if (a === "--usage") out.usage = argv[++i];
    else if (a === "--env") out.env.push(argv[++i]);
    else if (a === "--out-md") out.outMd = argv[++i];
    else if (a === "--out-csv") out.outCsv = argv[++i];
  }
  return out;
}

/** 素朴なCSVパーサー（ダブルクオート対応）。OpenAIのUsage/Cost CSVはシンプルな形式。 */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const parseLine = (line) => {
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') {
          inQuotes = false;
        } else {
          cur += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        cells.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    cells.push(cur);
    return cells;
  };
  const header = parseLine(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = parseLine(l);
    const obj = {};
    header.forEach((h, i) => (obj[h] = cells[i] ?? ""));
    return obj;
  });
  return { header, rows };
}

function toNum(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** "gpt-4o-mini-2024-07-18" のような日付付きモデル名を、アプリの記録と同じ
 * 素のモデル名（"gpt-4o-mini"）に正規化する。末尾の -YYYY-MM-DD だけを落とす
 * （OpenAIのUsage CSVはスナップショット日付付きのモデル名で出てくる）。 */
function normalizeModel(model) {
  if (!model) return model;
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

function dayFromIso(iso) {
  return (iso || "").slice(0, 10);
}

function loadCostCsv(filePath) {
  const { rows } = parseCsv(fs.readFileSync(filePath, "utf8"));
  // 日(UTC) -> 金額USD合計（モデル別の内訳は無いので日単位のみ）。
  const byDay = new Map();
  for (const r of rows) {
    const day = dayFromIso(r.start_time_iso);
    if (!day) continue;
    const amount = toNum(r.amount_value);
    byDay.set(day, (byDay.get(day) ?? 0) + amount);
  }
  return byDay;
}

function loadUsageCsv(filePath) {
  const { rows } = parseCsv(fs.readFileSync(filePath, "utf8"));
  // (日, 正規化モデル) -> {requests, inputTokens, outputTokens}
  const byDayModel = new Map();
  for (const r of rows) {
    const day = dayFromIso(r.start_time_iso);
    if (!day || !r.model) continue; // 利用が無い日は全列が空（modelも空）
    const model = normalizeModel(r.model);
    const key = `${day}\u0000${model}`;
    const cur = byDayModel.get(key) ?? { day, model, requests: 0, inputTokens: 0, outputTokens: 0 };
    cur.requests += toNum(r.num_model_requests);
    cur.inputTokens += toNum(r.input_tokens);
    cur.outputTokens += toNum(r.output_tokens);
    byDayModel.set(key, cur);
  }
  return byDayModel;
}

function loadEnvJsons(paths) {
  // (日, モデル) -> {requests, inputTokens, outputTokens, estimatedCostUsd}（複数環境を合算）
  const byDayModel = new Map();
  const byDay = new Map(); // 金額は日単位でも合算しておく（③の比較用）
  const envsLoaded = [];
  for (const p of paths) {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    envsLoaded.push({ env: json.env, path: p, rows: json.rows.length });
    for (const r of json.rows) {
      const model = normalizeModel(r.model);
      const key = `${r.day}\u0000${model}`;
      const cur = byDayModel.get(key) ?? {
        day: r.day,
        model,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
      };
      cur.requests += r.requests;
      cur.inputTokens += r.inputTokens;
      cur.outputTokens += r.outputTokens;
      cur.estimatedCostUsd += r.estimatedCostUsd;
      byDayModel.set(key, cur);
      byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.estimatedCostUsd);
    }
  }
  return { byDayModel, byDay, envsLoaded };
}

function fmtUsd(n) {
  return n < 0 ? `-$${Math.abs(n).toFixed(6)}` : `$${n.toFixed(6)}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.cost || !args.usage || args.env.length === 0) {
    console.error(
      "使い方: node scripts/reconcile-ai-usage.mjs --cost <CostCSV> --usage <UsageCSV> --env <envJSON> [--env <envJSON> ...] [--out-md <path>] [--out-csv <path>]",
    );
    process.exit(1);
  }
  const outMd = args.outMd || path.join("tmp", "ai-usage-report.md");
  const outCsv = args.outCsv || path.join("tmp", "ai-usage-report.csv");

  const openaiCostByDay = loadCostCsv(args.cost);
  const openaiUsageByDayModel = loadUsageCsv(args.usage);
  const { byDayModel: appByDayModel, byDay: appCostByDay, envsLoaded } = loadEnvJsons(args.env);

  const allKeys = new Set([...openaiUsageByDayModel.keys(), ...appByDayModel.keys()]);
  const allDays = new Set([...openaiCostByDay.keys(), ...appCostByDay.keys()]);

  const detailRows = [];
  for (const key of [...allKeys].sort()) {
    const [day, model] = key.split("\u0000");
    const o = openaiUsageByDayModel.get(key) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
    const a = appByDayModel.get(key) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
    const reqDiff = o.requests - a.requests;
    const inDiff = o.inputTokens - a.inputTokens;
    const outDiff = o.outputTokens - a.outputTokens;
    let firstMismatch = "一致";
    if (reqDiff !== 0) firstMismatch = "①件数";
    else if (inDiff !== 0 || outDiff !== 0) firstMismatch = "②トークン";
    detailRows.push({
      day,
      model,
      openaiRequests: o.requests,
      appRequests: a.requests,
      reqDiff,
      openaiInputTokens: o.inputTokens,
      appInputTokens: a.inputTokens,
      inDiff,
      openaiOutputTokens: o.outputTokens,
      appOutputTokens: a.outputTokens,
      outDiff,
      firstMismatch,
    });
  }

  const dayRows = [];
  for (const day of [...allDays].sort()) {
    const openaiUsd = openaiCostByDay.get(day) ?? 0;
    const appUsd = appCostByDay.get(day) ?? 0;
    const diff = openaiUsd - appUsd;
    dayRows.push({ day, openaiUsd, appUsd, diff });
  }

  // --- レポート（Markdown） ---
  const onlyTestEnv = envsLoaded.length === 1 && envsLoaded[0].env !== "prod" && envsLoaded[0].env !== "production";
  const lines = [];
  lines.push("# AI利用額: OpenAI実績との照合レポート");
  lines.push("");
  lines.push(`生成日時: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("対象環境（アプリ側、合算）: " + envsLoaded.map((e) => `${e.env}（${e.rows}行、${e.path}）`).join(" / "));
  lines.push("");
  if (onlyTestEnv) {
    lines.push(
      "> **注意**: OpenAI側の値は、全環境（本番・テスト・ローカル）で共用している1つのAPIキーの" +
        "合計です。今回アプリ側に含めているのは **テスト環境の記録だけ** です。本番の書き出しを" +
        "足すまでは、OpenAI側の値がアプリ側より大きく出るのが正常です（本番分がまだ含まれていないため）。",
    );
    lines.push("");
  }
  lines.push("## ③ 金額（USD、日単位。OpenAIのCost CSVはモデル別の内訳が無いため日単位で比較）");
  lines.push("");
  lines.push("| 日(UTC) | OpenAI実績 | アプリ記録（合算） | 差（OpenAI−アプリ） |");
  lines.push("| --- | --- | --- | --- |");
  for (const r of dayRows) {
    lines.push(`| ${r.day} | ${fmtUsd(r.openaiUsd)} | ${fmtUsd(r.appUsd)} | ${fmtUsd(r.diff)} |`);
  }
  lines.push("");
  const totalOpenaiUsd = dayRows.reduce((s, r) => s + r.openaiUsd, 0);
  const totalAppUsd = dayRows.reduce((s, r) => s + r.appUsd, 0);
  lines.push(`**合計**: OpenAI実績 ${fmtUsd(totalOpenaiUsd)} / アプリ記録 ${fmtUsd(totalAppUsd)} / 差 ${fmtUsd(totalOpenaiUsd - totalAppUsd)}`);
  lines.push("");
  lines.push("## ①② リクエスト数・トークン数（日×モデル）");
  lines.push("");
  lines.push("| 日(UTC) | モデル | 件数(OpenAI) | 件数(アプリ) | 件数差 | 入力tok(OpenAI) | 入力tok(アプリ) | 入力差 | 出力tok(OpenAI) | 出力tok(アプリ) | 出力差 | 最初にずれた段階 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of detailRows) {
    lines.push(
      `| ${r.day} | ${r.model} | ${r.openaiRequests} | ${r.appRequests} | ${r.reqDiff} | ${r.openaiInputTokens} | ${r.appInputTokens} | ${r.inDiff} | ${r.openaiOutputTokens} | ${r.appOutputTokens} | ${r.outDiff} | ${r.firstMismatch} |`,
    );
  }
  lines.push("");
  lines.push("## 差の分類（候補。断定はしない）");
  lines.push("");
  lines.push("- 件数がOpenAI側で多い: 記録漏れ・タイムアウト/リトライ/失敗した呼び出し・別用途（Playground等）・集計に含めていない環境");
  lines.push("- トークンだけずれる: キャッシュされた入力トークンの扱い（`input_cached_tokens`）・モデル名の不一致（日付付き名の正規化漏れ等）");
  lines.push("- 金額だけずれる: 単価表の誤り・古さ・キャッシュ割引（本アプリの概算はキャッシュ割引を考慮していない。lib/ai-usage.ts 参照）");
  lines.push("- 日付のずれ: UTCとJSTの境界（OpenAIはUTC、アプリの画面表示はJSTだが、この集計自体はUTCで揃えている）");
  lines.push("");

  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.writeFileSync(outMd, lines.join("\n"));

  // --- レポート（CSV） ---
  const csvLines = [
    "day,model,openai_requests,app_requests,request_diff,openai_input_tokens,app_input_tokens,input_diff,openai_output_tokens,app_output_tokens,output_diff,first_mismatch",
  ];
  for (const r of detailRows) {
    csvLines.push(
      [
        r.day,
        r.model,
        r.openaiRequests,
        r.appRequests,
        r.reqDiff,
        r.openaiInputTokens,
        r.appInputTokens,
        r.inDiff,
        r.openaiOutputTokens,
        r.appOutputTokens,
        r.outDiff,
        r.firstMismatch,
      ].join(","),
    );
  }
  fs.mkdirSync(path.dirname(outCsv), { recursive: true });
  fs.writeFileSync(outCsv, csvLines.join("\n"));

  // --- コンソール要約 ---
  const mismatches = detailRows.filter((r) => r.firstMismatch !== "一致");
  console.log(`レポート: ${outMd}`);
  console.log(`CSV: ${outCsv}`);
  console.log(`日×モデルの件数: ${detailRows.length}（うち不一致: ${mismatches.length}）`);
  console.log(`金額合計: OpenAI ${fmtUsd(totalOpenaiUsd)} / アプリ ${fmtUsd(totalAppUsd)} / 差 ${fmtUsd(totalOpenaiUsd - totalAppUsd)}`);
  const biggestCostDiffDay = [...dayRows].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
  if (biggestCostDiffDay) {
    console.log(
      `金額差が最大の日: ${biggestCostDiffDay.day}（差 ${fmtUsd(biggestCostDiffDay.diff)}）`,
    );
  }
  const biggestReqDiff = [...detailRows].sort((a, b) => Math.abs(b.reqDiff) - Math.abs(a.reqDiff))[0];
  if (biggestReqDiff) {
    console.log(
      `件数差が最大: ${biggestReqDiff.day} / ${biggestReqDiff.model}（差 ${biggestReqDiff.reqDiff}件）`,
    );
  }
}

main();

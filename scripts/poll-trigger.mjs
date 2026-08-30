// Render Cron Job から実行し、Web サービスの /api/cron/poll を叩く。
const base = process.env.APP_BASE_URL;
const secret = process.env.CRON_SECRET;

if (!base || !secret) {
  console.error("APP_BASE_URL と CRON_SECRET を設定してください。");
  process.exit(1);
}

const res = await fetch(`${base.replace(/\/$/, "")}/api/cron/poll`, {
  method: "POST",
  headers: { "x-cron-secret": secret },
});
const text = await res.text();
console.log(res.status, text);
if (!res.ok) process.exit(1);

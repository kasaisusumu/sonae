import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Docker では node_modules を丸ごと同梱し `next start` で起動するため、
     standalone 出力は使わない（シンプルさ優先）。 */
  // sharp はネイティブバイナリを含むため、バンドル・トレース対象から外して
  // そのまま require させる（Next.js公式の推奨設定）。Windows + Turbopack で
  // sharp をバンドル対象にすると junction point 作成に失敗することがある
  // （2026-10-23、ロック画面壁紙機能の追加時に確認）。
  serverExternalPackages: ["sharp"],
};

export default nextConfig;

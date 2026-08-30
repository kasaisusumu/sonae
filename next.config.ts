import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Docker では node_modules を丸ごと同梱し `next start` で起動するため、
     standalone 出力は使わない（シンプルさ優先）。 */
};

export default nextConfig;

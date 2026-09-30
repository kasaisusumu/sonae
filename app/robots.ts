import type { MetadataRoute } from "next";

/**
 * テスト環境（sonae-test 等）は検索に出したくない（ユーザー指定）。
 * 環境変数 NOINDEX=true を立てた環境だけ全面的にクロールを拒否する。
 * 本番にはこの変数を設定しないので、従来どおりクロールを許可する。
 */
export default function robots(): MetadataRoute.Robots {
  if (process.env.NOINDEX === "true") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return { rules: { userAgent: "*", allow: "/" } };
}

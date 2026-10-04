import type { MetadataRoute } from "next";

/**
 * クロール（読み込み）は全環境で許可する。
 * テスト環境（NOINDEX=true）の検索除外は、robots.txt の拒否ではなく各ページの
 * `<meta name="robots" content="noindex, nofollow">`（app/layout.tsx）で行う。
 * 以前は robots.txt で全面拒否していたが、分析サイトなどが読めなくなるため、
 * 検索に出ない対策は noindex だけに一本化した。
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" } };
}

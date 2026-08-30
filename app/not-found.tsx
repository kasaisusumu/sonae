import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md text-center">
      <h1 className="text-lg font-semibold">ページが見つかりません</h1>
      <p className="mt-2 text-sm text-muted">
        削除されたか、URL が正しくない可能性があります。
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white no-underline hover:bg-teal-dark"
      >
        ホームに戻る
      </Link>
    </div>
  );
}

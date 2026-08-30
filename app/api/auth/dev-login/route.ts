import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { setSession } from "@/lib/session";
import { ensureDefaultCategories } from "@/lib/categories";
import { isDevLoginEnabled, DEV_USER_EMAIL } from "@/lib/dev-login";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isDevLoginEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const user = await prisma.user.upsert({
    where: { email: DEV_USER_EMAIL },
    update: {},
    create: { email: DEV_USER_EMAIL, name: "テストユーザー" },
  });

  await ensureDefaultCategories(user.id);
  await setSession(user.id);

  const base = process.env.APP_BASE_URL || req.nextUrl.origin;
  return NextResponse.redirect(`${base}/events`);
}

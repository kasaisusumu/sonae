import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
];

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} が未設定です。.env を確認してください。`);
  return v;
}

export function makeOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    required("GOOGLE_CLIENT_ID"),
    required("GOOGLE_CLIENT_SECRET"),
    required("GOOGLE_REDIRECT_URI"),
  );
}

/** Google 同意画面の URL。ログインとカレンダー読み取り許可を 1 回で取得する。 */
export function buildConsentUrl(state: string): string {
  return makeOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // refresh_token を確実に得るため
    scope: GOOGLE_SCOPES,
    include_granted_scopes: true,
    state,
  });
}

export interface GoogleProfile {
  email: string;
  name?: string;
}

/** 認可コードをトークンに交換し、プロフィールも取得する。 */
export async function exchangeCode(code: string): Promise<{
  profile: GoogleProfile;
  accessToken: string;
  refreshToken: string | null;
  expiryDate: Date | null;
}> {
  const client = makeOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();

  if (!data.email) throw new Error("Google からメールアドレスを取得できませんでした。");

  return {
    profile: { email: data.email, name: data.name ?? undefined },
    accessToken: tokens.access_token ?? "",
    refreshToken: tokens.refresh_token ?? null,
    expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  };
}

/**
 * ユーザーの保存済みトークンから Calendar クライアントを作る。
 * アクセストークンが自動更新されたら DB に書き戻す。
 */
export async function getCalendarClient(userId: string) {
  const account = await prisma.userGoogleAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Google アカウントが未接続です。");

  const client = makeOAuthClient();
  client.setCredentials({
    access_token: account.accessToken,
    refresh_token: account.refreshToken ?? undefined,
    expiry_date: account.tokenExpiry ? account.tokenExpiry.getTime() : undefined,
  });

  client.on("tokens", (tokens) => {
    void prisma.userGoogleAccount
      .update({
        where: { userId },
        data: {
          ...(tokens.access_token ? { accessToken: tokens.access_token } : {}),
          ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
          ...(tokens.expiry_date
            ? { tokenExpiry: new Date(tokens.expiry_date) }
            : {}),
        },
      })
      .catch(() => {});
  });

  return { calendar: google.calendar({ version: "v3", auth: client }), account };
}

export interface FetchedEvent {
  googleEventId: string;
  title: string;
  description: string | null;
  start: Date;
  end: Date | null;
}

/** 直近〜将来の予定を取得する（過去 1 日 〜 先 60 日）。 */
export async function fetchUpcomingEvents(userId: string): Promise<{
  events: FetchedEvent[];
  calendarId: string;
}> {
  const { calendar, account } = await getCalendarClient(userId);
  const timeMin = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
  const timeMax = new Date(
    Date.now() + 1000 * 60 * 60 * 24 * 60,
  ).toISOString();

  const res = await calendar.events.list({
    calendarId: account.calendarId || "primary",
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 100,
  });

  const events: FetchedEvent[] = [];
  for (const item of res.data.items ?? []) {
    if (!item.id || item.status === "cancelled") continue;
    const startRaw = item.start?.dateTime ?? item.start?.date;
    if (!startRaw) continue;
    const endRaw = item.end?.dateTime ?? item.end?.date ?? null;
    events.push({
      googleEventId: item.id,
      title: item.summary?.trim() || "(タイトルなし)",
      description: item.description?.trim() || null,
      start: new Date(startRaw),
      end: endRaw ? new Date(endRaw) : null,
    });
  }

  return { events, calendarId: account.calendarId || "primary" };
}

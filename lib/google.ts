import crypto from "node:crypto";
import { google, type calendar_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export const CALENDAR_READ_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";
export const CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  CALENDAR_READ_SCOPE,
];

/** 説明欄書き込みを有効にするとき用の追加スコープ込み。 */
export const GOOGLE_SCOPES_WITH_WRITE = [...GOOGLE_SCOPES, CALENDAR_EVENTS_SCOPE];

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

/**
 * Google 同意画面の URL。
 * withWrite=true のときは calendar.events（予定の編集）も要求する。
 */
export function buildConsentUrl(state: string, withWrite = false): string {
  return makeOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // refresh_token を確実に得るため
    scope: withWrite ? GOOGLE_SCOPES_WITH_WRITE : GOOGLE_SCOPES,
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
  canWriteEvents: boolean;
}> {
  const client = makeOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();

  if (!data.email) throw new Error("Google からメールアドレスを取得できませんでした。");

  const grantedScopes = (tokens.scope ?? "").split(/\s+/);

  return {
    profile: { email: data.email, name: data.name ?? undefined },
    accessToken: tokens.access_token ?? "",
    refreshToken: tokens.refresh_token ?? null,
    expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    canWriteEvents: grantedScopes.includes(CALENDAR_EVENTS_SCOPE),
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
  recurringEventId: string | null;
  title: string;
  description: string | null;
  start: Date;
  end: Date | null;
}

export interface CalendarChanges {
  upserts: FetchedEvent[];
  deletedIds: string[];
  nextSyncToken: string | null;
  wasFullSync: boolean;
}

function toFetched(item: calendar_v3.Schema$Event): FetchedEvent | null {
  const startRaw = item.start?.dateTime ?? item.start?.date;
  if (!item.id || !startRaw) return null;
  const endRaw = item.end?.dateTime ?? item.end?.date ?? null;
  return {
    googleEventId: item.id,
    recurringEventId: item.recurringEventId ?? null,
    title: item.summary?.trim() || "(タイトルなし)",
    description: item.description?.trim() || null,
    start: new Date(startRaw),
    end: endRaw ? new Date(endRaw) : null,
  };
}

/**
 * 前回の syncToken があれば差分だけ、無ければ直近〜先60日を全件取得する。
 * syncToken 失効(410)時は自動で全件取得にフォールバック。
 */
export async function fetchCalendarChanges(userId: string): Promise<CalendarChanges> {
  const { calendar, account } = await getCalendarClient(userId);
  const calendarId = account.calendarId || "primary";

  async function run(syncToken: string | null): Promise<CalendarChanges> {
    const upserts: FetchedEvent[] = [];
    const deletedIds: string[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;

    do {
      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId,
        singleEvents: true,
        showDeleted: true,
        maxResults: 250,
        pageToken,
      };
      if (syncToken) {
        params.syncToken = syncToken;
      } else {
        params.timeMin = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
        params.timeMax = new Date(
          Date.now() + 1000 * 60 * 60 * 24 * 60,
        ).toISOString();
      }

      const res = await calendar.events.list(params);
      for (const item of res.data.items ?? []) {
        if (item.status === "cancelled") {
          if (item.id) deletedIds.push(item.id);
        } else {
          const f = toFetched(item);
          if (f) upserts.push(f);
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
      nextSyncToken = res.data.nextSyncToken ?? nextSyncToken;
    } while (pageToken);

    return { upserts, deletedIds, nextSyncToken, wasFullSync: !syncToken };
  }

  try {
    return await run(account.syncToken ?? null);
  } catch (err: unknown) {
    const e = err as { code?: number | string; response?: { status?: number } };
    const status = Number(e?.code ?? e?.response?.status ?? 0);
    if (account.syncToken && status === 410) {
      // syncToken 失効 → 全件でやり直し
      return run(null);
    }
    throw err;
  }
}

export interface CalendarChoice {
  id: string;
  summary: string;
  primary: boolean;
}

/** ユーザーが同期対象を選べるように、カレンダー一覧を返す。 */
export async function listCalendars(userId: string): Promise<CalendarChoice[]> {
  const { calendar } = await getCalendarClient(userId);
  const res = await calendar.calendarList.list({ maxResults: 100 });
  return (res.data.items ?? [])
    .filter((c): c is typeof c & { id: string } => Boolean(c.id))
    .map((c) => ({
      id: c.id,
      summary: c.summaryOverride || c.summary || c.id,
      primary: Boolean(c.primary),
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

// ── Google Calendar push 通知（watch チャンネル）────────────────

/** webhook で本人確認するための共有トークン（チャンネルごと固定）。 */
function watchToken(userId: string): string {
  const secret = process.env.CRON_SECRET || process.env.SESSION_SECRET || "sonae";
  return crypto.createHmac("sha256", secret).update(`watch:${userId}`).digest("hex");
}

export function verifyWatchToken(userId: string, token: string | null): boolean {
  if (!token) return false;
  const expected = watchToken(userId);
  return (
    token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  );
}

/**
 * カレンダー変更の push 通知チャンネルを（再）登録する。
 * ドメイン未確認などで失敗しても throw せず false を返す（ポーリングが保険）。
 */
export async function ensureWatch(userId: string): Promise<boolean> {
  const { calendar, account } = await getCalendarClient(userId);

  // まだ十分先まで有効なら何もしない（期限切れで push が止まらないよう 48h 前に張り直す）
  if (
    account.watchChannelId &&
    account.watchExpiration &&
    account.watchExpiration.getTime() - Date.now() > 1000 * 60 * 60 * 48
  ) {
    return true;
  }

  // 古いチャンネルを止める（ベストエフォート）
  if (account.watchChannelId && account.watchResourceId) {
    try {
      await calendar.channels.stop({
        requestBody: {
          id: account.watchChannelId,
          resourceId: account.watchResourceId,
        },
      });
    } catch {
      /* ignore */
    }
  }

  const channelId = crypto.randomUUID();
  try {
    const res = await calendar.events.watch({
      calendarId: account.calendarId || "primary",
      requestBody: {
        id: channelId,
        type: "web_hook",
        address: `${appBaseUrl()}/api/google/webhook`,
        token: watchToken(userId),
        params: { ttl: `${60 * 60 * 24 * 7}` }, // 7 日
      },
    });
    const expMs = res.data.expiration ? Number(res.data.expiration) : Date.now() + 6 * 864e5;
    await prisma.userGoogleAccount.update({
      where: { userId },
      data: {
        watchChannelId: channelId,
        watchResourceId: res.data.resourceId ?? null,
        watchExpiration: new Date(expMs),
      },
    });
    return true;
  } catch (err) {
    console.error("[google] events.watch 登録に失敗（ポーリングで代替）:", err);
    await prisma.userGoogleAccount.update({
      where: { userId },
      data: {
        watchChannelId: null,
        watchResourceId: null,
        watchExpiration: null,
      },
    });
    return false;
  }
}

/**
 * 予定の説明欄を書き換える（calendar.events スコープが必要）。
 * 権限不足などで失敗しても throw せず false を返す。
 */
export async function writeEventDescription(
  userId: string,
  googleEventId: string,
  description: string,
): Promise<boolean> {
  try {
    const { calendar, account } = await getCalendarClient(userId);
    await calendar.events.patch({
      calendarId: account.calendarId || "primary",
      eventId: googleEventId,
      requestBody: { description },
    });
    return true;
  } catch (err) {
    console.error("[google] 説明欄の書き込みに失敗:", err);
    return false;
  }
}

/** 連携解除時などに watch を止める。 */
export async function stopWatch(userId: string): Promise<void> {
  const account = await prisma.userGoogleAccount.findUnique({ where: { userId } });
  if (!account?.watchChannelId || !account.watchResourceId) return;
  try {
    const { calendar } = await getCalendarClient(userId);
    await calendar.channels.stop({
      requestBody: {
        id: account.watchChannelId,
        resourceId: account.watchResourceId,
      },
    });
  } catch {
    /* ignore */
  }
}

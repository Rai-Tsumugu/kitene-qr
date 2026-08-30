import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {
  isSupportScope,
  isoAfter,
  randomId,
  randomToken,
  requestFingerprint,
  sha256,
  timingSafeEqual,
  type SupportScope,
} from "./core";

type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
  DEMO_ADMIN_SECRET?: string;
  ENVIRONMENT: "local" | "staging" | "production";
  BUILD_REVISION: string;
};

type App = { Bindings: Bindings };
type AppContext = Context<App>;

type Invite = {
  id: string;
  event_title: string;
  event_starts_at: string;
  meeting_time_label: string;
  meeting_place_label: string;
  signal_label: string;
  state: "open" | "requested" | "confirmed" | "declined" | "expired";
  selected_scope: SupportScope | null;
  revision: number;
  expires_at: string;
  updated_at: string;
};

type Role = "admin" | "host" | "participant";

type Session = {
  id_hash: string;
  invite_id: string | null;
  role: Role;
  expires_at: string;
  revoked_at: string | null;
};

const COOKIE_BY_ROLE: Record<Role, string> = {
  admin: "meetqr_admin",
  host: "meetqr_host",
  participant: "meetqr_participant",
};

const CREATOR_COOKIE = "meetqr_creator";

const app = new Hono<App>();

app.use("*", async (context, next) => {
  const requestOrigin = context.req.header("Origin");
  if (
    requestOrigin &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(context.req.method) &&
    requestOrigin !== new URL(context.req.url).origin
  ) {
    return apiError(context, 403, "ORIGIN_NOT_ALLOWED", "許可されていない送信元です。", false);
  }

  await next();
  context.header("Referrer-Policy", "no-referrer");
  context.header("X-Content-Type-Options", "nosniff");
  context.header("X-Frame-Options", "DENY");
  context.header("Cache-Control", "no-store");
  context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
});

app.get("/api/health", async (context) => {
  try {
    const row = await context.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    if (row?.ok !== 1) return apiError(context, 503, "DATABASE_UNAVAILABLE", "DBを確認できません。", true);
    return apiSuccess(context, {
      status: "ok",
      db: "ok",
      environment: context.env.ENVIRONMENT,
      buildRevision: context.env.BUILD_REVISION,
    });
  } catch {
    return apiError(context, 503, "DATABASE_UNAVAILABLE", "DBを確認できません。", true);
  }
});

app.post("/api/admin/session", async (context) => {
  await enforceRateLimit(context.env.DB, `admin-login:${context.env.ENVIRONMENT}`, 10);
  const body = await readJson(context);
  const secret = typeof body.secret === "string" ? body.secret : "";
  const expected = context.env.DEMO_ADMIN_SECRET ?? "";
  if (!expected) return apiError(context, 503, "ADMIN_NOT_CONFIGURED", "管理設定がありません。", false);
  if (secret.length > 256 || !timingSafeEqual(await sha256(secret), await sha256(expected))) {
    return apiError(context, 401, "INVALID_ADMIN_SECRET", "認証できません。", false);
  }

  const token = randomToken();
  await insertSession(context.env.DB, token, "admin", null, 30);
  setRoleCookie(context, "admin", token, 30);
  return apiSuccess(context, { authenticated: true });
});

app.get("/api/admin/status", async (context) => {
  const session = await requireSession(context, "admin");
  if (session instanceof Response) return session;
  return apiSuccess(context, { authenticated: true });
});

app.get("/join/:token", async (context) => {
  const token = context.req.param("token");
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return privateNotFound();
  const tokenHash = await sha256(token);
  const invite = await context.env.DB
    .prepare(
      `SELECT id, event_title, event_starts_at, meeting_time_label, meeting_place_label,
        signal_label, state, selected_scope, revision, expires_at, updated_at
       FROM invites WHERE invite_token_hash = ?1`,
    )
    .bind(tokenHash)
    .first<Invite>();
  if (!invite) return privateNotFound();
  if (invite.state === "expired" || invite.expires_at <= new Date().toISOString()) {
    await expireInvite(context.env.DB, invite.id);
    return apiError(context, 410, "INVITE_UNAVAILABLE", "この招待は利用できません。", false);
  }

  const participantToken = randomToken();
  const minutesRemaining = Math.min(60, Math.max(
    1,
    Math.floor((Date.parse(invite.expires_at) - Date.now()) / 60_000),
  ));
  await insertSession(context.env.DB, participantToken, "participant", invite.id, minutesRemaining);
  setRoleCookie(context, "participant", participantToken, minutesRemaining);
  return context.redirect(`/invite/${invite.id}`, 303);
});

app.get("/api/host/demo", async (context) => {
  const session = await requireSession(context, "host");
  if (session instanceof Response) return session;
  const invite = await requireActiveInvite(context, session);
  if (invite instanceof Response) return invite;
  return apiSuccess(context, { invite: publicInvite(invite) });
});

app.get("/api/participant/invite", async (context) => {
  const session = await requireSession(context, "participant");
  if (session instanceof Response) return session;
  const invite = await requireActiveInvite(context, session, true);
  if (invite instanceof Response) return invite;
  return apiSuccess(context, { invite: publicInvite(invite) });
});

app.post("/api/participant/respond", async (context) => {
  const session = await requireSession(context, "participant");
  if (session instanceof Response) return session;
  const invite = await requireActiveInvite(context, session);
  if (invite instanceof Response) return invite;

  const body = await readJson(context);
  const selection = body.selection;
  const revision = body.revision;
  const idempotencyKey = context.req.header("Idempotency-Key") ?? "";
  if (!validIdempotencyKey(idempotencyKey)) {
    return apiError(context, 400, "INVALID_IDEMPOTENCY_KEY", "操作識別子が不正です。", false);
  }

  const payload = { selection, revision };
  const fingerprint = await requestFingerprint(payload);
  const replay = await findReplay(context.env.DB, invite.id, "participant", idempotencyKey);
  if (replay) return replayResponse(context, replay, fingerprint);
  await enforceRateLimit(context.env.DB, `participant-write:${invite.id}`, 5);
  if (!isSupportScope(selection) || typeof revision !== "number" || !Number.isInteger(revision)) {
    return apiError(context, 400, "INVALID_REQUEST", "入力が不正です。", false);
  }

  const resultingState = selection === "decline" ? "declined" : "requested";
  const response = {
    ok: true,
    data: {
      invite: {
        ...publicInvite(invite),
        state: resultingState,
        selectedScope: selection,
      },
    },
  };

  return insertInteraction(context, {
    invite,
    actorRole: "participant",
    action: selection === "decline" ? "decline" : "respond",
    selectedScope: selection,
    expectedRevision: revision,
    resultingState,
    resultingRevision: revision,
    idempotencyKey,
    fingerprint,
    response,
  });
});

app.post("/api/host/confirm", async (context) => {
  const session = await requireSession(context, "host");
  if (session instanceof Response) return session;
  const invite = await requireActiveInvite(context, session);
  if (invite instanceof Response) return invite;

  const body = await readJson(context);
  const revision = body.revision;
  const idempotencyKey = context.req.header("Idempotency-Key") ?? "";
  if (!validIdempotencyKey(idempotencyKey)) {
    return apiError(context, 400, "INVALID_IDEMPOTENCY_KEY", "操作識別子が不正です。", false);
  }

  const payload = { revision, action: "confirm" };
  const fingerprint = await requestFingerprint(payload);
  const replay = await findReplay(context.env.DB, invite.id, "host", idempotencyKey);
  if (replay) return replayResponse(context, replay, fingerprint);
  await enforceRateLimit(context.env.DB, `host-confirm:${invite.id}`, 5);
  if (typeof revision !== "number" || !Number.isInteger(revision)) {
    return apiError(context, 400, "INVALID_REQUEST", "入力が不正です。", false);
  }

  const response = {
    ok: true,
    data: {
      invite: {
        ...publicInvite(invite),
        state: "confirmed",
        revision: revision + 1,
      },
    },
  };
  return insertInteraction(context, {
    invite,
    actorRole: "host",
    action: "confirm",
    selectedScope: null,
    expectedRevision: revision,
    resultingState: "confirmed",
    resultingRevision: revision + 1,
    idempotencyKey,
    fingerprint,
    response,
  });
});

app.post("/api/invites", async (context) => {
  const idempotencyKey = context.req.header("Idempotency-Key") ?? "";
  if (!validIdempotencyKey(idempotencyKey)) {
    return apiError(context, 400, "INVALID_IDEMPOTENCY_KEY", "操作識別子が不正です。", false);
  }

  const body = await readJson(context);
  const eventTitle = typeof body.eventTitle === "string" ? body.eventTitle : "";
  const eventStartsAt = typeof body.eventStartsAt === "string" ? body.eventStartsAt : "";
  const meetingTime = typeof body.meetingTime === "string" ? body.meetingTime : "";
  const meetingPlace = typeof body.meetingPlace === "string" ? body.meetingPlace : "";
  const signal = typeof body.signal === "string" ? body.signal : "";
  if (
    eventTitle.length < 1 || eventTitle.length > 80 ||
    meetingTime.length < 1 || meetingTime.length > 40 ||
    meetingPlace.length < 1 || meetingPlace.length > 80 ||
    signal.length < 1 || signal.length > 40 ||
    Number.isNaN(Date.parse(eventStartsAt))
  ) {
    return apiError(context, 400, "INVALID_REQUEST", "入力が不正です。", false);
  }

  let creatorToken = getCookie(context, CREATOR_COOKIE);
  const issueCreatorCookie = !creatorToken;
  if (!creatorToken) creatorToken = randomToken();
  const creatorHash = await sha256(creatorToken);

  const fingerprint = await requestFingerprint({ eventTitle, eventStartsAt, meetingTime, meetingPlace, signal });
  const existing = await findInviteCreationReplay(context.env.DB, idempotencyKey);
  if (existing) {
    if (issueCreatorCookie) setCreatorCookie(context, creatorToken);
    return replayInviteCreation(context, existing, fingerprint);
  }

  await enforceRateLimit(context.env.DB, `invite-create:${creatorHash}`, 5);

  const now = new Date().toISOString();
  const expiresAt = isoAfter(120);
  const hostExpiresAt = isoAfter(60);
  const inviteId = randomId();
  const inviteToken = randomToken();
  const manageToken = randomToken();
  const hostToken = randomToken();
  const inviteTokenHash = await sha256(inviteToken);
  const manageTokenHash = await sha256(manageToken);
  const hostTokenHash = await sha256(hostToken);
  const origin = new URL(context.req.url).origin;
  const response = {
    ok: true,
    data: {
      inviteId,
      participantJoinUrl: `${origin}/join/${inviteToken}`,
      manageUrl: `${origin}/manage/${manageToken}`,
      hostPath: `/host/${inviteId}`,
    },
  };

  try {
    await context.env.DB.batch([
      context.env.DB
        .prepare(
          `INSERT INTO invites (
            id, invite_token_hash, manage_token_hash, event_title, event_starts_at,
            meeting_time_label, meeting_place_label, signal_label, state, revision,
            expires_at, created_at, updated_at, demo_key, created_via
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'open', 1, ?9, ?10, ?10, ?11, 'self_serve')`,
        )
        .bind(
          inviteId,
          inviteTokenHash,
          manageTokenHash,
          eventTitle,
          eventStartsAt,
          meetingTime,
          meetingPlace,
          signal,
          expiresAt,
          now,
          `self-serve:${inviteId}`,
        ),
      context.env.DB
        .prepare(
          "INSERT INTO sessions (id_hash, invite_id, role, expires_at, created_at) VALUES (?1, ?2, 'host', ?3, ?4)",
        )
        .bind(hostTokenHash, inviteId, hostExpiresAt, now),
      context.env.DB
        .prepare(
          `INSERT INTO invite_creation_keys (
            idempotency_key, invite_id, request_fingerprint, response_json, host_expires_at, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(idempotencyKey, inviteId, fingerprint, JSON.stringify(response), hostExpiresAt, now),
    ]);
  } catch (error) {
    const raced = await findInviteCreationReplay(context.env.DB, idempotencyKey);
    if (raced) {
      if (issueCreatorCookie) setCreatorCookie(context, creatorToken);
      return replayInviteCreation(context, raced, fingerprint);
    }
    throw error;
  }

  if (issueCreatorCookie) setCreatorCookie(context, creatorToken);
  setRoleCookie(context, "host", hostToken, 60);
  return apiSuccess(context, response.data);
});

app.get("/manage/:manageToken", async (context) => {
  const token = context.req.param("manageToken");
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return privateNotFound();
  const tokenHash = await sha256(token);
  const invite = await context.env.DB
    .prepare("SELECT id, state, expires_at FROM invites WHERE manage_token_hash = ?1")
    .bind(tokenHash)
    .first<{ id: string; state: Invite["state"]; expires_at: string }>();
  if (!invite) return privateNotFound();
  if (invite.state === "expired" || invite.expires_at <= new Date().toISOString()) {
    await expireInvite(context.env.DB, invite.id);
    return apiError(context, 410, "INVITE_UNAVAILABLE", "この招待は利用できません。", false);
  }

  const hostToken = randomToken();
  const minutesRemaining = Math.min(60, Math.max(
    1,
    Math.floor((Date.parse(invite.expires_at) - Date.now()) / 60_000),
  ));
  await insertSession(context.env.DB, hostToken, "host", invite.id, minutesRemaining);
  setRoleCookie(context, "host", hostToken, minutesRemaining);
  return context.redirect(`/host/${invite.id}`, 303);
});

app.post("/api/admin/invites/:id/expire", async (context) => {
  const admin = await requireSession(context, "admin");
  if (admin instanceof Response) return admin;
  await expireInvite(context.env.DB, context.req.param("id"));
  return apiSuccess(context, { expired: true });
});

app.all("*", (context) => context.env.ASSETS.fetch(context.req.raw));

app.onError((error, context) => {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("rate_limited")) {
    context.header("Retry-After", String(secondsUntilNextRateWindow()));
    return apiError(context, 429, "RATE_LIMITED", "操作が多すぎます。", true);
  }
  if (message.includes("stale_transition") || message.includes("UNIQUE constraint failed")) {
    return apiError(context, 409, "STALE_STATE", "別の操作が先に反映されました。", true);
  }
  return apiError(context, 500, "INTERNAL_ERROR", "処理を完了できませんでした。", true);
});

async function readJson(context: AppContext) {
  try {
    return (await context.req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function insertSession(
  db: D1Database,
  token: string,
  role: Role,
  inviteId: string | null,
  durationMinutes: number,
) {
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO sessions (id_hash, invite_id, role, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(await sha256(token), inviteId, role, isoAfter(durationMinutes), now)
    .run();
}

function setRoleCookie(context: AppContext, role: Role, token: string, durationMinutes: number) {
  setCookie(context, COOKIE_BY_ROLE[role], token, {
    httpOnly: true,
    secure: context.env.ENVIRONMENT !== "local",
    sameSite: "Strict",
    path: "/",
    maxAge: durationMinutes * 60,
  });
}

async function requireSession(context: AppContext, role: Role): Promise<Session | Response> {
  const token = getCookie(context, COOKIE_BY_ROLE[role]);
  if (!token) return apiError(context, 401, "AUTHENTICATION_REQUIRED", "認証が必要です。", false);
  const session = await context.env.DB
    .prepare(
      `SELECT id_hash, invite_id, role, expires_at, revoked_at FROM sessions
       WHERE id_hash = ?1 AND role = ?2 AND revoked_at IS NULL AND expires_at > ?3`,
    )
    .bind(await sha256(token), role, new Date().toISOString())
    .first<Session>();
  return session ?? apiError(context, 401, "SESSION_EXPIRED", "sessionが無効です。", false);
}

async function requireActiveInvite(
  context: AppContext,
  session: Session,
  allowExpiredState = false,
): Promise<Invite | Response> {
  if (!session.invite_id) return apiError(context, 404, "INVITE_NOT_FOUND", "招待が見つかりません。", false);
  const invite = await getInvite(context.env.DB, session.invite_id);
  if (!invite) return apiError(context, 404, "INVITE_NOT_FOUND", "招待が見つかりません。", false);
  if (invite.expires_at <= new Date().toISOString()) {
    await expireInvite(context.env.DB, invite.id);
    return apiError(context, 410, "INVITE_UNAVAILABLE", "この招待は利用できません。", false);
  }
  if (invite.state === "expired" && !allowExpiredState) {
    return apiError(context, 410, "INVITE_UNAVAILABLE", "この招待は利用できません。", false);
  }
  return invite;
}

async function getInvite(db: D1Database, id: string): Promise<Invite | null> {
  return db
    .prepare(
      `SELECT id, event_title, event_starts_at, meeting_time_label, meeting_place_label,
        signal_label, state, selected_scope, revision, expires_at, updated_at
       FROM invites WHERE id = ?1`,
    )
    .bind(id)
    .first<Invite>();
}

async function expireInvite(db: D1Database, id: string) {
  const now = new Date().toISOString();
  await db
    .prepare("UPDATE invites SET state = 'expired', updated_at = ?2 WHERE id = ?1 AND state != 'expired'")
    .bind(id, now)
    .run();
}

function publicInvite(invite: Invite) {
  return {
    id: invite.id,
    eventTitle: invite.event_title,
    eventStartsAt: invite.event_starts_at,
    meetingTime: invite.meeting_time_label,
    meetingPlace: invite.meeting_place_label,
    signal: invite.signal_label,
    state: invite.state,
    selectedScope: invite.selected_scope,
    revision: invite.revision,
    expiresAt: invite.expires_at,
    updatedAt: invite.updated_at,
  };
}

async function enforceRateLimit(db: D1Database, scopeKey: string, limit: number) {
  const now = Date.now();
  const windowStart = Math.floor(now / 600_000) * 600_000;
  const row = await db
    .prepare(
      `INSERT INTO rate_buckets (scope_key, window_start, count, updated_at)
       VALUES (?1, ?2, 1, ?3)
       ON CONFLICT(scope_key, window_start)
       DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
       RETURNING count`,
    )
    .bind(scopeKey, windowStart, new Date(now).toISOString())
    .first<{ count: number }>();
  if (!row || row.count > limit) throw new Error("rate_limited");
}

type Replay = { request_fingerprint: string; response_json: string };

async function findReplay(
  db: D1Database,
  inviteId: string,
  actorRole: "host" | "participant",
  idempotencyKey: string,
) {
  return db
    .prepare(
      `SELECT request_fingerprint, response_json FROM interactions
       WHERE invite_id = ?1 AND actor_role = ?2 AND idempotency_key = ?3`,
    )
    .bind(inviteId, actorRole, idempotencyKey)
    .first<Replay>();
}

function replayResponse(context: AppContext, replay: Replay, fingerprint: string) {
  if (replay.request_fingerprint !== fingerprint) {
    return apiError(context, 409, "IDEMPOTENCY_CONFLICT", "同じ操作識別子が別の入力に使われました。", false);
  }
  return context.json(JSON.parse(replay.response_json));
}

function validIdempotencyKey(value: string) {
  return /^[A-Za-z0-9_-]{16,120}$/u.test(value);
}

type InteractionInput = {
  invite: Invite;
  actorRole: "host" | "participant";
  action: "respond" | "decline" | "confirm";
  selectedScope: SupportScope | null;
  expectedRevision: number;
  resultingState: "requested" | "confirmed" | "declined";
  resultingRevision: number;
  idempotencyKey: string;
  fingerprint: string;
  response: Record<string, unknown>;
};

async function insertInteraction(context: AppContext, input: InteractionInput) {
  try {
    await context.env.DB
      .prepare(
        `INSERT INTO interactions (
          id, invite_id, actor_role, action, selected_scope, expected_revision,
          resulting_state, resulting_revision, idempotency_key, request_fingerprint,
          response_json, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      )
      .bind(
        randomId(),
        input.invite.id,
        input.actorRole,
        input.action,
        input.selectedScope,
        input.expectedRevision,
        input.resultingState,
        input.resultingRevision,
        input.idempotencyKey,
        input.fingerprint,
        JSON.stringify(input.response),
        new Date().toISOString(),
      )
      .run();
    return context.json(input.response);
  } catch (error) {
    const replay = await findReplay(
      context.env.DB,
      input.invite.id,
      input.actorRole,
      input.idempotencyKey,
    );
    if (replay) return replayResponse(context, replay, input.fingerprint);
    throw error;
  }
}

function setCreatorCookie(context: AppContext, token: string) {
  setCookie(context, CREATOR_COOKIE, token, {
    httpOnly: true,
    secure: context.env.ENVIRONMENT !== "local",
    sameSite: "Strict",
    path: "/",
    maxAge: 90 * 24 * 60 * 60,
  });
}

type InviteCreationReplay = { request_fingerprint: string; response_json: string };

async function findInviteCreationReplay(db: D1Database, idempotencyKey: string) {
  return db
    .prepare(
      `SELECT request_fingerprint, response_json FROM invite_creation_keys WHERE idempotency_key = ?1`,
    )
    .bind(idempotencyKey)
    .first<InviteCreationReplay>();
}

function replayInviteCreation(context: AppContext, replay: InviteCreationReplay, fingerprint: string) {
  if (replay.request_fingerprint !== fingerprint) {
    return apiError(context, 409, "IDEMPOTENCY_CONFLICT", "同じ操作識別子が別の入力に使われました。", false);
  }
  return context.json(JSON.parse(replay.response_json));
}

function privateNotFound() {
  return new Response(JSON.stringify({
    ok: false,
    error: { code: "INVITE_NOT_FOUND", message: "招待が見つかりません。", retryable: false },
  }), {
    status: 404,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function apiSuccess(context: AppContext, data: Record<string, unknown>) {
  return context.json({ ok: true, data });
}

function apiError(
  context: AppContext,
  status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 500 | 503,
  code: string,
  message: string,
  retryable: boolean,
) {
  return context.json({ ok: false, error: { code, message, retryable } }, status);
}

function secondsUntilNextRateWindow() {
  const remainder = 600 - Math.floor((Date.now() / 1000) % 600);
  return Math.min(600, Math.max(1, remainder));
}

export default app;

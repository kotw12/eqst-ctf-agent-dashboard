import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE = "eqst_session";
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const BLOCK_MS = 60 * 1000;

type Attempt = { failures: number; blockedUntil: number };
type Session = { user: string; expiresAt: number };
type Account = { user: string; userHash: Buffer; passwordHash: Buffer };

type AuthRequest = {
  headers: { cookie?: string };
  socket: { remoteAddress?: string };
};
type AuthResponse = {
  setHeader(name: string, value: string): unknown;
};
function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}
function equalSecret(value: string, expected: Buffer) {
  return timingSafeEqual(digest(value), expected);
}
function cookieValue(request: AuthRequest) {
  for (const part of (request.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === COOKIE)
      return part.slice(separator + 1).trim();
  }
  return "";
}

export class DashboardAuth {
  private readonly sessions = new Map<string, Session>();
  private readonly attempts = new Map<string, Attempt>();
  private readonly accounts: Account[];
  private readonly secureCookie: boolean;

  constructor(
    user = process.env.AUTH_USER || "eqst",
    password = process.env.AUTH_PASSWORD || "eqst",
    secureCookie = process.env.AUTH_SECURE_COOKIE === "1",
  ) {
    // AUTH_USERS="id:password,id2:password2"가 있으면 그 계정들을, 없으면 AUTH_USER/AUTH_PASSWORD 하나를 쓴다
    const pairs = (process.env.AUTH_USERS || "")
      .split(",")
      .map((entry) => entry.trim())
      .map((entry): [string, string] => {
        const separator = entry.indexOf(":");
        return separator > 0 ? [entry.slice(0, separator), entry.slice(separator + 1)] : ["", ""];
      })
      .filter(([id, secret]) => id !== "" && secret !== "");
    const accounts: [string, string][] = pairs.length ? pairs : [[user, password]];
    this.accounts = accounts.map(([id, secret]) => ({
      user: id,
      userHash: digest(id),
      passwordHash: digest(secret),
    }));
    this.secureCookie = secureCookie;
  }

  private prune(now = Date.now()) {
    for (const [token, session] of this.sessions)
      if (session.expiresAt <= now) this.sessions.delete(token);
    for (const [address, attempt] of this.attempts)
      if (attempt.blockedUntil && attempt.blockedUntil <= now)
        this.attempts.delete(address);
  }

  private session(request: AuthRequest) {
    this.prune();
    const token = cookieValue(request);
    const session = token ? this.sessions.get(token) : undefined;
    if (!session || session.expiresAt <= Date.now()) return undefined;
    return session;
  }

  status(request: AuthRequest) {
    const session = this.session(request);
    return { authenticated: !!session, user: session?.user };
  }

  login(
    request: AuthRequest,
    response: AuthResponse,
    id: string,
    password: string,
  ) {
    const address = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    const attempt = this.attempts.get(address) || {
      failures: 0,
      blockedUntil: 0,
    };
    if (attempt.blockedUntil > now)
      return {
        ok: false,
        retryAfter: Math.ceil((attempt.blockedUntil - now) / 1000),
      };
    if (attempt.blockedUntil) {
      attempt.failures = 0;
      attempt.blockedUntil = 0;
    }
    // 모든 계정을 끝까지 비교해, 어느 계정이 맞았는지 응답 시간으로 드러나지 않게 한다
    let account: Account | undefined;
    for (const candidate of this.accounts) {
      const validUser = equalSecret(id, candidate.userHash);
      const validPassword = equalSecret(password, candidate.passwordHash);
      if (validUser && validPassword) account = candidate;
    }
    const valid = account !== undefined;
    if (!valid) {
      attempt.failures++;
      if (attempt.failures >= MAX_FAILURES) {
        attempt.failures = 0;
        attempt.blockedUntil = now + BLOCK_MS;
      }
      this.attempts.set(address, attempt);
      return {
        ok: false,
        retryAfter: attempt.blockedUntil ? Math.ceil(BLOCK_MS / 1000) : 0,
      };
    }
    this.attempts.delete(address);
    const previous = cookieValue(request);
    if (previous) this.sessions.delete(previous);
    if (this.sessions.size >= 64) {
      const oldest = this.sessions.keys().next().value;
      if (oldest) this.sessions.delete(oldest);
    }
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, { user: account!.user, expiresAt: now + SESSION_MS });
    response.setHeader(
      "Set-Cookie",
      `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${this.secureCookie ? "; Secure" : ""}`,
    );
    return { ok: true, retryAfter: 0 };
  }

  logout(request: AuthRequest, response: AuthResponse) {
    const token = cookieValue(request);
    if (token) this.sessions.delete(token);
    response.setHeader(
      "Set-Cookie",
      `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${this.secureCookie ? "; Secure" : ""}`,
    );
  }

  require(request: Request, response: Response, next: NextFunction) {
    if (this.session(request)) next();
    else response.status(401).json({ error: "로그인이 필요합니다." });
  }
}

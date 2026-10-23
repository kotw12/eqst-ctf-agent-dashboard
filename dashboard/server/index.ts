import express from "express";
import type { Request, Response, NextFunction } from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { configSchema, type LiveEvent } from "../shared/protocol.ts";
import { RunStore } from "./store.ts";
import { Runner } from "./runner.ts";
import { execute } from "./browser.ts";
import { mountArena } from "./arena.ts";
import { DashboardAuth } from "./auth.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);
const publicPort = Number(process.env.PUBLIC_PORT || port);
const bindHost = process.env.HOST?.trim() || "127.0.0.1";
const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN) : undefined;
if (publicOrigin && (
  !["http:", "https:"].includes(publicOrigin.protocol) ||
  publicOrigin.username || publicOrigin.password ||
  publicOrigin.pathname !== "/" || publicOrigin.search || publicOrigin.hash
)) throw new Error("PUBLIC_ORIGIN must be an HTTP(S) origin without a path or credentials");
const configuredPath = (value: string | undefined, fallback: string) => {
  if (value && !path.isAbsolute(value)) throw new Error("Configured storage paths must be absolute");
  return value || fallback;
};
const normalizeHost = (value: string) =>
  value
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
const configuredHosts = (process.env.ALLOWED_HOSTS || "").split(",");
const allowAnyHost = configuredHosts.some((value) => value.trim() === "*");
const allowedHosts = new Set(
  ["127.0.0.1", "::1", "localhost", bindHost, publicOrigin?.hostname || "", ...configuredHosts]
    .map(normalizeHost)
    .filter(
      (value) =>
        value && value !== "*" && value !== "0.0.0.0" && value !== "::",
    ),
);
for (const entries of Object.values(os.networkInterfaces()))
  for (const entry of entries || [])
    if (entry.family === "IPv4") allowedHosts.add(normalizeHost(entry.address));
const allowedHost = (value: string) =>
  allowAnyHost || allowedHosts.has(normalizeHost(value));
const allowedOrigin = (value: string) => {
  if (publicOrigin) return value === publicOrigin.origin;
  try {
    const origin = new URL(value);
    const originPort = Number(origin.port || 80);
    return (
      origin.protocol === "http:" &&
      (originPort === port || originPort === publicPort) &&
      allowedHost(origin.hostname)
    );
  } catch {
    return false;
  }
};
const app = express(),
  token = randomBytes(24).toString("hex");
const store = new RunStore(
  configuredPath(process.env.EQST_DATA_DIR, path.join(root, "data", "runs")),
  configuredPath(process.env.EQST_WORKSPACE_ROOT, path.dirname(root)),
);
const runner = new Runner(store);
const auth = new DashboardAuth();
const loginSchema = z.object({
  id: z.string().max(64),
  password: z.string().max(256),
});
const connectedBrowserSchema = z.array(
  z.object({
    instance_id: z.string(),
    label: z.string().optional(),
    browser_name: z.string().optional(),
  }),
);
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (!allowedHost(req.hostname)) {
    res.status(403).send("Configured host required");
    return;
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.headers.origin &&
    !allowedOrigin(req.headers.origin)
  ) {
    res.status(403).send("Same origin required");
    return;
  }
  next();
});
app.use(express.json({ limit: "24kb" }));
app.use("/api/auth", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.get("/api/auth/status", (req, res) => res.json(auth.status(req)));
app.post("/api/auth/login", (req, res) => {
  const credentials = loginSchema.parse(req.body);
  const result = auth.login(req, res, credentials.id, credentials.password);
  if (!result.ok) {
    if (result.retryAfter)
      res.setHeader("Retry-After", String(result.retryAfter));
    res.status(result.retryAfter ? 429 : 401).json({
      error: result.retryAfter
        ? `로그인 시도가 잠겼습니다. ${result.retryAfter}초 후 다시 시도하세요.`
        : "아이디 또는 비밀번호가 올바르지 않습니다.",
    });
    return;
  }
  res.json({ authenticated: true, user: credentials.id });
});
app.post("/api/auth/logout", (req, res) => {
  auth.logout(req, res);
  res.json({ ok: true });
});
app.use("/api", (req, res, next) => auth.require(req, res, next));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.headers["x-seal-live"] !== token) {
    res.status(403).json({ error: "대시보드를 새로고침하고 다시 시도하세요." });
    return;
  }
  next();
});
app.get("/api/bootstrap", (_req, res) =>
  res.json({ token, runs: store.list(), activeId: runner.activeId }),
);
app.get("/api/health", async (_req, res) => {
  const [seal, codex, browser] = await Promise.all([
    execute(process.env.SEAL_BIN || "seal", ["--version"]).catch(
      (e) => `Unavailable: ${String(e)}`,
    ),
    execute(process.env.CTF_CODEX_BIN || "codex", ["--version"]).catch(
      (e) => `Unavailable: ${String(e)}`,
    ),
    Promise.resolve(""),
  ]);
  const parsed = connectedBrowserSchema.safeParse(
    browser ? JSON.parse(browser) : [],
  );
  res.json({
    seal: seal.trim(),
    codex: codex.trim(),
    browser: parsed.success && parsed.data.length ? "connected" : "unavailable",
    connected: parsed.success ? parsed.data : [],
    activeId: runner.activeId,
  });
});
app.get("/api/runs", (_req, res) => res.json(store.list()));
app.post("/api/runs", (req, res) => {
  const config = configSchema.parse(req.body);
  // 이 배포에는 브라우저 도구(BSK)가 없으므로 브라우저 연결을 끄고, SEAL은 항상 --yolo로 실행한다
  config.browser = false;
  config.browserId = "";
  config.yolo = true;
  // Pod 안에서는 자기 공인 주소로 되돌아오는 연결이 막혀 있어, 공개 포털 주소는 같은 Pod의 로컬 포털로 바꾼다
  if (process.env.PORTAL_PUBLIC_HOST && new URL(config.url).hostname === process.env.PORTAL_PUBLIC_HOST)
    config.url = process.env.DEMO_CTF_URL || "http://127.0.0.1:18081";
  if (runner.activeId) {
    res
      .status(409)
      .json({ error: "한 번에 하나의 SEAL만 실행할 수 있습니다." });
    return;
  }
  if (config.demo) {
    // 로컬 데모는 같은 Pod의 EQST HAL 포털로 고정한다
    config.title = "EQST CTF";
    config.url = process.env.DEMO_CTF_URL || "http://127.0.0.1:18081";
    config.model = "gpt-6-sol";
    config.effort = "max";
  }
  res.status(201).json({ id: runner.create(config) });
});
app.get("/api/runs/:id", (req, res) =>
  res.json(store.get(String(req.params.id))),
);
app.get("/api/runs/:id/events", (req, res) => {
  const id = String(req.params.id);
  store.get(id);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const send = (event: LiveEvent) => {
    if (res.writableLength > 512 * 1024) {
      res.end();
      return;
    }
    res.write(
      `id: ${event.seq}\nevent: event\ndata: ${JSON.stringify(event)}\n\n`,
    );
  };
  const since = Number(req.headers["last-event-id"] || req.query.after || 0);
  for (const event of store.after(id, Number.isFinite(since) ? since : 0))
    send(event);
  store.on(id, send);
  const timer = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  req.on("close", () => {
    clearInterval(timer);
    store.off(id, send);
  });
});
app.post("/api/runs/:id/stop", (req, res) => {
  runner.stop(String(req.params.id));
  res.json({ ok: true });
});
app.post("/api/runs/:id/message", (req, res) => {
  const { message } = z
    .object({ message: z.string().trim().min(1).max(5000) })
    .parse(req.body);
  runner.steer(String(req.params.id), message);
  res.json({ ok: true });
});
app.post("/api/runs/:id/select-challenge", (req, res) => {
  const { challenge } = z
    .object({ challenge: z.string().trim().min(1).max(150) })
    .parse(req.body);
  runner.selectChallenge(String(req.params.id), challenge);
  res.json({ ok: true });
});
app.post("/api/runs/:id/submission-decision", (req, res) => {
  const { challenge, decision } = z
    .object({
      challenge: z.string().trim().min(1).max(150),
      decision: z.enum(["approved", "rejected"]),
    })
    .parse(req.body);
  runner.submissionDecision(String(req.params.id), challenge, decision);
  res.json({ ok: true });
});
app.get("/api/runs/:id/frame", (req, res) => {
  const file = path.join(store.dir(String(req.params.id)), "frame.webp");
  if (!fs.existsSync(file)) {
    res.status(404).end();
    return;
  }
  res.type("webp").sendFile(file);
});
app.get("/api/runs/:id/log", (req, res) => {
  store.get(String(req.params.id));
  const file = path.join(store.dir(String(req.params.id)), "native.jsonl");
  if (!fs.existsSync(file)) {
    res.status(404).json({ error: "실행 로그가 아직 없습니다." });
    return;
  }
  res.download(file, "seal-native.jsonl");
});
app.get("/api/runs/:id/artifact", (req, res) => {
  const workspace = fs.realpathSync(
    store.get(String(req.params.id)).meta.workspace,
  );
  const relative = z.string().max(1000).parse(req.query.path);
  const resolved = fs.realpathSync(path.resolve(workspace, relative));
  if (
    !resolved.startsWith(workspace + path.sep) ||
    !fs.statSync(resolved).isFile() ||
    fs.statSync(resolved).size > 5 * 1024 * 1024
  ) {
    res
      .status(403)
      .json({ error: "작업폴더 내부의 5 MiB 이하 파일만 읽을 수 있습니다." });
    return;
  }
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res
    .type("text/plain")
    .send(fs.readFileSync(resolved, "utf8").slice(0, 80000));
});
app.use("/arena", (req, res, next) => auth.require(req, res, next));
mountArena(app, store);
if (process.argv.includes("--production")) {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(root, "dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message =
    error instanceof z.ZodError
      ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n")
      : error instanceof Error
        ? error.message
        : "Request failed";
  res.status(400).json({ error: message.slice(0, 1500) });
});
const server = app.listen(port, bindHost, () =>
  console.log(`EQST CTF Agent ready at http://${bindHost}:${port}`),
);
for (const sig of ["SIGINT", "SIGTERM"])
  process.once(sig, () => {
    server.close();
    void runner.shutdown().finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 14000).unref();
  });

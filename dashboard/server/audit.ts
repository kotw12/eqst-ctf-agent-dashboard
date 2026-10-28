import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";

export type AuditEntry = {
  at: number;
  ip: string;
  country?: string;
  user: string;
  action: string;
  detail?: string;
  status?: number;
  agent?: string;
};

const KEEP = 5000;

// RunPod 프록시 앞단의 Cloudflare가 넣는 접속자 주소를 우선 쓰고, 없으면 연결 주소를 쓴다.
export function clientAddress(req: Request) {
  const header = (name: string) => {
    const value = req.headers[name];
    return (Array.isArray(value) ? value[0] : value)?.trim() || "";
  };
  return (
    header("cf-connecting-ip") ||
    header("x-forwarded-for").split(",")[0].trim() ||
    header("x-real-ip") ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

// API 경로를 관리자 화면에 보일 행위 이름으로 바꾼다. 화면 갱신용 조회는 기록하지 않는다.
function describe(method: string, url: string): { action: string; detail?: string } | undefined {
  const pathname = url.split("?")[0];
  const run = pathname.match(/^\/api\/runs\/([\da-f-]{36})(?:\/([\w-]+))?$/);
  if (method === "GET" && pathname === "/api/bootstrap") return { action: "대시보드 열기" };
  if (method === "POST" && pathname === "/api/runs") return { action: "실행 시작" };
  if (!run) return undefined;
  const [, id, sub] = run;
  const detail = id.slice(0, 8);
  if (method === "GET" && !sub) return { action: "실행 기록 열람", detail };
  if (method === "GET" && sub === "log") return { action: "실행 로그 내려받기", detail };
  if (method === "GET" && sub === "artifact") {
    const file = new URLSearchParams(url.split("?")[1] || "").get("path") || "";
    return { action: "작업 파일 열람", detail: `${detail} ${file}`.trim() };
  }
  if (method !== "POST") return undefined;
  const actions: Record<string, string> = {
    stop: "실행 중지",
    message: "후속 지시 전송",
    "select-challenge": "문제 지정",
    "submission-decision": "제출 승인·거부",
  };
  return sub && actions[sub] ? { action: actions[sub], detail } : undefined;
}

export class AuditLog {
  private readonly entries: AuditEntry[] = [];

  constructor(private readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, "utf8").split("\n").slice(-KEEP)) {
      try {
        if (line) this.entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        /* 마지막 줄이 덜 쓰였으면 건너뛴다 */
      }
    }
  }

  add(req: Request, user: string, action: string, detail?: string, status?: number) {
    const country = req.headers["cf-ipcountry"];
    const entry: AuditEntry = {
      at: Date.now(),
      ip: clientAddress(req),
      country: typeof country === "string" && country !== "XX" ? country : undefined,
      user,
      action,
      detail: detail?.slice(0, 300),
      status,
      agent: String(req.headers["user-agent"] || "").slice(0, 300),
    };
    this.entries.push(entry);
    if (this.entries.length > KEEP) this.entries.splice(0, this.entries.length - KEEP);
    fs.appendFileSync(this.file, JSON.stringify(entry) + "\n", { mode: 0o600 });
  }

  // 로그인한 사용자의 API 요청 중 의미 있는 행위만 응답 후에 기록한다.
  middleware(userOf: (req: Request) => string | undefined) {
    return (req: Request, res: Response, next: NextFunction) => {
      const described = describe(req.method, req.originalUrl);
      if (described)
        res.on("finish", () =>
          this.add(req, userOf(req) || "-", described.action, described.detail, res.statusCode),
        );
      next();
    };
  }

  list() {
    return [...this.entries].reverse();
  }
}

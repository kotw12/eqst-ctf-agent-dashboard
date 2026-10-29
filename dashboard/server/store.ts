import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  applyEvent,
  emptyView,
  active,
  eventSchema,
  metaSchema,
  type EventData,
  type EventKind,
  type LiveEvent,
  type RunConfig,
  type RunMeta,
  type View,
} from "../shared/protocol.ts";

export function redact(value: string, limit = 12000): string {
  const secret = process.env.EQST_LMS_PW;
  return (secret && secret.length >= 4 ? value.split(secret).join("[REDACTED]") : value)
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\b((?:SMTMBANKSESSIONID|JSESSIONID|LOGINID)=)[^;\s"']+/g, "$1[REDACTED]")
    .replace(/([?&]sToken=)[^&\s"']+/g, "$1[REDACTED]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[REDACTED]")
    .replace(
      /((?:Cookie|Set-Cookie|Authorization)\s*:\s*)[^\r\n]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password)\s*[=:]\s*["']?)[^\s"',;}]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, limit);
}
export class RunStore extends EventEmitter {
  readonly views = new Map<string, View>();
  constructor(
    readonly root: string,
    readonly workspaceRoot: string,
  ) {
    super();
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(workspaceRoot, { recursive: true });
    for (const id of fs.readdirSync(root)) {
      if (!/^[\da-f-]{36}$/.test(id)) continue;
      try {
        const dir = this.dir(id);
        if (fs.lstatSync(dir).isSymbolicLink()) continue;
        const meta = metaSchema.parse(
          JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")),
        );
        let view = emptyView(meta);
        const file = path.join(dir, "events.jsonl");
        if (fs.existsSync(file))
          for (const line of fs.readFileSync(file, "utf8").split("\n")) {
            if (!line) continue;
            try {
              view = applyEvent(view, eventSchema.parse(JSON.parse(line)));
            } catch {
              /* incomplete final write, keep earlier events */
            }
          }
        this.views.set(id, view);
        if (active(view.status)) {
          const lastAt = view.events.at(-1)?.at ?? view.meta.createdAt;
          this.endOpenTools(id);
          this.add(
            id,
            "status",
            "이전 실행 중단",
            "서버가 종료되어 자동 재시작하지 않았습니다. 이어하기로 재개할 수 있습니다.",
            {
              status: "interrupted",
              endedAt: lastAt,
              activeMs:
                view.activeMs +
                Math.max(0, lastAt - (view.startedAt ?? lastAt)),
            },
          );
        }
      } catch (error) {
        console.error(`Could not restore run ${id}: ${String(error)}`);
      }
    }
  }
  dir(id: string) {
    if (!/^[\da-f-]{36}$/.test(id)) throw new Error("Invalid run id");
    return path.join(this.root, id);
  }
  get(id: string) {
    const view = this.views.get(id);
    if (!view) throw new Error("Run not found");
    return view;
  }
  list() {
    return [...this.views.values()]
      .sort((a, b) => b.meta.createdAt - a.meta.createdAt)
      .map((v) => ({
        id: v.meta.id,
        title: v.meta.config.title,
        status: v.status,
        createdAt: v.meta.createdAt,
        model: v.meta.config.model,
        demo: v.meta.config.demo,
      }));
  }
  create(config: RunConfig) {
    const id = randomUUID(),
      dir = this.dir(id),
      workspace = path.join(this.workspaceRoot, `eqst-session-${id}`);
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.mkdirSync(workspace, { mode: 0o700 });
    const meta: RunMeta = { id, createdAt: Date.now(), config, workspace };
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify(meta, null, 2),
      { mode: 0o600 },
    );
    fs.writeFileSync(path.join(workspace, ".live-signals.jsonl"), "", {
      mode: 0o600,
    });
    this.views.set(id, emptyView(meta));
    return id;
  }
  add(
    id: string,
    kind: EventKind,
    title: string,
    detail = "",
    data: EventData = {},
  ) {
    const current = this.get(id);
    const event: LiveEvent = {
      seq: current.lastSeq + 1,
      at: Date.now(),
      kind,
      title: redact(title, 300),
      detail: redact(detail),
      data,
    };
    fs.appendFileSync(
      path.join(this.dir(id), "events.jsonl"),
      JSON.stringify(event) + "\n",
      { mode: 0o600 },
    );
    this.views.set(id, applyEvent(current, event));
    this.emit(id, event);
    return event;
  }
  endOpenTools(id: string) {
    for (const tool of this.get(id).tools.filter(
      (t) => t.status === "running",
    )) {
      this.add(
        id,
        "tool",
        "도구 중단",
        "종료 응답 없이 프로세스가 중단되었습니다.",
        { id: tool.id, status: "stopped", endedAt: Date.now() },
      );
    }
  }
  raw(id: string, kind: string, value: unknown) {
    const filename = path.join(this.dir(id), "native.jsonl");
    const bytes = Buffer.byteLength(
      typeof value === "string" ? value : JSON.stringify(value),
    );
    if (
      (fs.existsSync(filename) ? fs.statSync(filename).size : 0) + bytes >
      32 * 1024 * 1024
    )
      throw new Error("실행 로그가 32 MiB 제한에 도달했습니다.");
    fs.appendFileSync(
      filename,
      JSON.stringify({
        at: Date.now(),
        kind,
        value: JSON.parse(
          JSON.stringify(value, (_k, v) =>
            typeof v === "string" ? redact(v, 24000) : v,
          ),
        ),
      }) + "\n",
      { mode: 0o600 },
    );
  }
  after(id: string, seq: number) {
    const file = path.join(this.dir(id), "events.jsonl");
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const e = eventSchema.parse(JSON.parse(line));
          return e.seq > seq ? [e] : [];
        } catch {
          return [];
        }
      });
  }
}

import { toolFamily } from "../shared/protocol.ts";
import { RunStore, redact } from "./store.ts";
import { z } from "zod";

export const nativeSchema = z.object({
  type: z.string(),
  thread_id: z.string().optional(),
  message: z.string().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cached_input_tokens: z.number().optional(),
    })
    .optional(),
  item: z
    .object({
      id: z.string().optional(),
      type: z.string(),
      text: z.string().optional(),
      command: z.string().optional(),
      server: z.string().optional(),
      tool: z.string().optional(),
      exit_code: z.number().nullable().optional(),
      aggregated_output: z.string().optional(),
      result: z.unknown().optional(),
      error: z.unknown().optional(),
      message: z.string().optional(),
      query: z.string().optional(),
      changes: z
        .array(z.object({ kind: z.string(), path: z.string() }))
        .optional(),
    })
    .optional(),
});

export class NativeProjection {
  completed = false;
  failed = false;
  private readonly flags = new Set<string>();
  constructor(
    private store: RunStore,
    private runId: string,
    private turn: string,
  ) {}
  consume(input: unknown) {
    const parsed = nativeSchema.safeParse(input);
    if (!parsed.success) return;
    const e = parsed.data;
    if (e.type === "thread.started" && typeof e.thread_id === "string") {
      this.store.add(this.runId, "status", "SEAL 연결됨", "", {
        status: "running",
        threadId: e.thread_id,
      });
      return;
    }
    if (e.type === "turn.completed") {
      this.completed = true;
      this.store.add(this.runId, "usage", "응답 완료", "", {
        input: e.usage?.input_tokens || 0,
        tokenOutput: e.usage?.output_tokens || 0,
        cached: e.usage?.cached_input_tokens || 0,
      });
      return;
    }
    if (e.type === "turn.failed" || e.type === "error") {
      if (e.type === "turn.failed") this.failed = true;
      this.store.add(
        this.runId,
        "error",
        e.type === "turn.failed" ? "모델 실행 오류" : "연결 상태",
        e.error?.message || e.message || JSON.stringify(e),
      );
      return;
    }
    const item = e.item;
    if (
      !item ||
      !["item.started", "item.updated", "item.completed"].includes(e.type)
    )
      return;
    if (item.type === "reasoning") return;
    if (item.type === "agent_message" && e.type === "item.completed") {
      const text = redact(String(item.text || ""));
      this.store.add(this.runId, "message", "SEAL", text);
      for (const flag of text.match(
        /[A-Za-z][A-Za-z0-9_]{1,24}\{[^{}\r\n]{1,200}\}/g,
      ) || []) {
        if (
          this.flags.has(flag) ||
          this.store.get(this.runId).challenges.some((c) => c.flag === flag)
        )
          continue;
        this.flags.add(flag);
        this.store.add(
          this.runId,
          "candidate",
          "플래그 후보",
          "에이전트 응답에서 발견 · 플랫폼 수락과는 별개입니다.",
          {
            flag,
            source: "agent",
            challenge:
              this.store.get(this.runId).currentChallenge || "Unassigned",
          },
        );
      }
    } else if (
      item.type === "command_execution" ||
      item.type === "mcp_tool_call"
    ) {
      const done = e.type === "item.completed";
      const command = redact(
        item.command || `${item.server || "MCP"} · ${item.tool || "tool"}`,
        6000,
      );
      this.store.add(
        this.runId,
        "tool",
        done ? "도구 실행 결과" : "도구 실행",
        "",
        {
          id: `${this.turn}:${item.id}`,
          command,
          family: toolFamily(command),
          status: done
            ? (item.exit_code && item.exit_code !== 0) || item.error
              ? "error"
              : "completed"
            : "running",
          ...(done
            ? {
                endedAt: Date.now(),
                exitCode: item.exit_code ?? null,
                output: redact(
                  typeof item.aggregated_output === "string"
                    ? item.aggregated_output
                    : JSON.stringify(item.result ?? item.error ?? ""),
                  10000,
                ),
              }
            : {}),
        },
      );
    } else if (item.type === "error" && e.type === "item.completed") {
      this.store.add(
        this.runId,
        "notice",
        "런타임 알림",
        String(item.message || ""),
      );
    } else if (item.type === "file_change" && e.type === "item.completed") {
      this.store.add(
        this.runId,
        "notice",
        "파일 변경",
        (item.changes || []).map((c) => `${c.kind} · ${c.path}`).join("\n"),
      );
    } else if (item.type === "web_search" && e.type === "item.completed") {
      this.store.add(
        this.runId,
        "notice",
        "웹 검색",
        String(item.query || "검색 도구 사용"),
      );
    }
  }
}

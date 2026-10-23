import { z } from "zod";

export const runStatusSchema = z.enum([
  "starting",
  "running",
  "stopping",
  "stopped",
  "completed",
  "failed",
  "interrupted",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;
export const configSchema = z.object({
  title: z.string().trim().min(1).max(100),
  agentId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/)
    .default("EQST"),
  mode: z.enum(["auto", "guided"]).default("auto"),
  url: z
    .string()
    .url()
    .max(2000)
    .refine((value) => {
      const u = new URL(value);
      return (
        ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
      );
    }, "인증정보 없는 HTTP(S) URL을 입력하세요."),
  prompt: z.string().max(8000),
  rules: z.string().max(6000),
  model: z.enum(["gpt-6-sol", "gpt-6-luna"]),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
  fast: z.boolean(),
  yolo: z.boolean(),
  submissionMode: z.enum(["auto", "manual", "off"]).default("off"),
  browser: z.boolean(),
  browserId: z.string().max(100),
  maxMinutes: z.number().int().min(1).max(180),
  demo: z.boolean(),
});
export type RunConfig = z.infer<typeof configSchema>;
export const metaSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.number(),
  config: configSchema,
  workspace: z.string(),
});
export type RunMeta = z.infer<typeof metaSchema>;
export const fileSchema = z.object({ path: z.string(), bytes: z.number() });
export const progressStageSchema = z.enum([
  "survey",
  "ready",
  "inspect",
  "model",
  "exploit",
  "verify",
  "submit",
  "blocked",
  "complete",
]);
export type ProgressStage = z.infer<typeof progressStageSchema>;
export const findingTypeSchema = z.enum([
  "surface",
  "structure",
  "constraint",
  "hypothesis",
  "evidence",
  "vulnerability",
  "artifact",
  "blocker",
  "result",
]);
export const catalogProblemSchema = z.object({
  name: z.string().min(1).max(150),
  category: z
    .string()
    .max(40)
    .nullish()
    .transform((value) => value || "misc"),
  points: z
    .number()
    .nullish()
    .transform((value) => value ?? undefined),
  target: z
    .string()
    .max(500)
    .nullish()
    .transform((value) => value ?? undefined),
  description: z
    .string()
    .max(1200)
    .nullish()
    .transform((value) => value ?? undefined),
});
export type CatalogProblem = z.infer<typeof catalogProblemSchema>;
export const findingSchema = z.object({
  id: z.number().int(),
  at: z.number(),
  challenge: z.string(),
  type: findingTypeSchema,
  label: z.string(),
  detail: z.string(),
  evidence: z.string().optional(),
  source: z.string(),
});
export type Finding = z.infer<typeof findingSchema>;
export const solutionSchema = z.object({
  id: z.number().int(),
  at: z.number(),
  challenge: z.string(),
  summary: z.string(),
  method: z.string(),
  evidence: z.string().optional(),
  source: z.string(),
});
export type Solution = z.infer<typeof solutionSchema>;
export const eventDataSchema = z.object({
  status: z.string().optional(),
  threadId: z.string().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().nullable().optional(),
  activeMs: z.number().optional(),
  id: z.string().optional(),
  command: z.string().optional(),
  family: z.string().optional(),
  exitCode: z.number().nullable().optional(),
  output: z.string().optional(),
  challenge: z.string().optional(),
  category: z.string().optional(),
  points: z.number().optional(),
  flag: z.string().optional(),
  evidence: z.string().optional(),
  source: z.string().optional(),
  outcome: z.string().optional(),
  state: z.string().optional(),
  sessionId: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  capturedAt: z.number().optional(),
  error: z.string().optional(),
  input: z.number().optional(),
  cached: z.number().optional(),
  files: z.array(fileSchema).optional(),
  tokenOutput: z.number().optional(),
  stage: progressStageSchema.optional(),
  summary: z.string().optional(),
  next: z.string().optional(),
  findingType: findingTypeSchema.optional(),
  label: z.string().optional(),
  target: z.string().optional(),
  problems: z.array(catalogProblemSchema).max(200).optional(),
  method: z.string().optional(),
});
export type EventData = z.infer<typeof eventDataSchema>;
export const eventSchema = z.object({
  seq: z.number().int(),
  at: z.number(),
  kind: z.enum([
    "status",
    "message",
    "tool",
    "challenge",
    "candidate",
    "submission",
    "approval",
    "solution",
    "catalog",
    "progress",
    "finding",
    "usage",
    "browser",
    "operator",
    "notice",
    "error",
    "artifact",
  ]),
  title: z.string(),
  detail: z.string().optional(),
  data: eventDataSchema,
});
export type LiveEvent = z.infer<typeof eventSchema>;
export type EventKind = LiveEvent["kind"];
export const toolSchema = z.object({
  id: z.string(),
  command: z.string(),
  status: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  exitCode: z.number().nullable().optional(),
  output: z.string().optional(),
  family: z.string(),
});
export type Tool = z.infer<typeof toolSchema>;
export const challengeSchema = z.object({
  name: z.string(),
  category: z.string(),
  status: z.enum([
    "queued",
    "working",
    "candidate",
    "accepted",
    "rejected",
    "blocked",
    "skipped",
  ]),
  points: z.number().optional(),
  source: z.string().optional(),
  evidence: z.string().optional(),
  flag: z.string().optional(),
  decision: z.enum(["approved", "rejected"]).optional(),
  description: z.string().optional(),
  target: z.string().optional(),
});
export type Challenge = z.infer<typeof challengeSchema>;
export const viewSchema = z.object({
  meta: metaSchema,
  status: runStatusSchema,
  threadId: z.string().optional(),
  statusDetail: z.string(),
  tools: z.array(toolSchema),
  challenges: z.array(challengeSchema),
  events: z.array(eventSchema),
  currentChallenge: z.string(),
  catalogReady: z.boolean().default(false),
  catalogSummary: z.string().default(""),
  focus: z.object({
    challenge: z.string(),
    stage: progressStageSchema,
    summary: z.string(),
    next: z.string().optional(),
    source: z.enum(["agent", "inferred"]),
    updatedAt: z.number(),
  }),
  findings: z.array(findingSchema),
  solutions: z.array(solutionSchema),
  browser: z.object({
    state: z.string(),
    sessionId: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    capturedAt: z.number().optional(),
    error: z.string().optional(),
  }),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    cached: z.number(),
  }),
  lastSeq: z.number(),
  toolCount: z.number().default(0),
  nonzeroCount: z.number().default(0),
  startedAt: z.number().optional(),
  endedAt: z.number().nullable().optional(),
  activeMs: z.number(),
  artifacts: z.array(fileSchema),
});
export type View = z.infer<typeof viewSchema>;
export const historySchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    status: runStatusSchema,
    createdAt: z.number(),
    model: z.string(),
    demo: z.boolean(),
  }),
);
export type RunHistory = z.infer<typeof historySchema>;
export const healthSchema = z.object({
  seal: z.string(),
  codex: z.string(),
  browser: z.string(),
  connected: z.array(
    z.object({
      instance_id: z.string(),
      label: z.string().optional(),
      browser_name: z.string().optional(),
    }),
  ),
  activeId: z.string().optional(),
});
export type Health = z.infer<typeof healthSchema>;
export function emptyView(meta: RunMeta): View {
  return {
    meta,
    status: "starting",
    statusDetail: "",
    tools: [],
    challenges: [],
    events: [],
    currentChallenge: "",
    catalogReady: false,
    catalogSummary: "",
    focus: {
      challenge: "",
      stage: "survey",
      summary: "대회 구조를 기다리는 중",
      source: "inferred",
      updatedAt: meta.createdAt,
    },
    findings: [],
    solutions: [],
    browser: { state: "off" },
    tokens: { input: 0, output: 0, cached: 0 },
    lastSeq: 0,
    activeMs: 0,
    artifacts: [],
    toolCount: 0,
    nonzeroCount: 0,
  };
}
function activitySummary(family: string) {
  const summaries: Record<string, string> = {
    browser: "브라우저에서 문제 화면과 응답을 확인하고 있습니다.",
    inspect: "제공된 자료와 파일의 구조를 확인하고 있습니다.",
    code: "풀이 코드를 실행해 가설을 검증하고 있습니다.",
    network: "대상 서비스의 요청과 응답을 비교하고 있습니다.",
    reverse: "바이너리의 함수와 동작 구조를 분석하고 있습니다.",
    shell: "풀이에 필요한 명령을 실행하고 있습니다.",
  };
  return summaries[family] || "현재 문제의 풀이 작업을 진행하고 있습니다.";
}

export function applyEvent(previous: View, event: LiveEvent): View {
  if (event.seq <= previous.lastSeq) return previous;
  const v: View = {
    ...previous,
    lastSeq: event.seq,
    events: [...previous.events.slice(-199), event],
  };
  const d = event.data;
  switch (event.kind) {
    case "status": {
      const status = runStatusSchema.safeParse(d.status);
      if (status.success) v.status = status.data;
      v.statusDetail = event.detail || "";
      if (d.threadId) v.threadId = d.threadId;
      if (d.startedAt) v.startedAt = d.startedAt;
      if ("endedAt" in d) v.endedAt = d.endedAt;
      if (d.activeMs !== undefined) v.activeMs = d.activeMs;
      break;
    }
    case "tool": {
      if (!d.id) break;
      const found = v.tools.find((t) => t.id === d.id);
      const item: Tool = {
        id: d.id,
        command: d.command ?? found?.command ?? "",
        family: d.family ?? found?.family ?? "shell",
        status: d.status ?? "running",
        startedAt: found?.startedAt ?? event.at,
        endedAt: d.endedAt ?? found?.endedAt,
        exitCode: d.exitCode ?? found?.exitCode,
        output: d.output ?? found?.output,
      };
      v.tools = found
        ? v.tools.map((t) => (t.id === item.id ? item : t))
        : [...v.tools.slice(-299), item];
      if (!found) v.toolCount++;
      if (item.status === "error" && found?.status !== "error")
        v.nonzeroCount++;
      const currentProblem = v.challenges.find(
        (challenge) => challenge.name === v.currentChallenge,
      );
      if (
        d.status === "running" &&
        v.currentChallenge &&
        !["accepted", "skipped", "rejected"].includes(
          currentProblem?.status || "",
        ) &&
        !(v.focus.source === "agent" && event.at - v.focus.updatedAt < 30_000)
      ) {
        const stage: ProgressStage =
          item.family === "reverse"
            ? "model"
            : item.family === "code"
              ? "exploit"
              : "inspect";
        v.focus = {
          challenge: v.currentChallenge,
          stage,
          summary: activitySummary(item.family),
          source: "inferred",
          updatedAt: event.at,
        };
      }
      break;
    }
    case "catalog": {
      for (const problem of d.problems || []) {
        const old = v.challenges.find((c) => c.name === problem.name);
        const item: Challenge = {
          ...old,
          name: problem.name,
          category: problem.category,
          description: problem.description ?? old?.description,
          points: problem.points ?? old?.points,
          status: old?.status ?? "queued",
          source: old?.source ?? "catalog",
          target: problem.target ?? old?.target,
        };
        v.challenges = old
          ? v.challenges.map((c) => (c.name === problem.name ? item : c))
          : [...v.challenges, item];
      }
      v.catalogReady = true;
      v.catalogSummary =
        d.summary || event.detail || `${d.problems?.length || 0}개 문제 확인`;
      const activeProblem = v.challenges.find(
        (problem) =>
          problem.name === v.currentChallenge &&
          ["working", "candidate", "blocked"].includes(problem.status),
      );
      if (!activeProblem)
        v.focus = {
          challenge: "",
          stage: "ready",
          summary: v.catalogSummary,
          next: d.next,
          source: "agent",
          updatedAt: event.at,
        };
      break;
    }
    case "progress": {
      const stage = progressStageSchema.safeParse(d.stage);
      if (!stage.success) break;
      v.focus = {
        challenge: d.challenge || v.currentChallenge,
        stage: stage.data,
        summary: d.summary || event.detail || event.title,
        next: d.next,
        source: d.source === "inferred" ? "inferred" : "agent",
        updatedAt: event.at,
      };
      if (d.challenge) v.currentChallenge = d.challenge;
      if (d.challenge) {
        const problem = v.challenges.find((item) => item.name === d.challenge);
        if (problem && problem.status !== "accepted") {
          const status =
            stage.data === "blocked"
              ? "blocked"
              : problem.status === "blocked"
                ? "working"
                : problem.status;
          v.challenges = v.challenges.map((item) =>
            item.name === d.challenge ? { ...item, status } : item,
          );
        }
      }
      break;
    }
    case "finding": {
      const type = findingTypeSchema.safeParse(d.findingType);
      if (!type.success || !d.label) break;
      const item: Finding = {
        id: event.seq,
        at: event.at,
        challenge: d.challenge || v.currentChallenge || "Contest",
        type: type.data,
        label: d.label,
        detail: d.summary || event.detail || "",
        evidence: d.evidence,
        source: d.source || "agent",
      };
      v.findings = [...v.findings.slice(-39), item];
      break;
    }
    case "challenge":
    case "candidate":
    case "submission": {
      const name = d.challenge || v.currentChallenge || "Unassigned";
      const old = v.challenges.find((c) => c.name === name);
      const verified = old?.status === "accepted" && old.source === "platform";
      const workspaceOnly =
        event.kind === "challenge" && d.source === "workspace";
      let status: Challenge["status"] =
        old?.status === "accepted"
          ? "accepted"
          : event.kind === "challenge"
            ? workspaceOnly
              ? (old?.status ?? "queued")
              : "working"
            : (old?.status ?? "working");
      if (event.kind === "candidate" && status !== "accepted")
        status = "candidate";
      if (event.kind === "submission" && !verified)
        status =
          d.outcome === "accepted"
            ? "accepted"
            : d.outcome === "rejected"
              ? "rejected"
              : status;
      const item: Challenge = {
        ...old,
        name,
        category: d.category || old?.category || "misc",
        status,
        points: d.points ?? old?.points,
        source: verified
          ? old.source
          : event.kind === "submission"
            ? d.source
            : (old?.source ?? d.source),
        evidence: verified ? old.evidence : (d.evidence ?? old?.evidence),
        flag: verified ? old.flag : (d.flag ?? old?.flag),
        decision:
          event.kind === "candidate" && d.flag !== old?.flag
            ? undefined
            : old?.decision,
      };
      v.challenges = old
        ? v.challenges.map((c) => (c.name === name ? item : c))
        : [...v.challenges, item];
      if (!workspaceOnly) v.currentChallenge = name;
      if (event.kind === "challenge" && !workspaceOnly) {
        v.focus = {
          challenge: name,
          stage: "inspect",
          summary: `${name} 문제를 선택했습니다.`,
          source: "inferred",
          updatedAt: event.at,
        };
      } else if (event.kind === "candidate") {
        v.focus = {
          challenge: name,
          stage: "verify",
          summary: "플래그 후보의 근거와 제출 대상을 확인 중입니다.",
          source: "inferred",
          updatedAt: event.at,
        };
      } else if (event.kind === "submission") {
        v.focus = {
          challenge: name,
          stage: d.outcome === "accepted" ? "complete" : "submit",
          summary:
            d.outcome === "accepted"
              ? "제출 결과가 Accepted로 보고됐습니다."
              : `제출 결과: ${d.outcome || "확인 중"}`,
          source: "inferred",
          updatedAt: event.at,
        };
      }
      break;
    }
    case "approval": {
      if (!d.challenge || !["approved", "rejected"].includes(d.outcome || ""))
        break;
      v.challenges = v.challenges.map((challenge) =>
        challenge.name === d.challenge
          ? {
              ...challenge,
              decision: d.outcome as "approved" | "rejected",
              status: d.outcome === "rejected" ? "skipped" : challenge.status,
            }
          : challenge,
      );
      v.focus = {
        challenge: d.challenge,
        stage: d.outcome === "approved" ? "submit" : "blocked",
        summary:
          d.outcome === "approved"
            ? "운영자가 정확한 후보의 1회 제출을 승인했습니다."
            : "운영자가 후보 제출을 거부해 이 문제 작업을 중단했습니다.",
        source: "inferred",
        updatedAt: event.at,
      };
      break;
    }
    case "solution": {
      if (!d.challenge || !d.summary || !d.method) break;
      const item: Solution = {
        id: event.seq,
        at: event.at,
        challenge: d.challenge,
        summary: d.summary,
        method: d.method,
        evidence: d.evidence,
        source: d.source || "agent",
      };
      const old = v.solutions.find(
        (solution) => solution.challenge === d.challenge,
      );
      v.solutions = old
        ? v.solutions.map((solution) =>
            solution.challenge === d.challenge ? item : solution,
          )
        : [...v.solutions, item];
      v.focus = {
        challenge: d.challenge,
        stage: "complete",
        summary: d.summary,
        source: "agent",
        updatedAt: event.at,
      };
      break;
    }
    case "browser":
      v.browser = {
        state: d.state ?? v.browser.state,
        sessionId: d.sessionId ?? v.browser.sessionId,
        url: d.url ?? v.browser.url,
        title: d.title ?? v.browser.title,
        capturedAt: d.capturedAt ?? v.browser.capturedAt,
        error: d.error,
      };
      break;
    case "usage":
      v.tokens = {
        input: v.tokens.input + (d.input || 0),
        output: v.tokens.output + (d.tokenOutput || 0),
        cached: v.tokens.cached + (d.cached || 0),
      };
      break;
    case "artifact":
      v.artifacts = d.files || [];
      break;
  }
  return v;
}
export function active(status: RunStatus) {
  return status === "starting" || status === "running" || status === "stopping";
}
export function toolFamily(command: string): string {
  if (/\bbsk\b|browser|playwright/i.test(command)) return "browser";
  if (/\b(python\d?|sage|node|deno)\b/.test(command)) return "code";
  if (/\b(curl|wget|nc|ncat|ffuf)\b/.test(command)) return "network";
  if (/\b(gdb|readelf|objdump|jadx|ghidra|strings|r2)\b/.test(command))
    return "reverse";
  if (/\b(cat|file|rg|ls|find|head|tail|sed)\b/.test(command)) return "inspect";
  return "shell";
}

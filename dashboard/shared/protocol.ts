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
  // 서버에 정의된 대회 프리셋 id. 비어 있으면 대회 주소를 직접 쓴다.
  preset: z.string().max(40).default(""),
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
// 이벤트 목록은 최근 200개만 남기므로, 화면 지표는 별도로 누적한다.
export const statsSchema = z.object({
  tools: z.number(),
  families: z.record(z.string(), z.number()),
  files: z.array(z.string()),
  fileCount: z.number(),
  written: z.number(),
  findings: z.record(z.string(), z.number()),
  reports: z.number(),
  submissions: z.number(),
  activity: z.array(z.number()),
  // 지표별 분 단위 증가량(명령 종류 fam:*, 파일 files·written, 발견 find:*). 그래프는 이 실측값만 그린다.
  series: z.record(z.string(), z.array(z.number())).default({}),
  problems: z.record(
    z.string(),
    z.object({
      tools: z.number(),
      startedAt: z.number().optional(),
      endedAt: z.number().optional(),
    }),
  ),
});
export type Stats = z.infer<typeof statsSchema>;
export const storySchema = z.object({
  id: z.number().int(),
  at: z.number(),
  kind: z.enum([
    "catalog",
    "select",
    "finding",
    "blocked",
    "candidate",
    "submission",
    "solution",
    "tools",
  ]),
  challenge: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  type: z.string().optional(),
  outcome: z.string().optional(),
  count: z.number().optional(),
  families: z.record(z.string(), z.number()).optional(),
  until: z.number().optional(),
});
export type Story = z.infer<typeof storySchema>;
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
  stats: statsSchema,
  story: z.array(storySchema),
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
    stats: {
      tools: 0,
      families: {},
      files: [],
      fileCount: 0,
      written: 0,
      findings: {},
      reports: 0,
      submissions: 0,
      activity: [],
      series: {},
      problems: {},
    },
    story: [],
  };
}
// 에이전트가 대시보드에 진행을 알리는 보고 명령은 풀이 작업으로 세지 않는다.
export function isReporter(command: string) {
  return /\bnode\b.*(?:\/server\/report\.mjs|SEAL_LIVE_REPORTER)/.test(command);
}
const systemPath = /^\/(?:bin|sbin|usr|dev|proc|sys|etc|lib\d*|opt)\//;
const fileExt =
  /^[^.].*\.(?:txt|md|py|sage|c|h|cc|cpp|rs|go|java|class|jar|apk|js|ts|php|rb|sh|asm|s|json|xml|ya?ml|csv|ini|cfg|conf|log|html?|bin|elf|out|so|exe|dll|o|img|dat|raw|enc|key|pem|der|pub|png|jpe?g|gif|bmp|pdf|zip|gz|tgz|xz|bz2|7z|tar|pcap|pcapng|wav|mp3|mp4|flag)$/i;
// 명령 인자에 나타난 파일 경로. URL·IP·버전 문자열은 제외한다.
export function commandFiles(command: string): string[] {
  const body = command.replace(/^\/bin\/(?:ba)?sh -lc\s+/, "");
  const found = new Set<string>();
  const pattern =
    /(?:^|[\s'"=(<>|;])((?:~|\.{1,2})?\/?[\w.@+-]+(?:\/[\w.@+-]+)*)(?=$|[\s'")<>|;,])/g;
  for (const match of body.matchAll(pattern)) {
    const token = match[1].replace(/^\.\//, "");
    if (token.length < 3 || token.length > 160) continue;
    const parts = token.split("/").filter(Boolean);
    const name = parts.at(-1) || "";
    const hasExt = /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(name);
    // 확장자 없는 경로는 디렉터리 구조가 분명할 때만 파일로 본다(/bin, /api/submit 제외).
    if (!hasExt && parts.length < (token.startsWith("/") ? 3 : 2)) continue;
    // 디렉터리 없이 단독으로 쓰인 이름은 흔한 파일 확장자일 때만 센다(.text, obj.size 제외).
    if (parts.length === 1 && !fileExt.test(name)) continue;
    if (/^[\d.]+$/.test(name) || /^\d+\.\d+/.test(name)) continue;
    if (systemPath.test(token) || token.startsWith("-")) continue;
    if (/^\/api\/|^(?:application|text|image|multipart|audio|video)\//.test(token))
      continue;
    // 에이전트 자신의 스킬 문서는 문제 자료가 아니다.
    if (/\/codex\/skills\//.test(token)) continue;
    if (/^(?:python|node|pip|npm)\d*(?:\.\d+)*$/.test(name)) continue;
    found.add(token);
  }
  return [...found];
}
function pushStory(v: View, item: Omit<Story, "id">, seq: number) {
  v.story = [...v.story.slice(-299), { id: seq, ...item }];
}
function problemStat(v: View, name: string) {
  return v.stats.problems[name] || { tools: 0 };
}
function setProblemStat(
  v: View,
  name: string,
  patch: Partial<Stats["problems"][string]>,
) {
  v.stats = {
    ...v.stats,
    problems: {
      ...v.stats.problems,
      [name]: { ...problemStat(v, name), ...patch },
    },
  };
}
function runMinute(v: View, at: number) {
  return Math.max(0, Math.min(599, Math.floor((at - v.meta.createdAt) / 60_000)));
}
function bumpSeries(v: View, at: number, counts: Record<string, number>) {
  const minute = runMinute(v, at);
  const series = { ...v.stats.series };
  for (const [key, n] of Object.entries(counts)) {
    if (!n) continue;
    const values = [...(series[key] || [])];
    while (values.length <= minute) values.push(0);
    values[minute] += n;
    series[key] = values;
  }
  v.stats = { ...v.stats, series };
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
      if (!found && isReporter(item.command))
        v.stats = { ...v.stats, reports: v.stats.reports + 1 };
      if (!found && !isReporter(item.command)) {
        const files = new Set(v.stats.files);
        const before = files.size;
        // 같은 파일을 상대·절대 경로로 부르는 경우를 합치기 위해 문제별 파일명으로 센다.
        for (const file of commandFiles(item.command))
          files.add(`${v.currentChallenge}:${file.split("/").at(-1)}`);
        const minute = runMinute(v, event.at);
        const activity = [...v.stats.activity];
        while (activity.length <= minute) activity.push(0);
        activity[minute]++;
        v.stats = {
          ...v.stats,
          tools: v.stats.tools + 1,
          families: {
            ...v.stats.families,
            [item.family]: (v.stats.families[item.family] || 0) + 1,
          },
          files: [...files].slice(-2000),
          fileCount: v.stats.fileCount + (files.size - before),
          activity,
        };
        bumpSeries(v, event.at, {
          [`fam:${item.family}`]: 1,
          files: files.size - before,
        });
        const owner = v.currentChallenge || "";
        if (owner)
          setProblemStat(v, owner, { tools: problemStat(v, owner).tools + 1 });
        const last = v.story.at(-1);
        if (last?.kind === "tools" && last.challenge === owner) {
          v.story = [
            ...v.story.slice(0, -1),
            {
              ...last,
              count: (last.count || 0) + 1,
              until: event.at,
              families: {
                ...last.families,
                [item.family]: (last.families?.[item.family] || 0) + 1,
              },
            },
          ];
        } else
          pushStory(
            v,
            {
              at: event.at,
              kind: "tools",
              challenge: owner,
              title: "명령 실행",
              count: 1,
              until: event.at,
              families: { [item.family]: 1 },
            },
            event.seq,
          );
      }
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
        const inferred: ProgressStage =
          item.family === "reverse"
            ? "model"
            : item.family === "code"
              ? "exploit"
              : "inspect";
        // 같은 문제 안에서는 도구로 추정한 단계가 이미 지난 단계로 되돌아가지 않게 한다.
        const order: ProgressStage[] = ["inspect", "model", "exploit", "verify", "submit"];
        const stage =
          v.focus.challenge === v.currentChallenge &&
          order.indexOf(v.focus.stage) > order.indexOf(inferred)
            ? v.focus.stage
            : inferred;
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
      pushStory(
        v,
        {
          at: event.at,
          kind: "catalog",
          challenge: "",
          title: "문제 목록 확인",
          detail: v.catalogSummary,
        },
        event.seq,
      );
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
      if (stage.data === "blocked")
        pushStory(
          v,
          {
            at: event.at,
            kind: "blocked",
            challenge: v.focus.challenge,
            title: "보류",
            detail: v.focus.summary,
          },
          event.seq,
        );
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
      v.stats = {
        ...v.stats,
        findings: {
          ...v.stats.findings,
          [item.type]: (v.stats.findings[item.type] || 0) + 1,
        },
      };
      bumpSeries(v, event.at, { [`find:${item.type}`]: 1 });
      pushStory(
        v,
        {
          at: event.at,
          kind: "finding",
          challenge: item.challenge,
          title: item.label,
          detail: item.detail,
          type: item.type,
        },
        event.seq,
      );
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
      if (event.kind === "challenge" && !workspaceOnly) {
        if (!problemStat(v, name).startedAt)
          setProblemStat(v, name, { startedAt: event.at });
        const lastSelect = v.story.findLast((s) => s.kind === "select");
        if (lastSelect?.challenge !== name)
          pushStory(
            v,
            {
              at: event.at,
              kind: "select",
              challenge: name,
              title: `${name} 풀이 시작`,
              type: item.category,
            },
            event.seq,
          );
      } else if (event.kind === "candidate") {
        pushStory(
          v,
          {
            at: event.at,
            kind: "candidate",
            challenge: name,
            title: "플래그 후보 확보",
            detail: event.detail,
          },
          event.seq,
        );
      } else if (event.kind === "submission") {
        v.stats = { ...v.stats, submissions: v.stats.submissions + 1 };
        if (d.outcome === "accepted" && !problemStat(v, name).endedAt)
          setProblemStat(v, name, { endedAt: event.at });
        pushStory(
          v,
          {
            at: event.at,
            kind: "submission",
            challenge: name,
            title:
              d.outcome === "accepted"
                ? "정답 판정"
                : d.outcome === "rejected"
                  ? "오답 판정"
                  : "제출",
            detail: d.evidence,
            outcome: d.outcome,
          },
          event.seq,
        );
      }
      break;
    }
    case "notice": {
      if (event.title !== "파일 변경") break;
      const changed = (event.detail || "").split("\n").filter(Boolean).length;
      v.stats = { ...v.stats, written: v.stats.written + changed };
      bumpSeries(v, event.at, { written: changed });
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
      if (!problemStat(v, d.challenge).endedAt)
        setProblemStat(v, d.challenge, { endedAt: event.at });
      pushStory(
        v,
        {
          at: event.at,
          kind: "solution",
          challenge: d.challenge,
          title: d.summary,
          detail: d.method,
        },
        event.seq,
      );
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
  // 키는 저장된 기록과 맞추기 위해 "reverse"로 두고, 화면에서는 "보안 분석 도구"로 부른다.
  if (
    /\b(gdb|readelf|objdump|nm|ltrace|strace|jadx|apktool|ghidra|strings|r2|radare2|rizin|checksec|ROPgadget|ropper|one_gadget|patchelf|upx|binwalk|foremost|exiftool|steghide|stegseek|zsteg|volatility3?|vol|tshark|xxd|hexdump|john|hashcat|openssl|sqlmap|nmap|gobuster|dirsearch|nikto|hydra)\b/.test(
      command,
    )
  )
    return "reverse";
  if (/\b(curl|wget|nc|ncat|ffuf)\b/.test(command)) return "network";
  if (/\b(cat|file|rg|ls|find|head|tail|sed)\b/.test(command)) return "inspect";
  return "shell";
}

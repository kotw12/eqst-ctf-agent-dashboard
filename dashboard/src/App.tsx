import {
  useEffect,
  useRef,
  useState,
  memo,
  type FormEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Binary,
  Braces,
  Bug,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  Cpu,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  FilePen,
  FileSearch,
  Flag,
  FlaskConical,
  Globe2,
  History,
  Home,
  Lightbulb,
  LoaderCircle,
  MessageSquare,
  Orbit,
  PauseCircle,
  Play,
  Radar,
  Radio,
  Rocket,
  Search,
  Send,
  Settings2,
  Shield,
  ShieldCheck,
  Square,
  Terminal,
  Unplug,
  RefreshCw,
  TrendingUp,
  Users,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { z } from "zod";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  active,
  applyEvent,
  configSchema,
  eventSchema,
  healthSchema,
  historySchema,
  isReporter,
  viewSchema,
  type Challenge,
  type Health,
  type LiveEvent,
  type ProgressStage,
  type RunConfig,
  type RunHistory,
  type RunStatus,
  type Story,
  type Tool,
  type View,
} from "../shared/protocol.ts";

const initial: RunConfig = {
  title: "",
  agentId: "EQST",
  mode: "auto",
  url: "",
  prompt:
    "대회 사이트에서 문제를 살펴보고 풀 수 있는 문제를 순서대로 풀어줘. 현재 선택한 문제와 확인된 단서를 짧게 설명하면서 진행해.",
  rules:
    "지정된 대회와 문제에 제공된 endpoint만 사용. 외부 write-up과 정답 검색 금지.",
  model: "gpt-6-sol",
  effort: "high",
  fast: false,
  yolo: true,
  submissionMode: "manual",
  browser: false,
  browserId: "",
  maxMinutes: 30,
  demo: false,
  preset: "",
};
const presetSchema = z.array(
  z.object({ id: z.string(), title: z.string(), lab: z.string(), ready: z.boolean() }),
);
type Preset = z.infer<typeof presetSchema>[number];
function presetConfig(preset: Preset): RunConfig {
  return {
    ...initial,
    preset: preset.id,
    title: preset.title,
    url: preset.lab,
    maxMinutes: 120,
    prompt:
      "실습 사이트의 문제를 번호 순으로 하나씩 직접 풀어. 현재 문제와 확인된 단서를 짧게 설명하면서 진행하고, 정답 판정을 받으면 다음 문제로 넘어가.",
    rules:
      "실습 사이트와 lms-tool 만 사용. LMS 직접 접속·정답자 게시판·외부 write-up과 정답 검색 금지. 대량 요청·무차별 대입 금지.",
  };
}
const demoConfig: RunConfig = {
  ...initial,
  title: "EQST CTF",
  url: "http://127.0.0.1:18081",
  demo: true,
  model: "gpt-6-sol",
  effort: "max",
  yolo: true,
  submissionMode: "auto",
  maxMinutes: 180,
  prompt:
    "EQST HAL 로컬 대회 포털의 /api/challenges에서 문제 목록을 확인하고 한 문제씩 직접 풀어. 실행형 문제는 표시된 127.0.0.1 target에 HTTP/TCP 도구로 접속하고, 첨부파일이 있으면 포털에서 내려받아 분석해. 각 문제의 flag를 확보하면 즉시 보고하고 포털 /api/submit(JSON: agent, challenge, flag)으로 문제당 한 번 제출해 verdict를 확인한 뒤 다음 문제로 진행해. 모든 문제를 시도했으면 결과를 요약해.",
  rules:
    "EQST HAL 포털(http://127.0.0.1:18081)과 그 문제 target만 대상. 브라우저 없이 HTTP/TCP 도구만 사용. 포털 관리자 기능·다른 사용자 파일·외부 write-up 검색 금지.",
};
const authSchema = z.object({
  authenticated: z.boolean(),
  user: z.string().optional(),
  admin: z.boolean().optional(),
});
type Page = "home" | "run" | "history" | "audit";
const labels: Record<RunStatus, string> = {
  starting: "준비 중",
  running: "진행 중",
  stopping: "중지 중",
  stopped: "중지됨",
  completed: "완료",
  failed: "실행 오류",
  interrupted: "연결 중단",
};
// 화면에 보이는 풀이 단계. 내부 단계 값(inspect·model·exploit·verify·submit)과 1:1로 대응한다.
const steps: { stage: ProgressStage; label: string; detail: string }[] = [
  {
    stage: "inspect",
    label: "탐색",
    detail: "문제 설명·첨부 파일·접속 대상을 확인합니다",
  },
  {
    stage: "model",
    label: "분석",
    detail: "동작 구조와 취약한 지점을 파악합니다",
  },
  {
    stage: "exploit",
    label: "풀이 시도",
    detail: "풀이 코드와 요청을 직접 실행합니다",
  },
  {
    stage: "verify",
    label: "검증",
    detail: "얻은 플래그 후보의 근거를 확인합니다",
  },
  {
    stage: "submit",
    label: "제출",
    detail: "포털에 제출하고 정답 판정을 확인합니다",
  },
];
const stageIndex: Record<ProgressStage, number> = {
  survey: -1,
  ready: -1,
  inspect: 0,
  model: 1,
  exploit: 2,
  verify: 3,
  submit: 4,
  blocked: -1,
  complete: 5,
};
const stageLabels: Record<ProgressStage, string> = {
  survey: "문제 목록 확인",
  ready: "준비 완료",
  inspect: "탐색",
  model: "분석",
  exploit: "풀이 시도",
  verify: "검증",
  submit: "제출",
  blocked: "보류",
  complete: "해결",
};
// 명령 종류 색상: dataviz 기본 팔레트 dark 단계(어두운 배경에서 검증 통과).
const families: { key: string; label: string; color: string }[] = [
  { key: "network", label: "네트워크 요청", color: "#4590ee" },
  { key: "code", label: "코드 실행", color: "#e0632c" },
  { key: "inspect", label: "파일 확인", color: "#1aa577" },
  { key: "reverse", label: "보안 분석 도구", color: "#c98500" },
  { key: "shell", label: "터미널", color: "#e45a9c" },
];
const familyColor = Object.fromEntries(families.map((f) => [f.key, f.color]));
// 분 단위 실측값을 최대 count개 구간으로 합친다. 실행이 길어도 전체 구간이 한 그래프에 들어온다.
function bucketize(values: number[], span: number, count: number) {
  const size = Math.max(1, Math.ceil(span / count));
  return Array.from({ length: Math.ceil(span / size) }, (_, i) =>
    values.slice(i * size, (i + 1) * size).reduce((a, b) => a + b, 0),
  );
}
function runSpan(activity: number[], running: boolean, createdAt: number, now: number) {
  return Math.max(
    running ? Math.floor((now - createdAt) / 60_000) + 1 : activity.length,
    activity.length,
    2,
  );
}
const familyLabels: Record<string, string> = {
  ...Object.fromEntries(families.map((f) => [f.key, f.label])),
  browser: "브라우저",
};
const categoryLabels: Record<string, string> = {
  web: "웹",
  crypto: "암호학",
  pwn: "포너블",
  rev: "리버싱",
  reverse: "리버싱",
  reversing: "리버싱",
  forensics: "포렌식",
  misc: "기타",
  osint: "OSINT",
};
const findingLabels: Record<string, string> = {
  surface: "접속 대상",
  structure: "구조",
  constraint: "제약 조건",
  hypothesis: "가설",
  evidence: "근거",
  vulnerability: "취약점",
  artifact: "분석 자료",
  blocker: "보류 사유",
  result: "검증 결과",
};
type Board = "queued" | "working" | "solved" | "held";
const boardLabels: Record<Board, string> = {
  queued: "대기",
  working: "작업 중",
  solved: "해결",
  held: "보류",
};
function boardStatus(c: Challenge, running: boolean): Board {
  if (c.status === "accepted") return "solved";
  if (c.status === "queued") return "queued";
  if (["blocked", "skipped", "rejected"].includes(c.status)) return "held";
  return running ? "working" : "held";
}
function heldReason(c: Challenge, running: boolean) {
  if (c.status === "rejected") return "오답 판정";
  if (c.status === "skipped") return "제출 거부";
  if (c.status === "blocked") return "풀이 근거 부족";
  if (!running) return "실행 중지";
  return "";
}
function category(value: string) {
  return categoryLabels[value.toLowerCase()] || value;
}
const flagPattern = /[A-Za-z][A-Za-z0-9_]{1,24}\{[^{}\r\n]{1,200}\}/g;
function safe(value: string, show: boolean) {
  return show
    ? value
    : value.replace(flagPattern, (match) => `${match.split("{")[0]}{••••••••}`);
}
function formatTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}분 ${s % 60}초` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
}
function clock(at: number) {
  return new Date(at).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
function shortCommand(text: string) {
  return text
    .replace(/^\/bin\/(?:ba)?sh -lc\s+['"]?/, "")
    .replace(/['"]$/, "")
    .split("\n")[0];
}
function count(n: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}
function Icon({ type, size = 16 }: { type: string; size?: number }) {
  const icons = {
    browser: Globe2,
    inspect: Search,
    code: Braces,
    network: Radio,
    reverse: FileCode2,
    shell: Terminal,
    challenge: Orbit,
    candidate: Flag,
    submission: CheckCheck,
    approval: Shield,
    solution: CheckCheck,
    message: MessageSquare,
    error: Unplug,
    operator: Send,
    notice: Activity,
    catalog: Search,
    progress: Radio,
    finding: Lightbulb,
  };
  const Component = icons[type as keyof typeof icons] || Activity;
  return <Component size={size} strokeWidth={1.7} />;
}
function PanelTitle({
  icon,
  title,
  tail,
}: {
  icon: ReactNode;
  title: string;
  tail?: ReactNode;
}) {
  return (
    <div className="panel-title">
      <span>
        {icon}
        {title}
      </span>
      {tail}
    </div>
  );
}
function useClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
// 값이 바뀌면 이전 값에서 새 값까지 짧게 올라가는 숫자.
function useCountUp(value: number, enabled: boolean) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (!enabled) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now(),
      origin = from.current;
    let frame = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      const next = origin + (value - origin) * (1 - (1 - p) ** 3);
      setShown(next);
      if (p < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = value;
    };
  }, [value, enabled]);
  return Math.round(shown);
}
function LoginScreen({
  status,
  id,
  password,
  error,
  busy,
  onId,
  onPassword,
  onSubmit,
}: {
  status: "checking" | "anonymous";
  id: string;
  password: string;
  error: string;
  busy: boolean;
  onId: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <main className="login-shell">
      <div className="login-aura" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <section className="login-card" aria-labelledby="login-title">
        <header>
          <div className="login-mark">
            <Orbit size={29} />
          </div>
          <div>
            <span className="eyebrow">운영자 로그인</span>
            <h1 id="login-title">EQST CTF Agent</h1>
          </div>
        </header>
        <p>대회 실행과 풀이 기록은 인증된 운영자에게만 공개됩니다.</p>
        {status === "checking" ? (
          <div className="login-checking">
            <LoaderCircle className="spin" size={20} />
            로그인 세션 확인 중
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <label>
              아이디
              <input
                name="username"
                autoComplete="username"
                value={id}
                onChange={(event) => onId(event.target.value)}
                required
                autoFocus
              />
            </label>
            <label>
              비밀번호
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => onPassword(event.target.value)}
                required
              />
            </label>
            {error && (
              <div className="login-error" role="alert">
                <Unplug size={15} />
                {error}
              </div>
            )}
            <button className="button primary login-submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Shield size={16} />
              )}
              로그인
              <ArrowRight size={14} />
            </button>
          </form>
        )}
        <footer>
          <span className="dot green" />
          로그인한 운영자만 접근할 수 있습니다
        </footer>
      </section>
    </main>
  );
}

export default function App() {
  const [view, setView] = useState<View | null>(null),
    [health, setHealth] = useState<Health | null>(null),
    [runs, setRuns] = useState<RunHistory>([]),
    [presets, setPresets] = useState<Preset[]>([]);
  const [page, setPage] = useState<Page>("home");
  const [setup, setSetup] = useState(false),
    [form, setForm] = useState<RunConfig>(demoConfig);
  const [showFlags, setShowFlags] = useState(false),
    [motion, setMotion] = useState(
      () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [hint, setHint] = useState("");
  const [celebration, setCelebration] = useState("");
  const [authStatus, setAuthStatus] = useState<
      "checking" | "anonymous" | "authenticated"
    >("checking"),
    [authUser, setAuthUser] = useState(""),
    [isAdmin, setIsAdmin] = useState(false),
    [loginId, setLoginId] = useState("eqst"),
    [loginPassword, setLoginPassword] = useState(""),
    [loginError, setLoginError] = useState(""),
    [loginBusy, setLoginBusy] = useState(false);
  const token = useRef(""),
    stream = useRef<EventSource | null>(null),
    runId = useRef(""),
    dialog = useRef<HTMLDialogElement>(null);
  const now = useClock();
  async function api(url: string, body?: unknown) {
    const response = await fetch(
      url,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Seal-Live": token.current,
            },
            body: JSON.stringify(body),
          },
    );
    const json: unknown = await response.json();
    if (response.status === 401) {
      stream.current?.close();
      token.current = "";
      setConnected(false);
      setAuthStatus("anonymous");
      setLoginError("세션이 만료되었습니다. 다시 로그인하세요.");
    }
    if (!response.ok) {
      const result = z.object({ error: z.string().optional() }).safeParse(json);
      throw new Error(
        result.success ? result.data.error || "요청 실패" : "요청 실패",
      );
    }
    return json;
  }
  function go(next: Page, id = runId.current) {
    setPage(next);
    const query =
      next === "run" && id ? `?run=${id}` : next === "history" || next === "audit" ? `?page=${next}` : "";
    window.history.replaceState({}, "", `${location.pathname}${query}`);
    window.scrollTo({ top: 0 });
  }
  async function refreshRuns() {
    setRuns(historySchema.parse(await api("/api/runs")));
  }
  async function selectRun(id: string) {
    stream.current?.close();
    runId.current = id;
    setError("");
    const result = viewSchema.parse(await api(`/api/runs/${id}`));
    if (runId.current !== id) return;
    setView(result);
    const events = new EventSource(
      `/api/runs/${id}/events?after=${result.lastSeq}`,
    );
    stream.current = events;
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.addEventListener("event", (e) => {
      const parsed = eventSchema.safeParse(JSON.parse(e.data));
      if (!parsed.success) return;
      const item = parsed.data;
      setView((prev) => (prev?.meta.id === id ? applyEvent(prev, item) : prev));
      if (
        item.kind === "submission" &&
        item.data.outcome === "accepted" &&
        item.data.source === "platform"
      ) {
        setCelebration(item.data.challenge || "Challenge");
      }
      if (item.kind === "status") void refreshRuns();
    });
  }
  async function openRun(id: string) {
    await selectRun(id);
    go("run", id);
  }
  async function loadDashboard() {
    const bootstrap = z
      .object({
        token: z.string(),
        runs: historySchema,
        activeId: z.string().optional(),
      })
      .parse(await api("/api/bootstrap"));
    token.current = bootstrap.token;
    setRuns(bootstrap.runs);
    const params = new URLSearchParams(location.search);
    const requested = params.get("run");
    if (requested) {
      await selectRun(requested);
      go("run", requested);
    } else {
      // 진행 중인 실행이 있으면 메인 화면에서 바로 보여줄 수 있게 연결만 해 둔다.
      if (bootstrap.activeId) await selectRun(bootstrap.activeId);
      const requestedPage = params.get("page");
      go(requestedPage === "history" || requestedPage === "audit" ? requestedPage : "home");
    }
    setHealth(healthSchema.parse(await api("/api/health")));
    setPresets(presetSchema.parse(await api("/api/presets")));
  }
  async function submitLogin(e: FormEvent) {
    e.preventDefault();
    if (loginBusy) return;
    setLoginBusy(true);
    setLoginError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: loginId, password: loginPassword }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const result = z
          .object({ error: z.string().optional() })
          .safeParse(json);
        throw new Error(
          result.success ? result.data.error || "로그인 실패" : "로그인 실패",
        );
      }
      const state = authSchema.parse(json);
      setAuthUser(state.user || loginId);
      setIsAdmin(!!state.admin);
      setAuthStatus("authenticated");
      setLoginPassword("");
      await loadDashboard();
    } catch (loginFailure) {
      setLoginPassword("");
      setLoginError(
        loginFailure instanceof Error
          ? loginFailure.message
          : "로그인에 실패했습니다.",
      );
    } finally {
      setLoginBusy(false);
    }
  }
  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    stream.current?.close();
    token.current = "";
    runId.current = "";
    setConnected(false);
    setView(null);
    setRuns([]);
    setHealth(null);
    setAuthUser("");
    setIsAdmin(false);
    setAuthStatus("anonymous");
    setPage("home");
    window.history.replaceState({}, "", location.pathname);
  }
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const response = await fetch("/api/auth/status", { cache: "no-store" });
        const state = authSchema.parse(await response.json());
        if (disposed) return;
        if (!state.authenticated) {
          setAuthStatus("anonymous");
          return;
        }
        setAuthUser(state.user || "");
        setIsAdmin(!!state.admin);
        setAuthStatus("authenticated");
        await loadDashboard();
      } catch (startupError) {
        if (!disposed) {
          setAuthStatus("anonymous");
          setLoginError(
            startupError instanceof Error
              ? startupError.message
              : "로그인 상태를 확인하지 못했습니다.",
          );
        }
      }
    })();
    return () => {
      disposed = true;
      stream.current?.close();
    };
  }, []);
  useEffect(() => {
    if (setup) dialog.current?.showModal();
    else dialog.current?.close();
  }, [setup]);
  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(() => setCelebration(""), 6000);
    return () => clearTimeout(t);
  }, [celebration]);
  const running = view ? active(view.status) : false;
  useEffect(() => {
    document.title =
      view && page === "run"
        ? `${running ? "● " : ""}${view.meta.config.title} · EQST CTF Agent`
        : "EQST CTF Agent";
  }, [view, page, running]);
  const elapsed = view
    ? view.activeMs + (running && view.startedAt ? now - view.startedAt : 0)
    : 0;
  async function start(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const config = configSchema.parse(form);
      const response = z
        .object({ id: z.string() })
        .parse(await api("/api/runs", config));
      setSetup(false);
      await openRun(response.id);
      await refreshRuns();
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues.map((i) => i.message).join(" · ")
          : String(e),
      );
    } finally {
      setBusy(false);
    }
  }
  async function sendHint(e: FormEvent) {
    e.preventDefault();
    if (!view || busy || !hint.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/runs/${view.meta.id}/message`, { message: hint });
      setHint("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function decideSubmission(
    challenge: string,
    decision: "approved" | "rejected",
  ) {
    if (!view || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/runs/${view.meta.id}/submission-decision`, {
        challenge,
        decision,
      });
    } catch (decisionError) {
      setError(String(decisionError));
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    if (!view) return;
    setBusy(true);
    try {
      await api(`/api/runs/${view.meta.id}/stop`, {});
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function openSetup(config: RunConfig) {
    setForm(config);
    setError("");
    setSetup(true);
  }
  if (authStatus !== "authenticated")
    return (
      <LoginScreen
        status={authStatus}
        id={loginId}
        password={loginPassword}
        error={loginError}
        busy={loginBusy}
        onId={setLoginId}
        onPassword={setLoginPassword}
        onSubmit={submitLogin}
      />
    );

  const liveView = view && running ? view : null;
  return (
    <div className={`app cyber ${motion ? "" : "no-motion"}`}>
      <div className="x-backdrop" aria-hidden="true">
        <span className="x-grid" />
        <span className="x-glow" />
      </div>
      <a className="skip" href="#main">
        본문으로 이동
      </a>
      <aside className="navrail">
        <div className="mark" aria-label="EQST">
          <Orbit size={29} />
        </div>
        {(
          [
            ["home", "메인", Home],
            ["run", "실행 화면", Radar],
            ["history", "실행 기록", History],
          ] as const
        ).map(([key, label, NavIcon]) => (
          <button
            key={key}
            className={page === key ? "nav active" : "nav"}
            aria-label={label}
            title={label}
            onClick={() => {
              if (key === "history") void refreshRuns();
              go(key);
            }}
          >
            <NavIcon size={21} />
            {key === "run" && running && <i className="x-nav-live" />}
          </button>
        ))}
        <span className="rail-bottom">eqst</span>
      </aside>
      <div className="shell">
        <header className="topbar">
          <a
            className="wordmark"
            href="/"
            aria-label="EQST CTF Agent"
            onClick={(e) => {
              e.preventDefault();
              go("home");
            }}
          >
            EQST <span>CTF Agent</span>
          </a>
          <div className="top-divider" />
          <nav className="x-tabs" aria-label="화면">
            {(
              [
                ["home", "메인"],
                ["run", "실행 화면"],
                ["history", "실행 기록"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={page === key ? "active" : ""}
                onClick={() => {
                  if (key === "history") void refreshRuns();
                  go(key);
                }}
              >
                {label}
                {key === "run" && running && <i className="dot amber pulse" />}
              </button>
            ))}
          </nav>
          <div className="header-actions">
            <span className="connection">
              <span
                className={`dot ${view ? (connected ? "green" : "") : health ? "green" : ""}`}
              />
              {view
                ? connected
                  ? "실시간 연결"
                  : "다시 연결하는 중"
                : health
                  ? "엔진 준비됨"
                  : "엔진 확인 중"}
            </span>
            <button
              className="icon-btn"
              aria-label={motion ? "애니메이션 끄기" : "애니메이션 켜기"}
              title="모션 전환"
              onClick={() => setMotion(!motion)}
            >
              <Waves size={18} />
            </button>
            <button
              type="button"
              className="button secondary compact flag-visibility"
              aria-pressed={showFlags}
              title="화면의 플래그 문자열을 표시하거나 가립니다."
              onClick={() => setShowFlags((visible) => !visible)}
            >
              {showFlags ? <EyeOff size={17} /> : <Eye size={17} />}
              {showFlags ? "플래그 숨기기" : "플래그 보기"}
            </button>
            <button
              className="icon-btn logout-control"
              aria-label={`${authUser || "Operator"} 로그아웃`}
              title={`${authUser || "Operator"} 로그아웃`}
              onClick={() => void logout()}
            >
              <Unplug size={17} />
            </button>
          </div>
        </header>
        <main id="main">
          {error && !setup && (
            <div className="error-banner" role="alert">
              <Unplug size={17} />
              <span>{error}</span>
              <button
                className="icon-btn"
                onClick={() => setError("")}
                aria-label="오류 닫기"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {page === "home" && (
            <HomePage
              live={liveView}
              elapsed={elapsed}
              health={health}
              runs={runs}
              motion={motion}
              onStart={() => openSetup(demoConfig)}
              onCustom={() => openSetup({ ...initial })}
              onWatch={() => go("run")}
              onHistory={() => {
                void refreshRuns();
                go("history");
              }}
              onAdmin={isAdmin ? () => go("audit") : undefined}
            />
          )}
          {page === "audit" && (
            <AuditPage onBack={() => go("home")} />
          )}
          {page === "history" && (
            <HistoryPage
              runs={runs}
              activeId={liveView?.meta.id}
              onOpen={(id) => void openRun(id)}
              onStart={() => openSetup(demoConfig)}
            />
          )}
          {page === "run" &&
            (view ? (
              <RunPage
                view={view}
                running={running}
                elapsed={elapsed}
                now={now}
                busy={busy}
                motion={motion}
                showFlags={showFlags}
                hint={hint}
                onHint={setHint}
                onSendHint={sendHint}
                onStop={() => void stop()}
                onDecide={(name, decision) =>
                  void decideSubmission(name, decision)
                }
                onError={setError}
              />
            ) : (
              <section className="x-empty-run">
                <Radar size={44} strokeWidth={1.2} />
                <h2>표시할 실행이 없습니다</h2>
                <p>새 실행을 시작하면 에이전트의 풀이 과정이 이곳에 실시간으로 나타납니다.</p>
                <button
                  className="button primary"
                  onClick={() => openSetup(demoConfig)}
                >
                  <Rocket size={16} />새 실행 시작
                </button>
              </section>
            ))}
          <footer>
            <span />
            <span>EQST CTF Agent</span>
          </footer>
        </main>
      </div>
      {celebration && (
        <div className="success-toast x-solved-toast" role="status">
          <span className="success-halo" />
          <ShieldCheck size={30} />
          <div>
            <small>포털 정답 판정</small>
            <strong>{celebration}</strong>
            <span>에이전트가 문제를 해결했습니다.</span>
          </div>
          <button
            className="icon-btn"
            onClick={() => setCelebration("")}
            aria-label="성공 알림 닫기"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className="setup-dialog"
        onCancel={() => setSetup(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSetup(false);
        }}
      >
        <form onSubmit={start}>
          <div className="dialog-heading">
            <div>
              <span className="eyebrow">실행 설정</span>
              <h2>{form.demo ? "EQST CTF 데모 실행" : "새 실행 설정"}</h2>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSetup(false)}
              aria-label="설정 닫기"
            >
              <X size={20} />
            </button>
          </div>
          {form.demo && (
            <div className="x-demo-summary">
              <span>
                <b>대회</b>EQST HAL 로컬 포털
              </span>
              <span>
                <b>모델</b>GPT-6 Sol · 추론 강도 max
              </span>
              <span>
                <b>제출</b>검증된 플래그 자동 제출
              </span>
              <span>
                <b>권한</b>SEAL --yolo · 최대 180분
              </span>
            </div>
          )}
          <div className="setup-grid">
            <div className="setup-main">
              {!form.demo && presets.length > 0 && (
                <label>
                  대회
                  <select
                    value={form.preset}
                    onChange={(e) => {
                      const preset = presets.find((p) => p.id === e.target.value);
                      setForm(preset ? presetConfig(preset) : { ...initial });
                    }}
                  >
                    <option value="">직접 입력</option>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.ready}>
                        {p.title}
                        {p.ready ? "" : " (서버 계정 미설정)"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                대회 이름
                <input
                  required
                  disabled={!!form.preset}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="예: EQST CTF"
                />
              </label>
              <label>
                제출자 이름 (Agent ID)
                <input
                  required
                  maxLength={32}
                  pattern={"[A-Za-z0-9][A-Za-z0-9._\\-]{0,31}"}
                  value={form.agentId}
                  onChange={(e) =>
                    setForm({ ...form, agentId: e.target.value })
                  }
                  placeholder="예: EQST-test1"
                />
              </label>
              <label>
                실행 방식
                <select
                  value={form.mode}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      mode: e.target.value as RunConfig["mode"],
                    })
                  }
                >
                  <option value="auto">준비 후 자동 풀이</option>
                  <option value="guided">준비 후 문제 선택 대기</option>
                </select>
              </label>
              <label>
                대회 주소
                <input
                  required
                  type="url"
                  value={form.url}
                  disabled={form.demo || !!form.preset}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://ctf.example.com"
                />
              </label>
              <details className="advanced-settings">
                <summary>
                  <Settings2 size={14} />
                  목표·범위 세부 설정
                </summary>
                <div>
                  <label>
                    에이전트에게 할 일
                    <textarea
                      rows={4}
                      value={form.prompt}
                      onChange={(e) =>
                        setForm({ ...form, prompt: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    범위와 규칙
                    <textarea
                      rows={2}
                      value={form.rules}
                      onChange={(e) =>
                        setForm({ ...form, rules: e.target.value })
                      }
                    />
                  </label>
                </div>
              </details>
            </div>
            <div className="setup-options">
              <label>
                모델
                <select
                  value={form.model}
                  disabled={form.demo}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      model: e.target.value as RunConfig["model"],
                    })
                  }
                >
                  <option value="gpt-6-sol">GPT-6 Sol</option>
                  <option value="gpt-6-luna">GPT-6 Luna</option>
                </select>
              </label>
              <div className="two-fields">
                <label>
                  추론 강도 (Effort)
                  <select
                    value={form.effort}
                    disabled={form.demo}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        effort: e.target.value as RunConfig["effort"],
                      })
                    }
                  >
                    {["low", "medium", "high", "xhigh", "max"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  최대 실행 (분)
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={form.maxMinutes}
                    onChange={(e) =>
                      setForm({ ...form, maxMinutes: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.fast}
                  onChange={(e) => setForm({ ...form, fast: e.target.checked })}
                />
                <span>
                  <Zap size={16} />
                  빠른 응답 모드
                </span>
              </label>
              <label>
                플래그 제출 방식
                <select
                  value={form.submissionMode}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      submissionMode: e.target
                        .value as RunConfig["submissionMode"],
                    })
                  }
                >
                  <option value="manual">후보마다 승인 요청</option>
                  <option value="auto">검증된 후보 자동 제출</option>
                  <option value="off">제출하지 않음</option>
                </select>
              </label>
              <label className="toggle">
                <input type="checkbox" checked disabled readOnly />
                <span>
                  <Shield size={16} />
                  SEAL --yolo
                </span>
              </label>
              <p className="option-help warning">
                승인·native sandbox 해제. 격리된 CTF 환경에서만 사용합니다.
              </p>
            </div>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            {form.demo ? (
              <button
                type="button"
                className="text-button"
                onClick={() => setForm({ ...initial })}
              >
                <Settings2 size={16} />
                다른 대회로 직접 설정
              </button>
            ) : (
              <button
                type="button"
                className="text-button"
                onClick={() => setForm(demoConfig)}
              >
                <Braces size={16} />
                EQST CTF 데모 설정
              </button>
            )}
            <span>
              {form.demo ? "로컬 CTF · 실제 모델 호출" : "기존 SEAL 로그인·스킬 사용"}
            </span>
            <button
              className="button primary"
              type="submit"
              disabled={busy || running}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Play size={16} />
              )}
              실행 시작
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

function HomePage({
  live,
  elapsed,
  health,
  runs,
  motion,
  onStart,
  onCustom,
  onWatch,
  onHistory,
  onAdmin,
}: {
  live: View | null;
  elapsed: number;
  health: Health | null;
  runs: RunHistory;
  motion: boolean;
  onStart: () => void;
  onCustom: () => void;
  onWatch: () => void;
  onHistory: () => void;
  onAdmin?: () => void;
}) {
  const solved = live?.challenges.filter((c) => c.status === "accepted").length || 0;
  return (
    <div className="x-home">
      <section className="x-hero">
        <div className="x-hero-copy">
          <span className="x-kicker">
            <i className={`dot ${live ? "amber pulse" : "green"}`} />
            AI 기반 자율형 CTF 에이전트
          </span>
          <h1>
            EQST AI <em>CTF Agent</em>
          </h1>
          <p>
            EQST AI CTF Agent는 사람의 개입 없이 AI가 자율적으로 문제를 탐색하고
            분석해 취약점을 찾아냅니다. 발견한 단서로 가설을 세우고, 풀이 코드를 직접
            작성·실행해 검증한 뒤, 확보한 플래그를 제출하고 정답 여부까지 확인합니다.
            실시간 대시보드를 통해 AI agent가 문제를 풀이하는 과정을 확인할 수 있습니다.
          </p>
          <div className="x-hero-actions">
            {live ? (
              <button className="button primary x-cta" onClick={onWatch}>
                <Radar size={18} />
                진행 중인 실행 보기
                <ArrowRight size={16} />
              </button>
            ) : (
              <button className="button primary x-cta" onClick={onStart}>
                <Rocket size={18} />새 실행 시작
                <ArrowRight size={16} />
              </button>
            )}
            <button className="button secondary" onClick={onCustom} disabled={!!live}>
              <Settings2 size={15} />
              직접 설정
            </button>
          </div>
          <div className="x-hero-meta">
            <span>
              <Flag size={13} />
              EQST HAL 로컬 대회
            </span>
            <span>
              <Cpu size={13} />
              GPT-6 Sol · max
            </span>
            <span>
              <i className={`dot ${health ? "green" : ""}`} />
              {health ? `SEAL 엔진 준비됨 · ${health.codex}` : "엔진 상태 확인 중"}
            </span>
          </div>
        </div>
        <div className={`x-hero-visual ${live ? "live" : ""}`} aria-hidden="true">
          <RadarScope active={!!live || motion} />
          <div className="x-hero-code">
            {(live
              ? live.tools
                  .filter((t) => !isReporter(t.command))
                  .slice(-6)
                  .map((t) => `$ ${shortCommand(t.command).slice(0, 64)}`)
              : [
                  "$ curl -s http://127.0.0.1:18081/api/challenges",
                  "$ file attachments/*",
                  "$ objdump -d boi | grep -A20 '<main>'",
                  "$ python3 solve/exploit.py",
                  "$ curl -s -X POST .../api/submit",
                ]
            ).map((line, index) => (
              <code key={`${index}-${line}`} style={{ animationDelay: `${index * 0.4}s` }}>
                {line}
              </code>
            ))}
          </div>
        </div>
      </section>
      {live && (
        <button className="x-live-card" onClick={onWatch}>
          <span className="x-live-badge">
            <i className="dot amber pulse" />
            LIVE
          </span>
          <div>
            <strong>{live.meta.config.title}</strong>
            <small>
              {live.focus.challenge || live.currentChallenge || "문제 목록 확인 중"} ·{" "}
              {stageLabels[live.focus.stage]}
            </small>
          </div>
          <dl>
            <div>
              <dt>경과</dt>
              <dd>{formatTime(elapsed)}</dd>
            </div>
            <div>
              <dt>해결</dt>
              <dd>
                {solved}/{live.challenges.length || "–"}
              </dd>
            </div>
            <div>
              <dt>도구 호출</dt>
              <dd>{live.stats.tools}</dd>
            </div>
          </dl>
          <ArrowUpRight size={20} />
        </button>
      )}
      <section className="x-steps" aria-label="에이전트의 풀이 과정">
        {steps.map((step, index) => (
          <article key={step.stage}>
            <span className="x-step-no">{String(index + 1).padStart(2, "0")}</span>
            <StepIcon stage={step.stage} />
            <strong>{step.label}</strong>
            <p>{step.detail}</p>
          </article>
        ))}
      </section>
      <section className="x-home-foot">
        <div>
          <History size={16} />
          이전 실행 {runs.length}건의 기록과 풀이 결과는 실행 기록 탭에서 볼 수 있습니다.
        </div>
        <button className="text-button" onClick={onHistory}>
          실행 기록 열기
          <ArrowRight size={14} />
        </button>
      </section>
      {onAdmin && (
        <section className="x-home-foot x-admin-entry">
          <div>
            <Shield size={16} />
            관리자 전용: 누가 언제 어느 IP에서 접속해 어떤 작업을 했는지 확인합니다.
          </div>
          <button className="text-button" onClick={onAdmin}>
            접속 기록 열기
            <ArrowRight size={14} />
          </button>
        </section>
      )}
    </div>
  );
}

const auditSchema = z.array(
  z.object({
    at: z.number(),
    ip: z.string(),
    country: z.string().optional(),
    user: z.string(),
    action: z.string(),
    detail: z.string().optional(),
    status: z.number().optional(),
    agent: z.string().optional(),
  }),
);
type AuditRow = z.infer<typeof auditSchema>[number];
// 사용자 에이전트 문자열에서 브라우저와 OS만 짧게 뽑는다.
function deviceLabel(agent = "") {
  const browser =
    /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : /curl|python|node/i.test(agent) ? "스크립트" : "기타";
  const os =
    /Windows/.test(agent) ? "Windows" : /iPhone|iPad/.test(agent) ? "iOS" : /Android/.test(agent) ? "Android" : /Mac OS/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}
function AuditPage({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  async function load() {
    setError("");
    try {
      const response = await fetch("/api/admin/audit", { cache: "no-store" });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message = z.object({ error: z.string() }).safeParse(json);
        throw new Error(message.success ? message.data.error : "접속 기록을 불러오지 못했습니다.");
      }
      setRows(auditSchema.parse(json));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "접속 기록을 불러오지 못했습니다.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const all = rows || [];
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? all.filter((r) =>
        [r.user, r.ip, r.country, r.action, r.detail].some((v) => v?.toLowerCase().includes(needle)),
      )
    : all;
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = all.filter((r) => r.at >= dayAgo);
  // 접속자별 요약: ID와 IP 조합마다 마지막 접속 시각과 행위 수를 보여준다.
  const visitors = [
    ...all
      .reduce((map, r) => {
        const key = `${r.user}|${r.ip}`;
        const item = map.get(key) || { user: r.user, ip: r.ip, country: r.country, last: r.at, count: 0, agent: r.agent };
        item.count++;
        item.last = Math.max(item.last, r.at);
        return map.set(key, item);
      }, new Map<string, { user: string; ip: string; country?: string; last: number; count: number; agent?: string }>())
      .values(),
  ].sort((a, b) => b.last - a.last);
  const stats = [
    { label: "최근 24시간 기록", value: recent.length },
    { label: "최근 24시간 로그인", value: recent.filter((r) => r.action === "로그인").length },
    { label: "로그인 실패·차단", value: recent.filter((r) => r.action !== "로그인" && r.action.startsWith("로그인")).length },
    { label: "접속 IP 수", value: new Set(all.map((r) => r.ip)).size },
  ];
  return (
    <section className="x-audit">
      <header>
        <div>
          <span className="eyebrow">관리자</span>
          <h1>접속 기록</h1>
          <p>
            대시보드 로그인과 주요 작업을 시간순으로 보여줍니다. IP는 접속자 주소이고, 국가는 접속 경로에서 확인된
            경우에만 표시됩니다.
          </p>
        </div>
        <div className="x-audit-actions">
          <button className="button secondary" onClick={onBack}>
            메인으로
          </button>
          <button className="button primary" onClick={() => void load()}>
            <RefreshCw size={15} />
            새로고침
          </button>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <Unplug size={17} />
          <span>{error}</span>
        </div>
      )}
      <div className="x-audit-stats">
        {stats.map((s) => (
          <div key={s.label}>
            <strong>{s.value.toLocaleString("ko-KR")}</strong>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
      <div className="x-audit-grid">
        <section className="panel">
          <PanelTitle icon={<Users size={16} />} title="접속자" tail={<span className="count-badge">{visitors.length}</span>} />
          <ul className="x-visitors">
            {visitors.slice(0, 40).map((v) => (
              <li key={`${v.user}|${v.ip}`}>
                <strong>{v.user}</strong>
                <code>{v.ip}</code>
                <small>
                  {v.country ? `${v.country} · ` : ""}
                  {deviceLabel(v.agent)} · {v.count}건 · 마지막 {new Date(v.last).toLocaleString("ko-KR")}
                </small>
              </li>
            ))}
            {!visitors.length && <li className="x-audit-empty">아직 기록이 없습니다.</li>}
          </ul>
        </section>
        <section className="panel">
          <PanelTitle
            icon={<Activity size={16} />}
            title="행위 기록"
            tail={
              <input
                className="x-audit-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ID, IP, 행위로 찾기"
                aria-label="기록 검색"
              />
            }
          />
          <div className="x-audit-table">
            <table>
              <thead>
                <tr>
                  <th>시각</th>
                  <th>ID</th>
                  <th>IP</th>
                  <th>국가</th>
                  <th>행위</th>
                  <th>대상</th>
                  <th>기기</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((r, i) => (
                  <tr key={`${r.at}-${i}`} className={r.action.startsWith("로그인 ") ? "warn" : ""}>
                    <td>{new Date(r.at).toLocaleString("ko-KR")}</td>
                    <td>{r.user}</td>
                    <td>
                      <code>{r.ip}</code>
                    </td>
                    <td>{r.country || "–"}</td>
                    <td>
                      {r.action}
                      {r.status && r.status >= 400 ? ` (${r.status})` : ""}
                    </td>
                    <td>{r.detail || "–"}</td>
                    <td title={r.agent}>{deviceLabel(r.agent)}</td>
                  </tr>
                ))}
                {rows && !shown.length && (
                  <tr>
                    <td colSpan={7} className="x-audit-empty">
                      조건에 맞는 기록이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}
function StepIcon({ stage, size = 20 }: { stage: ProgressStage; size?: number }) {
  const icons: Partial<Record<ProgressStage, typeof Search>> = {
    inspect: FileSearch,
    model: Binary,
    exploit: Braces,
    verify: FlaskConical,
    submit: Flag,
  };
  const Component = icons[stage] || Activity;
  return <Component size={size} strokeWidth={1.6} />;
}
function RadarScope({
  active: on,
  blips = 5,
  center,
}: {
  active: boolean;
  blips?: number;
  center?: ReactNode;
}) {
  return (
    <div className={`x-radar ${on ? "on" : ""}`}>
      <span className="x-radar-ring" />
      <span className="x-radar-ring" />
      <span className="x-radar-ring" />
      <span className="x-radar-sweep" />
      {Array.from({ length: blips }, (_, i) => (
        <i
          key={i}
          className="x-radar-blip"
          style={{
            left: `${50 + 36 * Math.cos(i * 2.4)}%`,
            top: `${50 + 36 * Math.sin(i * 2.4)}%`,
            animationDelay: `${i * 0.55}s`,
          }}
        />
      ))}
      <div className="x-radar-core">{center || <Orbit size={34} strokeWidth={1.3} />}</div>
    </div>
  );
}

function HistoryPage({
  runs,
  activeId,
  onOpen,
  onStart,
}: {
  runs: RunHistory;
  activeId?: string;
  onOpen: (id: string) => void;
  onStart: () => void;
}) {
  return (
    <section className="x-history">
      <header>
        <div>
          <span className="eyebrow">실행 기록</span>
          <h1>이전 실행</h1>
          <p>실행을 선택하면 당시의 풀이 과정과 지표를 다시 볼 수 있습니다.</p>
        </div>
        <button className="button primary" onClick={onStart} disabled={!!activeId}>
          <Rocket size={15} />새 실행 시작
        </button>
      </header>
      {runs.length ? (
        <div className="x-history-list">
          {runs.map((r) => (
            <button
              className={`x-history-row ${r.status}`}
              key={r.id}
              onClick={() => onOpen(r.id)}
            >
              <span className="x-history-icon">
                {active(r.status) ? <Radar size={18} /> : <History size={18} />}
              </span>
              <span>
                <strong>{r.title}</strong>
                <small>
                  {new Date(r.createdAt).toLocaleString("ko-KR")} · {r.model}
                  {r.demo ? " · 데모" : ""}
                </small>
              </span>
              <span className={`tag ${active(r.status) ? "live" : ""}`}>
                {labels[r.status]}
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))}
        </div>
      ) : (
        <p className="muted padded">아직 저장된 실행이 없습니다.</p>
      )}
    </section>
  );
}

function RunPage({
  view,
  running,
  elapsed,
  now,
  busy,
  motion,
  showFlags,
  hint,
  onHint,
  onSendHint,
  onStop,
  onDecide,
  onError,
}: {
  view: View;
  running: boolean;
  elapsed: number;
  now: number;
  busy: boolean;
  motion: boolean;
  showFlags: boolean;
  hint: string;
  onHint: (value: string) => void;
  onSendHint: (event: FormEvent) => void;
  onStop: () => void;
  onDecide: (name: string, decision: "approved" | "rejected") => void;
  onError: (message: string) => void;
}) {
  const pendingApproval =
    view.meta.config.submissionMode === "manual"
      ? view.challenges.find(
          (challenge) =>
            challenge.status === "candidate" &&
            !!challenge.flag &&
            !challenge.decision,
        )
      : undefined;
  return (
    <div className="x-run">
      <section className="x-run-head">
        <div>
          <span className="x-kicker">
            <i className={`dot ${running ? "amber pulse" : ""}`} />
            {view.meta.config.demo ? "EQST CTF 데모 · 실제 SEAL 실행" : "자율 CTF 실행"}
          </span>
          <h1>{view.meta.config.title}</h1>
          <p>
            {view.meta.config.model} · {view.meta.config.effort} · Agent{" "}
            {view.meta.config.agentId} · {new Date(view.meta.createdAt).toLocaleString("ko-KR")}
          </p>
        </div>
        <div className="x-run-controls">
          <div className={`x-timer ${running ? "live" : ""}`}>
            <Clock3 size={16} />
            <span>{formatTime(elapsed)}</span>
          </div>
          <span className={`status-pill ${running ? "live" : view.status}`}>
            <span className={`dot ${running ? "amber pulse" : ""}`} />
            {labels[view.status]}
          </span>
          {running && (
            <button className="button danger" disabled={busy} onClick={onStop}>
              <Square size={14} />
              중지
            </button>
          )}
        </div>
      </section>
      {pendingApproval?.flag && (
        <section className="approval-banner" role="alert" aria-live="assertive">
          <div className="approval-signal">
            <span />
            <Shield size={22} />
          </div>
          <div className="approval-copy">
            <span className="eyebrow">제출 승인 요청</span>
            <strong>{pendingApproval.name} 플래그 후보를 찾았습니다.</strong>
            <code>{pendingApproval.flag}</code>
            <p>승인하면 공식 제출 화면에서 한 번만 전송하고 실제 판정을 확인합니다.</p>
          </div>
          <div className="approval-actions">
            <button
              className="button danger"
              disabled={busy}
              onClick={() => onDecide(pendingApproval.name, "rejected")}
            >
              <X size={14} />
              제출 거부
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => onDecide(pendingApproval.name, "approved")}
            >
              <Check size={15} />이 후보 1회 제출 승인
            </button>
          </div>
        </section>
      )}
      <div className="x-command">
        <NowPanel view={view} running={running} showFlags={showFlags} motion={motion} />
        <SolveGauge view={view} running={running} motion={motion} />
      </div>
      <MetricsPanel view={view} elapsed={elapsed} running={running} motion={motion} now={now} />
      <ProblemBoard view={view} running={running} now={now} />
      <div className="x-story-grid">
        <Timeline view={view} showFlags={showFlags} />
        <SolutionCards view={view} showFlags={showFlags} />
      </div>
      <DetailSection
        view={view}
        running={running}
        showFlags={showFlags}
        busy={busy}
        hint={hint}
        onHint={onHint}
        onSendHint={onSendHint}
        onError={onError}
      />
    </div>
  );
}

function NowPanel({
  view,
  running,
  showFlags,
  motion,
}: {
  view: View;
  running: boolean;
  showFlags: boolean;
  motion: boolean;
}) {
  const focus = view.focus;
  const name = focus.challenge || view.currentChallenge;
  const problem = view.challenges.find((c) => c.name === name);
  const latestMessage = view.events.findLast((e) => e.kind === "message");
  const commands = view.tools.filter((t) => !isReporter(t.command)).slice(-4);
  const current = commands.findLast((t) => t.status === "running");
  // 현재 문제에서 실제로 지나온 단계를 표시한다.
  const reached = Math.max(
    stageIndex[focus.stage],
    ...view.events
      .filter((e) => e.kind === "progress" && e.data.challenge === name && e.data.stage)
      .map((e) => stageIndex[e.data.stage!]),
  );
  const heading = !view.catalogReady
    ? "대회 문제 목록을 확인하고 있습니다"
    : name || "다음 문제를 고르고 있습니다";
  return (
    <section className={`x-now ${running ? "live" : ""}`} aria-label="지금 하는 일">
      <div className="x-now-scope">
        <RadarScope
          active={running && motion}
          blips={Math.min(8, 3 + (view.stats.tools % 6))}
          center={<StepIcon stage={stageIndex[focus.stage] >= 0 && focus.stage !== "complete" ? focus.stage : "inspect"} size={30} />}
        />
      </div>
      <div className="x-now-body">
        <span className="x-kicker">
          <Radar size={13} />
          {running ? "지금 하는 일" : "마지막 작업"}
          {focus.source === "agent" ? " · 에이전트 보고" : " · 도구 활동 기준"}
        </span>
        <h2>
          {heading}
          {problem && <span className="x-cat">{category(problem.category)}</span>}
          {problem?.points !== undefined && <span className="x-pts">{problem.points}점</span>}
        </h2>
        <p className="x-now-summary">{safe(focus.summary, showFlags)}</p>
        {focus.next && (
          <p className="x-now-next">
            <ArrowRight size={13} />
            <b>다음</b>
            {safe(focus.next, showFlags)}
          </p>
        )}
        <ol className="x-stepper">
          {steps.map((step, index) => {
            // 현재 단계 이후라도 이미 거친 단계는 "거침"으로만 표시해 순서가 뒤집혀 보이지 않게 한다.
            const state =
              focus.stage === "complete" || index < stageIndex[focus.stage]
                ? "done"
                : index === stageIndex[focus.stage]
                  ? "now"
                  : index <= reached
                    ? "seen"
                    : "";
            return (
              <li key={step.stage} className={state} title={step.detail}>
                <span>
                  {state === "done" ? <Check size={13} /> : <StepIcon stage={step.stage} size={14} />}
                </span>
                {step.label}
              </li>
            );
          })}
          {focus.stage === "blocked" && (
            <li className="held">
              <span>
                <PauseCircle size={13} />
              </span>
              보류
            </li>
          )}
        </ol>
        <div className="x-ticker" aria-label="최근 실행한 명령">
          {commands.length ? (
            commands.map((t) => (
              <code key={t.id} className={t.status}>
                <span style={{ color: families.find((f) => f.key === t.family)?.color }}>
                  {familyLabels[t.family] || t.family}
                </span>
                {safe(shortCommand(t.command), showFlags).slice(0, 120)}
                {t === current && <i className="terminal-cursor" />}
              </code>
            ))
          ) : (
            <code>명령 실행을 기다리는 중</code>
          )}
        </div>
        {latestMessage?.detail && (
          <details className="x-now-message">
            <summary>
              <MessageSquare size={13} />
              에이전트 최근 보고 · {clock(latestMessage.at)}
            </summary>
            <div className="public-message">
              <PublicMessage>{safe(latestMessage.detail, showFlags)}</PublicMessage>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

function SolveGauge({
  view,
  running,
  motion,
}: {
  view: View;
  running: boolean;
  motion: boolean;
}) {
  const totals: Record<Board, number> = { queued: 0, working: 0, solved: 0, held: 0 };
  for (const c of view.challenges) totals[boardStatus(c, running)]++;
  const total = view.challenges.length;
  const solved = useCountUp(totals.solved, motion);
  const ratio = total ? totals.solved / total : 0;
  const r = 70,
    circumference = 2 * Math.PI * r;
  return (
    <section className="x-gauge" aria-label="문제 해결 현황">
      <div className="x-gauge-ring">
        <svg viewBox="0 0 180 180" role="img" aria-label={`전체 ${total}문제 중 ${totals.solved}문제 해결`}>
          <circle cx="90" cy="90" r={r} className="track" />
          {ratio > 0 && (
            <circle
              cx="90"
              cy="90"
              r={r}
              className="value"
              strokeDasharray={`${circumference * ratio} ${circumference}`}
            />
          )}
        </svg>
        <div>
          <strong>{solved}</strong>
          <span>/ {total || "–"} 해결</span>
        </div>
      </div>
      <ul className="x-gauge-legend">
        {(Object.keys(boardLabels) as Board[]).map((key) => (
          <li key={key} className={key}>
            <BoardIcon status={key} />
            {boardLabels[key]}
            <b>{totals[key]}</b>
          </li>
        ))}
      </ul>
      <p className="x-gauge-note">
        {view.catalogReady ? view.catalogSummary : "문제 목록을 확인하는 중"}
      </p>
    </section>
  );
}
function BoardIcon({ status }: { status: Board }) {
  if (status === "solved") return <Check size={13} />;
  if (status === "working") return <LoaderCircle size={13} className="spin" />;
  if (status === "held") return <PauseCircle size={13} />;
  return <Clock3 size={13} />;
}

function MetricsPanel({
  view,
  elapsed,
  running,
  motion,
  now,
}: {
  view: View;
  elapsed: number;
  running: boolean;
  motion: boolean;
  now: number;
}) {
  const s = view.stats;
  const minutes = Math.max(elapsed / 60_000, 1 / 60);
  const solvedTimes = Object.values(s.problems)
    .filter((p) => p.startedAt && p.endedAt)
    .map((p) => p.endedAt! - p.startedAt!);
  const attempted = Object.values(s.problems).filter((p) => p.startedAt).length;
  const clues =
    (s.findings.surface || 0) +
    (s.findings.structure || 0) +
    (s.findings.constraint || 0) +
    (s.findings.evidence || 0) +
    (s.findings.artifact || 0);
  const firstSolve = Math.min(
    ...Object.values(s.problems)
      .filter((p) => p.endedAt)
      .map((p) => p.endedAt! - view.meta.createdAt),
  );
  const span = Math.max(
    runSpan(s.activity, running, view.meta.createdAt, now),
    ...Object.values(s.series).map((values) => values.length),
  );
  // 타일 그래프는 실행 전체를 같은 시간 구간으로 나눈 실측 증가량이다.
  const trend = (values: number[] = []) => ({
    spark: bucketize(values, span, 16),
    recent: values.slice(Math.max(0, span - 5), span).reduce((a, b) => a + b, 0),
  });
  const tiles: Omit<TileProps, "motion" | "running">[] = [
    {
      label: "도구 호출",
      value: s.tools,
      unit: "회",
      note: `분당 ${(s.tools / minutes).toFixed(1)}회 · 사람 개입 0회`,
      icon: <Terminal size={20} />,
      color: "#45e3d1",
      hero: true,
      ...trend(s.activity),
    },
    {
      label: "실행한 코드",
      value: s.families.code || 0,
      unit: "회",
      note: "직접 작성한 풀이·분석 코드",
      icon: <Braces size={20} />,
      color: familyColor.code,
      ...trend(s.series["fam:code"]),
    },
    {
      label: "네트워크 요청",
      value: s.families.network || 0,
      unit: "회",
      note: "포털·문제 서버에 보낸 요청 명령",
      icon: <Radio size={20} />,
      color: familyColor.network,
      ...trend(s.series["fam:network"]),
    },
    {
      label: "탐색한 파일",
      value: s.fileCount,
      unit: "개",
      note: "명령으로 열거나 분석한 파일",
      icon: <FileSearch size={20} />,
      color: familyColor.inspect,
      ...trend(s.series.files),
    },
    {
      label: "작성·수정한 파일",
      value: s.written,
      unit: "개",
      note: "풀이 코드·노트·결과물",
      icon: <FilePen size={20} />,
      color: "#e8c33a",
      ...trend(s.series.written),
    },
    {
      label: "세운 가설",
      value: s.findings.hypothesis || 0,
      unit: "개",
      note: `확인한 단서 ${clues}개`,
      icon: <Lightbulb size={20} />,
      color: "#a98bff",
      ...trend(s.series["find:hypothesis"]),
    },
    {
      label: "찾은 취약점",
      value: s.findings.vulnerability || 0,
      unit: "개",
      note: `검증 결과 ${s.findings.result || 0}건`,
      icon: <Bug size={20} />,
      color: "#ff6b5e",
      ...trend(s.series["find:vulnerability"]),
    },
    {
      label: "문제당 평균 풀이",
      value: solvedTimes.length
        ? Math.round(solvedTimes.reduce((a, b) => a + b, 0) / solvedTimes.length / 1000)
        : 0,
      unit: "초",
      note: Number.isFinite(firstSolve)
        ? `첫 해결까지 ${formatDuration(firstSolve)} · 시도 ${attempted}문제`
        : `시도 ${attempted}문제`,
      icon: <Zap size={20} />,
      color: "#6ec3ff",
      // 이 타일의 막대는 시간 흐름이 아니라 해결한 문제별 풀이 시간(초)이다.
      spark: solvedTimes.map((ms) => Math.round(ms / 1000)),
      sparkLabel: "해결한 문제별 풀이 시간",
    },
  ];
  return (
    <section className="x-metrics" aria-label="자동 처리량">
      <header>
        <span className="x-kicker">
          <Activity size={13} />
          자동 처리량
        </span>
        <p>에이전트가 사람의 개입 없이 처리한 작업량입니다.</p>
      </header>
      <div className="x-metric-grid">
        {tiles.map((tile) => (
          <MetricTile key={tile.label} {...tile} motion={motion} running={running} />
        ))}
      </div>
      <div className="x-charts">
        <Throughput activity={s.activity} series={s.series} span={span} running={running} />
        <CommandMix stats={s.families} />
      </div>
    </section>
  );
}
type TileProps = {
  label: string;
  value: number;
  unit: string;
  note: string;
  icon: ReactNode;
  color: string;
  hero?: boolean;
  spark: number[];
  sparkLabel?: string;
  recent?: number;
  motion: boolean;
  running: boolean;
};
function MetricTile({
  label,
  value,
  unit,
  note,
  icon,
  color,
  hero,
  spark,
  sparkLabel,
  recent,
  motion,
  running,
}: TileProps) {
  const shown = useCountUp(value, motion);
  const formatted =
    unit === "초" && value >= 60 ? formatDuration(shown * 1000) : shown.toLocaleString("ko-KR");
  return (
    <div className={`x-tile ${hero ? "hero" : ""}`} style={{ "--c": color } as CSSProperties}>
      <span className="x-tile-label">
        {icon}
        {label}
      </span>
      {running && recent !== undefined && recent > 0 && (
        <span className="x-tile-delta" title="최근 5분 동안 늘어난 양">
          <TrendingUp size={13} />+{recent.toLocaleString("ko-KR")}
          <small>최근 5분</small>
        </span>
      )}
      <div className="x-tile-row">
        <strong key={value}>
          {formatted}
          {!(unit === "초" && value >= 60) && <small>{unit}</small>}
        </strong>
        <Spark values={spark} label={sparkLabel || `${label} 시간대별 증가량`} unit={unit} />
      </div>
      <p>{note}</p>
    </div>
  );
}
// 타일 하단의 작은 막대그래프. 0인 구간은 바닥 점선으로만 표시한다.
function Spark({ values, label, unit }: { values: number[]; label: string; unit: string }) {
  if (!values.length) return <div className="x-spark empty" aria-hidden="true" />;
  const w = 132,
    h = 40,
    gap = 2;
  const max = Math.max(1, ...values);
  const bar = Math.min(10, (w - gap * (values.length - 1)) / values.length);
  const left = w - values.length * (bar + gap) + gap;
  return (
    <svg
      className="x-spark"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`${label}: ${values.join(", ")}${unit}`}
    >
      {values.map((v, i) => {
        const x = left + i * (bar + gap);
        if (!v) return <rect key={i} className="zero" x={x} y={h - 2} width={bar} height={2} rx={1} />;
        const height = Math.max(4, (v / max) * h);
        return (
          <rect
            key={i}
            x={x}
            y={h - height}
            width={bar}
            height={height}
            rx={2}
            style={{ opacity: 0.45 + (0.55 * (i + 1)) / values.length }}
          >
            <title>
              {v}
              {unit}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}
// 시간 구간별 도구 호출 수를 명령 종류로 쌓은 막대그래프. 색은 옆 "실행한 명령 종류" 범례와 같다.
function Throughput({
  activity,
  series,
  span,
  running,
}: {
  activity: number[];
  series: Record<string, number[]>;
  span: number;
  running: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const size = Math.max(1, Math.ceil(span / 30));
  const keys = [...families.map((f) => f.key), "browser"];
  const stacks = keys.map((key) => bucketize(series[`fam:${key}`] || [], span, 30));
  const totals = bucketize(activity, span, 30);
  // 이전 기록처럼 종류별 분 단위 값이 없으면 합계만 한 색으로 그린다.
  const known = stacks.reduce((sum, values) => sum + values.reduce((a, b) => a + b, 0), 0);
  const columns = totals.map((total, i) =>
    known
      ? keys.map((key, k) => ({ key, value: stacks[k][i] || 0 })).filter((c) => c.value)
      : total
        ? [{ key: "all", value: total }]
        : [],
  );
  const perMinute = Array.from({ length: span }, (_, i) => activity[i] || 0);
  const peak = perMinute.indexOf(Math.max(...perMinute));
  const w = 560,
    h = 190,
    pad = { l: 30, r: 6, t: 10, b: 24 };
  const max = Math.max(4, ...totals);
  const slot = (w - pad.l - pad.r) / totals.length;
  const bar = Math.min(26, slot * 0.72);
  const x = (i: number) => pad.l + i * slot + (slot - bar) / 2;
  const y = (v: number) => h - pad.b - (v / max) * (h - pad.t - pad.b);
  const range = (i: number) =>
    size === 1 ? `${i + 1}분째` : `${i * size + 1}~${Math.min(span, (i + 1) * size)}분`;
  return (
    <figure className="x-chart x-throughput">
      <figcaption>
        <span className="x-chart-title">
          {size === 1 ? "분당 도구 호출" : `${size}분 단위 도구 호출`}
        </span>
        <span className="x-chart-stat">
          <b>{perMinute[peak]}</b>회 <small>분당 최고 · {peak + 1}분째</small>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`시간대별 도구 호출, 분당 최고 ${perMinute[peak]}회`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * w;
          const i = Math.floor((px - pad.l) / slot);
          setHover(i >= 0 && i < totals.length ? i : null);
        }}
      >
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line className="grid" x1={pad.l} x2={w - pad.r} y1={y(max * t)} y2={y(max * t)} />
            <text className="axis" x={pad.l - 7} y={y(max * t) + 4} textAnchor="end">
              {Math.round(max * t)}
            </text>
          </g>
        ))}
        <text className="axis" x={pad.l} y={h - 6}>
          시작
        </text>
        <text className="axis" x={w - pad.r} y={h - 6} textAnchor="end">
          {span}분
        </text>
        {hover !== null && (
          <rect className="hover-band" x={pad.l + hover * slot} y={pad.t} width={slot} height={h - pad.t - pad.b} />
        )}
        {columns.map((column, i) => {
          let top = h - pad.b;
          return (
            <g key={i} className={hover !== null && hover !== i ? "dim" : ""}>
              {column.map((c, k) => {
                const height = (c.value / max) * (h - pad.t - pad.b);
                top -= height;
                const last = k === column.length - 1;
                return (
                  <rect
                    key={c.key}
                    x={x(i)}
                    y={top + (last ? 0 : 1)}
                    width={bar}
                    height={Math.max(1, height - (last ? 0 : 1))}
                    rx={last ? 3 : 0}
                    fill={familyColor[c.key] || "#45e3d1"}
                  />
                );
              })}
            </g>
          );
        })}
        {running && totals.length > 0 && (
          <circle className="live-dot" cx={x(totals.length - 1) + bar / 2} cy={y(totals.at(-1)!) - 8} r="4" />
        )}
      </svg>
      {hover !== null && (
        <div className="x-tip" style={{ left: `${((x(hover) + bar / 2) / w) * 100}%` }}>
          <b>
            {range(hover)} · {totals[hover]}회
          </b>
          {columns[hover]
            .filter((c) => c.key !== "all")
            .map((c) => (
              <span key={c.key}>
                <i style={{ background: familyColor[c.key] || "#45e3d1" }} />
                {familyLabels[c.key] || c.key} {c.value}
              </span>
            ))}
        </div>
      )}
    </figure>
  );
}
function CommandMix({ stats }: { stats: Record<string, number> }) {
  const rows = families.map((f) => ({ ...f, value: stats[f.key] || 0 }));
  const total = rows.reduce((a, b) => a + b.value, 0);
  const top = Math.max(1, ...rows.map((r) => r.value));
  const [hover, setHover] = useState("");
  const r = 62,
    circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <figure className="x-chart x-mix">
      <figcaption>
        <span className="x-chart-title">실행한 명령 종류</span>
        <span className="x-chart-stat">
          <small>총</small> <b>{total.toLocaleString("ko-KR")}</b>회
        </span>
      </figcaption>
      <div className="x-mix-body">
        <div className="x-donut">
          <svg viewBox="0 0 160 160" role="img" aria-label={rows.map((row) => `${row.label} ${row.value}회`).join(", ")}>
            <circle cx="80" cy="80" r={r} className="track" />
            {rows
              .filter((row) => row.value)
              .map((row) => {
                const length = (row.value / total) * circumference;
                const gap = rows.filter((x) => x.value).length > 1 ? 2.5 : 0;
                const segment = (
                  <circle
                    key={row.key}
                    cx="80"
                    cy="80"
                    r={r}
                    stroke={row.color}
                    strokeDasharray={`${Math.max(0.5, length - gap)} ${circumference}`}
                    strokeDashoffset={-offset}
                    className={hover && hover !== row.key ? "dim" : ""}
                    onMouseEnter={() => setHover(row.key)}
                    onMouseLeave={() => setHover("")}
                  >
                    <title>{`${row.label} ${row.value}회 (${Math.round((row.value / total) * 100)}%)`}</title>
                  </circle>
                );
                offset += length;
                return segment;
              })}
          </svg>
          <div>
            <strong>{total.toLocaleString("ko-KR")}</strong>
            <span>총 명령</span>
          </div>
        </div>
        <ul className="x-mix-legend">
          {rows.map((row) => (
            <li
              key={row.key}
              className={hover && hover !== row.key ? "dim" : ""}
              onMouseEnter={() => setHover(row.key)}
              onMouseLeave={() => setHover("")}
            >
              <i style={{ background: row.color }} />
              <span>{row.label}</span>
              <em>
                <u style={{ width: `${(row.value / top) * 100}%`, background: row.color }} />
              </em>
              <b>{row.value}</b>
              <small>{total ? `${Math.round((row.value / total) * 100)}%` : "–"}</small>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

function ProblemBoard({
  view,
  running,
  now,
}: {
  view: View;
  running: boolean;
  now: number;
}) {
  const current = view.focus.challenge || view.currentChallenge;
  return (
    <section className="x-board" aria-label="문제 보드">
      <PanelTitle
        icon={<Flag size={16} />}
        title="문제 보드"
        tail={<span className="count-badge">{view.challenges.length}</span>}
      />
      {view.challenges.length ? (
        <div className="x-board-grid">
          {view.challenges.map((c) => {
            const status = boardStatus(c, running);
            const stat = view.stats.problems[c.name];
            const took =
              stat?.startedAt &&
              (stat.endedAt || (status === "working" ? now : undefined));
            const isCurrent = running && c.name === current && status === "working";
            return (
              <article
                key={c.name}
                className={`x-card ${status} ${isCurrent ? "current" : ""}`}
                title={c.description}
              >
                <header>
                  <span className="x-card-cat">{category(c.category)}</span>
                  {c.points !== undefined && <span className="x-card-pts">{c.points}</span>}
                </header>
                <strong>{c.name}</strong>
                <footer>
                  <span className={`x-state ${status}`}>
                    <BoardIcon status={status} />
                    {boardLabels[status]}
                  </span>
                  <small>
                    {took && stat?.startedAt
                      ? `${formatDuration(took - stat.startedAt)} · 도구 ${stat.tools}`
                      : status === "held"
                        ? heldReason(c, running)
                        : ""}
                  </small>
                </footer>
                {status === "held" && took && <p className="x-card-reason">{heldReason(c, running)}</p>}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="x-board-empty">
          <Search size={20} />
          에이전트가 대회 문제 목록을 확인하면 문제가 이곳에 나타납니다.
        </div>
      )}
    </section>
  );
}

function Timeline({ view, showFlags }: { view: View; showFlags: boolean }) {
  const items = [...view.story].reverse().slice(0, 60);
  return (
    <section className="x-timeline panel" aria-label="풀이 타임라인">
      <PanelTitle
        icon={<Activity size={17} />}
        title="풀이 타임라인"
        tail={<span className="x-sub">발견 → 가설 → 검증 → 제출</span>}
      />
      <ol>
        {items.length ? (
          items.map((item) => <TimelineItem key={item.id} item={item} showFlags={showFlags} />)
        ) : (
          <li className="x-tl-empty">실행이 시작되면 에이전트의 발견과 판단이 시간순으로 쌓입니다.</li>
        )}
      </ol>
    </section>
  );
}
function TimelineItem({ item, showFlags }: { item: Story; showFlags: boolean }) {
  const tone =
    item.kind === "submission"
      ? item.outcome === "accepted"
        ? "good"
        : "warn"
      : item.kind === "solution"
        ? "good"
        : item.kind === "blocked"
          ? "warn"
          : item.kind === "finding"
            ? item.type || "finding"
            : item.kind;
  const icon =
    item.kind === "tools" ? (
      <Terminal size={14} />
    ) : item.kind === "finding" ? (
      item.type === "vulnerability" ? (
        <Bug size={14} />
      ) : item.type === "hypothesis" ? (
        <Lightbulb size={14} />
      ) : (
        <Search size={14} />
      )
    ) : item.kind === "submission" || item.kind === "solution" ? (
      <ShieldCheck size={14} />
    ) : item.kind === "candidate" ? (
      <Flag size={14} />
    ) : item.kind === "blocked" ? (
      <PauseCircle size={14} />
    ) : item.kind === "select" ? (
      <Radar size={14} />
    ) : (
      <Search size={14} />
    );
  if (item.kind === "tools") {
    const parts = families
      .filter((f) => item.families?.[f.key])
      .map((f) => `${f.label} ${item.families![f.key]}`);
    return (
      <li className={`x-tl tools`}>
        <time>{clock(item.at)}</time>
        <span className="x-tl-icon">{icon}</span>
        <div>
          <strong>
            명령 {item.count}개 실행
            {item.until && item.until > item.at ? (
              <small> · {formatDuration(item.until - item.at)}</small>
            ) : null}
          </strong>
          <span className="x-tl-mix">
            {families
              .filter((f) => item.families?.[f.key])
              .map((f) => (
                <i key={f.key} style={{ flexGrow: item.families![f.key], background: f.color }} />
              ))}
          </span>
          <p>{parts.join(" · ")}</p>
        </div>
      </li>
    );
  }
  const tag =
    item.kind === "finding"
      ? findingLabels[item.type || ""] || "발견"
      : item.kind === "select"
        ? category(item.type || "misc")
        : item.kind === "catalog"
          ? "준비"
          : item.kind === "candidate"
            ? "후보"
            : item.kind === "submission"
              ? "판정"
              : item.kind === "solution"
                ? "해결"
                : "보류";
  return (
    <li className={`x-tl ${tone}`}>
      <time>{clock(item.at)}</time>
      <span className="x-tl-icon">{icon}</span>
      <div>
        <strong>
          <em>{tag}</em>
          {safe(item.title, showFlags)}
          {item.challenge && item.kind !== "select" && <small> · {item.challenge}</small>}
        </strong>
        {item.detail && item.kind !== "candidate" && <p>{safe(item.detail, showFlags)}</p>}
      </div>
    </li>
  );
}

function SolutionCards({ view, showFlags }: { view: View; showFlags: boolean }) {
  return (
    <section className="x-solutions panel" aria-label="해결 카드">
      <PanelTitle
        icon={<ShieldCheck size={17} />}
        title="해결 카드"
        tail={<span className="count-badge">{view.solutions.length}</span>}
      />
      {view.solutions.length ? (
        <div className="x-solution-list">
          {[...view.solutions].reverse().map((solution) => {
            const problem = view.challenges.find((c) => c.name === solution.challenge);
            const stat = view.stats.problems[solution.challenge];
            return (
              <article className="x-solution" key={solution.challenge}>
                <header>
                  <span className="x-solution-check">
                    <Check size={15} />
                  </span>
                  <div>
                    <strong>{solution.challenge}</strong>
                    <small>
                      {problem ? `${category(problem.category)} · ` : ""}
                      {stat?.startedAt && stat.endedAt
                        ? `${formatDuration(stat.endedAt - stat.startedAt)} · 도구 ${stat.tools}회`
                        : clock(solution.at)}
                    </small>
                  </div>
                  {problem?.status === "accepted" && <span className="x-accepted">정답</span>}
                </header>
                <dl>
                  <div>
                    <dt>핵심 원리</dt>
                    <dd>{safe(solution.summary, showFlags)}</dd>
                  </div>
                  <div>
                    <dt>풀이 과정</dt>
                    <dd>{safe(solution.method, showFlags)}</dd>
                  </div>
                  {solution.evidence && (
                    <div>
                      <dt>확인 근거</dt>
                      <dd>{safe(solution.evidence, showFlags)}</dd>
                    </div>
                  )}
                </dl>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="x-solutions-empty">
          <ShieldCheck size={26} strokeWidth={1.3} />
          문제를 해결하면 무엇이 취약했고 어떻게 풀었는지가 카드로 정리됩니다.
        </div>
      )}
    </section>
  );
}

function DetailSection({
  view,
  running,
  showFlags,
  busy,
  hint,
  onHint,
  onSendHint,
  onError,
}: {
  view: View;
  running: boolean;
  showFlags: boolean;
  busy: boolean;
  hint: string;
  onHint: (value: string) => void;
  onSendHint: (event: FormEvent) => void;
  onError: (message: string) => void;
}) {
  const [tab, setTab] = useState<"terminal" | "files">("terminal");
  const [selectedTool, setSelectedTool] = useState("");
  const [artifact, setArtifact] = useState<{ name: string; text: string } | null>(null);
  const currentTool = view.tools.findLast((t) => t.status === "running") || view.tools.at(-1);
  const terminal: Tool | undefined =
    view.tools.find((t) => t.id === selectedTool) || currentTool;
  const feed = view.events
    .filter(
      (e) =>
        [
          "message",
          "catalog",
          "progress",
          "finding",
          "challenge",
          "candidate",
          "approval",
          "submission",
          "solution",
          "operator",
          "error",
        ].includes(e.kind) ||
        (e.kind === "tool" && e.data.status !== "running"),
    )
    .slice(-35)
    .reverse();
  return (
    <section className="x-detail" aria-label="상세 지표">
      <header className="x-detail-head">
        <h2>상세 지표</h2>
        <p>
          실행 로그와 작업 파일, 원본 이벤트를 그대로 보여줍니다. 도구 실행 {view.toolCount}회(대시보드
          보고 {view.stats.reports}회 포함) · 종료 코드 오류 {view.nonzeroCount}회 · 출력 토큰{" "}
          {count(view.tokens.output)}(응답 단위로 집계)
        </p>
      </header>
      <div className="x-detail-grid">
        <section className="stage panel">
          <div className="stage-header">
            <div className="stage-tabs" role="tablist" aria-label="상세 화면">
              <button role="tab" aria-selected={tab === "terminal"} onClick={() => setTab("terminal")}>
                <Terminal size={15} />
                실행 로그<span>{view.tools.length}</span>
              </button>
              <button role="tab" aria-selected={tab === "files"} onClick={() => setTab("files")}>
                <FileCode2 size={15} />
                작업 파일<span>{view.artifacts.length}</span>
              </button>
            </div>
            <span className="stage-status">
              <span className={`dot ${running ? "blue" : ""}`} />
              {running ? "작업 중" : "저장된 기록"}
            </span>
          </div>
          {tab === "terminal" && (
            <div className="terminal-view">
              <div className="terminal-list">
                {view.tools
                  .slice(-24)
                  .reverse()
                  .map((t) => (
                    <button
                      key={t.id}
                      className={terminal?.id === t.id ? "tool-choice selected" : "tool-choice"}
                      onClick={() => setSelectedTool(t.id)}
                    >
                      <Icon type={t.family} />
                      <span>{safe(shortCommand(t.command), showFlags).slice(0, 52)}</span>
                      <span className={`tool-dot ${t.status}`} />
                    </button>
                  ))}
                {!view.tools.length && <p className="empty-small">실행한 명령이 여기에 나타납니다.</p>}
              </div>
              <div className="terminal-code">
                <div className="terminal-meta">
                  <span>{terminal ? familyLabels[terminal.family] || terminal.family : "명령 실행"}</span>
                  <span>
                    {terminal?.endedAt
                      ? `${((terminal.endedAt - terminal.startedAt) / 1000).toFixed(1)}s · exit ${terminal.exitCode ?? "—"}`
                      : terminal
                        ? "실행 중"
                        : "대기 중"}
                  </span>
                </div>
                <pre className="command-line">
                  {terminal ? `$ ${safe(terminal.command, showFlags)}` : "$ 에이전트의 실제 명령을 기다리는 중"}
                </pre>
                <pre className="command-output">
                  {terminal
                    ? safe(
                        terminal.output ||
                          (terminal.status === "running"
                            ? "프로세스가 실행 중입니다…"
                            : terminal.status === "stopped"
                              ? "중단됨 · 완전한 결과를 받지 못했습니다."
                              : "출력 없이 종료되었습니다."),
                        showFlags,
                      )
                    : "가짜 명령이나 시뮬레이션 출력을 표시하지 않습니다."}
                </pre>
                {terminal?.status === "running" && <span className="terminal-cursor" />}
              </div>
            </div>
          )}
          {tab === "files" && (
            <div className="file-list">
              {view.artifacts.length ? (
                view.artifacts.map((f) => (
                  <button
                    key={f.path}
                    onClick={async () => {
                      try {
                        const r = await fetch(
                          `/api/runs/${view.meta.id}/artifact?path=${encodeURIComponent(f.path)}`,
                        );
                        if (!r.ok) throw new Error("파일을 열 수 없습니다.");
                        setArtifact({ name: f.path, text: await r.text() });
                      } catch (e) {
                        onError(String(e));
                      }
                    }}
                  >
                    <FileCode2 size={17} />
                    <span>{f.path}</span>
                    <small>{count(f.bytes)} B</small>
                    <ArrowUpRight size={14} />
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  <FileCode2 size={28} />
                  <h3>작업 파일이 아직 없습니다</h3>
                  <p>문제 파일, 풀이 코드, 실행 결과를 실제 작업 폴더에서 가져옵니다.</p>
                </div>
              )}
            </div>
          )}
        </section>
        <section className="activity panel">
          <PanelTitle
            icon={<Activity size={17} />}
            title="원본 이벤트"
            tail={
              <div className="activity-actions">
                <a href={`/api/runs/${view.meta.id}/log`} className="text-button">
                  <Download size={14} />
                  로그 저장
                </a>
              </div>
            }
          />
          <div className="feed">
            {feed.length ? (
              feed.map((e) => (
                <EventRow
                  key={e.seq}
                  event={e}
                  showFlags={showFlags}
                  onTool={() => {
                    if (e.data.id) {
                      setTab("terminal");
                      setSelectedTool(e.data.id);
                    }
                  }}
                />
              ))
            ) : (
              <div className="empty-feed">
                <span className="dot" />
                <p>실행 이벤트가 시간순으로 쌓입니다.</p>
              </div>
            )}
          </div>
        </section>
      </div>
      <form className="operator-bar" onSubmit={onSendHint}>
        <MessageSquare size={18} />
        <input
          id="hint"
          aria-label="에이전트에게 지시"
          value={hint}
          onChange={(e) => onHint(e.target.value)}
          placeholder={
            running
              ? "필요할 때만 개입하세요. 현재 턴을 중단하고 같은 대화에서 이어갑니다…"
              : "후속 지시를 입력해 같은 대화를 이어가세요…"
          }
          disabled={!view.threadId}
        />
        <button
          type="submit"
          className="button primary compact"
          disabled={!view.threadId || busy || !hint.trim()}
        >
          <Send size={15} />
          {running ? "지시 전달" : "이어하기"}
        </button>
      </form>
      {artifact && (
        <div className="artifact-overlay">
          <section>
            <PanelTitle
              icon={<FileCode2 size={17} />}
              title={artifact.name}
              tail={
                <button className="icon-btn" aria-label="파일 닫기" onClick={() => setArtifact(null)}>
                  <X size={20} />
                </button>
              }
            />
            <pre>{safe(artifact.text, showFlags)}</pre>
          </section>
        </div>
      )}
    </section>
  );
}

const PublicMessage = memo(function PublicMessage({
  children,
}: {
  children: string;
}) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ children: text }) => <span className="note-link">{text}</span>,
        img: () => null,
      }}
    >
      {children}
    </Markdown>
  );
});

function EventRow({
  event,
  showFlags,
  onTool,
}: {
  event: LiveEvent;
  showFlags: boolean;
  onTool: () => void;
}) {
  return (
    <details className={`event-row ${event.kind}`}>
      <summary>
        <time>
          {new Date(event.at).toLocaleTimeString("en-GB", { hour12: false })}
        </time>
        <span className="event-icon">
          <Icon
            type={
              event.kind === "tool" ? event.data.family || "shell" : event.kind
            }
          />
        </span>
        <div>
          <strong>
            {event.kind === "tool"
              ? familyLabels[event.data.family || "shell"] || "도구 실행"
              : safe(event.title, showFlags)}
          </strong>
          <span>
            {safe(
              event.kind === "tool"
                ? shortCommand(event.data.command || "")
                : event.detail || event.data.challenge || "",
              showFlags,
            ).slice(0, 140)}
          </span>
        </div>
        {event.kind === "tool" ? (
          <span
            className={`exit-badge ${event.data.status === "error" ? "bad" : ""}`}
          >
            {event.data.status === "stopped"
              ? "stopped"
              : event.data.exitCode !== null &&
                  event.data.exitCode !== undefined
                ? `exit ${event.data.exitCode}`
                : "done"}
          </span>
        ) : event.kind === "submission" ? (
          <span className="source-tag">
            {event.data.source === "platform" ? "채점 확인" : "에이전트 보고"}
          </span>
        ) : null}
        <ChevronDown size={14} />
      </summary>
      <div className="event-detail">
        {event.kind === "message" ? (
          <div className="public-message">
            <PublicMessage>{safe(event.detail || "", showFlags)}</PublicMessage>
          </div>
        ) : (
          <pre>
            {safe(
              event.kind === "tool"
                ? `${event.data.command}\n\n${event.data.output || ""}`
                : `${event.detail || ""}\n${event.data.flag || ""}\n${event.data.evidence || ""}`,
              showFlags,
            )}
          </pre>
        )}
        {event.kind === "tool" && (
          <button className="text-button" onClick={onTool}>
            실행 로그에서 보기
            <ArrowUpRight size={13} />
          </button>
        )}
      </div>
    </details>
  );
}

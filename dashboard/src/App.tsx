import {
  useEffect,
  useRef,
  useState,
  memo,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  Flag,
  Globe2,
  History,
  LayoutDashboard,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Minus,
  Orbit,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  Settings2,
  Shield,
  Square,
  Terminal,
  Unplug,
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
  viewSchema,
  type Health,
  type LiveEvent,
  type RunConfig,
  type RunHistory,
  type RunStatus,
  type ProgressStage,
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
  yolo: false,
  submissionMode: "manual",
  browser: import.meta.env.VITE_DEFAULT_BROWSER !== "0",
  browserId: "",
  maxMinutes: 30,
  demo: false,
};
const authSchema = z.object({
  authenticated: z.boolean(),
  user: z.string().optional(),
});
const labels: Record<RunStatus, string> = {
  starting: "준비 중",
  running: "진행 중",
  stopping: "중지 중",
  stopped: "중지됨",
  completed: "응답 완료",
  failed: "실행 오류",
  interrupted: "연결 중단",
};
const stageLabels: Record<ProgressStage, string> = {
  survey: "대회 살펴보기",
  ready: "준비 완료",
  inspect: "자료 확인",
  model: "구조 분석",
  exploit: "풀이 실행",
  verify: "후보 검증",
  submit: "제출 확인",
  blocked: "진행 보류",
  complete: "문제 완료",
};
const familyLabels: Record<string, string> = {
  browser: "브라우저",
  inspect: "자료 관찰",
  code: "코드 실행",
  network: "네트워크",
  reverse: "바이너리 분석",
  shell: "터미널",
};
const categoryLabels: Record<string, string> = {
  web: "웹",
  crypto: "암호",
  pwn: "시스템 해킹",
  rev: "리버싱",
  reverse: "리버싱",
  forensics: "포렌식",
  misc: "기타",
  osint: "공개정보 조사",
};
const findingLabels: Record<string, string> = {
  surface: "접속 대상",
  structure: "동작 구조",
  constraint: "제약 조건",
  hypothesis: "가설",
  evidence: "확인한 응답",
  vulnerability: "취약점",
  artifact: "분석 자료",
  blocker: "막힌 지점",
  result: "검증 결과",
};
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
    catalog: LayoutDashboard,
    progress: Radio,
    finding: Search,
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
        <p>
          대회 실행, 브라우저 화면과 풀이 기록은 인증된 운영자에게만 공개됩니다.
        </p>
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
    [runs, setRuns] = useState<RunHistory>([]);
  const [setup, setSetup] = useState(false),
    [showHistory, setShowHistory] = useState(false),
    [form, setForm] = useState<RunConfig>(initial);
  const [showFlags, setShowFlags] = useState(false),
    [motion, setMotion] = useState(true),
    [presenting, setPresenting] = useState(false);
  const [tab, setTab] = useState<"browser" | "terminal" | "files">("browser"),
    [selectedTool, setSelectedTool] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [hint, setHint] = useState("");
  const [artifact, setArtifact] = useState<{
      name: string;
      text: string;
    } | null>(null),
    [celebration, setCelebration] = useState("");
  const [authStatus, setAuthStatus] = useState<
      "checking" | "anonymous" | "authenticated"
    >("checking"),
    [authUser, setAuthUser] = useState(""),
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
    setSelectedTool("");
    window.history.replaceState({}, "", `?run=${id}`);
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
    const id =
      new URLSearchParams(location.search).get("run") ||
      bootstrap.activeId ||
      bootstrap.runs[0]?.id;
    if (id) await selectRun(id);
    setHealth(healthSchema.parse(await api("/api/health")));
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
    setAuthStatus("anonymous");
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
  useEffect(() => {
    const awaitingApproval =
      view?.meta.config.submissionMode === "manual" &&
      view.challenges.some(
        (challenge) =>
          challenge.status === "candidate" &&
          !!challenge.flag &&
          !challenge.decision,
      );
    document.title = view
      ? `${awaitingApproval ? "승인 대기 · " : ""}${view.meta.config.title} · EQST CTF Agent`
      : "EQST CTF Agent";
  }, [view]);
  const running = view ? active(view.status) : false;
  const currentTool =
    view?.tools.findLast((t) => t.status === "running") || view?.tools.at(-1);
  const terminal =
    view?.tools.find((t) => t.id === selectedTool) || currentTool;
  const accepted =
    view?.challenges.filter((c) => c.status === "accepted") || [];
  const confirmed = accepted.filter((c) => c.source === "platform");
  const pendingApproval =
    view?.meta.config.submissionMode === "manual"
      ? view.challenges.find(
          (challenge) =>
            challenge.status === "candidate" &&
            !!challenge.flag &&
            !challenge.decision,
        )
      : undefined;
  const elapsed = view
    ? view.activeMs + (running && view.startedAt ? now - view.startedAt : 0)
    : 0;
  const feed =
    view?.events
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
      .reverse() || [];
  const latestCandidate = [...(view?.events || [])]
    .reverse()
    .find((e) => e.kind === "candidate");
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
      await selectRun(response.id);
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
  async function chooseChallenge(name: string) {
    if (!view || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/runs/${view.meta.id}/select-challenge`, {
        challenge: name,
      });
    } catch (selectionError) {
      setError(String(selectionError));
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
  function configureDemo() {
    setForm({
      ...initial,
      title: "Signal Lab",
      url: location.origin,
      demo: true,
      effort: "low",
      submissionMode: "auto",
      browserId: health?.connected[0]?.instance_id || "",
      maxMinutes: 10,
      prompt:
        "로컬 데모 사이트의 두 문제를 브라우저에서 차례로 열어 분석하고 직접 풀어. 각 문제의 flag를 즉시 보고하고 해당 페이지의 Submit flag 버튼으로 한 번 제출해. Accepted 응답을 관찰한 후 다음 문제로 진행하고, 두 문제를 모두 시도했으면 결과를 요약해.",
      rules:
        "이 실행의 localhost 대회 URL만 대상. 실제 SEAL 실행이며 시뮬레이션 로그를 생성하지 말 것. 다른 사용자 파일과 탭에는 접근하지 말 것.",
    });
    setSetup(true);
    setError("");
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

  return (
    <div
      className={`app ${presenting ? "presenting" : ""} ${motion ? "" : "no-motion"}`}
    >
      <a className="skip" href="#main">
        본문으로 이동
      </a>
      <aside className="navrail">
        <div className="mark" aria-label="SEAL">
          <Orbit size={29} />
        </div>
        <button
          className={!showHistory ? "nav active" : "nav"}
          aria-label="라이브 대시보드"
          onClick={() => setShowHistory(false)}
        >
          <LayoutDashboard size={21} />
        </button>
        <button
          className={showHistory ? "nav active" : "nav"}
          aria-label="실행 기록"
          onClick={() => {
            setShowHistory(!showHistory);
            void refreshRuns();
          }}
        >
          <History size={21} />
        </button>
        <div className="rail-line" />
        <button
          className="nav"
          aria-label="새 실행 설정"
          onClick={() => {
            setForm({
              ...initial,
              browserId: health?.connected[0]?.instance_id || "",
            });
            setSetup(true);
          }}
        >
          <Plus size={21} />
        </button>
        <span className="rail-bottom">eqst</span>
      </aside>
      <div className="shell">
        <header className="topbar">
          <a className="wordmark" href="/" aria-label="EQST CTF Agent">
            EQST <span>CTF Agent</span>
          </a>
          <div className="top-divider" />
          <span className="product-name">AI 기반 자율형 CTF 에이전트</span>
          <div className="header-actions">
            <span className="connection">
              <span className={`dot ${connected ? "green" : ""}`} />
              {view
                ? connected
                  ? "실시간 업데이트 중"
                  : "다시 연결하는 중"
                : "대회 시작을 기다리고 있습니다"}
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
              className="icon-btn"
              aria-label={presenting ? "발표 화면 해제" : "발표 화면"}
              title="발표 화면"
              onClick={() => setPresenting(!presenting)}
            >
              <Maximize2 size={18} />
            </button>
            <button
              className="icon-btn logout-control"
              aria-label={`${authUser || "Operator"} 로그아웃`}
              title={`${authUser || "Operator"} 로그아웃`}
              onClick={() => void logout()}
            >
              <Unplug size={17} />
            </button>
            <button
              type="button"
              className="button secondary compact flag-visibility"
              aria-pressed={showFlags}
              title="화면의 텍스트 플래그를 표시하거나 가립니다. 브라우저 이미지는 원문입니다."
              onClick={() => setShowFlags((visible) => !visible)}
            >
              {showFlags ? <EyeOff size={17} /> : <Eye size={17} />}
              {showFlags ? "플래그 숨기기" : "플래그 보기"}
            </button>
            <button
              className="button primary compact"
              onClick={() => {
                setForm({
                  ...initial,
                  browserId: health?.connected[0]?.instance_id || "",
                });
                setSetup(true);
              }}
            >
              <Plus size={15} />새 실행
            </button>
          </div>
        </header>
        {showHistory && (
          <section className="history-drawer">
            <PanelTitle
              icon={<History size={17} />}
              title="실행 기록"
              tail={
                <button
                  className="icon-btn"
                  onClick={() => setShowHistory(false)}
                  aria-label="기록 닫기"
                >
                  <X size={16} />
                </button>
              }
            />
            {runs.length ? (
              runs.map((r) => (
                <button
                  className="history-row"
                  key={r.id}
                  onClick={() => {
                    void selectRun(r.id);
                    setShowHistory(false);
                  }}
                >
                  <span>
                    <strong>{r.title}</strong>
                    <small>
                      {new Date(r.createdAt).toLocaleString("ko-KR")} ·{" "}
                      {r.model}
                    </small>
                  </span>
                  <span className="tag">{labels[r.status]}</span>
                </button>
              ))
            ) : (
              <p className="muted padded">아직 저장된 실행이 없습니다.</p>
            )}
          </section>
        )}
        <main id="main">
          {error && (
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
          <section className="mission-heading">
            <div>
              <div className="eyebrow">
                <span className={`dot ${running ? "amber pulse" : ""}`} />
                {view
                  ? view.meta.config.demo
                    ? "로컬 데모 · 실제 SEAL 실행"
                    : "자율 CTF 플레이 · 단일 에이전트"
                  : "대회 준비부터 문제 풀이까지"}
              </div>
              <h1>{view?.meta.config.title || "대회를 시작해 보세요"}</h1>
              <p>
                {view
                  ? `${view.meta.config.url} · Agent ${view.meta.config.agentId}`
                  : "탐색에서 플래그까지, 실제 문제 풀이가 눈앞에서 이어집니다."}
              </p>
            </div>
            <div className="mission-controls">
              {view && (
                <>
                  <span
                    className={`status-pill ${running ? "live" : view.status}`}
                  >
                    <span className={`dot ${running ? "amber pulse" : ""}`} />
                    {labels[view.status]}
                  </span>
                  {running ? (
                    <button
                      className="button danger"
                      disabled={busy}
                      onClick={() => void stop()}
                    >
                      <Square size={14} />
                      중지
                    </button>
                  ) : (
                    <button
                      className="button secondary"
                      disabled={busy || !view.threadId}
                      onClick={() => {
                        setPresenting(false);
                        setHint(
                          "같은 대회 작업을 이어가. 아직 끝내지 않은 문제를 계속 풀어.",
                        );
                        requestAnimationFrame(() =>
                          document.getElementById("hint")?.focus(),
                        );
                      }}
                    >
                      <Play size={15} />
                      이어하기
                    </button>
                  )}
                </>
              )}
              {!view && (
                <button className="button secondary" onClick={configureDemo}>
                  <Play size={15} />
                  실제 엔진 데모
                </button>
              )}
            </div>
          </section>
          <ContestFlow view={view} running={running} />
          {pendingApproval?.flag && (
            <section
              className="approval-banner"
              role="alert"
              aria-live="assertive"
            >
              <div className="approval-signal">
                <span />
                <Shield size={22} />
              </div>
              <div className="approval-copy">
                <span className="eyebrow">제출 승인 요청</span>
                <strong>
                  {pendingApproval.name} 플래그 후보를 찾았습니다.
                </strong>
                <code>{pendingApproval.flag}</code>
                <p>
                  정확한 문제와 후보입니다. 승인하면 공식 제출 화면에서 한 번만
                  전송하고 실제 verdict를 확인합니다.
                </p>
              </div>
              <div className="approval-actions">
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() =>
                    void decideSubmission(pendingApproval.name, "rejected")
                  }
                >
                  <X size={14} />
                  제출 거부
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    void decideSubmission(pendingApproval.name, "approved")
                  }
                >
                  <Check size={15} />이 후보 1회 제출 승인
                </button>
              </div>
            </section>
          )}
          <IntelligenceMap
            view={view}
            running={running}
            showFlags={showFlags}
          />
          <section className="metrics" aria-label="실행 지표">
            <Metric
              title="Accepted"
              value={`${accepted.length}`}
              unit="문제"
              icon={<CheckCheck size={19} />}
              note={
                confirmed.length
                  ? `${confirmed.reduce((sum, c) => sum + (c.points || 0), 0)}점 · 채점 결과 확인`
                  : accepted.length
                    ? "에이전트가 보고한 결과"
                    : "정답으로 확인된 문제 수"
              }
              accent
            />
            <Metric
              title={view?.catalogReady ? "전체 문제" : "목록 확인 중"}
              value={`${view?.challenges.length || 0}`}
              unit="문제"
              icon={<LayoutDashboard size={19} />}
              note={
                view?.catalogReady
                  ? `대기 ${view.challenges.filter((c) => c.status === "queued").length}개 · 후보 ${view.challenges.filter((c) => c.status === "candidate").length}개`
                  : "전체 목록을 먼저 확인하는 중"
              }
            />
            <Metric
              title="도구 실행"
              value={`${view?.toolCount || 0}`}
              unit="회"
              icon={<Terminal size={19} />}
              note={`종료 코드 오류 ${view?.nonzeroCount || 0}회 · ${view?.tokens.output ? "출력 " + count(view.tokens.output) + " 토큰" : "실제 실행 기준"}`}
            />
            <Metric
              title="작업 시간"
              value={formatTime(elapsed)}
              unit=""
              icon={<Clock3 size={19} />}
              note={`${view?.meta.config.model || "gpt-6-sol"} / ${view?.meta.config.effort || "ready"}`}
            />
          </section>
          <div className="workspace-grid">
            <section className="stage panel">
              <div className="stage-header">
                <div
                  className="stage-tabs"
                  role="tablist"
                  aria-label="작업 화면"
                >
                  <button
                    role="tab"
                    aria-selected={tab === "browser"}
                    onClick={() => setTab("browser")}
                  >
                    <Globe2 size={15} />
                    Browser
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === "terminal"}
                    onClick={() => setTab("terminal")}
                  >
                    <Terminal size={15} />
                    Terminal<span>{view?.tools.length || 0}</span>
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === "files"}
                    onClick={() => setTab("files")}
                  >
                    <FileCode2 size={15} />
                    Files
                  </button>
                </div>
                <span className="stage-status">
                  <span className={`dot ${running ? "blue" : ""}`} />
                  {running ? "작업 중" : view ? "저장된 화면" : "대기 중"}
                </span>
              </div>
              {tab === "browser" && (
                <>
                  <div className="browser-address">
                    <div className="window-dots">
                      <i />
                      <i />
                      <i />
                    </div>
                    <Shield size={12} />
                    <span>
                      {view?.browser.url ||
                        view?.meta.config.url ||
                        "이 작업 전용 브라우저"}
                    </span>
                    <span className="frame-age">
                      {view?.browser.capturedAt
                        ? `${Math.max(0, Math.floor((now - view.browser.capturedAt) / 1000))}s ago`
                        : ""}
                    </span>
                  </div>
                  <div className="browser-surface">
                    {view?.browser.capturedAt ? (
                      <img
                        src={`/api/runs/${view.meta.id}/frame?t=${view.browser.capturedAt}`}
                        alt={`에이전트 브라우저: ${view.browser.title || "현재 페이지"}`}
                        className="browser-frame"
                      />
                    ) : (
                      <div className="standby">
                        <div className={`orb ${running ? "working" : ""}`}>
                          <Orbit size={72} strokeWidth={0.75} />
                          <span />
                          <i />
                        </div>
                        <span className="standby-kicker">
                          {running ? "브라우저 연결 중" : "문제 풀이 화면"}
                        </span>
                        <h2>
                          {running
                            ? "탐색할 화면을 준비하고 있습니다."
                            : "단서가 풀이가 되는 순간."}
                        </h2>
                        <p>
                          {view?.browser.error ||
                            (view && !view.meta.config.browser
                              ? "브라우저 연결이 꺼져 있습니다. 실행 기록에서 도구 결과를 확인하세요."
                              : "대회 사이트를 열고, 문제를 살피고, 직접 해결하는 과정을 관찰하세요.")}
                        </p>
                        {!view && (
                          <button
                            className="button primary"
                            onClick={configureDemo}
                          >
                            <Play size={15} />
                            로컬 CTF로 시작해 보기
                            <ArrowUpRight size={15} />
                          </button>
                        )}
                      </div>
                    )}
                    {view?.browser.state === "unavailable" &&
                      view.browser.capturedAt && (
                        <div className="frame-warning">
                          화면 연결 중단 · 마지막 캡처 표시
                        </div>
                      )}
                  </div>
                  <div className="stage-caption">
                    <span>
                      <span
                        className={`dot ${view?.browser.state === "live" ? "green" : ""}`}
                      />
                      {view?.browser.state === "live"
                        ? "에이전트가 사용 중인 브라우저"
                        : view?.browser.capturedAt
                          ? "마지막 실제 브라우저 캡처"
                          : "전용 브라우저 화면"}
                    </span>
                    <small>
                      약 4.5초 간격 · 브라우저 원문은 마스킹되지 않습니다
                    </small>
                  </div>
                </>
              )}
              {tab === "terminal" && (
                <div className="terminal-view">
                  <div className="terminal-list">
                    {view?.tools
                      .slice(-24)
                      .reverse()
                      .map((t) => (
                        <button
                          key={t.id}
                          className={
                            terminal?.id === t.id
                              ? "tool-choice selected"
                              : "tool-choice"
                          }
                          onClick={() => setSelectedTool(t.id)}
                        >
                          <Icon type={t.family} />
                          <span>
                            {safe(shortCommand(t.command), showFlags).slice(
                              0,
                              52,
                            )}
                          </span>
                          <span className={`tool-dot ${t.status}`} />
                        </button>
                      ))}
                    {!view?.tools.length && (
                      <p className="empty-small">
                        실행한 명령이 여기에 나타납니다.
                      </p>
                    )}
                  </div>
                  <div className="terminal-code">
                    <div className="terminal-meta">
                      <span>
                        {terminal
                          ? familyLabels[terminal.family] || terminal.family
                          : "명령 실행"}
                      </span>
                      <span>
                        {terminal?.endedAt
                          ? `${((terminal.endedAt - terminal.startedAt) / 1000).toFixed(1)}s · exit ${terminal.exitCode ?? "—"}`
                          : terminal
                            ? "실행 중"
                            : "대기 중"}
                      </span>
                    </div>
                    <pre className="command-line">
                      {terminal
                        ? `$ ${safe(terminal.command, showFlags)}`
                        : "$ 에이전트의 실제 명령을 기다리는 중"}
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
                    {terminal?.status === "running" && (
                      <span className="terminal-cursor" />
                    )}
                  </div>
                </div>
              )}
              {tab === "files" && (
                <div className="file-list">
                  {view?.artifacts.length ? (
                    view.artifacts.map((f) => (
                      <button
                        key={f.path}
                        onClick={async () => {
                          try {
                            const r = await fetch(
                              `/api/runs/${view.meta.id}/artifact?path=${encodeURIComponent(f.path)}`,
                            );
                            if (!r.ok)
                              throw new Error("파일을 열 수 없습니다.");
                            setArtifact({ name: f.path, text: await r.text() });
                          } catch (e) {
                            setError(String(e));
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
                      <h3>분석의 흔적이 쌓이는 곳</h3>
                      <p>
                        문제 파일, 풀이 코드, 실행 결과를 실제 작업폴더에서
                        가져옵니다.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {latestCandidate && (
                <div className="candidate-strip">
                  <Flag size={18} />
                  <div>
                    <span>최근 플래그 후보</span>
                    <code>
                      {safe(latestCandidate.data.flag || "", showFlags)}
                    </code>
                  </div>
                </div>
              )}
            </section>
            <aside className="right-column">
              <section className="challenges panel">
                <PanelTitle
                  icon={<Flag size={16} />}
                  title="문제 목록"
                  tail={
                    <span className="count-badge">
                      {view?.challenges.length || 0}
                    </span>
                  }
                />
                <div className="challenge-list">
                  {view?.challenges.length ? (
                    view.challenges.map((c) => (
                      <details key={c.name} className={`challenge ${c.status}`}>
                        <summary>
                          <span className="challenge-icon">
                            {c.status === "accepted" ? (
                              <Check size={16} />
                            ) : c.status === "candidate" ? (
                              <Flag size={16} />
                            ) : c.status === "queued" ? (
                              <Clock3 size={16} />
                            ) : c.status === "blocked" ? (
                              <Unplug size={16} />
                            ) : (
                              <Orbit size={16} />
                            )}
                          </span>
                          <span>
                            <strong>{c.name}</strong>
                            <small>
                              {categoryLabels[c.category.toLowerCase()] ||
                                c.category}
                              {c.points !== undefined ? ` · ${c.points}점` : ""}
                            </small>
                          </span>
                          <span className={`challenge-state ${c.status}`}>
                            {c.status === "accepted"
                              ? "Accepted"
                              : c.status === "candidate"
                                ? "후보 확보"
                                : c.status === "rejected"
                                  ? "오답"
                                  : c.status === "queued"
                                    ? "대기"
                                    : c.status === "blocked"
                                      ? "진행 보류"
                                      : c.status === "skipped"
                                        ? "건너뜀"
                                        : running
                                          ? "풀이 중"
                                          : "일시 중지"}
                          </span>
                        </summary>
                        <div className="challenge-detail">
                          <p>
                            {c.source === "platform"
                              ? "로컬 플랫폼 응답으로 확인"
                              : c.source === "workspace"
                                ? "실제 작업폴더에서 감지"
                                : c.source === "catalog"
                                  ? "대회 문제 목록에서 확인"
                                  : "에이전트 보고 · 근거를 확인하세요"}
                          </p>
                          {c.flag && <code>{safe(c.flag, showFlags)}</code>}
                          {c.evidence && (
                            <pre>{safe(c.evidence, showFlags)}</pre>
                          )}
                          {c.decision === "approved" && (
                            <p className="decision approved">
                              <Check size={12} />
                              운영자가 이 후보의 1회 제출을 승인했습니다.
                            </p>
                          )}
                          {c.decision === "rejected" && (
                            <p className="decision rejected">
                              <X size={12} />
                              운영자가 이 후보의 제출을 거부했습니다.
                            </p>
                          )}
                          {view?.meta.config.mode === "guided" &&
                            [
                              "queued",
                              "blocked",
                              "skipped",
                              "rejected",
                            ].includes(c.status) &&
                            view.threadId && (
                              <button
                                type="button"
                                className="pick-challenge"
                                disabled={busy}
                                onClick={() => void chooseChallenge(c.name)}
                              >
                                <Play size={14} />이 문제만 풀기
                              </button>
                            )}
                        </div>
                      </details>
                    ))
                  ) : (
                    <div className="empty-board">
                      <div className="outline-stack">
                        <span />
                        <span />
                        <span />
                      </div>
                      <p>
                        에이전트가 선택한 문제가
                        <br />
                        이곳에 하나씩 나타납니다.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </aside>
          </div>
          <SolutionsPanel view={view} showFlags={showFlags} />
          <section className="activity panel">
            <PanelTitle
              icon={<Activity size={17} />}
              title="실시간 풀이 기록"
              tail={
                <div className="activity-actions">
                  <span>실제 이벤트만 표시</span>
                  {view && (
                    <a
                      href={`/api/runs/${view.meta.id}/log`}
                      className="text-button"
                    >
                      <Download size={14} />
                      로그 저장
                    </a>
                  )}
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
                  <p>
                    대회를 시작하면 탐색, 관찰, 도구 실행, 제출 결과가
                    시간순으로 쌓입니다.
                  </p>
                  <code>아직 기록이 없습니다</code>
                </div>
              )}
            </div>
          </section>
          <form className="operator-bar" onSubmit={sendHint}>
            <MessageSquare size={18} />
            <input
              id="hint"
              aria-label="에이전트에게 지시"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder={
                running
                  ? "필요할 때 개입하세요. 현재 턴을 중단하고 같은 대화에서 이어갑니다…"
                  : "후속 지시를 입력해 같은 대화를 이어가세요…"
              }
              disabled={!view?.threadId}
            />
            <button
              type="submit"
              className="button primary compact"
              disabled={!view?.threadId || busy || !hint.trim()}
            >
              <Send size={15} />
              {running ? "지시 전달" : "이어하기"}
            </button>
          </form>
          <footer>
            <span>
              <Shield size={13} />
              SEAL 에이전트 한 개로 진행
            </span>
            <span>실제 보고와 실행 결과를 보여드립니다.</span>
            <span>EQST CTF Agent</span>
          </footer>
        </main>
      </div>
      {celebration && (
        <div className="success-toast" role="status">
          <span className="success-halo" />
          <CheckCheck size={28} />
          <div>
            <small>채점 결과 확인</small>
            <strong>{celebration}</strong>
            <span>정답입니다. 한 문제를 해결했습니다.</span>
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
              <span className="eyebrow">대회 설정</span>
              <h2>새 대회 시작하기</h2>
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
          <div className="setup-grid">
            <div className="setup-main">
              <label>
                대회 이름
                <input
                  required
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
                  disabled={form.demo}
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
                  checked={form.browser}
                  onChange={(e) =>
                    setForm({ ...form, browser: e.target.checked })
                  }
                />
                <span>
                  <Globe2 size={16} />
                  브라우저 화면 연결
                </span>
              </label>
              {form.browser && (
                <label>
                  브라우저 프로필
                  <select
                    value={form.browserId}
                    onChange={(e) =>
                      setForm({ ...form, browserId: e.target.value })
                    }
                  >
                    <option value="">연결된 단일 브라우저</option>
                    {health?.connected.map((b) => (
                      <option value={b.instance_id} key={b.instance_id}>
                        {b.label || b.browser_name} · {b.instance_id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
              <p className="option-help">
                수동 승인 모드는 flag를 먼저 보여주고, 대시보드에서 승인한
                정확한 후보만 한 번 제출합니다.
              </p>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.yolo}
                  onChange={(e) => setForm({ ...form, yolo: e.target.checked })}
                />
                <span>
                  <Shield size={16} />
                  SEAL --yolo
                </span>
              </label>
              <p className="option-help warning">
                승인·native sandbox 해제. 격리된 CTF 환경에서만 선택하세요.
                브라우저 자체 확인 절차는 유지됩니다.
              </p>
            </div>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            <button
              type="button"
              className="text-button"
              onClick={configureDemo}
            >
              <Braces size={16} />
              로컬 데모 설정
            </button>
            <span>
              {form.demo
                ? "로컬 CTF · 실제 모델 호출"
                : "기존 SEAL 로그인·스킬 사용"}
            </span>
            <button
              className="button primary"
              type="submit"
              disabled={busy || !!(view && active(view.status))}
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
      {artifact && (
        <div className="artifact-overlay">
          <section>
            <PanelTitle
              icon={<FileCode2 size={17} />}
              title={artifact.name}
              tail={
                <button
                  className="icon-btn"
                  aria-label="파일 닫기"
                  onClick={() => setArtifact(null)}
                >
                  <X size={20} />
                </button>
              }
            />
            <pre>{safe(artifact.text, showFlags)}</pre>
          </section>
        </div>
      )}
    </div>
  );
}
function ContestFlow({
  view,
  running,
}: {
  view: View | null;
  running: boolean;
}) {
  const catalogReady = !!view?.catalogReady;
  const current = view?.challenges.find(
    (challenge) => challenge.name === view.currentChallenge,
  );
  const solveActive =
    catalogReady &&
    !!current &&
    ["working", "candidate", "blocked"].includes(current.status);
  const analysisState = catalogReady
    ? "complete"
    : running
      ? "active"
      : "waiting";
  const solveState = !catalogReady
    ? "locked"
    : solveActive
      ? running
        ? "active"
        : "waiting"
      : "ready";
  return (
    <section className="contest-flow" aria-label="대회 운영 단계">
      <article className={`flow-phase ${analysisState}`}>
        <span className="flow-number">01</span>
        <div className="flow-icon">
          {catalogReady ? <Check size={20} /> : <LayoutDashboard size={20} />}
        </div>
        <div>
          <span>대회 준비</span>
          <strong>대회·문제 목록 분석</strong>
          <p>
            {catalogReady
              ? `문제 ${view?.challenges.length || 0}개 확인 완료`
              : "카테고리·점수·접속 대상 조사"}
          </p>
        </div>
        <b>{catalogReady ? "완료" : running ? "확인 중" : "대기"}</b>
      </article>
      <span className={`flow-bridge ${catalogReady ? "ready" : ""}`}>
        <ArrowRight size={17} />
      </span>
      <article className={`flow-phase ${solveState}`}>
        <span className="flow-number">02</span>
        <div className="flow-icon">
          <Code2 size={20} />
        </div>
        <div>
          <span>문제 풀이</span>
          <strong>선택 문제 분석·풀이</strong>
          <p>
            {!catalogReady
              ? "준비 단계 완료 후 활성화"
              : solveActive
                ? `${current?.name} · ${stageLabels[view!.focus.stage]}`
                : view?.meta.config.mode === "guided"
                  ? "문제 카드를 선택해 한 문제만 실행"
                  : "다음 미해결 문제 자동 선택"}
          </p>
        </div>
        <b>
          {!catalogReady
            ? "준비 전"
            : solveActive
              ? running
                ? "진행 중"
                : "일시 중지"
              : "선택 대기"}
        </b>
      </article>
    </section>
  );
}

function SolutionsPanel({
  view,
  showFlags,
}: {
  view: View | null;
  showFlags: boolean;
}) {
  if (!view?.solutions.length) return null;
  return (
    <section className="solutions panel" aria-label="해결한 문제 요약">
      <PanelTitle
        icon={<CheckCheck size={18} />}
        title="문제별 풀이 요약"
        tail={<span className="count-badge">{view.solutions.length}</span>}
      />
      <div className="solution-grid">
        {[...view.solutions].reverse().map((solution) => (
          <article className="solution-card" key={solution.challenge}>
            <header>
              <span className="solution-check">
                <Check size={15} />
              </span>
              <div>
                <strong>{solution.challenge}</strong>
                <small>
                  {new Date(solution.at).toLocaleTimeString("ko-KR")}
                </small>
              </div>
            </header>
            <h3>{safe(solution.summary, showFlags)}</h3>
            <p>{safe(solution.method, showFlags)}</p>
            {solution.evidence && (
              <div className="solution-evidence">
                <Shield size={12} />
                {safe(solution.evidence, showFlags)}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function Metric({
  title,
  value,
  unit,
  icon,
  note,
  accent,
}: {
  title: string;
  value: string;
  unit: string;
  icon: ReactNode;
  note: string;
  accent?: boolean;
}) {
  return (
    <div className={`metric ${accent ? "accent" : ""}`}>
      <div className="metric-label">
        {title}
        {icon}
      </div>
      <div className="metric-number">
        {value}
        <span>{unit}</span>
      </div>
      <p>{note}</p>
    </div>
  );
}
function IntelligenceMap({
  view,
  running,
  showFlags,
}: {
  view: View | null;
  running: boolean;
  showFlags: boolean;
}) {
  const stageOrder: ProgressStage[] = [
    "survey",
    "ready",
    "inspect",
    "model",
    "exploit",
    "verify",
    "submit",
    "blocked",
    "complete",
  ];
  const focus = view?.focus || {
    challenge: "",
    stage: "survey" as const,
    summary: "대회 주소를 입력하면 문제 목록부터 확인합니다.",
    source: "inferred" as const,
    updatedAt: 0,
  };
  const challenge = focus.challenge || view?.currentChallenge || "";
  const problem = view?.challenges.find((item) => item.name === challenge);
  const allFindings =
    view?.findings.filter((item) => item.challenge === challenge) || [];
  const findings = allFindings
    .filter((item) => !["hypothesis", "blocker", "result"].includes(item.type))
    .slice(-3);
  const hypotheses = allFindings
    .filter((item) => ["hypothesis", "blocker", "result"].includes(item.type))
    .slice(-3);
  const selection = view?.events.findLast(
    (event) =>
      event.kind === "challenge" &&
      event.data.challenge === challenge &&
      event.data.source !== "workspace",
  );
  const latestMessage = view?.events.findLast(
    (event) => event.kind === "message" && event.seq >= (selection?.seq || 0),
  );
  const isOperation = (tool: Tool) =>
    !/\bnode\b.*(?:\/server\/report\.mjs|SEAL_LIVE_REPORTER)/.test(
      tool.command,
    );
  const currentTool =
    view?.tools.findLast(
      (tool) => tool.status === "running" && isOperation(tool),
    ) || view?.tools.findLast(isOperation);
  const solution = view?.solutions.find((item) => item.challenge === challenge);
  const stageIcons: Record<ProgressStage, string> = {
    survey: "browser",
    ready: "catalog",
    inspect: "inspect",
    model: "reverse",
    exploit: "code",
    verify: "candidate",
    submit: "submission",
    blocked: "error",
    complete: "submission",
  };
  const observed = new Set<ProgressStage>(
    view?.events.flatMap((event) =>
      event.kind === "progress" &&
      event.data.stage &&
      (!challenge || event.data.challenge === challenge)
        ? [event.data.stage]
        : [],
    ) || [],
  );
  observed.add(focus.stage);
  const executionLabel = currentTool
    ? `${familyLabels[currentTool.family] || currentTool.family} · ${
        currentTool.status === "running" ? "실행 중" : "최근 실행"
      }`
    : "실행 대기";
  return (
    <section
      className={`intel-board operations-board ${running ? "is-live" : ""}`}
      aria-label="확인된 정보에서 실제 문제 풀이로 이어지는 현재 작업"
    >
      <header className="intel-header operations-header">
        <div>
          <span className="eyebrow">실시간 풀이 현황</span>
          <strong>단서에서 검증까지</strong>
        </div>
        <div className="intel-meta">
          <span className={`source-tag ${focus.source}`}>
            {focus.source === "agent" ? "진행 보고" : "도구 활동 기준"}
          </span>
          <span>
            {view?.meta.config.mode === "guided"
              ? "문제 직접 선택"
              : "순서대로 진행"}
          </span>
        </div>
      </header>
      <div className="operations-flow">
        <section className="evidence-lane" aria-label="확인된 정보">
          <header>
            <Search size={17} />
            <div>
              <span>01 · 파악한 내용</span>
              <strong>구조와 단서</strong>
            </div>
            <b>{findings.length + (problem?.target ? 1 : 0)}</b>
          </header>
          <div className="evidence-stack">
            {problem?.target && (
              <article className="evidence-chip surface">
                <span>접속 대상</span>
                <strong>문제 서비스</strong>
                <p>{safe(problem.target, showFlags)}</p>
              </article>
            )}
            {findings.map((finding) => (
              <article
                className={`evidence-chip ${finding.type}`}
                key={finding.id}
              >
                <span>{findingLabels[finding.type] || finding.type}</span>
                <strong>{safe(finding.label, showFlags)}</strong>
                <p>{safe(finding.detail, showFlags)}</p>
                {finding.evidence && (
                  <small>{safe(finding.evidence, showFlags)}</small>
                )}
              </article>
            ))}
            {!findings.length && !problem?.target && (
              <div className="lane-empty">
                <Search size={18} />
                <span>
                  아직 정리된 단서가 없습니다. 파일과 응답을 확인하면 여기에
                  남깁니다.
                </span>
              </div>
            )}
          </div>
        </section>
        <div className={`operations-link ${running ? "flowing" : ""}`}>
          <span />
          <ArrowRight size={17} />
          <small>분석</small>
        </div>
        <section
          className={`agent-live-card ${running ? "working" : ""}`}
          aria-label="현재 문제 풀이 상황"
        >
          <div className="agent-live-head">
            <div className="live-agent-avatar">
              <span />
              <Icon type={stageIcons[focus.stage]} size={29} />
            </div>
            <div>
              <span>02 · {stageLabels[focus.stage]}</span>
              <strong>
                {challenge ||
                  (view?.catalogReady
                    ? "풀 문제를 선택하세요"
                    : "대회 살펴보기")}
              </strong>
              <div className="problem-badges">
                {problem ? (
                  <>
                    <span>
                      {categoryLabels[problem.category.toLowerCase()] ||
                        problem.category}
                    </span>
                    {problem.points !== undefined && <b>{problem.points}점</b>}
                  </>
                ) : (
                  <span>
                    {view?.catalogReady
                      ? `문제 ${view.challenges.length}개 확인`
                      : "문제 목록 확인 중"}
                  </span>
                )}
              </div>
            </div>
            <b className={running ? "live" : ""}>
              <span className={`dot ${running ? "amber pulse" : ""}`} />
              {running ? "진행 중" : "최근 기록"}
            </b>
          </div>
          {problem?.description && (
            <p className="challenge-description">
              {safe(problem.description, showFlags)}
            </p>
          )}
          <div key={latestMessage?.seq} className="agent-live-message">
            <PublicMessage>
              {safe(
                latestMessage?.detail ||
                  focus.summary ||
                  "풀이를 시작하면 진행 내용을 여기에 보여드립니다.",
                showFlags,
              )}
            </PublicMessage>
          </div>
          <div className="agent-live-context">
            <span>
              <Radio size={12} />
              {stageLabels[focus.stage]}
            </span>
            <span>
              {latestMessage
                ? `최근 보고 ${new Date(latestMessage.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
                : "보고 대기 중"}
            </span>
          </div>
        </section>
        <div className={`operations-link ${running ? "flowing" : ""}`}>
          <span />
          <ArrowRight size={17} />
          <small>검증</small>
        </div>
        <section className="execution-lane" aria-label="문제 풀이 실행과 검증">
          <header>
            <Terminal size={17} />
            <div>
              <span>03 · 시도와 결과</span>
              <strong>가설과 검증</strong>
            </div>
          </header>
          <div className="hypothesis-stack">
            {hypotheses.map((item) => (
              <article className={`hypothesis-card ${item.type}`} key={item.id}>
                <Icon
                  type={
                    item.type === "blocker"
                      ? "error"
                      : item.type === "result"
                        ? "submission"
                        : "inspect"
                  }
                  size={16}
                />
                <div>
                  <span>{findingLabels[item.type]}</span>
                  <strong>{safe(item.label, showFlags)}</strong>
                  <p>{safe(item.detail, showFlags)}</p>
                  {item.evidence && (
                    <small>{safe(item.evidence, showFlags)}</small>
                  )}
                </div>
              </article>
            ))}
          </div>
          <div className="execution-status">
            <span>{executionLabel}</span>
            <code>
              {currentTool
                ? safe(shortCommand(currentTool.command), showFlags).slice(
                    0,
                    180,
                  )
                : "도구 실행을 기다리는 중"}
            </code>
          </div>
          {focus.next && (
            <div className="execution-next">
              <ArrowRight size={13} />
              <span>
                <b>다음 할 일</b>
                {safe(focus.next, showFlags)}
              </span>
            </div>
          )}
          {problem?.status === "candidate" && problem.flag && (
            <div className="execution-result candidate">
              <Flag size={13} />
              <span>후보 확보</span>
              <code>{safe(problem.flag, showFlags)}</code>
            </div>
          )}
          {problem?.status === "accepted" && (
            <div className="execution-result accepted">
              <CheckCheck size={14} />
              <span>정답 확인</span>
            </div>
          )}
          {problem?.decision === "rejected" && (
            <div className="execution-result rejected">
              <X size={13} />
              <span>운영자가 제출 거부</span>
            </div>
          )}
          {solution && (
            <div className="execution-result solved">
              <Check size={13} />
              <span>{safe(solution.summary, showFlags)}</span>
            </div>
          )}
        </section>
      </div>
      <div className="stage-radar" aria-label="관찰된 단계">
        {stageOrder.map((stage) => (
          <span
            className={`${observed.has(stage) ? "seen" : ""} ${
              focus.stage === stage ? "active" : ""
            }`}
            key={stage}
          >
            <i />
            {stageLabels[stage]}
          </span>
        ))}
      </div>
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
            실행 기록에서 보기
            <ArrowUpRight size={13} />
          </button>
        )}
      </div>
    </details>
  );
}

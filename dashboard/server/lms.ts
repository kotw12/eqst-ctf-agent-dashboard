import { publicEncrypt, constants, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

// EQST LMS(eqst.co.kr) 워게임을 대회처럼 쓰기 위한 게이트웨이.
// 로그인·문제지 열기·정답 제출은 서버가 맡고, 에이전트에게는 실습 사이트 쿠키와 제출 결과만 넘긴다.
// LMS 원본 화면에는 이미 푼 문제의 정답과 정답자 게시판이 있으므로 에이전트에게 그대로 주지 않는다.

export type LmsPreset = {
  id: string;
  title: string;
  course: string;
  exam: string;
  lab: string;
};
export const LMS_PRESETS: LmsPreset[] = [
  {
    id: "eqst-finance-bank",
    title: "EQST Finance · 인터넷 뱅킹",
    course: "Finance & E-commerce Web Hacking",
    exam: "온라인 인터넷 뱅킹 모의해킹",
    // 테스트에서는 EQST_LMS_LAB 로 mock 실습 서버를 가리킨다
    lab: process.env.EQST_LMS_LAB || "https://lab.eqst.co.kr:8111",
  },
];
export const lmsPreset = (id: string) => LMS_PRESETS.find((p) => p.id === id);
export const lmsConfigured = () =>
  !!process.env.EQST_LMS_ID && !!process.env.EQST_LMS_PW;

export type LmsProblem = {
  no: number;
  title: string;
  description: string;
  points?: number;
  level?: string;
  target?: string;
  qstnSn: string;
  solved: boolean;
};
export type Paper = {
  problems: LmsProblem[];
  // 이미 푼 문제의 기존 정답. 서버 안에서 대조용으로만 쓰고 밖으로 내보내지 않는다.
  answers: Map<number, string>;
  form: Record<string, string>;
};

const BASE = process.env.EQST_LMS_BASE || "https://eqst.co.kr";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_LOGIN_FAILURES = 3;

export function problemName(p: Pick<LmsProblem, "no" | "title">) {
  return `${p.no}. ${p.title}`;
}
export function problemNo(name: string) {
  const match = name.match(/^(\d+)\.\s/);
  return match ? Number(match[1]) : undefined;
}
function text(html: string) {
  return html
    .replace(/<br\s*\/?>|<\/br>/gi, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}
function attr(tag: string, name: string) {
  return tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
}

// 워게임 문제지(addPaperPop)를 문제 목록으로 바꾼다. 정답 입력칸의 값은 answers 에만 담는다.
export function parsePaper(html: string): Paper {
  const form: Record<string, string> = {};
  const formHtml = html.match(/<form[^>]*id="examForm"[\s\S]*?<\/form>/i)?.[0] || "";
  for (const tag of formHtml.match(/<input[^>]*>/gi) || []) {
    const name = attr(tag, "name");
    if (name) form[name] = attr(tag, "value") ?? "";
  }
  const problems: LmsProblem[] = [];
  const answers = new Map<number, string>();
  for (const block of html.split(/class="list_view_box"/).slice(1)) {
    const no = Number(block.match(/<span class="num">\s*(\d+)\./)?.[1]);
    const qstnSn = block.match(/qstnsn="([^"]+)"/i)?.[1];
    if (!no || !qstnSn) continue;
    const input = block.match(new RegExp(`<input[^>]*id="ans_${no}"[^>]*>`))?.[0] || "";
    const solved =
      /id="markDiv\d+"[^>]*mark_right/.test(block) || /readonly/i.test(input);
    const answer = attr(input, "value");
    if (solved && answer) answers.set(no, answer);
    problems.push({
      no,
      title: text(block.match(/<div class="quest">([\s\S]*?)<\/div>/)?.[1] || `문제 ${no}`),
      description: text(block.match(/<div class="exam_area">([\s\S]*?)<\/div>/)?.[1] || ""),
      points: Number(block.match(/배점[\s\S]*?:\s*([\d.]+)\s*점/)?.[1]) || undefined,
      level: block.match(/난이도\s*:\s*([^\s<&|]+)/)?.[1],
      target: block.match(/openPracticeSite\('url',\s*\d+,\s*'([^']+)'/)?.[1],
      qstnSn,
      solved,
    });
  }
  return { problems, answers, form };
}

type Reply = { url: string; status: number; text: string; cookies: string[] };
// LMS 나 실습 서버가 응답하지 않으면 원인을 알 수 있는 오류로 바꾼다.
async function timedFetch(url: string | URL, init: RequestInit) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    const where = `${new URL(url).host}${new URL(url).pathname}`;
    if ((error as Error).name === "TimeoutError")
      throw new Error(`${where} 가 20초 동안 응답하지 않았습니다.`);
    throw new Error(`${where} 에 연결하지 못했습니다: ${String((error as Error & { cause?: unknown }).cause || error)}`);
  }
}
class LoggedOut extends Error {
  constructor() {
    super("LMS 로그인 상태가 유지되지 않습니다. 다시 로그인한 뒤에도 같은 응답이 왔습니다.");
  }
}

export class LmsClient {
  private jar = new Map<string, string>();
  private failures = 0;
  private pending?: Promise<void>;
  constructor(
    private readonly id = process.env.EQST_LMS_ID || "",
    private readonly password = process.env.EQST_LMS_PW || "",
    private readonly base = BASE,
  ) {}
  get user() {
    return this.id;
  }
  async request(
    target: string,
    init: {
      method?: string;
      form?: Record<string, string>;
      headers?: Record<string, string>;
      // 로그인 과정 자체의 요청은 로그인 화면을 만나도 로그아웃으로 보지 않는다
      loginFlow?: boolean;
    } = {},
  ): Promise<Reply> {
    let url = new URL(target, this.base).href;
    let method = init.method || "GET";
    let body = init.form ? new URLSearchParams(init.form).toString() : undefined;
    for (let hop = 0; hop < 8; hop++) {
      const res = await timedFetch(url, {
        method,
        body,
        redirect: "manual",
        headers: {
          "user-agent": UA,
          cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
          ...(body ? { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" } : {}),
          ...(new URL(url).origin === new URL(this.base).origin ? { origin: this.base } : {}),
          ...init.headers,
        },
      });
      const cookies = res.headers.getSetCookie();
      if (process.env.EQST_LMS_DEBUG) console.log(`[lms] ${method} ${new URL(url).pathname} -> ${res.status}`);
      if (new URL(url).origin === new URL(this.base).origin)
        for (const line of cookies) {
          const pair = line.split(";")[0];
          const at = pair.indexOf("=");
          if (at > 0) this.jar.set(pair.slice(0, at).trim(), pair.slice(at + 1));
        }
      const location = res.headers.get("location");
      if (location && res.status >= 300 && res.status < 400) {
        url = new URL(location, url).href;
        method = "GET";
        body = undefined;
        if (/\/home\/user\/loginForm/.test(url) && !init.loginFlow) throw new LoggedOut();
        continue;
      }
      const reply = { url, status: res.status, text: await res.text(), cookies };
      if (
        !init.loginFlow &&
        (/id="login_pwd"/.test(reply.text) || /"result"\s*:\s*-3\b/.test(reply.text))
      )
        throw new LoggedOut();
      return reply;
    }
    throw new Error("LMS 응답이 너무 많이 이동했습니다.");
  }
  // 로그인 화면과 같은 방식: base64(utf8("id|pw"))를 RSA-OAEP(SHA-1)로 암호화해 hex로 보낸다.
  login() {
    this.pending ??= this.doLogin().finally(() => (this.pending = undefined));
    return this.pending;
  }
  private async doLogin() {
    if (!this.id || !this.password)
      throw new Error("서버에 EQST_LMS_ID / EQST_LMS_PW 가 설정되지 않았습니다.");
    if (this.failures >= MAX_LOGIN_FAILURES)
      throw new Error("LMS 로그인이 연속 실패해 계정 보호를 위해 더 시도하지 않습니다.");
    this.jar.clear();
    const page = await this.request("/home/user/loginForm?mcd=HM04001000", { loginFlow: true });
    const signature = page.text.match(/name="csSignature" value="([^"]+)"/)?.[1];
    const key = page.text.match(/KEYUTIL\.getKey\("([^"]+)"\)/)?.[1]?.replace(/\\n/g, "\n");
    if (!signature || !key) throw new Error("LMS 로그인 화면 구조가 바뀌었습니다.");
    const encryptData = publicEncrypt(
      { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
      Buffer.from(Buffer.from(`${this.id}|${this.password}`, "utf8").toString("base64")),
    ).toString("hex");
    try {
      const result = await this.request("/home/user/login", {
        method: "POST",
        form: { csSignature: signature, encryptData },
        loginFlow: true,
      });
      if (/\/home\/user\/loginForm/.test(result.url)) throw new LoggedOut();
      const home = await this.request("/home/main/indexMain", { loginFlow: true });
      if (!home.text.includes("/home/user/logout")) throw new LoggedOut();
    } catch (error) {
      this.failures++;
      throw error instanceof LoggedOut
        ? new Error("LMS 로그인에 실패했습니다. 계정 정보를 확인하세요.")
        : error;
    }
    this.failures = 0;
  }
}

export type SubmitResult = {
  outcome: "accepted" | "rejected";
  evidence: string;
  local: boolean;
};

export class LmsGateway {
  readonly client: LmsClient;
  private paper?: Paper;
  private course?: { crsCreCd: string; stdNo: string };
  constructor(readonly preset: LmsPreset, client = new LmsClient()) {
    this.client = client;
  }
  get problems() {
    return this.paper?.problems || [];
  }
  problem(no: number) {
    return this.problems.find((p) => p.no === no);
  }
  // 로그아웃 상태가 확인되면 다시 로그인하고 강의실·문제지를 다시 연 뒤 한 번만 재시도한다.
  private async retry<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof LoggedOut)) throw error;
      await this.client.login();
      await this.openPaper();
      return work();
    }
  }
  async open() {
    await this.client.login();
    await this.openPaper();
    return this.problems;
  }
  private async openPaper() {
    const study = await this.client.request("/home/main/goMenuPage?mcd=MC00000051");
    const courseAt = [study.text.indexOf(`>${this.preset.course}<`), study.text.indexOf(`>${this.preset.course.replace(/&/g, "&amp;")}<`)].find((i) => i >= 0);
    const lecture = courseAt === undefined ? undefined : study.text.slice(courseAt).match(/goLecture\('([^']+)','([^']+)'\)/);
    if (!lecture) throw new Error(`수강 중인 과정에서 "${this.preset.course}"를 찾지 못했습니다.`);
    this.course = { crsCreCd: lecture[1], stdNo: lecture[2] };
    await this.client.request(
      `/lec/main/goLecture?crsCreCd=${encodeURIComponent(lecture[1])}&stdNo=${encodeURIComponent(lecture[2])}`,
    );
    const list = await this.client.request("/lec/main/goMenuPage?mcd=MC10000066");
    const examAt = list.text.indexOf(this.preset.exam);
    const exam = examAt < 0 ? undefined : list.text.slice(examAt).match(/examPaper\('([^']+)','(\d+)','(\d+)'\)/);
    if (!exam) throw new Error(`워게임에서 "${this.preset.exam}"을 찾지 못했습니다.`);
    const signature = list.text.match(/name="csSignature" value="([^"]+)"/)?.[1] || "";
    const stare = await this.client.request("/lec/exam/examPaperStareCnt", {
      method: "POST",
      headers: { "x-requested-with": "XMLHttpRequest" },
      form: {
        csSignature: signature,
        crsCreCd: this.course.crsCreCd,
        encExamSn: exam[1],
        stdNo: this.course.stdNo,
        stareLimitCnt: exam[2],
        stareCnt: "",
      },
    });
    const vo = JSON.parse(stare.text) as { result: number; returnVO?: { stareCnt?: string; agreeYn?: string } };
    if (vo.returnVO?.agreeYn !== "Y")
      throw new Error("이 워게임의 응시 약관에 아직 동의하지 않았습니다. LMS에서 한 번 직접 응시해 주세요.");
    const stareCnt = vo.result > 0 ? Number(vo.returnVO.stareCnt || 0) + 1 : 1;
    const paper = await this.client.request(
      "/lec/exam/addPaperPop?" +
        new URLSearchParams({
          crsCreCd: this.course.crsCreCd,
          encExamSn: exam[1],
          agreeYn: "Y",
          stareCnt: String(stareCnt),
        }),
    );
    const parsed = parsePaper(paper.text);
    if (!parsed.problems.length || !parsed.form.encExamSn)
      throw new Error("워게임 문제지 구조를 읽지 못했습니다.");
    this.paper = parsed;
  }
  // LMS 에서 1분짜리 sToken 을 받아 실습 사이트에 넘기고, 실습 사이트가 준 세션 쿠키를 돌려준다.
  async labCookie(no?: number) {
    return this.retry(async () => {
      const token = await this.client.request("/home/etc/token/getJwtToken", {
        method: "POST",
        headers: { "x-requested-with": "XMLHttpRequest" },
      });
      let vo: { result: number; message?: string };
      try {
        vo = JSON.parse(token.text);
      } catch {
        // 로그인이 풀리면 JSON 대신 안내 화면이 올 수 있다. 재로그인 후 한 번만 다시 시도한다.
        throw new LoggedOut();
      }
      if (vo.result <= 0 || !vo.message) throw new LoggedOut();
      const target =
        (no && this.problem(no)?.target) || this.problems.find((p) => p.target)?.target || `${this.preset.lab}/main`;
      const url = new URL(target);
      if (url.origin !== new URL(this.preset.lab).origin)
        throw new Error("프리셋 밖의 실습 주소입니다.");
      url.searchParams.set("sToken", vo.message);
      const res = await timedFetch(url, {
        redirect: "manual",
        headers: { "user-agent": UA },
      });
      const cookie = res.headers
        .getSetCookie()
        .map((line) => line.split(";")[0])
        .filter((pair) => pair.includes("="))
        .join("; ");
      if (!cookie) throw new Error(`실습 사이트가 세션을 주지 않았습니다 (HTTP ${res.status}).`);
      return { cookie, origin: url.origin };
    });
  }
  async submit(no: number, answer: string): Promise<SubmitResult> {
    const problem = this.problem(no);
    if (!problem) throw new Error(`${no}번 문제가 없습니다.`);
    const known = this.paper?.answers.get(no);
    // 계정에서 이미 푼 문제는 LMS 가 다시 받지 않으므로, 서버에 있는 기존 정답과만 대조한다.
    if (problem.solved) {
      const same = !!known && known.trim().toUpperCase() === answer.trim().toUpperCase();
      return {
        outcome: same ? "accepted" : "rejected",
        evidence: `계정에서 이미 푼 문제라 LMS에 제출하지 않고 기존 정답과 대조했습니다: ${same ? "일치" : "불일치"}.`,
        local: true,
      };
    }
    return this.retry(async () => {
      const form = this.paper!.form;
      const reply = await this.client.request("/lec/exam/submitPaperOne", {
        method: "POST",
        headers: { "x-requested-with": "XMLHttpRequest" },
        form: {
          ...form,
          encExamQstnSn: this.problem(no)!.qstnSn,
          stareAnss: answer.trim(),
          qstnNo: String(no),
        },
      });
      const vo = JSON.parse(reply.text) as { result: number; message?: string };
      if (vo.result !== 2 && vo.result !== 3)
        throw new Error(`LMS 제출 응답을 해석하지 못했습니다: ${String(vo.message || vo.result).slice(0, 200)}`);
      if (vo.result === 2) this.problem(no)!.solved = true;
      return {
        outcome: vo.result === 2 ? "accepted" : "rejected",
        evidence: `EQST LMS 판정: ${vo.result === 2 ? "정답" : "오답"} (submitPaperOne result=${vo.result}).`,
        local: false,
      };
    });
  }
}

// 에이전트가 부르는 lms-tool 의 상대. 127.0.0.1 에만 열고, 실행마다 새 토큰을 요구한다.
export type LmsHandlers = {
  problems(): unknown;
  labCookie(no?: number): Promise<unknown>;
  submit(no: number, answer: string): Promise<unknown>;
  whoami(): unknown;
};
export async function serveLms(handlers: LmsHandlers) {
  const token = randomBytes(24).toString("hex");
  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-lms-token"] !== token) return send(403, { error: "허가되지 않은 요청입니다." });
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 8192) return send(413, { error: "요청이 너무 깁니다." });
    }
    try {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const no = body.no === undefined ? undefined : Number(body.no);
      if (no !== undefined && !Number.isInteger(no)) return send(400, { error: "문제 번호는 정수입니다." });
      if (req.url === "/problems") return send(200, handlers.problems());
      if (req.url === "/whoami") return send(200, handlers.whoami());
      if (req.url === "/lab-cookie") return send(200, await handlers.labCookie(no));
      if (req.url === "/submit") {
        if (no === undefined || typeof body.answer !== "string" || !body.answer.trim() || body.answer.length > 300)
          return send(400, { error: "submit 에는 문제 번호와 300자 이하의 답이 필요합니다." });
        return send(200, await handlers.submit(no, body.answer));
      }
      send(404, { error: "problems, whoami, lab-cookie, submit 만 지원합니다." });
    } catch (error) {
      const status = (error as { status?: number }).status || 502;
      send(status, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

import { generateKeyPairSync, privateDecrypt, constants, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

// 게이트웨이 테스트용 EQST LMS·실습 사이트 흉내. 실제 사이트에서 확인한 화면 구조와 응답 형식만 따라 한다.
// 실제 문제·정답은 담지 않는다.

export type MockProblem = { title: string; description: string; answer: string; solved: boolean };
export type MockOptions = {
  id?: string;
  password?: string;
  sessionTtlMs?: number;
  problems?: MockProblem[];
  // issue: sToken 응답에서 세션을 준다(뱅킹 실습). bind: 첫 방문에서 세션을 주고 sToken 은 그 세션에 인증만 붙인다(쇼핑몰 실습).
  labStyle?: "issue" | "bind";
};
const SIGNATURE = "mock-signature==";
const COURSE = "Finance & E-commerce Web Hacking";

export async function startMockLms(options: MockOptions = {}) {
  const account = { id: options.id || "tester", password: options.password || "pw-1234!" };
  const ttl = options.sessionTtlMs ?? 30 * 60_000;
  const problems = (
    options.problems || [
      { title: "파라미터 변조(1)", description: "다른 사용자의 거래내역을 조회하세요.</br>- Hint : 000", answer: "MOCK_ONE", solved: false },
      { title: "세션 탈취", description: "로그인하지 않고 문제 페이지로 이동하세요.", answer: "MOCK_TWO", solved: true },
      { title: "XSS(1)", description: "alert 를 띄우는 인자를 찾으세요.", answer: "MOCK_THREE", solved: false },
    ]
  ).map((p, i) => ({ ...p, no: i + 1, qstnSn: `QSTN${i + 1}==` }));
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString().trim().replace(/\n/g, "\\n");
  const sessions = new Map<string, { user: string; seen: number; course?: string }>();
  const tokens = new Map<string, number>();
  const labSessions = new Set<string>();
  const stats = { logins: 0, failedLogins: 0, stare: 0, submits: [] as { no: number; answer: string; result: number }[] };
  let labOrigin = "";

  const page = (body: string) => `<!DOCTYPE html><html><body><main>${body}</main></body></html>`;
  const cookieOf = (req: http.IncomingMessage, name: string) =>
    (req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).find(([k]) => k === name)?.[1];
  const readForm = async (req: http.IncomingMessage) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    return Object.fromEntries(new URLSearchParams(raw));
  };
  const json = (res: http.ServerResponse, body: unknown) => {
    res.writeHead(200, { "content-type": "application/json;charset=UTF-8" });
    res.end(JSON.stringify(body));
  };
  const html = (res: http.ServerResponse, body: string, headers: Record<string, string | string[]> = {}) => {
    res.writeHead(200, { "content-type": "text/html;charset=UTF-8", ...headers });
    res.end(page(body));
  };
  const redirect = (res: http.ServerResponse, to: string, headers: Record<string, string | string[]> = {}) => {
    res.writeHead(302, { location: to, ...headers });
    res.end();
  };
  const paper = () => {
    const blocks = problems
      .map(
        (p) => `
      <div class="list_view_box"><div class="list_title mr10">
        <div id="markDiv${p.no}" class="type ${p.solved ? "mark_right" : ""}" corr="${p.solved ? "correct" : ""}"><span class="num">${p.no}.</span>단답형 문항<!-- 문항 --></div>
        <div class="score">배점<!-- 배점 -->: 7.0 점\n\n &nbsp;|&nbsp; 난이도: 중</div></div>
        <div class="list_item"><div class="quest">${p.title}</div>
        <div class="exam_area">${p.description}</div>
        <div class="virtualdiv mb30" id="virtualdiv${p.no}" idx="${p.no}" qstnsn="${p.qstnSn}", scenario="">
          <button class='btn small type3' onclick="openPracticeSite('url',${p.no},'${labOrigin}/practice/practice${p.no}','');return false;">실습 사이트 이동</button></div>
        <div class="form-inline"><input class="form-control short" type="text" name="ans_${p.no}" id="ans_${p.no}" placeholder="답을 입력하세요." value="${p.solved ? p.answer : ""}" ${p.solved ? "readonly='readonly'" : ""}></div>
        ${p.solved ? "" : `<button type="button" class="btn type4" onclick="submitPaperOne('${p.no}','${p.qstnSn}','D');" id="submitBtn${p.no}">제출하기</button>`}
        <button onclick="viewQstnAtclList('${p.qstnSn}','${p.no}');return false;" class="btn solid type2" id="atclBtn${p.no}">정답자 게시판 보기</button>
      </div></div>`,
      )
      .join("");
    return `<form id="examForm" name="examForm" onsubmit="return false" method="post">
      <input type="hidden" name="csSignature" value="${SIGNATURE}" />
      <input type="hidden" name="encCrsCreCd" value="ENC_CRS=" />
      <input type="hidden" name="encExamSn" value="BANK==" />
      <input type="hidden" name="encStdNo" value="ENC_STD=" />
      <input type="hidden" name="encExamQstnSn" value="" />
      <input type="hidden" name="stareTm" value="0"/>
      <input type="hidden" name="stareAnss" value="" />
      <input type="hidden" name="stareCnt" 	value="${stats.stare}" />
      <input type="hidden" name="examDivCd" value="WA" />
      <input type="hidden" name="qstnNo" value="" />
    </form><p class="message-text">VM 생성중...</p>${blocks}`;
  };

  const lms = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://lms");
    const sid = cookieOf(req, "JSESSIONID");
    const session = sid ? sessions.get(sid) : undefined;
    const alive = !!session && Date.now() - session.seen < ttl;
    if (alive) session!.seen = Date.now();
    const ajax = req.method === "POST" && req.headers["x-requested-with"] === "XMLHttpRequest";
    const loginForm = () =>
      html(res, `<form name="loginForm" id="loginForm" method="post" action="/home/user/login"><input type="hidden" name="csSignature" value="${SIGNATURE}" /><input type="hidden" name="encryptData" id="encryptData" /></form><input type="password" id="login_pwd"><script>const rsaPublicKey = KEYUTIL.getKey("${pem}");</script>`, {
        "set-cookie": `JSESSIONID=${randomBytes(8).toString("hex")}; Path=/; Secure; HttpOnly`,
      });
    switch (url.pathname) {
      case "/home/user/loginForm":
        return loginForm();
      case "/home/user/login": {
        const form = await readForm(req);
        let ok = false;
        try {
          const plain = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" }, Buffer.from(form.encryptData || "", "hex")).toString();
          ok = form.csSignature === SIGNATURE && Buffer.from(plain, "base64").toString("utf8") === `${account.id}|${account.password}`;
        } catch {}
        if (!ok) {
          stats.failedLogins++;
          return redirect(res, "/home/user/loginForm?mcd=HM04001000");
        }
        stats.logins++;
        const next = randomBytes(12).toString("hex");
        sessions.set(next, { user: account.id, seen: Date.now() });
        return redirect(res, "/home/user/editFormUserMain", {
          "set-cookie": [`JSESSIONID=${next}; Path=/; Secure; HttpOnly`, `LOGINID=${account.id}; Path=/`],
        });
      }
      case "/home/user/editFormUserMain":
        return html(res, "프로필");
    }
    if (!alive) {
      if (ajax) return json(res, { result: -3, message: "로그인이 필요합니다." });
      if (url.pathname === "/home/main/indexMain") return html(res, `<a href="/home/main/goMenuPage?mcd=HM04001000">로그인</a>`);
      return redirect(res, "/home/user/loginForm?mcd=HM04001000");
    }
    switch (url.pathname) {
      case "/home/main/indexMain":
        return html(res, `<a href="/home/user/logout">로그아웃</a>`);
      case "/home/main/goMenuPage":
        if (url.searchParams.get("mcd") === "MC00000051") return redirect(res, "/home/main/listCourseMain?mcd=MC00000051");
        break;
      case "/home/main/listCourseMain":
        return html(res, `<div title="Web Hacking">Web Hacking</div><button onclick="javascript:goLecture('CE_WEB','EN_WEB')">Learning</button>
          <div class="tit" title="${COURSE}">${COURSE}</div><span>Progress</span><button class="go" onclick="javascript:goLecture('CE_FIN','EN_FIN')">Learning</button>`);
      case "/lec/main/goLecture":
        session!.course = url.searchParams.get("crsCreCd") || undefined;
        return redirect(res, "/lec/main/lectureMain");
      case "/lec/main/lectureMain":
        return html(res, "강의실 Home");
      case "/lec/main/goMenuPage":
        if (url.searchParams.get("mcd") === "MC10000066") return redirect(res, "/lec/exam/examMain?examDivCd=WA");
        break;
      case "/lec/exam/examMain":
        if (session!.course !== "CE_FIN") return html(res, "잘못된 접근입니다.");
        return html(res, `<input type="hidden" name="csSignature" value="${SIGNATURE}" />
          <label class="online">Online</label> <h4>쇼핑몰 모의해킹</h4> <button onclick="examPaper('SHOP==','999','7')">응시하기</button>
          <label class="online">Online</label> <h4>인터넷 뱅킹 모의해킹</h4> <button onclick="examPaper('BANK==','999','4')">응시하기</button>`);
      case "/lec/exam/examPaperStareCnt": {
        const form = await readForm(req);
        if (form.encExamSn !== "BANK==") return json(res, { result: -1 });
        stats.stare++;
        return json(res, { result: 1, returnVO: { agreeYn: "Y", stareCnt: String(stats.stare - 1) } });
      }
      case "/lec/exam/addPaperPop":
        if (session!.course !== "CE_FIN") return html(res, "잘못된 접근입니다.");
        return html(res, paper());
      case "/home/etc/token/getJwtToken": {
        const token = `mock.${randomBytes(16).toString("hex")}.sig`;
        tokens.set(token, Date.now() + 60_000);
        return json(res, { result: 1, message: token });
      }
      case "/lec/exam/submitPaperOne": {
        const form = await readForm(req);
        const problem = problems.find((p) => p.qstnSn === form.encExamQstnSn && String(p.no) === form.qstnNo);
        if (!problem || form.encExamSn !== "BANK==" || form.csSignature !== SIGNATURE) return json(res, { result: -1, message: "시험지를 제출하지 못 하였습니다" });
        const result = problem.answer === form.stareAnss ? 2 : 3;
        if (result === 2) problem.solved = true;
        stats.submits.push({ no: problem.no, answer: form.stareAnss, result });
        return json(res, { result, returnVO: { totGetScore: 0, rgtCnt: 0 } });
      }
    }
    res.writeHead(404).end();
  });

  const lab = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://lab");
    const token = url.searchParams.get("sToken");
    if (options.labStyle === "bind") {
      const sid = cookieOf(req, "EQSTORESESSIONID");
      if (!sid) {
        const fresh = randomBytes(12).toString("hex");
        return redirect(res, "/forbidden", { "set-cookie": `EQSTORESESSIONID=${fresh}; Path=/; Secure; HttpOnly` });
      }
      if (token) {
        const expires = tokens.get(token);
        tokens.delete(token);
        if (!expires || expires < Date.now()) return redirect(res, "/forbidden");
        labSessions.add(sid);
        url.searchParams.delete("sToken");
        return redirect(res, url.pathname);
      }
      const no = url.pathname.match(/^\/practice\/practice(\d+)$/)?.[1];
      if (no && labSessions.has(sid)) return html(res, `문제 ${no}번. EQSTORE`);
      return redirect(res, "/forbidden");
    }
    if (token) {
      const expires = tokens.get(token);
      tokens.delete(token);
      if (!expires || expires < Date.now()) return redirect(res, "/error");
      const sid = randomBytes(12).toString("hex");
      labSessions.add(sid);
      url.searchParams.delete("sToken");
      return redirect(res, url.pathname, { "set-cookie": `SMTMBANKSESSIONID=${sid}; Path=/; Secure; HttpOnly` });
    }
    if (url.pathname === "/error") return html(res, "에러 잘못된 접근입니다.");
    const no = url.pathname.match(/^\/practice\/practice(\d+)$/)?.[1];
    if (no && labSessions.has(cookieOf(req, "SMTMBANKSESSIONID") || "")) return html(res, `문제 ${no}번. Shield Bank`);
    return redirect(res, "/error");
  });

  const listen = (server: http.Server) =>
    new Promise<string>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
    );
  const base = await listen(lms);
  labOrigin = await listen(lab);
  return {
    base,
    lab: labOrigin,
    account,
    problems,
    stats,
    // 서버 쪽 세션 만료를 흉내 낸다
    expireSessions: () => sessions.clear(),
    close: () => Promise.all([lms, lab].map((s) => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); }))),
  };
}

// 직접 실행하면 대시보드 수동 테스트용으로 띄운다: npx tsx server/lms-mock.ts
if (process.argv[1]?.replace(/\\/g, "/").endsWith("server/lms-mock.ts")) {
  const mock = await startMockLms({ sessionTtlMs: Number(process.env.MOCK_SESSION_TTL_MS) || undefined });
  console.log(JSON.stringify({ EQST_LMS_BASE: mock.base, EQST_LMS_LAB: mock.lab, EQST_LMS_ID: mock.account.id, EQST_LMS_PW: mock.account.password }));
}

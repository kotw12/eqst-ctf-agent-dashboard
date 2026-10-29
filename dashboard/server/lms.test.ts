import { test } from "node:test";
import assert from "node:assert/strict";
import { LmsClient, LmsGateway, parsePaper, problemName, problemNo, type LmsPreset } from "./lms.ts";
import { startMockLms } from "./lms-mock.ts";

async function withMock(
  run: (ctx: { mock: Awaited<ReturnType<typeof startMockLms>>; gateway: LmsGateway }) => Promise<void>,
  password?: string,
) {
  const mock = await startMockLms();
  const preset: LmsPreset = {
    id: "mock",
    title: "Mock",
    course: "Finance & E-commerce Web Hacking",
    exam: "온라인 인터넷 뱅킹 모의해킹",
    lab: mock.lab,
  };
  try {
    await run({ mock, gateway: new LmsGateway(preset, new LmsClient(mock.account.id, password ?? mock.account.password, mock.base)) });
  } finally {
    await mock.close();
  }
}

test("mock LMS: 로그인 → 과정 → 워게임 문제지까지 열고, 기존 정답은 밖으로 내보내지 않는다", () =>
  withMock(async ({ mock, gateway }) => {
    const problems = await gateway.open();
    assert.equal(mock.stats.logins, 1);
    assert.deepEqual(problems.map((p) => [p.no, p.title, p.solved]), [
      [1, "파라미터 변조(1)", false],
      [2, "세션 탈취", true],
      [3, "XSS(1)", false],
    ]);
    assert.equal(problems[0].target, `${mock.lab}/practice/practice1`);
    assert.ok(!JSON.stringify(problems).includes("MOCK_TWO"));
  }));

test("mock LMS: 실습 쿠키로 문제 화면이 열린다", () =>
  withMock(async ({ mock, gateway }) => {
    await gateway.open();
    const { cookie, origin } = await gateway.labCookie(1);
    assert.equal(origin, mock.lab);
    assert.match(cookie, /^SMTMBANKSESSIONID=/);
    const page = await fetch(`${mock.lab}/practice/practice1`, { headers: { cookie }, redirect: "manual" });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /문제 1번/);
    const anonymous = await fetch(`${mock.lab}/practice/practice1`, { redirect: "manual" });
    assert.equal(anonymous.headers.get("location"), "/error");
  }));

test("mock LMS: 안 푼 문제는 LMS 판정, 이미 푼 문제는 LMS 제출 없이 기존 정답과 대조한다", () =>
  withMock(async ({ mock, gateway }) => {
    await gateway.open();
    assert.equal((await gateway.submit(1, "WRONG")).outcome, "rejected");
    const right = await gateway.submit(1, " MOCK_ONE ");
    assert.equal(right.outcome, "accepted");
    assert.equal(right.local, false);
    assert.deepEqual(mock.stats.submits.map((s) => [s.no, s.result]), [[1, 3], [1, 2]]);
    const known = await gateway.submit(2, "mock_two");
    assert.equal(known.outcome, "accepted");
    assert.equal(known.local, true);
    assert.equal((await gateway.submit(2, "nope")).outcome, "rejected");
    assert.equal(mock.stats.submits.length, 2, "이미 푼 문제는 LMS 로 보내지 않는다");
  }));

test("mock LMS: 세션이 만료되면 다시 로그인하고 문제지를 다시 연 뒤 이어간다", () =>
  withMock(async ({ mock, gateway }) => {
    await gateway.open();
    mock.expireSessions();
    await gateway.labCookie(1);
    assert.equal(mock.stats.logins, 2);
    mock.expireSessions();
    assert.equal((await gateway.submit(3, "MOCK_THREE")).outcome, "accepted");
    assert.equal(mock.stats.logins, 3);
  }));

test("mock LMS: 비밀번호가 틀리면 3번까지만 시도하고 멈춘다", () =>
  withMock(async ({ mock, gateway }) => {
    for (let i = 0; i < 3; i++) await assert.rejects(gateway.open(), /로그인에 실패/);
    await assert.rejects(gateway.open(), /더 시도하지 않습니다/);
    assert.equal(mock.stats.failedLogins, 3);
  }, "wrong-password"));

const block = (no: number, solved: boolean) => `
<div class="list_view_box"><div class="list_title mr10">
  <div id="markDiv${no}" class="type ${solved ? "mark_right" : ""}" corr="${solved ? "correct" : ""}"><span class="num">${no}.</span>단답형 문항</div>
  <div class="score">배점<!-- 배점 -->: 7.0 점 &nbsp;|&nbsp; 난이도: 중</div></div>
  <div class="list_item"><div class="quest">문제 &amp; 제목 ${no}</div>
  <div class="exam_area">설명</br></br>- Hint : abc</div>
  <div class="virtualdiv mb30" id="virtualdiv${no}" idx="${no}" qstnsn="Q${no}==", scenario="">
  <button onclick="openPracticeSite('url',${no},'https://lab.example:8111/practice/practice${no}','');return false;">실습 사이트 이동</button></div>
  <input class="form-control short" type="text" name="ans_${no}" id="ans_${no}" value="${solved ? `ANSWER${no}` : ""}" ${solved ? "readonly='readonly'" : ""}>
</div></div>`;
const html = `<form id="examForm" name="examForm" method="post">
<input type="hidden" name="csSignature" value="sig" />
<input type="hidden" name="encExamSn" value="exam==" />
<input type="hidden" name="stareCnt" 	value="5" />
</form>${block(1, false)}${block(2, true)}`;

test("문제지에서 문제 목록과 제출 폼을 읽고, 기존 정답은 answers 에만 둔다", () => {
  const paper = parsePaper(html);
  assert.deepEqual(paper.form, { csSignature: "sig", encExamSn: "exam==", stareCnt: "5" });
  assert.equal(paper.problems.length, 2);
  const [first, second] = paper.problems;
  assert.equal(first.title, "문제 & 제목 1");
  assert.equal(first.description, "설명\n\n- Hint : abc");
  assert.equal(first.points, 7);
  assert.equal(first.level, "중");
  assert.equal(first.target, "https://lab.example:8111/practice/practice1");
  assert.equal(first.qstnSn, "Q1==");
  assert.equal(first.solved, false);
  assert.equal(second.solved, true);
  assert.equal(paper.answers.get(2), "ANSWER2");
  assert.equal(paper.answers.has(1), false);
  assert.ok(!JSON.stringify(paper.problems).includes("ANSWER"));
});

test("대시보드 문제 이름과 번호를 서로 바꾼다", () => {
  const name = problemName({ no: 12, title: "XSS(1)" });
  assert.equal(name, "12. XSS(1)");
  assert.equal(problemNo(name), 12);
  assert.equal(problemNo("XSS"), undefined);
});

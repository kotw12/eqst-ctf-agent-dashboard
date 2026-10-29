import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePaper, problemName, problemNo } from "./lms.ts";

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

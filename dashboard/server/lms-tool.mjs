#!/usr/bin/env node
// 에이전트가 쓰는 EQST LMS 게이트웨이 명령. LMS 계정·화면에는 닿지 않고 대시보드 서버에 요청만 보낸다.
const usage = `사용법:
  node lms-tool.mjs problems              문제 목록(번호·제목·설명·실습 주소)
  node lms-tool.mjs whoami                실습에 쓰는 LMS 아이디
  node lms-tool.mjs lab-cookie [번호]     실습 사이트 세션 쿠키(Cookie 헤더 값) 새로 발급
  node lms-tool.mjs submit <번호> <답>    정답 제출 → 정답/오답`;
const [command, ...rest] = process.argv.slice(2);
const routes = { problems: "/problems", whoami: "/whoami", "lab-cookie": "/lab-cookie", submit: "/submit" };
try {
  if (!routes[command]) throw new Error(usage);
  if (!process.env.SEAL_LIVE_LMS_URL || !process.env.SEAL_LIVE_LMS_TOKEN)
    throw new Error("EQST LMS 프리셋 실행 안에서만 쓸 수 있습니다.");
  const body =
    command === "submit"
      ? { no: Number(rest[0]), answer: rest.slice(1).join(" ") }
      : command === "lab-cookie" && rest[0]
        ? { no: Number(rest[0]) }
        : {};
  const res = await fetch(process.env.SEAL_LIVE_LMS_URL + routes[command], {
    method: "POST",
    headers: { "content-type": "application/json", "x-lms-token": process.env.SEAL_LIVE_LMS_TOKEN },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (command === "lab-cookie") console.log(data.cookie);
  else console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

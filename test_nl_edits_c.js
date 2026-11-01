// 3차 묶음 — 새 말투: 불평·감상형, 오타·초성, 복합 요청(크기+서체), 반말·명령, 숫자·단위, 대상 생략, 비유. (API 호출 없음)
// 실행: node test_nl_edits_c.js
import { pathToFileURL } from 'url';
import { runCases } from './test_nl_edits_100.js';

const M4 = ['marginTop', 'marginBottom', 'marginInner', 'marginOuter'];

export const CASES_C = [
  // 불평·감상 (1~12)
  ['글자가 너무 작아서 읽기 힘들어', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['글씨가 너무 커서 부담스러워', { keys: ['bodySize'], dir: -1, level: 3, mode: 'synth' }],
  ['줄 사이가 너무 좁아서 답답해', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['줄 간격이 너무 넓어서 허전해', { keys: ['bodyLeading'], dir: -1, level: 3, mode: 'synth' }],
  ['여백이 너무 많아서 낭비 같아', { keys: M4, dir: -1, level: 3, mode: 'synth' }],
  ['여백이 너무 없어서 숨막혀', { keys: M4, dir: 1, level: 3, mode: 'synth' }],
  ['글자들이 너무 붙어 있어', { keys: ['letterSpace'], dir: 1, level: 3, mode: 'synth' }],
  ['글자 사이가 너무 벌어져 있어', { keys: ['letterSpace'], dir: -1, level: 3, mode: 'synth' }],
  ['문단들이 너무 붙어 있어 보여', { keys: ['parSkip'], dir: 1, level: 3, mode: 'synth' }],
  ['각주가 너무 커서 거슬려', { keys: ['noteSize'], dir: -1, level: 3, mode: 'synth' }],
  ['제목이 너무 작아서 안 눈에 띄어', { keys: ['h1Size'], dir: 1, level: 3, mode: 'synth' }],
  ['쪽번호가 너무 커서 눈에 띄어', { keys: ['pnSize'], dir: -1, level: 3, mode: 'synth' }],
  // 반말·명령·단답 (13~22)
  ['본문 키워', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['행간 늘려', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['자간 좁혀', { keys: ['letterSpace'], dir: -1, level: 3, mode: 'synth' }],
  ['여백 늘려', { keys: M4, dir: 1, level: 3, mode: 'synth' }],
  ['제목 줄여', { keys: ['h1Size'], dir: -1, level: 3, mode: 'synth' }],
  ['각주 키워', { keys: ['noteSize'], dir: 1, level: 3, mode: 'synth' }],
  ['본문 작게!', { keys: ['bodySize'], dir: -1, level: 3, mode: 'synth' }],
  ['행간 더 넓게!!', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['글씨 확 키워!', { keys: ['bodySize'], dir: 1, level: 4, mode: 'synth' }],
  ['자간 쭉 늘려봐', { keys: ['letterSpace'], dir: 1, level: 4, mode: 'synth' }],
  // 오타·띄어쓰기 변형 (23~32)
  ['본문 글짜 키워줘', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['본문 글자크기 줄여줘', { keys: ['bodySize'], dir: -1, level: 3, mode: 'synth' }],
  ['줄간격 넓혀줘', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['줄 간격좀 줄여주세요', { keys: ['bodyLeading'], dir: -1, level: 3, mode: 'synth' }],
  ['글자간격 넓혀줘', { keys: ['letterSpace'], dir: 1, level: 3, mode: 'synth' }],
  ['위 여백 줄여주세요', { keys: ['marginTop'], not: ['marginBottom'], dir: -1, level: 3, mode: 'synth' }],
  ['아래여백 늘려줘', { keys: ['marginBottom'], not: ['marginTop'], dir: 1, level: 3, mode: 'synth' }],
  ['안쪽여백 줄여줘', { keys: ['marginInner'], not: ['marginOuter'], dir: -1, level: 3, mode: 'synth' }],
  ['제목글자 키워줘', { keys: ['h1Size'], dir: 1, level: 3, mode: 'synth' }],
  ['각주글씨 줄여줘', { keys: ['noteSize'], dir: -1, level: 3, mode: 'synth' }],
  // 강도 표현 변형 (33~42)
  ['본문 살짝만 키워줘', { keys: ['bodySize'], dir: 1, level: 1, mode: 'synth' }],
  ['본문 약간 줄여줘', { keys: ['bodySize'], dir: -1, level: 2, mode: 'synth' }],
  ['행간 보통으로 늘려줘', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['행간 꽤 넓혀줘', { keys: ['bodyLeading'], dir: 1, level: 4, mode: 'synth' }],
  ['여백 대폭 줄여줘', { keys: M4, dir: -1, level: 4, mode: 'synth' }],
  ['여백 극단적으로 줄여줘', { keys: M4, dir: -1, level: 5, mode: 'synth' }],
  ['본문 엄청 키워줘', { keys: ['bodySize'], dir: 1, level: 5, mode: 'synth' }],
  ['자간 미세하게 넓혀줘', { keys: ['letterSpace'], dir: 1, level: 1, mode: 'synth' }],
  ['제목 최대한 크게', { keys: ['h1Size'], dir: 1, level: 5, mode: 'synth' }],
  ['각주 최소한으로 작게', { keys: ['noteSize'], dir: -1, level: 5, mode: 'synth' }],
  // 복합: 크기+서체, 여러 대상 (43~52)
  ['본문 키우고 나눔명조로 바꿔줘', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['행간 늘리고 서체는 본명조로', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['제목 키우고 부제목 줄여줘', { keys: ['h1Size', 'h2Size'], mode: 'llm' }],
  ['본문은 키우고 각주는 줄여줘', { keys: ['bodySize', 'noteSize'], mode: 'llm' }],
  ['행간이랑 자간 둘 다 넓혀줘', { keys: ['bodyLeading', 'letterSpace'], dir: 1, level: 3, mode: 'synth' }],
  ['본문 글자와 행간 같이 줄여줘', { keys: ['bodySize', 'bodyLeading'], dir: -1, level: 3, mode: 'synth' }],
  ['위아래 여백은 줄이고 좌우는 늘려줘', { keys: ['marginTop', 'marginBottom', 'marginInner', 'marginOuter'], mode: 'llm' }],
  ['쪽번호랑 면주 둘 다 작게', { keys: ['pnSize', 'rhSize'], dir: -1, level: 3, mode: 'synth' }],
  ['각주와 쪽번호 모두 키워줘', { keys: ['noteSize', 'pnSize'], dir: 1, level: 3, mode: 'synth' }],
  ['전부 조금씩 줄여줘', { keys: [], mode: 'llm' }],
  // 숫자·단위 (53~60)
  ['본문 10.5pt로', { keys: ['bodySize'], mode: 'amount' }],
  ['행간을 16포인트로 해줘', { keys: ['bodyLeading'], mode: 'amount' }],
  ['위 여백 20mm', { keys: ['marginTop'], mode: 'amount' }],
  ['각주 7pt로 줄여줘', { keys: ['noteSize'], mode: 'amount' }],
  ['제목 24pt로 키워줘', { keys: ['h1Size'], mode: 'amount' }],
  ['자간 2로', { keys: ['letterSpace'], mode: 'amount' }],
  ['문단 간격 6pt', { keys: ['parSkip'], mode: 'amount' }],
  ['쪽번호 8pt', { keys: ['pnSize'], mode: 'amount' }],
  // 비유·감각 표현 (61~68)
  ['숨 좀 쉬게 여백 넓혀줘', { keys: M4, dir: 1, level: 3, mode: 'synth' }],
  ['빽빽해 보이니까 행간 넓혀줘', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['시원시원하게 글자 키워줘', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['한 페이지에 더 많이 들어가게 글자 줄여줘', { keys: ['bodySize'], dir: -1, level: 3, mode: 'synth' }],
  ['페이지 수 줄이게 여백 줄여줘', { keys: M4, dir: -1, level: 3, mode: 'synth' }],
  ['돋보기 없이 읽게 본문 키워줘', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['제목 좀 묵직하게 키워줘', { keys: ['h1Size'], dir: 1, level: 3, mode: 'synth' }],
  ['각주는 눈에 안 띄게 작게 해줘', { keys: ['noteSize'], dir: -1, level: 3, mode: 'synth' }],
  // 되돌림·초기화·후속 (69~74)
  ['원래대로 돌려줘', { mode: 'none' }],
  ['방금 거 취소해줘', { mode: 'none' }],
  ['한 번 더 키워줘', { mode: 'follow', prev: ['bodySize'], dir: 1, level: 3, expect: ['bodySize', 'bodyLeading'] }],
  ['아까처럼 줄여줘', { mode: 'follow', prev: ['marginTop', 'marginBottom', 'marginInner', 'marginOuter'], dir: -1, level: 3, expect: ['marginTop', 'marginBottom', 'marginInner', 'marginOuter'] }],
];

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exit(runCases(CASES_C) === 0 ? 0 : 1);

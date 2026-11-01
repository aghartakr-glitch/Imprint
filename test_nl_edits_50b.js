// 2차 묶음 — 1차와 다른 유형: 영어 혼용·어순 뒤집기·말줄임/감탄·높임·부정/대조·비교·위치 비유·단위 표기·제외 조건.
// 기대값은 "사용자가 이렇게 말하면 이렇게 처리돼야 한다"는 기준이다. (API 호출 없음)
// 실행: node test_nl_edits_50b.js
import { pathToFileURL } from 'url';
import { runCases } from './test_nl_edits_100.js';

const M4 = ['marginTop', 'marginBottom', 'marginInner', 'marginOuter'];

export const CASES_B = [
  // 영어 혼용 (1~7)
  ['font size 좀 키워줘', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['line height 늘려줘', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['margin 줄여줘', { keys: M4, dir: -1, level: 3, mode: 'synth' }],
  ['letter spacing 넓혀줘', { keys: ['letterSpace'], dir: 1, level: 3, mode: 'synth' }],
  ['footnote 크기 줄여줘', { keys: ['noteSize'], dir: -1, level: 3, mode: 'synth' }],
  ['title 키워줘', { keys: ['h1Size'], dir: 1, level: 3, mode: 'synth' }],
  ['page number 작게', { keys: ['pnSize'], dir: -1, level: 3, mode: 'synth' }],
  // 어순 뒤집기 (8~10)
  ['줄여줘 행간 좀', { keys: ['bodyLeading'], dir: -1, level: 3, mode: 'synth' }],
  ['키워줘 본문 글자', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['넓혀줘 자간 조금', { keys: ['letterSpace'], dir: 1, level: 2, mode: 'synth' }],
  // 말줄임·감탄·이모티콘 (11~13)
  ['행간... 너무 좁은데 넓혀줘~', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['아 글씨 작게 해줘 ㅠㅠ', { keys: ['bodySize'], dir: -1, level: 3, mode: 'synth' }],
  ['본문 키워줘ㅋㅋ', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  // 높임·띄어 쓴 "주세요" (14~17)
  ['본문 글자를 키워 주세요', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['행간을 줄여 주시겠어요', { keys: ['bodyLeading'], dir: -1, level: 3, mode: 'synth' }],
  ['여백을 넓혀 주세요', { keys: M4, dir: 1, level: 3, mode: 'synth' }],
  ['자간 좀 좁혀 줄래?', { keys: ['letterSpace'], dir: -1, level: 3, mode: 'synth' }],
  // 부정·대조 — 부정된 쪽을 버리고 뜻을 읽어야 함 (18~20)
  ['본문 글자 줄이지 말고 키워줘', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['글자 작게 말고 크게 해줘', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['행간 넓히지 말고 좁혀줘', { keys: ['bodyLeading'], dir: -1, level: 3, mode: 'synth' }],
  // 비교형 — 값은 모델이 정함 (21~22)
  ['제목을 본문보다 크게', { keys: ['h1Size'], mode: 'llm' }],
  ['각주를 본문보다 작게', { keys: ['noteSize'], mode: 'llm' }],
  // 위치를 비유·다르게 말함 (23~26)
  ['맨 위 여백만 좁혀줘', { keys: ['marginTop'], not: ['marginBottom', 'marginInner', 'marginOuter'], dir: -1, level: 3, mode: 'synth' }],
  ['제일 아래 여백 넓혀줘', { keys: ['marginBottom'], not: ['marginTop', 'marginInner', 'marginOuter'], dir: 1, level: 3, mode: 'synth' }],
  ['책등 쪽 여백 늘려줘', { keys: ['marginInner'], not: ['marginTop', 'marginBottom', 'marginOuter'], dir: 1, level: 3, mode: 'synth' }],
  ['페이지 바깥쪽 여백 줄여줘', { keys: ['marginOuter'], not: ['marginTop', 'marginBottom', 'marginInner'], dir: -1, level: 3, mode: 'synth' }],
  // 단위 표기 — 양을 직접 말함 (27~30)
  ['본문 한 포인트 키워줘', { keys: ['bodySize'], mode: 'amount' }],
  ['본문 1pt 줄여줘', { keys: ['bodySize'], mode: 'amount' }],
  ['위쪽 여백 2밀리 넓혀줘', { keys: ['marginTop'], mode: 'amount' }],
  ['자간 -3으로 해줘', { keys: ['letterSpace'], mode: 'amount' }],
  // 제외 조건 — "제목은 그대로" 같은 말에 제목이 같이 바뀌면 안 됨 (31~33)
  ['제목은 놔두고 본문만 키워줘', { keys: ['bodySize'], not: ['h1Size', 'h2Size'], dir: 1, level: 3, mode: 'synth' }],
  ['각주는 그대로 두고 행간만 줄여줘', { keys: ['bodyLeading'], not: ['noteSize', 'noteLeading'], dir: -1, level: 3, mode: 'synth' }],
  ['본문 빼고 제목만 크게', { keys: ['h1Size'], not: ['bodySize', 'bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  // 전체/대상 생략 (34~36)
  ['전체적으로 글자 키워줘', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['본문 폰트 명조로', { keys: ['bodyFontFamily'], mode: 'llm' }],
  ['각주 고딕체로', { keys: ['footnoteFontFamily'], not: ['bodyFontFamily'], mode: 'llm' }],
  // 굵기 (37~38)
  ['본문 좀 두껍게', { keys: ['bodyWeight'], mode: 'llm' }],
  ['제목 볼드로', { keys: ['headingWeight'], not: ['bodyWeight'], mode: 'llm' }],
  // 연속 후속 발화 (39~40)
  ['좀 더 키워', { mode: 'follow', prev: ['bodySize', 'bodyLeading'], dir: 1, level: 3, expect: ['bodySize', 'bodyLeading'] }],
  ['한참 더 줄여줘', { mode: 'follow', prev: ['marginTop', 'marginBottom', 'marginInner', 'marginOuter'], dir: -1, level: 4, expect: ['marginTop', 'marginBottom', 'marginInner', 'marginOuter'] }],
];

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exit(runCases(CASES_B) === 0 ? 0 : 1);

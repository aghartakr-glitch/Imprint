// 말투를 일부러 다양하게 섞은 50문장 — 존댓말·소망형·은어·붙여쓰기·동의어·질문형·절대값·후속 발화·복합.
// 기대값은 현재 코드에 맞춘 게 아니라 "사용자가 이렇게 말하면 이렇게 처리돼야 한다"는 기준이다. (API 호출 없음)
// 실행: node test_nl_edits_50.js
import { pathToFileURL } from 'url';
import { runCases } from './test_nl_edits_100.js';

const M4 = ['marginTop', 'marginBottom', 'marginInner', 'marginOuter'];

export const CASES_50 = [
  // 존댓말·정중한 부탁 (1~2)
  ['본문 글자 크기를 조금만 키워주시면 감사하겠습니다', { keys: ['bodySize'], dir: 1, level: 2, mode: 'synth' }],
  ['행간을 좀 넓게 해주실 수 있을까요?', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  // 소망형·과거형 어미 (3~4, 14)
  ['글씨가 좀 더 컸으면 좋겠어요', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['행간이 조금만 좁았으면 해요', { keys: ['bodyLeading'], dir: -1, level: 2, mode: 'synth' }],
  ['행간을 줄였으면 좋겠어', { keys: ['bodyLeading'], dir: -1, level: 3, mode: 'synth' }],
  // 은어·구어 (5~8)
  ['글자가 개작아 보여', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['행간 겁나 넓게 해줘', { keys: ['bodyLeading'], dir: 1, level: 5, mode: 'synth' }],
  ['폰트 좀만 키워봐', { keys: ['bodySize'], dir: 1, level: 2, mode: 'synth' }],
  ['자간 쫙 벌려줘', { keys: ['letterSpace'], dir: 1, level: 4, mode: 'synth' }],
  // 붙여쓰기·띄어쓰기 없음 (9~12)
  ['본문글자키워줘', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['행간좀줄여줘', { keys: ['bodyLeading'], dir: -1, level: 3, mode: 'synth' }],
  ['여백줄여줘', { keys: M4, dir: -1, level: 3, mode: 'synth' }],
  ['자간넓혀줘', { keys: ['letterSpace'], dir: 1, level: 3, mode: 'synth' }],
  // 가장 흔한 말 — 짧은 명령 (13)
  ['행간 줄여줘', { keys: ['bodyLeading'], dir: -1, level: 3, mode: 'synth' }],
  // 절대값·배율로 지정 (15~17, 47) — 양을 직접 말했으므로 모델 값을 그대로 써야 함
  ['본문을 11pt로 바꿔줘', { keys: ['bodySize'], mode: 'amount' }],
  ['여백을 15mm로 맞춰줘', { keys: M4, mode: 'amount' }],
  ['행간 150%로', { keys: ['bodyLeading'], mode: 'amount' }],
  ['본문 글자 두 배로 키워줘', { keys: ['bodySize'], mode: 'amount' }],
  ['본문 글자 크기를 한 단계 줄여줘', { keys: ['bodySize'], mode: 'amount' }],
  // 복수 대상·복합 (18~19, 46)
  ['제목이랑 부제목 둘 다 키워줘', { keys: ['h1Size', 'h2Size'], dir: 1, level: 3, mode: 'synth' }],
  ['본문은 크게, 각주는 작게', { keys: ['bodySize', 'noteSize'], mode: 'llm' }],
  ['제목과 부제목 모두 아주 조금 키워줘', { keys: ['h1Size', 'h2Size'], dir: 1, level: 1, mode: 'synth' }],
  // 동의어: 주석·머리말·페이지 숫자·타이틀·텍스트·줄 높이·라인 간격 … (20~25, 27~34)
  ['주석 글씨 키워줘', { keys: ['noteSize'], dir: 1, level: 3, mode: 'synth' }],
  ['머리말 작게 해줘', { keys: ['rhSize'], dir: -1, level: 3, mode: 'synth' }],
  ['머릿글 지워줘', { keys: ['rhPos'], mode: 'llm' }],
  ['페이지 숫자 좀 작게', { keys: ['pnSize'], dir: -1, level: 3, mode: 'synth' }],
  ['타이틀 크게 해줘', { keys: ['h1Size'], dir: 1, level: 3, mode: 'synth' }],
  ['대제목 키워줘', { keys: ['h1Size'], dir: 1, level: 3, mode: 'synth' }],
  ['텍스트 크기 줄여줘', { keys: ['bodySize'], dir: -1, level: 3, mode: 'synth' }],
  ['줄 높이 좀 키워줘', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['라인 간격 넓혀줘', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['글자 간격 좁혀줘', { keys: ['letterSpace'], dir: -1, level: 3, mode: 'synth' }],
  ['트래킹 넓혀줘', { keys: ['letterSpace'], dir: 1, level: 3, mode: 'synth' }],
  ['마진 줄여줘', { keys: M4, dir: -1, level: 3, mode: 'synth' }],
  ['문단 구분 간격 늘려줘', { keys: ['parSkip'], dir: 1, level: 3, mode: 'synth' }],
  ['단락 띄우기 줄여줘', { keys: ['parSkip'], dir: -1, level: 3, mode: 'synth' }],
  // 키가 없는 요청 — 없다고 알려야 함 (35~36, 48~49)
  ['제목 서체를 명조로 바꿔줘', { keys: ['headingFontFamily'], mode: 'llm' }],
  ['오른쪽 정렬로 해줘', { mode: 'none' }],
  ['표 넣어줘', { mode: 'none' }],
  ['그림 크기 줄여줘', { mode: 'none' }],
  // 일부 여백만 (37~38)
  ['위아래 여백만 줄여줘', { keys: ['marginTop', 'marginBottom'], not: ['marginInner', 'marginOuter'], dir: -1, level: 3, mode: 'synth' }],
  ['좌우 여백만 늘려줘', { keys: ['marginInner', 'marginOuter'], not: ['marginTop', 'marginBottom'], dir: 1, level: 3, mode: 'synth' }],
  // 값이 아니라 종류를 고르는 말 (39~43, 50)
  ['각주 구분선 없애줘', { keys: ['footnoteRule'], mode: 'llm' }],
  ['쪽수 표시 숨겨줘', { keys: ['pnPos'], mode: 'llm' }],
  ['제목 아래 간격 너무 좁아', { keys: ['bodyGap'], dir: 1, level: 3, mode: 'synth' }],
  ['문단 첫줄 들여쓰기 늘려줘', { keys: ['parIndent'], dir: 1, level: 3, mode: 'synth' }],
  ['단어 간격이 너무 넓어', { keys: ['wordSpace'], dir: -1, level: 3, mode: 'synth' }],
  ['본문 서체를 좀 더 단정하게', { keys: ['bodyFontFamily'], mode: 'llm' }],
  // 대상 없는 후속 발화 (44~45)
  ['아까보다 더 크게 해줘', { mode: 'follow', prev: ['bodySize', 'bodyLeading'], dir: 1, level: 3, expect: ['bodySize', 'bodyLeading'] }],
  ['조금씩 계속 줄여줘', { mode: 'follow', prev: ['marginTop', 'marginBottom'], dir: -1, level: 2, expect: ['marginTop', 'marginBottom'] }],
];

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exit(runCases(CASES_50) === 0 ? 0 : 1);

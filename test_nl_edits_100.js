// 새로 만든 자연어 수정 문장 100개 — "반영이 안 되는 문장"을 찾는 검사.
// test_nl_corpus.js는 문장이 어떤 키로 연결되는지만 보지만, 여기서는 문장마다
//  ① 대상 키가 잡히는지  ② 방향(늘림/줄임)  ③ 강도 단계(1~5)  ④ 모델이 sty_patch를 못 냈을 때 직접 계산한 값의 부호
//  ⑤ 같은 키를 5단계로 말했을 때 변화량이 단계 순서대로 확실히 커지는지  를 확인한다.
// 실행: node test_nl_edits_100.js
import { pathToFileURL } from 'url';
import { planNaturalEdit } from './src/nlKnobAliases.js';
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

// 현재 문서 수치(기본 생성 결과와 같은 값)
export const CM = {
  bodySize: '9.5', bodyLeading: '15.2', noteSize: '8', noteLeading: '13.2',
  h1Size: '21', h1Leading: '26.3', h2Size: '18', h2Leading: '22.5',
  pnSize: '9', pnLeading: '11', rhSize: '9', rhLeading: '11',
  marginTop: '17', marginBottom: '61', marginInner: '25', marginOuter: '26',
  headingGap: '11.4', bodyGap: '15.2', footnoteSep: '15.8', footinsSkip: '12',
  colGap: '4', parIndent: '1', letterSpace: '0', wordSpace: '0', parSkip: '7.6', headingSpaceBefore: '0',
};

// [문장, 기대]  기대: keys(걸려야 하는 키), not(걸리면 안 되는 키), dir, level, mode
//   mode 'synth'  → 직접 계산 결과가 나와야 함(수치 키 + 방향이 명확한 문장)
//   mode 'llm'    → 키 힌트만 있으면 됨(굵기·서체·위치·불만형처럼 모델이 값을 정하는 문장)
//   mode 'amount' → 사용자가 양을 말함(1.2배, 2mm) — 직접 계산하지 않고 모델 값을 써야 함
//   mode 'none'   → 키가 없는 요청(미지원) — 사유가 붙어야 함
//   mode 'follow' → prev 키를 이어받아야 함
export const CASES = [
  // A. 본문 글자 크기 — 5단계 × 키우기/줄이기 (1~10)
  ['본문 글자를 아주 조금 키워줘', { keys: ['bodySize'], dir: 1, level: 1, mode: 'synth' }],
  ['본문 글자를 조금 키워줘', { keys: ['bodySize'], dir: 1, level: 2, mode: 'synth' }],
  ['본문 글자를 적당히 키워줘', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['본문 글자를 많이 키워줘', { keys: ['bodySize'], dir: 1, level: 4, mode: 'synth' }],
  ['본문 글자를 아주 많이 키워줘', { keys: ['bodySize'], dir: 1, level: 5, mode: 'synth' }],
  ['본문 글자를 아주 조금 줄여줘', { keys: ['bodySize'], dir: -1, level: 1, mode: 'synth' }],
  ['본문 글자를 조금 줄여줘', { keys: ['bodySize'], dir: -1, level: 2, mode: 'synth' }],
  ['본문 글자를 적당히 줄여줘', { keys: ['bodySize'], dir: -1, level: 3, mode: 'synth' }],
  ['본문 글자를 많이 줄여줘', { keys: ['bodySize'], dir: -1, level: 4, mode: 'synth' }],
  ['본문 글자를 아주 많이 줄여줘', { keys: ['bodySize'], dir: -1, level: 5, mode: 'synth' }],

  // B. 여백 — 위/아래/안/바깥, 5단계 (11~20)
  ['위쪽 여백 살짝 줄여줘', { keys: ['marginTop'], dir: -1, level: 1, mode: 'synth' }],
  ['위쪽 여백 조금 줄여줘', { keys: ['marginTop'], dir: -1, level: 2, mode: 'synth' }],
  ['위쪽 여백 적당히 줄여줘', { keys: ['marginTop'], dir: -1, level: 3, mode: 'synth' }],
  ['위쪽 여백 많이 줄여줘', { keys: ['marginTop'], dir: -1, level: 4, mode: 'synth' }],
  ['위쪽 여백 아주 많이 줄여줘', { keys: ['marginTop'], dir: -1, level: 5, mode: 'synth' }],
  ['아래 여백 살짝 늘려줘', { keys: ['marginBottom'], dir: 1, level: 1, mode: 'synth' }],
  ['아래 여백 조금 늘려줘', { keys: ['marginBottom'], dir: 1, level: 2, mode: 'synth' }],
  ['안쪽 여백 많이 늘려줘', { keys: ['marginInner'], dir: 1, level: 4, mode: 'synth' }],
  ['바깥 여백 아주 많이 줄여줘', { keys: ['marginOuter'], dir: -1, level: 5, mode: 'synth' }],
  ['안쪽 여백 적당히 줄여줘', { keys: ['marginInner'], dir: -1, level: 3, mode: 'synth' }],

  // C. 행간 (21~26)
  ['행간 아주 조금 넓혀줘', { keys: ['bodyLeading'], dir: 1, level: 1, mode: 'synth' }],
  ['행간 조금 넓혀줘', { keys: ['bodyLeading'], dir: 1, level: 2, mode: 'synth' }],
  ['행간 적당히 넓혀줘', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['행간 많이 넓혀줘', { keys: ['bodyLeading'], dir: 1, level: 4, mode: 'synth' }],
  ['행간 아주 많이 넓혀줘', { keys: ['bodyLeading'], dir: 1, level: 5, mode: 'synth' }],
  ['행간 조금 좁혀줘', { keys: ['bodyLeading'], dir: -1, level: 2, mode: 'synth' }],

  // D. 자간 (27~32)
  ['자간 살짝 넓혀줘', { keys: ['letterSpace'], dir: 1, level: 1, mode: 'synth' }],
  ['자간 조금 넓혀줘', { keys: ['letterSpace'], dir: 1, level: 2, mode: 'synth' }],
  ['자간 적당히 넓혀줘', { keys: ['letterSpace'], dir: 1, level: 3, mode: 'synth' }],
  ['자간 많이 넓혀줘', { keys: ['letterSpace'], dir: 1, level: 4, mode: 'synth' }],
  ['자간 아주 많이 넓혀줘', { keys: ['letterSpace'], dir: 1, level: 5, mode: 'synth' }],
  ['자간 많이 좁혀줘', { keys: ['letterSpace'], dir: -1, level: 4, mode: 'synth' }],

  // E. 제목·부제목 (33~40)
  ['제목 크기 조금 키워줘', { keys: ['h1Size'], not: ['h2Size'], dir: 1, level: 2, mode: 'synth' }],
  ['제목 크기 많이 줄여줘', { keys: ['h1Size'], not: ['h2Size'], dir: -1, level: 4, mode: 'synth' }],
  ['부제목 크기 아주 조금 키워줘', { keys: ['h2Size'], not: ['h1Size'], dir: 1, level: 1, mode: 'synth' }],
  ['소제목 글씨 많이 키워줘', { keys: ['h2Size'], not: ['h1Size'], dir: 1, level: 4, mode: 'synth' }],
  ['제목 부제목 줄간격 줄여줘', { keys: ['h1Leading', 'h2Leading'], not: ['h1Size', 'headingGap'], dir: -1, level: 3, mode: 'synth' }],
  ['제목 줄간격 많이 늘려줘', { keys: ['h1Leading'], not: ['h1Size'], dir: 1, level: 4, mode: 'synth' }],
  ['부제목 줄간격 조금 줄여줘', { keys: ['h2Leading'], not: ['h1Leading'], dir: -1, level: 2, mode: 'synth' }],
  ['제목 크기 훨씬 키워줘', { keys: ['h1Size'], dir: 1, level: 5, mode: 'synth' }],

  // F. 각주 (41~48)
  ['각주 글자 조금 키워줘', { keys: ['noteSize'], dir: 1, level: 2, mode: 'synth' }],
  ['각주 줄간격 조금 줄여줘', { keys: ['noteLeading'], not: ['noteSize'], dir: -1, level: 2, mode: 'synth' }],
  ['각주 줄간격 많이 줄여줘', { keys: ['noteLeading'], not: ['noteSize'], dir: -1, level: 4, mode: 'synth' }],
  ['각주 행간 아주 많이 줄여줘', { keys: ['noteLeading'], not: ['noteSize'], dir: -1, level: 5, mode: 'synth' }],
  ['각주끼리 간격 조금 늘려줘', { keys: ['footnoteSep'], dir: 1, level: 2, mode: 'synth' }],
  ['본문과 각주 사이 간격 많이 줄여줘', { keys: ['footinsSkip'], dir: -1, level: 4, mode: 'synth' }],
  ['각주 글씨 아주 조금 줄여줘', { keys: ['noteSize'], dir: -1, level: 1, mode: 'synth' }],
  ['각주 크기 적당히 키워줘', { keys: ['noteSize'], dir: 1, level: 3, mode: 'synth' }],

  // G. 쪽번호·면주 (49~54)
  ['쪽번호 조금 키워줘', { keys: ['pnSize'], dir: 1, level: 2, mode: 'synth' }],
  ['쪽번호 크기 많이 줄여줘', { keys: ['pnSize'], dir: -1, level: 4, mode: 'synth' }],
  ['면주 아주 조금 작게 해줘', { keys: ['rhSize'], dir: -1, level: 1, mode: 'synth' }],
  ['면주 크기 적당히 키워줘', { keys: ['rhSize'], dir: 1, level: 3, mode: 'synth' }],
  ['쪽번호를 가운데 아래로 옮겨줘', { keys: ['pnPos'], mode: 'llm' }],
  ['면주 지워줘', { keys: ['rhPos'], mode: 'llm' }],

  // H. 문단·단어 (55~61)
  ['문단 간격 조금 줄여줘', { keys: ['parSkip'], dir: -1, level: 2, mode: 'synth' }],
  ['문단 간격 많이 늘려줘', { keys: ['parSkip'], dir: 1, level: 4, mode: 'synth' }],
  ['문단 사이 아주 많이 띄워줘', { keys: ['parSkip'], dir: 1, level: 5, mode: 'synth' }],
  ['들여쓰기 조금 줄여줘', { keys: ['parIndent'], dir: -1, level: 2, mode: 'synth' }],
  ['단어 간격 조금 좁혀줘', { keys: ['wordSpace'], dir: -1, level: 2, mode: 'synth' }],
  ['단어 사이 많이 넓혀줘', { keys: ['wordSpace'], dir: 1, level: 4, mode: 'synth' }],
  ['띄어쓰기 간격 살짝 줄여줘', { keys: ['wordSpace'], dir: -1, level: 1, mode: 'synth' }],

  // I. 단 간격·제목 간격 (62~64)
  ['단 사이 간격 조금 넓혀줘', { keys: ['colGap'], dir: 1, level: 2, mode: 'synth' }],
  ['제목과 본문 사이 간격 많이 줄여줘', { keys: ['bodyGap'], dir: -1, level: 4, mode: 'synth' }],
  ['제목과 부제 사이 간격 조금 줄여줘', { keys: ['headingGap'], dir: -1, level: 2, mode: 'synth' }],

  // J. 대상 없는 후속 발화 — 직전에 바꾼 키(본문 크기·행간)를 이어받아야 함 (65~69)
  ['더 줄여줘', { mode: 'follow', prev: ['bodySize', 'bodyLeading'], dir: -1, level: 3, expect: ['bodySize', 'bodyLeading'] }],
  ['조금 더 키워줘', { mode: 'follow', prev: ['bodySize', 'bodyLeading'], dir: 1, level: 2, expect: ['bodySize', 'bodyLeading'] }],
  ['좀 많이 늘려줘', { mode: 'follow', prev: ['marginTop', 'marginBottom'], dir: 1, level: 4, expect: ['marginTop', 'marginBottom'] }],
  ['줄여달라고', { mode: 'follow', prev: ['noteLeading'], dir: -1, level: 3, expect: ['noteLeading'] }],
  ['아주 많이 줄여줘', { mode: 'follow', prev: ['h1Size', 'h1Leading'], dir: -1, level: 5, expect: ['h1Size', 'h1Leading'] }],

  // K. 사용자가 양을 직접 말함 — 모델이 그 값을 쓰게 두어야 함 (70~72)
  ['본문 크기 한 포인트만 줄여줘', { keys: ['bodySize'], mode: 'amount' }],
  ['행간을 1.2배로 맞춰줘', { keys: ['bodyLeading'], mode: 'amount' }],
  ['위쪽 여백 2mm 줄여줘', { keys: ['marginTop'], mode: 'amount' }],

  // L. 값이 아니라 종류를 고르는 요청 — 키 힌트만 정확하면 됨 (73~79)
  ['제목 굵게 해줘', { keys: ['headingWeight'], not: ['bodyWeight'], mode: 'llm' }],
  ['본문 고딕으로 바꿔줘', { keys: ['bodyFontFamily'], mode: 'llm' }],
  ['본문에 각주 번호도 고딕으로 해줘', { keys: ['footnoteMarkFont'], not: ['bodyFontFamily', 'footnoteFontFamily'], mode: 'llm' }],
  ['왼쪽 정렬로 바꿔줘', { keys: ['bodyAlign'], mode: 'llm' }],
  ['각주 번호를 괄호 숫자로 바꿔줘', { keys: ['footnoteMarker'], mode: 'llm' }],
  ['각주만 명조체로 바꿔줘', { keys: ['footnoteFontFamily'], not: ['bodyFontFamily'], mode: 'llm' }],
  ['소제목만 굵게 해줘', { keys: ['h2Weight'], not: ['headingWeight'], mode: 'llm' }],

  // M. 불만형 — 방향이 문장에 직접 없어서 모델이 판단하되, 키 힌트는 있어야 함 (80~85)
  ['글씨가 너무 작아 보여', { keys: ['bodySize'], dir: 1, level: 3, mode: 'synth' }],
  ['줄이 너무 빽빽해', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['제목이 너무 커서 튀어', { keys: ['h1Size'], not: ['h2Size'], dir: -1, level: 3, mode: 'synth' }],
  ['각주가 너무 빽빽해', { keys: ['noteLeading'], not: ['noteSize'], dir: 1, level: 3, mode: 'synth' }],
  ['단어 사이가 너무 벌어져 보여', { keys: ['wordSpace'], dir: -1, level: 3, mode: 'synth' }],
  ['글자끼리 너무 붙어 보여', { keys: ['letterSpace'], dir: 1, level: 3, mode: 'synth' }],

  // N. 미지원 — 키가 없다고 답해야 함 (86~89)
  ['목차 넣어줘', { mode: 'none' }],
  ['표지 디자인을 바꿔줘', { mode: 'none' }],
  ['3쪽만 행간을 다르게 해줘', { mode: 'none' }],
  ['책 두께를 줄여줘', { mode: 'none' }],

  // O. 복합 — 방향이 둘이라 직접 계산하지 않고 모델에 맡겨야 함 (90~91)
  ['본문은 조금 키우고 각주는 조금 줄여줘', { keys: ['bodySize', 'noteSize'], mode: 'llm' }],
  ['제목은 키우고 부제목은 줄여줘', { keys: ['h1Size', 'h2Size'], mode: 'llm' }],

  // P. 그 밖의 말투 (92~100)
  ['제목 위 여백 조금 늘려줘', { keys: ['headingSpaceBefore'], not: ['marginTop'], dir: 1, level: 2, mode: 'synth' }],
  ['소제목 위쪽 많이 띄워줘', { keys: ['headingSpaceBefore'], dir: 1, level: 4, mode: 'synth' }],
  ['본문 줄 간격 확 벌려줘', { keys: ['bodyLeading'], dir: 1, level: 4, mode: 'synth' }],
  ['글자 크기 확 줄여줘', { keys: ['bodySize'], dir: -1, level: 4, mode: 'synth' }],
  ['하단 여백 아주 조금만 늘려줘', { keys: ['marginBottom'], dir: 1, level: 1, mode: 'synth' }],
  ['행간 훨씬 넓혀줘', { keys: ['bodyLeading'], dir: 1, level: 5, mode: 'synth' }],
  ['행간 약간 좁혀줘', { keys: ['bodyLeading'], dir: -1, level: 2, mode: 'synth' }],
  ['글씨 크기 살짝 줄여줘', { keys: ['bodySize'], dir: -1, level: 1, mode: 'synth' }],
  ['여백 거의 없애주세요', { keys: ['marginTop', 'marginBottom', 'marginInner', 'marginOuter'], dir: -1, level: 5, mode: 'synth' }],

  // Q. 회귀 방지 — 실제로 엉뚱한 값이 같이 바뀌거나 방향을 거꾸로 읽었던 문장 (101~108)
  ['본문과 각주 사이 간격 많이 줄여줘', { keys: ['footinsSkip'], not: ['bodySize', 'bodyLeading'], dir: -1, level: 4, mode: 'synth' }],
  ['제목과 본문 사이 간격 아주 많이 줄여줘', { keys: ['bodyGap'], not: ['bodySize', 'bodyLeading'], dir: -1, level: 5, mode: 'synth' }],
  ['제목 줄간격 많이 늘려줘', { keys: ['h1Leading'], not: ['bodyLeading', 'h1Size'], dir: 1, level: 4, mode: 'synth' }],
  ['각주 행간 넓혀줘', { keys: ['noteLeading'], not: ['bodyLeading', 'noteSize'], dir: 1, level: 3, mode: 'synth' }],
  ['쪽번호 줄간격 조금 줄여줘', { keys: ['pnLeading'], not: ['bodyLeading'], dir: -1, level: 2, mode: 'synth' }],
  ['줄이 너무 빽빽해', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['줄이 너무 붙어 있어', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
  ['본문 줄 사이가 답답해', { keys: ['bodyLeading'], dir: 1, level: 3, mode: 'synth' }],
];

export function runCases(cases = CASES) {
const sign = n => Math.sign(n);
const failures = [];
const fail = (s, why) => failures.push(`- "${s}"  ${why}`);
const ladder = {}; // `${key}|${dir}` → [{level, delta}]

for (const [s, e] of cases) {
  const plan = planNaturalEdit(s, CM, e.prev || []);
  const keys = plan.keys;
  const synth = plan.synth;

  if (e.mode === 'none') {
    if (plan.unsupported.length === 0) fail(s, '미지원 사유가 안 붙음');
    continue;
  }
  if (e.mode === 'follow') {
    if (!plan.inherited) fail(s, '직전 대상을 이어받지 못함');
    for (const k of e.expect) if (!synth || !(k in synth.patches)) fail(s, `후속 발화인데 ${k} 값이 계산되지 않음`);
    if (synth) for (const k of Object.keys(synth.patches)) if (!e.expect.includes(k)) fail(s, `후속 발화인데 직전 대상이 아닌 ${k}가 바뀜`);
    if (plan.dir !== e.dir) fail(s, `방향 기대 ${e.dir}, 실제 ${plan.dir}`);
    if (plan.level !== e.level) fail(s, `강도 기대 ${e.level}, 실제 ${plan.level}`);
    continue;
  }
  for (const k of e.keys || []) if (!keys.includes(k)) fail(s, `키 ${k}가 안 잡힘 (실제: ${keys.join(',') || '없음'})`);
  for (const k of e.not || []) if (keys.includes(k)) fail(s, `잡히면 안 되는 키 ${k}가 잡힘 (실제: ${keys.join(',')})`);

  if (e.mode === 'amount') {
    if (!plan.explicit) fail(s, '양을 직접 말한 문장으로 인식하지 못함');
    if (synth) fail(s, '양을 직접 말했는데 단계표로 덮어쓰려 함');
    continue;
  }
  if (e.mode === 'llm') {
    // 값은 모델이 정하는 문장 — 직접 계산이 끼어들면 방향을 잘못 읽은 것이다
    if (synth && !synth.font && !synth.multi) fail(s, `모델에 맡겨야 하는데 직접 계산함: ${Object.entries(synth.patches).map(([k, v]) => `${k} ${CM[k]}→${v}`).join(', ')}`);
    continue;
  }
  // synth
  if (plan.dir !== e.dir) fail(s, `방향 기대 ${e.dir}, 실제 ${plan.dir}`);
  if (plan.level !== e.level) fail(s, `강도 기대 ${e.level}(${e.level}), 실제 ${plan.level} ("${plan.word}")`);
  if (!synth) { fail(s, '직접 계산 결과가 없음 — 모델이 거부하면 반영되지 않음'); continue; }
  // 기대한 키(와 크기 키의 짝 행간) 말고 다른 값이 같이 바뀌면 안 된다
  const PAIR = { bodySize: 'bodyLeading', noteSize: 'noteLeading', h1Size: 'h1Leading', h2Size: 'h2Leading', pnSize: 'pnLeading', rhSize: 'rhLeading' };
  const allowed = new Set([...e.keys.flatMap(k => [k, PAIR[k]].filter(Boolean)), 'serifFont', 'sansFont']); // 같은 문장에 서체 요청이 섞여도 허용
  for (const k of Object.keys(synth.patches)) {
    if (!allowed.has(k)) fail(s, `엉뚱한 값이 같이 바뀜: ${k} ${CM[k]}→${synth.patches[k]}`);
  }
  for (const k of e.keys) {
    if (!(k in synth.patches)) { fail(s, `${k} 값이 계산되지 않음`); continue; }
    const delta = Number(synth.patches[k]) - Number(CM[k]);
    if (sign(delta) !== e.dir) fail(s, `${k} 변화 부호 기대 ${e.dir}, 실제 ${delta}`);
    (ladder[`${k}|${e.dir}`] ||= []).push({ level: e.level, delta: Math.abs(delta), s });
  }
}

// 같은 키를 서로 다른 단계로 말했을 때 변화량이 단계가 올라갈수록 확실히 커져야 한다
for (const [id, rows] of Object.entries(ladder)) {
  const byLevel = new Map();
  for (const r of rows) byLevel.set(r.level, r.delta);
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  for (let i = 1; i < levels.length; i++) {
    const lo = byLevel.get(levels[i - 1]), hi = byLevel.get(levels[i]);
    if (!(hi > lo)) failures.push(`- 단계 역전/동일 ${id}: ${levels[i - 1]}단계 ${lo} ≥ ${levels[i]}단계 ${hi}`);
  }
}

console.log(`전체 ${cases.length}문장, 실패 ${failures.length}개`);
failures.forEach(f => console.log(f));
console.log('\n── 단계별 변화량 (같은 키·방향) ──');
for (const [id, rows] of Object.entries(ladder)) {
  const byLevel = new Map(rows.map(r => [r.level, r.delta]));
  if (byLevel.size < 3) continue;
  console.log(id.padEnd(16), [1, 2, 3, 4, 5].map(l => (byLevel.has(l) ? Number(byLevel.get(l).toFixed(2)) : '-')).join(' < '));
}
return failures.length;
}
if (isMain) process.exit(runCases() === 0 ? 0 : 1);

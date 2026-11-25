// 전체 실행 로그(10-17~11-01)에서 모델 판단에만 맡겨져 있던 요청을 코드가 정하는지. (API 호출 없음)  실행: node test_nl_log.js
import { planNaturalEdit } from './src/nlKnobAliases.js';

const CM = { pnPos: '하단-외측', rhPos: '상단-외측', bodyFontFamily: 'serif', headingFontFamily: 'serif', footnoteFontFamily: 'sans', rhFontFamily: 'sans', pnFontFamily: 'sans', bodyAlign: 'justified', marginInner: '6', marginOuter: '6', marginTop: '6', marginBottom: '6', rhSize: '9', parSkip: '6', h2Size: '18', footnoteSep: '14' };
const eq = (p, o) => Object.keys(o).length === Object.keys(p).length && Object.entries(o).every(([k, v]) => p[k] === v);
const CASES = [
  ['제목 굵게해줘', p => eq(p, { h1Weight: 'bold' })],
  ['제목 굵게 해줘', p => eq(p, { h1Weight: 'bold' })],
  ['제목이 더 강조되면 좋겠어', p => eq(p, { h1Weight: 'bold' })],
  ['소제목 굵게', p => eq(p, { h2Weight: 'bold' })],
  ['제목 소제목 모두 굵게', p => eq(p, { headingWeight: 'bold' })],
  ['본문 볼드 빼줘', p => eq(p, { bodyWeight: 'normal' })],
  ['제목 얇게 해줘', p => eq(p, { h1Weight: 'normal' })],
  ['왼쪽정렬 해줘', p => eq(p, { bodyAlign: 'ragged' })],
  ['단 글자를 양끝정렬로 바꿔줘', p => eq(p, { bodyAlign: 'justified' })],
  ['쪽번호 아래 바깥쪽으로 배치, 면주는 아래 안쪽에 배치', p => eq(p, { pnPos: '하단-외측', rhPos: '하단-내측' })],
  ['면주 좌측 하단으로', p => eq(p, { rhPos: '하단-좌측' })],
  ['쪽번호 다시 우측으로', p => eq(p, { pnPos: '하단-우측' })],
  ['쪽번호를 중앙으로', p => eq(p, { pnPos: '하단-중앙' })],
  ['쪽번호를 하단으로, 면주를 상단으로', p => eq(p, { pnPos: '하단-외측', rhPos: '상단-외측' })],
  ['면주를 아래로 내리고 쪽번호를 좌측으로 옮겨줘', p => p.rhPos === '하단-외측' && p.pnPos === '하단-좌측'],
  ['쪽번호는 위쪽 외측, 면주는 아래쪽 외측', p => eq(p, { pnPos: '상단-외측', rhPos: '하단-외측' })],
  ['전체 고딕으로 바꿔줘', p => p.bodyFontFamily === 'sans' && p.headingFontFamily === 'sans' && p.footnoteFontFamily === undefined],
  ['전체 명조체로 바꿔줘', p => p.footnoteFontFamily === 'serif' && p.rhFontFamily === 'serif' && p.pnFontFamily === 'serif'],
  ['문서 전체 고딕으로', p => p.bodyFontFamily === 'sans'],
  ['면주 크기 많이 줄여주고 상하좌우 마진을 많이 줘', p => Number(p.rhSize) < 9 && ['marginTop', 'marginBottom', 'marginInner', 'marginOuter'].every(k => Number(p[k]) > 6)],
  ['문단 줄바꿈 없애줘', p => Number(p.parSkip) < 6],
  ['소제목이 덜 튀게 해줘', p => Number(p.h2Size) < 18],
  // 위치·정렬이 아닌 말 — 건드리면 안 된다
  ['쪽번호 크기 키워줘', p => !('pnPos' in p) && !('pnPos' in p)],
  ['면주 연하게 해줘', p => !('rhPos' in p) && 'rhStyle' in p],
  ['본문 크기 키워줘', p => !('bodyWeight' in p) && !('bodyAlign' in p)],
  ['따옴표 안 굵게 해줘', p => p.quoteHighlight === 'bold' && !('h1Weight' in p)],
];
let bad = 0; const out = [];
for (const [msg, ok] of CASES) {
  const p = planNaturalEdit(msg, CM, []).synth?.patches || {};
  let pass = false; try { pass = ok(p); } catch {}
  if (!pass) { bad++; out.push(`  ✗ "${msg}" → ${JSON.stringify(p)}`); }
}
console.log(`로그 기반 문장 ${CASES.length}개: ${CASES.length - bad}개 통과, ${bad}개 실패`);
out.forEach(o => console.log(o));
process.exit(bad ? 1 : 0);

// "완전 붙어야대" 같은 강한 붙이기·없애기는 간격 0으로, 약한 "붙여줘"는 단계표로. (API 호출 없음)  실행: node test_nl_gap.js
import { planNaturalEdit } from './src/nlKnobAliases.js';
const CM = { headingGap: '9.7', bodyGap: '12', parSkip: '6', footnoteSep: '14', marginTop: '10' };
const CASES = [
  ['제목이랑 부제목 완전 붙어야대', p => p.headingGap === '0'],
  ['제목이랑 부제목 딱 붙여줘', p => p.headingGap === '0'],
  ['제목 부제목 간격 0으로', p => p.headingGap === '0'],
  ['제목이랑 부제목 간격 없애줘', p => p.headingGap === '0'],
  ['제목이랑 본문 딱 붙게', p => p.bodyGap === '0'],
  ['문단 사이 아예 붙게', p => p.parSkip === '0'],
  ['문단 간격 없애줘', p => p.parSkip === '0'],
  ['각주끼리 완전 붙여줘', p => p.footnoteSep === '0'],
  ['제목이랑 부제목 붙여줘', p => Number(p.headingGap) > 0 && Number(p.headingGap) < 9.7],
  ['제목이랑 부제목 사이 더 벌려줘', p => Number(p.headingGap) > 9.7],
  ['글자 완전 붙여줘', p => !('headingGap' in p) && !('parSkip' in p)],
  ['제목 위 여백 없애줘', p => !('headingGap' in p) && !('bodyGap' in p)],
];
let bad = 0; const out = [];
for (const [msg, ok] of CASES) {
  const p = planNaturalEdit(msg, CM, [], {}).synth?.patches || {};
  let pass = false; try { pass = ok(p); } catch {}
  if (!pass) { bad++; out.push(`  ✗ "${msg}" → ${JSON.stringify(p)}`); }
}
console.log(`간격 붙이기 문장 ${CASES.length}개: ${CASES.length - bad}개 통과, ${bad}개 실패`);
out.forEach(o => console.log(o));
process.exit(bad ? 1 : 0);

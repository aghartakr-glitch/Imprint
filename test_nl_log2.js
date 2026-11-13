// 11-09·11-11 로그 기반 — 제외 표현·크기+굵기·각주 위치 방향. (API 호출 없음)  실행: node test_nl_log2.js
import { planNaturalEdit } from './src/nlKnobAliases.js';

const CM = { noteColor: '75', bodyColor: '100', noteSize: '7', noteLeading: '12', h1Size: '21', h1Leading: '26', h2Size: '18', h2Leading: '22', bodySize: '9.5', bodyLeading: '15', footinsSkip: '10', marginBottom: '20', footnoteSep: '14' };
const p0 = msg => planNaturalEdit(msg, CM, [], {}).synth?.patches || {};
const keys = p => Object.keys(p).sort().join(',');
const CASES = [
  ['각주 글자 연하게 해줘 본문은 그대로', p => 'noteColor' in p && !('bodyColor' in p)],
  ['각주 글자 연하게 해줘 적당히', p => keys(p) === 'noteColor'],
  ['본문은 건드리지 말고 각주 글씨 연하게', p => 'noteColor' in p && !('bodyColor' in p)],
  ['제목 더 크게 해줘 굵게', p => Number(p.h1Size) > 21 && p.h1Weight === 'bold' && !('h2Size' in p)],
  ['제목 키우고 굵게', p => Number(p.h1Size) > 21 && p.h1Weight === 'bold'],
  ['제목 크고 굵게', p => Number(p.h1Size) > 21 && p.h1Weight === 'bold'],
  ['본문 글자 키우고 볼드', p => Number(p.bodySize) > 9.5 && p.bodyWeight === 'bold'],
  ['각주를 더 작고 얇게 해줘 티 덜나게', p => Number(p.noteSize) < 7 && p.footnoteWeight === 'light'],
  ['제목 굵게', p => keys(p) === 'h1Weight'],
  ['각주가 작고 얇아 보여', p => !('footnoteWeight' in p)],
  ['주석 전체 위치를 본문과 많이 떨어트려줘, 하단으로 내려줘', p => Number(p.footinsSkip) > 10 && Number(p.footnoteShift) < 0 && !('marginBottom' in p)],
  ['1번 주석 앞에 커서 놓고 엔터 두번 친것처럼 늘려줘', p => Number(p.footinsSkip) > 10 && !('marginBottom' in p)],
  ['각주를 본문 가깝게 붙여줘', p => Number(p.footinsSkip) < 10],
  ['각주 끼리 간격 줄여줘', p => keys(p) === 'footnoteSep' && Number(p.footnoteSep) < 14],
  ['각주 글자 크기 줄여줘', p => 'noteSize' in p && !('footinsSkip' in p)],
];
let bad = 0; const out = [];
for (const [msg, ok] of CASES) {
  const p = p0(msg);
  let pass = false; try { pass = ok(p); } catch {}
  if (!pass) { bad++; out.push(`  ✗ "${msg}" → ${JSON.stringify(p)}`); }
}
console.log(`로그2 문장 ${CASES.length}개: ${CASES.length - bad}개 통과, ${bad}개 실패`);
out.forEach(o => console.log(o));
process.exit(bad ? 1 : 0);

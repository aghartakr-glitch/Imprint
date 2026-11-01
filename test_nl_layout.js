// 11월 1일 로그 기반 — 행간을 글자 크기에 맞추기 / 컬럼 가로 크기 / 본문을 제목 아래로 / 하단 푸터 footskip. (API 호출 없음)  실행: node test_nl_layout.js
import { planNaturalEdit } from './src/nlKnobAliases.js';
import { ensureFootskip, readFootskip } from './src/styGeometry.js';

const CM = { bodySize: '10', bodyLeading: '18', noteSize: '7', noteLeading: '8', marginInner: '10', marginOuter: '10', bodyGap: '12', h1Size: '20', h1Leading: '24' };
const CASES = [
  ['행간도 글자 크기에 맞게 조정해줘', p => Number(p.bodyLeading) === 16 && !('bodySize' in p)],
  ['행간 글자 크기에 맞게 늘려줘', p => Number(p.bodyLeading) > 18 && !('bodySize' in p)],
  ['행간 글자 크기에 비례하게 줄여줘', p => Number(p.bodyLeading) < 18 && !('bodySize' in p)],
  ['각주 행간 글자 크기에 맞게', p => Number(p.noteLeading) === 10.5 && !('noteSize' in p)],
  ['컬럼 가로 크기를 늘려줘', p => Number(p.marginInner) < 10 && Number(p.marginOuter) < 10 && !('noteSize' in p)],
  ['컬럼 가로 크기 많이 늘려줘', p => Number(p.marginInner) <= 7.5],
  ['컬럼 가로 크기를 줄여줘', p => Number(p.marginInner) > 10],
  ['단 폭을 넓혀줘', p => Number(p.marginInner) < 10],
  ['모든 본문 글자들이 제목 가로선보다 아래로 내려가게 해줘', p => Number(p.bodyGap) > 12],
  ['본문이 제목 부제목보다 내려가게 해줘', p => Number(p.bodyGap) > 12],
  ['본문 글자 잡지처럼 크게해줘', p => Number(p.bodySize) >= 12],
  ['본문 글자 잡지처럼 크게해줘', p => Number(p.bodySize) > Number(CM.bodySize) * 1.15],
];
let bad = 0; const out = [];
for (const [msg, ok] of CASES) {
  const p = planNaturalEdit(msg, CM, []).synth?.patches || {};
  let pass = false; try { pass = ok(p); } catch {}
  if (!pass) { bad++; out.push(`  ✗ "${msg}" → ${JSON.stringify(p)}`); }
}
const unit = [];
const noFoot = '\geometry{\n  top=5mm, bottom=7mm,\n  includehead=true, includefoot=true,\n}\n';
let s = ensureFootskip(noFoot, 10);
if (readFootskip(s) !== 10) unit.push('footskip 없던 문서에 넣기');
if (readFootskip(ensureFootskip('\geometry{footskip=4mm,}', 10)) !== 10) unit.push('작은 footskip 올리기');
if (readFootskip(ensureFootskip('\geometry{footskip=14mm,}', 10)) !== 14) unit.push('충분한 footskip 건드림');
if ((ensureFootskip(ensureFootskip(noFoot), 10).match(/footskip/g) || []).length !== 1) unit.push('footskip 중복');
console.log(`레이아웃 문장 ${CASES.length}개: ${CASES.length - bad}개 통과, ${bad}개 실패 / footskip 점검 ${unit.length ? unit.join(', ') : '통과'}`);
out.forEach(o => console.log(o));
process.exit(bad || unit.length ? 1 : 0);

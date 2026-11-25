// 문단 첫 글자 키우기 — 본문 전체 크기로 읽지 않고 배율만 내는지, 적용 결과. (API 호출 없음)  실행: node test_nl_dropcap.js
import { planNaturalEdit } from './src/nlKnobAliases.js';
import { applyDropCap, countDropCaps, readDropCap } from './src/styDropCap.js';
const CM = { bodySize: '9.5', bodyLeading: '15.2' };
const CASES = [
  ['문단 시작 첫 글자만 겁나 크게 해줘', p => Number(p.dropCap) >= 3 && !('bodySize' in p)],
  ['문단 첫 글자 조금만 키워', p => Number(p.dropCap) > 1 && Number(p.dropCap) < 2 && !('bodySize' in p)],
  ['첫 글자 크게', p => Number(p.dropCap) === 2],
  ['드롭캡 해줘', p => Number(p.dropCap) > 1],
  ['첫 글자 크기 원래대로', p => p.dropCap === '1'],
  ['문단 첫 글자 없애줘', p => p.dropCap === '1'],
  ['본문 글자 크게', p => 'bodySize' in p && !('dropCap' in p)],
  ['행간 늘려줘', p => !('dropCap' in p)],
];
let bad = 0; const out = [];
for (const [msg, ok] of CASES) {
  const p = planNaturalEdit(msg, CM, [], {}).synth?.patches || {};
  let pass = false; try { pass = ok(p); } catch {}
  if (!pass) { bad++; out.push(`  ✗ "${msg}" → ${JSON.stringify(p)}`); }
}
const sty0 = '\\makeatother\n\\endinput\n';
const tex0 = '\\begin{document}\n{\\bodyf\\noindent 낡은 시장\\par}\n{\\bodyf 가장 먼저\\par}\n{\\bodyf\\noindent ‘빈’ 점포\\par}\n\\bodyf{}\n\\end{document}';
const a = applyDropCap(sty0, tex0, 2);
const unit = [];
if (countDropCaps(a.tex) !== 3) unit.push('감싼 문단 수 ' + countDropCaps(a.tex));
if (!a.tex.includes('\\imprintDrop{‘}') && !a.tex.includes('\\imprintDrop{‘빈')) unit.push('따옴표로 시작하는 문단');
if (!a.tex.includes('\\bodyf{}')) unit.push('\\bodyf{} 줄을 건드림');
if (readDropCap(a.sty) !== '2') unit.push('읽기');
const b = applyDropCap(a.sty, a.tex, 2.6);
if (countDropCaps(b.tex) !== 3 || (b.sty.match(/imprintDropCap/g) || []).length !== 1) unit.push('연속 적용이 겹침');
const c = applyDropCap(b.sty, b.tex, 1);
if (countDropCaps(c.tex) !== 0 || /imprintDrop/.test(c.sty) || c.tex !== tex0) unit.push('끄기가 원상복구 안 됨');
console.log(`첫 글자 문장 ${CASES.length}개: ${CASES.length - bad}개 통과, ${bad}개 실패 / 적용 점검 ${unit.length ? unit.join(', ') : '통과'}`);
out.forEach(o => console.log(o));
process.exit(bad || unit.length ? 1 : 0);

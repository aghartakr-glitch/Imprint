// 따옴표 안 굵게·기울임 / 각주 번호 모양 / 전체 인상(비어 보이게·꽉 차 보이게) 자연어. (API 호출 없음)  실행: node test_nl_misc.js
import { planNaturalEdit } from './src/nlKnobAliases.js';
import { applyNoteMarker, readNoteMarker } from './src/styNoteMarker.js';
import { applyHighlight, countHighlighted } from './src/styHighlight.js';

const CM = { bodyLeading: '12', bodySize: '9', parSkip: '3', marginTop: '10', marginBottom: '10', marginInner: '10', marginOuter: '10', footnoteMarker: 'dot' };
const M = ['marginTop', 'marginBottom', 'marginInner', 'marginOuter'];
const up = (k, p) => Number(p[k]) > Number(CM[k]);
const down = (k, p) => Number(p[k]) < Number(CM[k]);

const CASES = [
  // 따옴표 안만 굵게·기울임
  ['따옴표 안에 있는것만 볼드 처리해줘', p => p.quoteHighlight === 'bold'],
  ['따옴표 안의 단어들 굵게 해줘', p => p.quoteHighlight === 'bold'],
  ['인용 구절만 볼드로', p => p.quoteHighlight === 'bold'],
  ['따옴표 안 글자 기울여줘', p => p.quoteHighlight === 'italic'],
  ['따옴표 안 문구 이탤릭으로 바꿔줘', p => p.quoteHighlight === 'italic'],
  ['따옴표 안 볼드 지워줘', p => p.quoteHighlight === 'off'],
  // 각주 번호 모양
  ['각주 번호를 동그라미로 바꿔줘', p => p.footnoteMarker === 'circle'],
  ['각주 번호 동그라미 숫자로', p => p.footnoteMarker === 'circle'],
  ['각주 숫자를 원문자로 해줘', p => p.footnoteMarker === 'circle'],
  ['주석 번호 소괄호로 바꿔줘', p => p.footnoteMarker === 'paren'],
  ['각주 번호를 대괄호로 해줘', p => p.footnoteMarker === 'bracket'],
  ['각주 표시를 점으로 바꿔줘', p => p.footnoteMarker === 'dot'],
  // 전체 인상 — 여유 있게 / 꽉 차 보이게
  ['전체적으로 좀 비어보이게 해줘 다', p => M.every(k => up(k, p)) && up('bodyLeading', p) && up('parSkip', p)],
  ['전체적으로 여유있게 해줘', p => M.every(k => up(k, p)) && up('bodyLeading', p)],
  ['다 시원하게 해줘', p => M.every(k => up(k, p)) && up('parSkip', p)],
  ['전체적으로 아주 널널하게', p => M.every(k => up(k, p))],
  ['전반적으로 휑하게 해줘', p => M.every(k => up(k, p))],
  ['전반적으로 꽉 차 보이게 해줘', p => M.every(k => down(k, p)) && down('bodyLeading', p)],
  ['전체적으로 알차 보이게 해줘', p => M.every(k => down(k, p))],
  // 아닌 말 — 여러 항목을 건드리면 안 된다
  ['본문을 좀 더 널널하게 해줘', p => up('bodyLeading', p) && !('marginTop' in p)],
  ['줄이 너무 빽빽해', p => up('bodyLeading', p) && !('marginTop' in p)],
  ['여백 늘려줘', p => M.every(k => up(k, p)) && !('bodyLeading' in p)],
];

let bad = 0; const out = [];
for (const [msg, check] of CASES) {
  const plan = planNaturalEdit(msg, CM, []);
  const p = plan.synth?.patches || {};
  let ok = false;
  try { ok = !!plan.synth && check(p); } catch { ok = false; }
  if (!ok) { bad++; out.push(`  ✗ "${msg}" → ${JSON.stringify(p)}`); }
}
// 적용 점검
const unit = [];
const sty0 = '\\newcommand{\\ImpNoteLabel}[1]{#1.\\ }\n\\endinput\n';
let s = applyNoteMarker(sty0, 'circle');
if (readNoteMarker(s) !== 'circle') unit.push('동그라미 읽기');
s = applyNoteMarker(s, 'paren');
if (readNoteMarker(s) !== 'paren' || /imprintFnCircle/.test(s)) unit.push('소괄호로 바꿀 때 원 줄이 남음');
s = applyNoteMarker(applyNoteMarker(s, 'bracket'), 'bracket');
if ((s.match(/ImpNoteLabel\}\[1\]/g) || []).length !== 1) unit.push('번호 정의가 중복');
const tex = '\\begin{document}\n그는 ‘평면’이라 했고 “동선”도 말했다. 사과\n\\end{document}';
const a = applyHighlight('\\endinput\n', tex, 'bold');
if (countHighlighted(a.tex) !== 2 || !/textbf/.test(a.sty)) unit.push('굵게 감싸기');
const b = applyHighlight(a.sty, a.tex, 'off');
if (countHighlighted(b.tex) !== 0 || /imprintHL/.test(b.sty)) unit.push('굵게 끄기');
console.log(`기타 문장 ${CASES.length}개: ${CASES.length - bad}개 통과, ${bad}개 실패 / 적용 점검 ${unit.length ? unit.join(', ') : '통과'}`);
out.forEach(o => console.log(o));
process.exit(bad || unit.length ? 1 : 0);

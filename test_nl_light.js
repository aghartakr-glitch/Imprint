// 각주 Light 굵기·특수문자 서체 이름 지정·큰 첫 글자 줄 높이. (API 호출 없음)  실행: node test_nl_light.js
import { planNaturalEdit } from './src/nlKnobAliases.js';
import { applyNoteLight, isNoteLight, canNoteLight } from './src/styWeight.js';
import { applySymbolStyle, readSymbolStyle } from './src/stySymbol.js';
import { applyDropCap } from './src/styDropCap.js';

const plan = (msg, cm = {}) => planNaturalEdit(msg, cm, [], {}).synth?.patches || {};
const CASES = [
  ['각주 더 얇게', { footnoteWeight: 'normal' }, p => p.footnoteWeight === 'light'],
  ['각주 폰트 굵기도 얇게 변경해줘', {}, p => p.footnoteWeight === 'light'],
  ['각주 더 얇게', { footnoteWeight: 'light' }, p => p.footnoteWeight === 'light'],
  ['각주 얇게', { footnoteWeight: 'bold' }, p => p.footnoteWeight === 'normal'],
  ['각주 보통 굵기로', { footnoteWeight: 'light' }, p => p.footnoteWeight === 'normal'],
  ['각주 굵게', { footnoteWeight: 'light' }, p => p.footnoteWeight === 'bold'],
  ['특수문자만 나눔명조로 바꿔줘', {}, p => /font=nanum/.test(p.symbolStyle)],
  ['특수문자 돋움체로 해줘', {}, p => /font=dotum/.test(p.symbolStyle)],
  ['기호만 본명조로 빨간색', {}, p => /font=noto/.test(p.symbolStyle) && /color=red/.test(p.symbolStyle)],
  ['특수문자만 고딕으로 바꿔줘', {}, p => /font=sans/.test(p.symbolStyle)],
  ['특수문자 프리텐다드 라이트로', {}, p => /font=prelight/.test(p.symbolStyle)],
];
let bad = 0; const out = [];
for (const [msg, cm, ok] of CASES) {
  const p = plan(msg, cm);
  let pass = false; try { pass = ok(p); } catch {}
  if (!pass) { bad++; out.push(`  ✗ "${msg}" → ${JSON.stringify(p)}`); }
}
const unit = [];
// Light: 고딕 각주만, 두 번 적용해도 겹치지 않고, 되돌리면 깨끗이 사라진다
const sans = '\\newcommand{\\notef}{\\sffamily\\fontsize{7pt}{9pt}\\selectfont}\n\\endinput\n';
const serif = '\\newcommand{\\notef}{\\rmfamily\\fontsize{7pt}{9pt}\\selectfont}\n\\endinput\n';
if (!canNoteLight(sans) || canNoteLight(serif)) unit.push('Light 가능 여부(고딕만)');
const a = applyNoteLight(sans, true);
if (!isNoteLight(a) || (applyNoteLight(a, true).match(/imprintNoteLight/g) || []).length !== 1) unit.push('Light 적용·중복');
if (applyNoteLight(serif, true) !== serif) unit.push('명조 각주는 건드리면 안 됨');
if (/imprintLightSans|imprintNoteLight/.test(applyNoteLight(a, false))) unit.push('Light 되돌리기');
// 특수문자 서체 이름
const sty0 = '\\makeatother\n\\endinput\n', tex0 = '\\begin{document}\n가 ★ 나\n\\end{document}';
const s1 = applySymbolStyle(sty0, tex0, 'font=nanum');
if (!s1.sty.includes('\\newfontfamily\\imprintSymFont{NanumMyeongjo}') || readSymbolStyle(s1.sty) !== 'font=nanum;color=;skip=') unit.push('나눔명조 정의 ' + readSymbolStyle(s1.sty));
const s2 = applySymbolStyle(s1.sty, s1.tex, 'font=sans');
if (s2.sty.includes('newfontfamily')) unit.push('서체를 바꿀 때 이전 정의가 남음');
// 큰 첫 글자는 줄 높이를 고정한다
const big = applyDropCap(sty0, '\\begin{document}\n{\\bodyf 가나\\par}', 3.3).sty, small = applyDropCap(sty0, '\\begin{document}\n{\\bodyf 가나\\par}', 2).sty;
if (!big.includes('raisebox') || small.includes('raisebox')) unit.push('2.6배 이상만 줄 높이 고정');
console.log(`Light·서체 이름·큰 첫 글자 ${CASES.length}문장: ${bad}개 실패 / 적용 점검 ${unit.length ? unit.join(', ') : '통과'}`);
out.forEach(o => console.log(o));
process.exit(bad || unit.length ? 1 : 0);

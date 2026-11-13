// 11-05·11-06 로그에서 반영되지 않던 요청들. (API 호출 없음)  실행: node test_nl_logfix.js
import { planNaturalEdit } from './src/nlKnobAliases.js';
import { applyMarkColor, readMarkColor } from './src/styColor.js';
import { applyHighlight, countHighlighted, readHighlight, isHlMode } from './src/styHighlight.js';

const CM = { h1Size: '21', h1Leading: '26', h2Size: '19', h2Leading: '23', bodySize: '9.5', bodyLeading: '15', noteSize: '7', noteLeading: '12', noteColor: '70', footnoteMarkColor: '100', footinsSkip: '10', footnoteRule: 'off', marginTop: '10', marginBottom: '10', marginInner: '10', marginOuter: '10', quoteHighlight: 'text:red' };
const only = (p, ...keys) => Object.keys(p).length === keys.length && keys.every(k => k in p);
// [문장, 직전 키, 검사]
const CASES = [
  ['각주 숫자를 연하게 해줘 본문에', [], p => only(p, 'footnoteMarkColor') && Number(p.footnoteMarkColor) < 100],
  ['본문에 있는 각주 숫자를 연하게 해줘 밑에 각주는 건들지 말고', [], p => only(p, 'footnoteMarkColor')],
  ['본문 속 각주 번호 진하게', [], p => only(p, 'footnoteMarkColor')],
  ['각주 진하게', [], p => only(p, 'noteColor') && Number(p.noteColor) > 70],
  ['각주 폰트 굵기도 얇게 변경해줘', ['h2Size'], p => only(p, 'footnoteWeight') && p.footnoteWeight === 'light'],
  ['각주 굵게', ['h2Size'], p => only(p, 'footnoteWeight') && p.footnoteWeight === 'bold'],
  ['굵게', ['h2Size'], p => Object.keys(p).length === 0],
  ['굵게', ['quoteHighlight'], p => p.quoteHighlight === 'text:red+bold'],
  ['기울여', ['quoteHighlight'], p => p.quoteHighlight === 'text:red+italic'],
  ['따옴표 안에 빨강색 굵게', [], p => p.quoteHighlight === 'text:red+bold' && Object.keys(p).length === 1],
  ['따옴표 안에 글자 파랑 굵게 해줘', [], p => p.quoteHighlight === 'text:blue+bold'],
  ['소제목 크기를 제목과 차이가 나도록 조금 줄여줘.', [], p => only(p, 'h2Size', 'h2Leading') && Number(p.h2Size) < 19],
  ['각 주 위에 줄 넣어줘', [], p => p.footnoteRule === 'on'],
  ['주석 위에 공백을 많이 넣어줘', [], p => only(p, 'footinsSkip') && Number(p.footinsSkip) > 10],
  ['우측 주석 위에 여백을 좀 넣어줘', [], p => only(p, 'footinsSkip') && Number(p.footinsSkip) > 10],
  ['각주 위 선 가늘게 해줘', [], p => 'footnoteRuleThickness' in p && !('footnoteWeight' in p)],
  ['여백 넣어줘', [], p => ['marginTop', 'marginBottom', 'marginInner', 'marginOuter'].every(k => Number(p[k]) > 10)],
];
// 되묻기·안내만 해야 하는 말
const ASK = ['주석 시작점을 본문 라인에 맞춰서 나오게 해줘', '하단 주 석은 지워줘', '하단 주석은 지워줘'];

let bad = 0; const out = [];
for (const [msg, pk, ok] of CASES) {
  const p = planNaturalEdit(msg, CM, pk, { h2Size: -1 }).synth?.patches || {};
  let pass = false; try { pass = ok(p); } catch {}
  if (!pass) { bad++; out.push(`  ✗ "${msg}" (직전 ${pk.join(',') || '없음'}) → ${JSON.stringify(p)}`); }
}
for (const msg of ASK) {
  const pl = planNaturalEdit(msg, CM, [], {});
  if (pl.synth || !pl.unsupported.length) { bad++; out.push(`  ✗ [안내] "${msg}" → ${JSON.stringify(pl.synth?.patches || {})}`); }
}
const unit = [];
const sty0 = '\\makeatother\n\\endinput\n';
const m1 = applyMarkColor(sty0, 40);
if (readMarkColor(m1) !== '40') unit.push('각주 숫자 색 읽기');
if ((applyMarkColor(m1, 25).match(/imprintMarkColor/g) || []).length !== 1) unit.push('각주 숫자 색이 겹침');
if (/imprintMarkColor/.test(applyMarkColor(m1, 100))) unit.push('100이면 끄기');
const tex0 = '\\begin{document}\n그는 ‘평면’이라 했다.\n\\end{document}';
const h = applyHighlight(sty0, tex0, 'text:red+bold');
if (countHighlighted(h.tex) !== 1 || !/textbf\{\\textcolor/.test(h.sty) || readHighlight(h.sty) !== 'text:red+bold') unit.push('색+굵게 조합');
if (!isHlMode('text:red|bold') || !isHlMode('yellow+italic') || isHlMode('bold+italic') || isHlMode('text:red+yellow')) unit.push('모드 검증');
const off = applyHighlight(h.sty, h.tex, 'off');
if (countHighlighted(off.tex) !== 0 || /imprintHL/.test(off.sty)) unit.push('끄기');
console.log(`로그 보완 문장 ${CASES.length + ASK.length}개: ${bad}개 실패 / 적용 점검 ${unit.length ? unit.join(', ') : '통과'}`);
out.forEach(o => console.log(o));
process.exit(bad || unit.length ? 1 : 0);

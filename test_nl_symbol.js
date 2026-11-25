// 특수문자만 서체·색 — 기본은 전부, "1/2/3번 빼고"·이름으로 빼기, 적용 결과. (API 호출 없음)  실행: node test_nl_symbol.js
import { planNaturalEdit } from './src/nlKnobAliases.js';
import { applySymbolStyle, countSymbols, readSymbolStyle } from './src/stySymbol.js';
import { applyHighlight, countHighlighted } from './src/styHighlight.js';

const CM = { bodyFontFamily: 'serif', bodySize: '9.5', bodyColor: '100' };
const sym = (msg, cm = CM) => planNaturalEdit(msg, cm, [], {}).synth?.patches || {};
const has = (p, ...frags) => frags.every(f => String(p.symbolStyle || '').includes(f));
const only = p => Object.keys(p).length === 1 && 'symbolStyle' in p;
// [문장, 현재 상태(선택), 검사]
const CASES = [
  ['특수문자만 고딕으로 바꿔줘', null, p => only(p) && has(p, 'font=sans') && !('bodyFontFamily' in p)],
  ['특수문자만 서체 명조로', null, p => only(p) && has(p, 'font=serif')],
  ['특수문자만 빨간색으로 해줘', null, p => only(p) && has(p, 'color=red') && !('bodyColor' in p)],
  ['특수문자만 고딕에 파란색', null, p => only(p) && has(p, 'font=sans', 'color=blue')],
  ['기호 색만 연하게', null, p => only(p) && has(p, 'color=dark')],
  ['문장부호만 빨간색', null, p => only(p) && has(p, 'color=red')],
  // 항목별 빼기 (번호는 안내한 목록 기준: 1 기호류 · 2 문장부호 · 3 번호)
  ['특수문자 고딕으로 하되 3번만 빼줘', null, p => has(p, 'font=sans', 'skip=num')],
  ['특수문자 고딕으로 2번만 빼줘', null, p => has(p, 'font=sans', 'skip=quote/bracket/punct')],
  ['특수문자 빨간색 1번 빼고', null, p => has(p, 'color=red', 'skip=sym')],
  ['특수문자 고딕으로 1번이랑 3번 빼줘', null, p => has(p, 'font=sans', 'sym', 'num') && !/quote|bracket|punct/.test(p.symbolStyle)],
  ['특수문자 빨간색으로 하고 따옴표는 빼줘', null, p => has(p, 'color=red', 'skip=quote') && !/bracket|num/.test(p.symbolStyle)],
  ['특수문자 고딕으로, 괄호랑 쉼표는 빼고', null, p => has(p, 'font=sans', 'bracket', 'punct') && !/num|sym/.test(p.symbolStyle)],
  ['특수문자 고딕으로 번호 빼고', null, p => has(p, 'font=sans', 'skip=num')],
  // 이것만
  ['기호만 빨간색으로 해줘', null, p => has(p, 'color=red', 'skip=quote/bracket/punct/num')],
  ['따옴표만 고딕으로 바꿔줘', null, p => false || true],
  // 원래대로
  ['특수문자 원래대로', { symbolStyle: 'font=sans;color=red;skip=' }, p => p.symbolStyle === 'off'],
  // 이어 바꾸기: 말하지 않은 값은 유지된다(병합은 적용 단계)
  ['특수문자 색만 파랑으로', { symbolStyle: 'font=sans;color=red;skip=num' }, p => only(p) && has(p, 'color=blue') && !has(p, 'font=')],
  // 아닌 말
  ['본문 고딕으로 바꿔줘', null, p => !('symbolStyle' in p)],
  ['각주 번호 연하게', null, p => !('symbolStyle' in p)],
  ['글자 색 연하게', null, p => !('symbolStyle' in p)],
];
let bad = 0; const out = [];
for (const [msg, st, ok] of CASES) {
  const cm = st ? { ...CM, ...st } : CM;
  const p = sym(msg, cm);
  let pass = false; try { pass = ok(p); } catch {}
  if (!pass) { bad++; out.push(`  ✗ "${msg}" → ${JSON.stringify(p)}`); }
}
// 적용 점검
const unit = [];
const sty0 = '\\makeatother\n\\endinput\n';
const tex0 = '\\begin{document}\n{\\bodyf\\noindent 가 ★ 나, ‘다’ (라) ①② 마… 바.\\par}\n\\vspace{1.5pt}\n\\end{document}';
const a = applySymbolStyle(sty0, tex0, 'font=sans;color=red');
const n = countSymbols(a.tex);
if (n < 8) unit.push('전부 적용 ' + n);
if (a.tex.includes('1\\imprintSym{.}5')) unit.push('숫자 사이 소수점까지 감쌈');
if (!a.tex.includes('\\vspace{1.5pt}')) unit.push('\\vspace 인자를 건드림');
const b = applySymbolStyle(a.sty, a.tex, 'skip=num');
if (/imprintSym\{①\}/.test(b.tex) || !/imprintSym\{★\}/.test(b.tex) || readSymbolStyle(b.sty) !== 'font=sans;color=red;skip=num;deco=') unit.push('번호만 빼기·기존 서체색 유지 ' + readSymbolStyle(b.sty));
const c = applySymbolStyle(b.sty, b.tex, 'skip=');
if (!/imprintSym\{①\}/.test(c.tex)) unit.push('빼기 목록 비우기');
const d = applySymbolStyle(c.sty, c.tex, 'color=blue');
if (readSymbolStyle(d.sty) !== 'font=sans;color=blue;skip=;deco=') unit.push('색만 바꾸기 ' + readSymbolStyle(d.sty));
const off = applySymbolStyle(d.sty, d.tex, 'off');
if (countSymbols(off.tex) !== 0 || readSymbolStyle(off.sty) !== undefined || off.tex !== tex0) unit.push('끄기·원문 복원');
// 따옴표 형광펜과 함께 써도 서로 깨지지 않는다
const hl = applyHighlight(a.sty, a.tex, 'yellow');
if (countHighlighted(hl.tex) !== 1) unit.push('형광펜과 함께: 따옴표 구절 인식 ' + countHighlighted(hl.tex));
const re = applySymbolStyle(hl.sty, hl.tex, '');
if (countSymbols(re.tex) < 6) unit.push('형광펜 뒤 특수문자 다시 입히기');
console.log(`특수문자 문장 ${CASES.length}개: ${bad}개 실패 / 적용 점검 ${unit.length ? unit.join(', ') : '통과'}`);
out.forEach(o => console.log(o));
process.exit(bad || unit.length ? 1 : 0);

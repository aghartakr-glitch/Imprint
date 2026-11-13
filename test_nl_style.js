// 요소별 색·꾸밈(굵게·기울임·밑줄·취소선) — 로그의 실패 요청과 적용 결과. (API 호출 없음)  실행: node test_nl_style.js
import { planNaturalEdit } from './src/nlKnobAliases.js';
import { applyElementStyle, readElementStyle, parseSpec } from './src/styElement.js';
import { applyHighlight, countHighlighted, isHlMode } from './src/styHighlight.js';
import { fixLocaleLine, mapSafeLines } from './src/texSafe.js';

const CM = { quoteHighlight: 'off', noteStyle: '', bodyStyle: '', h1Size: '21', h1Leading: '26', bodySize: '9.5', bodyLeading: '15' };
const run = (msg, cm = CM) => planNaturalEdit(msg, cm, [], {}).synth?.patches || {};
const spec = (p, k) => parseSpec(p[k]);
const only = (p, ...keys) => Object.keys(p).length === keys.length && keys.every(k => k in p);

const CASES = [
  // 로그의 실패 요청
  ['각주만 연하게 해줘', p => only(p, 'noteStyle') && /^\d+$|!/.test(spec(p, 'noteStyle').color)],
  ['각주만 연하게 해달랬는데 본문도 연해져', p => only(p, 'noteStyle')],
  ['각주 번호만 빨간색으로 바꿔줘', p => only(p, 'markStyle') && spec(p, 'markStyle').color === 'red'],
  ['본문의 각주 번호 많이 크게 해줘', p => only(p, 'markStyle') && spec(p, 'markStyle').size >= 1.7],
  ['쪽번호만 초록으로', p => only(p, 'pnStyle') && spec(p, 'pnStyle').color === 'green'],
  ['각주만 파랑색', p => only(p, 'noteStyle') && spec(p, 'noteStyle').color === 'blue'],
  ['따옴표 아닌 내용만 빨간색으로 해줘', p => spec(p, 'bodyStyle').color === 'red' && p.quoteHighlight === 'reset'],
  ['따옴표 안에 있는 것 제외한 본문만 빨강색으로', p => spec(p, 'bodyStyle').color === 'red' && p.quoteHighlight === 'reset'],
  ['따옴표 안에 있는거 빼고 본문 빨강', p => spec(p, 'bodyStyle').color === 'red' && p.quoteHighlight === 'reset'],
  ['따옴표 안에 있는것만 고딕체로 변경', p => only(p, 'quoteHighlight') && p.quoteHighlight === 'sans'],
  ['따옴표 안 빨강 명조체', p => p.quoteHighlight === 'text:red+serif'],
  ['따옴표 말고 빨간 적용', p => spec(p, 'bodyStyle').color === 'red' && /reset/.test(p.quoteHighlight)],
  ['따옴표 안에 있는거 빨강으로, 밑줄', p => p.quoteHighlight === 'text:red+underline'],
  ['따옴표 안에 빨강 굵게 밑줄', p => ['text:red', 'bold', 'underline'].every(x => p.quoteHighlight.split('+').includes(x))],
  ['따옴표 안 굵게 기울임 밑줄 취소선', p => ['bold', 'italic', 'underline', 'strike'].every(x => p.quoteHighlight.split('+').includes(x))],
  // 모든 요소 각각
  ['제목 빨강에 밑줄', p => only(p, 'h1Style') && spec(p, 'h1Style').color === 'red' && spec(p, 'h1Style').deco.includes('underline')],
  ['부제목 파랑 기울임', p => only(p, 'h2Style') && spec(p, 'h2Style').color === 'blue' && spec(p, 'h2Style').deco.includes('italic')],
  ['면주만 보라색', p => only(p, 'rhStyle') && spec(p, 'rhStyle').color === 'purple'],
  ['쪽번호 파랑 밑줄', p => only(p, 'pnStyle') && spec(p, 'pnStyle').deco.includes('underline')],
  ['각주 주황 굵게 기울임', p => only(p, 'noteStyle') && spec(p, 'noteStyle').deco.includes('bold') && spec(p, 'noteStyle').deco.includes('italic')],
  ['본문 글자 남색', p => only(p, 'bodyStyle') && spec(p, 'bodyStyle').color === 'navy'],
  ['본문 기울임', p => only(p, 'bodyStyle') && spec(p, 'bodyStyle').deco.includes('italic')],
  ['제목 취소선', p => spec(p, 'h1Style').deco.includes('strike')],
  ['면주 밑줄 빼줘', { noteStyle: '', rhStyle: 'color=;deco=underline;size=' }, p => only(p, 'rhStyle') && !spec(p, 'rhStyle').deco.includes('underline')],
  // 크기+색을 같이 말해도 둘 다
  ['제목 더 크게 해줘 빨강 굵게', p => Number(p.h1Size) > 21 && spec(p, 'h1Style').color === 'red'],
  // 기존 굵기 항목은 그대로
  ['제목 굵게', p => only(p, 'h1Weight')],
  ['본문 볼드 빼줘', p => p.bodyWeight === 'normal'],
  // 건드리면 안 되는 말
  ['각주 구분선 연하게 해줘', p => !('noteStyle' in p) && 'footnoteRuleColor' in p],
  ['특수문자만 빨강', p => only(p, 'symbolStyle')],
  // 자판이 갈라진 오타
  ['쪽번호 ㅍ ㅏ랑색', p => only(p, 'pnStyle') && spec(p, 'pnStyle').color === 'blue'],
  ['쪽번호 ㅍㅏ랑색으로', p => spec(p, 'pnStyle').color === 'blue'],
  ['제목 ㅊ ㅗ록', p => spec(p, 'h1Style').color === 'green'],
  ['각주 글자 연하게 해줘 본문은 그대로', p => only(p, 'noteStyle')],
];
let bad = 0; const out = [];
for (const c of CASES) {
  const [msg, a, b] = c;
  const cm = b ? { ...CM, ...a } : CM; const ok = b || a;
  const p = run(msg, cm);
  let pass = false; try { pass = ok(p); } catch {}
  if (!pass) { bad++; out.push(`  ✗ "${msg}" → ${JSON.stringify(p)}`); }
}
// 적용 점검
const unit = [];
const sty0 = '\\newcommand{\\notef}{\\sffamily\\fontsize{7pt}{9pt}\\selectfont}\n\\newcommand{\\hone}{\\sffamily\\fontsize{20pt}{24pt}\\selectfont}\n\\renewcommand\\@makefntext[1]{%\n  \\noindent\\makebox[1.5em][l]{\\notef\\@thefnmark.}\\,{\\notef #1}}\n\\makeoddhead{imprint}{}{}{\\runningheadf\\imprintrunninghead}\n\\makeoddfoot{imprint}{}{\\foliof\\thepage}{}\n\\endinput\n';
const tex0 = '\\begin{document}\n\\XeTeXlinebreaklocale “ko”\n{\\noindent\\hone 제목\\par}\n{\\bodyf 그는 ‘평면’이라 했다.\\par}\n\\end{document}';
let a = applyElementStyle(sty0, tex0, 'note', 'color=blue;deco=bold/underline');
if (readElementStyle(a.sty, 'note') !== 'color=blue;deco=bold/underline;size=') unit.push('각주 상태 읽기 ' + readElementStyle(a.sty, 'note'));
if (!/imprintDecoNote\{#1\}/.test(a.sty)) unit.push('각주 밑줄 사용처 감싸기');
a = applyElementStyle(a.sty, a.tex, 'note', 'color=red');
if (readElementStyle(a.sty, 'note') !== 'color=red;deco=bold/underline;size=') unit.push('색만 바꿀 때 꾸밈 유지 ' + readElementStyle(a.sty, 'note'));
a = applyElementStyle(a.sty, a.tex, 'note', 'deco=');
if (/imprintDecoNote\{#1\}/.test(a.sty) || (a.sty.match(/imprintEl note/g) || []).length !== 1) unit.push('꾸밈 끄기·줄 겹침');
let h = applyElementStyle(sty0, tex0, 'h1', 'deco=underline');
if (!/\\hone \\imprintDecoHOne\{제목\}/.test(h.tex)) unit.push('제목 밑줄 감싸기 ' + h.tex.split('\n')[2]);
h = applyElementStyle(h.sty, h.tex, 'h1', 'deco=');
if (h.tex !== tex0) unit.push('제목 꾸밈 끄고 원문 복원');
const r = applyElementStyle(sty0, tex0, 'rh', 'color=blue;deco=underline');
if (!/\\imprintDecoRh\{\\imprintrunninghead\}/.test(r.sty)) unit.push('면주 밑줄 감싸기');
const pn = applyElementStyle(sty0, tex0, 'pn', 'deco=underline');
if (!/\\imprintDecoPn\{\\thepage\}/.test(pn.sty)) unit.push('쪽번호 밑줄 감싸기');
const mk = applyElementStyle(sty0, tex0, 'mark', 'color=red;size=1.8');
if (!/makeatletter\\AtBeginDocument/.test(mk.sty) || !/dimexpr1\.8/.test(mk.sty)) unit.push('각주 번호 색·크기 ' + mk.sty.split('\n').pop());
// 본문 색은 전역으로 걸리지 않고 본문 문단에서만, 묶음 없는 \bodyf{}는 걷힌다
const bd = applyElementStyle(sty0, tex0 + '\\vspace{1pt}\\bodyf{}', 'body', 'color=red');
if (/AtBeginDocument\{\\color/.test(bd.sty)) unit.push('본문 색 전역 적용');
if (/\\bodyf\{\}/.test(bd.tex)) unit.push('묶음 없는 bodyf 남음');
if (!/\{\\noindent\\bodyf /.test(applyElementStyle(sty0, '{\\bodyf\\noindent 글\\par}', 'body', 'color=red').tex)) unit.push('문단 연 뒤 색 걸기');
if (!/makefntext\[1\]\{\\normalcolor/.test(bd.sty)) unit.push('각주는 기본색');
// 로케일 줄은 따옴표 색을 입혀도 건드리지 않는다
const hl = applyHighlight(sty0, tex0, 'text:red+bold');
if (countHighlighted(hl.tex) !== 1 || /imprintHL\{“ko”\}/.test(hl.tex)) unit.push('로케일 줄 보호 ' + countHighlighted(hl.tex));
if (fixLocaleLine('\\XeTeXlinebreaklocale \\imprintHL{“ko”}').includes('imprintHL')) unit.push('감싸진 로케일 줄 복구');
if (mapSafeLines('\\XeTeXlinebreaklocale “ko”\n“a”', l => l.toUpperCase()).split('\n')[0] !== '\\XeTeXlinebreaklocale “ko”') unit.push('안전 줄 매핑');
if (!isHlMode('reset+bold') || !isHlMode('text:red+bold+italic+underline+strike')) unit.push('따옴표 모드 검증');
console.log(`요소별 스타일 문장 ${CASES.length}개: ${bad}개 실패 / 적용 점검 ${unit.length ? unit.join(', ') : '통과'}`);
out.forEach(o => console.log(o));
process.exit(bad || unit.length ? 1 : 0);

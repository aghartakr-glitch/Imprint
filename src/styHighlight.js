// 따옴표 안 낱말에 형광펜(배경색) 또는 글자색·꾸밈 — ‘…’ “…” 로 묶인 짧은 구절을 \imprintHL{…}로 감싸고,
// 모양은 sty의 \imprintHL 정의 한 줄(% imprintHL)로 정한다. 켜기/끄기/색 바꾸기를 여러 번 해도 겹치지 않는다.
export const HL_COLORS = {
  yellow: { label: '노랑', expr: 'yellow!55' },
  green:  { label: '연두', expr: 'green!35' },
  pink:   { label: '분홍', expr: 'magenta!25' },
  blue:   { label: '하늘', expr: 'cyan!25' },
  orange: { label: '주황', expr: 'orange!40' },
  gray:   { label: '회색', expr: 'black!15' },
};
// 글자색 — mode는 'text:red'처럼 쓴다. 요소별 색(styElement)도 같은 표를 쓴다
export const TEXT_COLORS = {
  red:    { label: '빨강', expr: 'red!80!black' },
  blue:   { label: '파랑', expr: 'blue!70!black' },
  green:  { label: '초록', expr: 'green!45!black' },
  orange: { label: '주황', expr: 'orange!90!black' },
  pink:   { label: '분홍', expr: 'magenta!80!black' },
  gray:   { label: '회색', expr: 'black!55' },
  purple: { label: '보라', expr: 'violet!80!black' },
  brown:  { label: '갈색', expr: 'brown!90!black' },
  navy:   { label: '남색', expr: 'blue!55!black' },
  yellow: { label: '노랑', expr: 'yellow!60!black' },
};
// 꾸밈: 굵게·기울임·밑줄·취소선. 몇 개든 겹쳐 쓸 수 있다(예: 'text:red+bold+underline')
export const FACE_MODES = { bold: '\\textbf{#1}', italic: '\\textit{#1}', underline: '\\uline{#1}', strike: '\\sout{#1}', sans: '{\\sffamily #1}', serif: '{\\rmfamily #1}' };
// 모델이 'text:red|bold'처럼 | , 로 이어 내도 같은 뜻으로 읽는다. 'reset'은 색을 본문 기본색으로 되돌리는 자리 표시
// ("따옴표 아닌 내용만 빨강"에서 따옴표는 빨강이 되지 않게 둘 때 쓴다)
const splitMode = mode => String(mode).split(/[+|,]/).map(x => x.trim()).filter(x => x && x !== 'off');
const baseOk = v => v === 'reset' || !!HL_COLORS[v] || (/^text:/.test(v) && !!TEXT_COLORS[v.slice(5)]);
export const isHlMode = v => {
  const t = splitMode(v);
  const faces = t.filter(x => FACE_MODES[x]), bases = t.filter(x => !FACE_MODES[x]);
  return t.length > 0 && t.every(x => FACE_MODES[x] || baseOk(x)) && bases.length <= 1 && new Set(faces).size === faces.length;
};
export const normalizeHlMode = mode => splitMode(mode).join('+');

import { mapSafeLines, fixLocaleLine } from './texSafe.js';
const MARK = '% imprintHL';
const QUOTE_RE = /(‘[^‘’\\\n{}]{1,40}’|“[^“”\\\n{}]{1,40}”)/g;

function appendBeforeEndinput(sty, text) {
  if (/\\endinput\s*$/.test(sty)) return sty.replace(/\\endinput\s*$/, `${text}\n\\endinput\n`);
  return sty + '\n' + text + '\n';
}

export function readHighlight(sty) {
  const m = String(sty).match(/% imprintHL ([\w:+]+)/);
  return m ? m[1] : 'off';
}

// mode: 'off' | 배경색 | 'text:색' | 'reset' 에 꾸밈(bold·italic·underline·strike)을 +로 몇 개든 더한 것. { sty, tex }를 돌려준다.
export function applyHighlight(sty, tex, rawMode) {
  const parts = splitMode(rawMode);
  const faceToks = parts.filter(x => FACE_MODES[x]);
  const baseTok = parts.find(x => !FACE_MODES[x]) || null;
  const mode = parts.length ? parts.join('+') : 'off';
  const outSty = String(sty).replace(/^.*% imprintHL.*\r?\n?/gm, '');
  let outTex = String(tex);
  if (!parts.length) {
    outTex = outTex.replace(/\\imprintHL\{([^{}]*)\}/g, '$1');
    return { sty: outSty, tex: outTex };
  }
  // 안쪽부터: 색(또는 형광펜/reset) → 꾸밈들
  let macro = '#1';
  if (baseTok === 'reset') macro = '{\\normalcolor #1}';
  else if (baseTok && /^text:/.test(baseTok) && TEXT_COLORS[baseTok.slice(5)]) macro = `\\textcolor{${TEXT_COLORS[baseTok.slice(5)].expr}}{#1}`;
  else if (baseTok && HL_COLORS[baseTok]) macro = `{\\setlength{\\fboxsep}{0.5pt}\\colorbox{${HL_COLORS[baseTok].expr}}{#1}}`;
  for (const f of faceToks) macro = FACE_MODES[f].replace('#1', () => macro);
  const needUlem = faceToks.some(f => f === 'underline' || f === 'strike');
  const styOut = appendBeforeEndinput(outSty,
    `\\RequirePackage{xcolor}${needUlem ? '\\RequirePackage[normalem]{ulem}' : ''}\\providecommand{\\imprintHL}[1]{${macro}}\\renewcommand{\\imprintHL}[1]{${macro}} ${MARK} ${mode}`);
  const at = outTex.indexOf('\\begin{document}');
  const head = at < 0 ? '' : outTex.slice(0, at);
  let body = at < 0 ? outTex : outTex.slice(at);
  // 이미 감싼 것은 한 번 벗기고 다시 감싼다 — 같은 구절이 두 번 감싸지지 않게
  // 특수문자 서체·색 감싸기(\imprintSym)도 한 번 벗겨야 따옴표 구절이 인식된다 — 호출한 쪽에서 다시 적용한다
  body = fixLocaleLine(body).replace(/\\imprintSym\{([^{}]*)\}/g, '$1').replace(/\\imprintHL\{([^{}]*)\}/g, '$1');
  body = mapSafeLines(body, l => l.replace(QUOTE_RE, m => `\\imprintHL{${m}}`));
  return { sty: styOut, tex: head + body };
}

export const countHighlighted = tex => (String(tex).match(/\\imprintHL\{/g) || []).length;

// 자연어(예전 단순 판): 새 통합 해석기(nlStyle.js)가 먼저 처리하고, 여기는 형광펜 말만 남아 있을 때 쓴다
const HAS_QUOTE = /(따옴표|인용|‘|’|“|”|작은따옴표|큰따옴표|홑따옴표)/;
const HAS_HL = /(형광펜|하이라이트|배경\s*색|칠해|칠하|마커|밑바탕)/;
const OFF = /(지워|없애|빼\s*줘|해제|취소|제거|원래대로)/;
const COLOR_WORDS = [[/(노랑|노란|yellow)/i, 'yellow'], [/(연두|초록|녹색|green)/i, 'green'], [/(분홍|핑크|pink)/i, 'pink'], [/(하늘|파랑|파란|청색|blue)/i, 'blue'], [/(주황|오렌지|orange)/i, 'orange'], [/(회색|그레이|gray|grey)/i, 'gray']];

export function planHighlight(msg = '') {
  const m = String(msg);
  const quoted = HAS_QUOTE.test(m);
  const off = OFF.test(m);
  if (!HAS_HL.test(m)) return null;
  if (!quoted && !(off && /형광펜|하이라이트/.test(m))) return null;
  if (off) return { patches: { quoteHighlight: 'off' } };
  const c = COLOR_WORDS.find(([re]) => re.test(m));
  return { patches: { quoteHighlight: c ? c[1] : 'yellow' } };
}

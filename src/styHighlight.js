// 따옴표 안 낱말에 형광펜(배경색) 또는 글자색 — ‘…’ “…” 로 묶인 짧은 구절을 \imprintHL{…}로 감싸고,
// 모양은 sty의 \imprintHL 정의 한 줄(% imprintHL)로 정한다. 켜기/끄기/색 바꾸기를 여러 번 해도 겹치지 않는다.
export const HL_COLORS = {
  yellow: { label: '노랑', expr: 'yellow!55' },
  green:  { label: '연두', expr: 'green!35' },
  pink:   { label: '분홍', expr: 'magenta!25' },
  blue:   { label: '하늘', expr: 'cyan!25' },
  orange: { label: '주황', expr: 'orange!40' },
  gray:   { label: '회색', expr: 'black!15' },
};
// 글자색 — mode는 'text:red'처럼 쓴다
export const TEXT_COLORS = {
  red:    { label: '빨강', expr: 'red!80!black' },
  blue:   { label: '파랑', expr: 'blue!70!black' },
  green:  { label: '초록', expr: 'green!45!black' },
  orange: { label: '주황', expr: 'orange!90!black' },
  pink:   { label: '분홍', expr: 'magenta!80!black' },
  gray:   { label: '회색', expr: 'black!55' },
};
export const FACE_MODES = { bold: '\\textbf{#1}', italic: '\\textit{#1}' }; // 굵게·기울임
export const isHlMode = v => !!FACE_MODES[v] || !!HL_COLORS[v] || (/^text:/.test(String(v)) && !!TEXT_COLORS[String(v).slice(5)]);

const MARK = '% imprintHL';
const QUOTE_RE = /(‘[^‘’\\\n{}]{1,40}’|“[^“”\\\n{}]{1,40}”)/g;

function appendBeforeEndinput(sty, text) {
  if (/\\endinput\s*$/.test(sty)) return sty.replace(/\\endinput\s*$/, `${text}\n\\endinput\n`);
  return sty + '\n' + text + '\n';
}

export function readHighlight(sty) {
  const m = String(sty).match(/% imprintHL ([\w:]+)/);
  return m ? m[1] : 'off';
}

// mode: 'off' | HL_COLORS 키(배경) | 'text:색'(글자색). { sty, tex }를 돌려준다.
export function applyHighlight(sty, tex, mode) {
  const isText = /^text:/.test(String(mode));
  const face = FACE_MODES[mode];
  const color = face ? { expr: '' } : isText ? TEXT_COLORS[String(mode).slice(5)] : HL_COLORS[mode];
  let outSty = String(sty).replace(/^.*% imprintHL.*\r?\n?/gm, '');
  let outTex = String(tex);
  if (!color) {
    outTex = outTex.replace(/\\imprintHL\{([^{}]*)\}/g, '$1');
    return { sty: outSty, tex: outTex };
  }
  const macro = face ? face : isText
    ? `\\textcolor{${color.expr}}{#1}`
    : `{\\setlength{\\fboxsep}{0.5pt}\\colorbox{${color.expr}}{#1}}`;
  outSty = appendBeforeEndinput(outSty,
    `\\RequirePackage{xcolor}\\providecommand{\\imprintHL}[1]{${macro}}\\renewcommand{\\imprintHL}[1]{${macro}} ${MARK} ${mode}`);
  const at = outTex.indexOf('\\begin{document}');
  const head = at < 0 ? '' : outTex.slice(0, at);
  let body = at < 0 ? outTex : outTex.slice(at);
  // 이미 감싼 것은 한 번 벗기고 다시 감싼다 — 같은 구절이 두 번 감싸지지 않게
  body = body.replace(/\\imprintHL\{([^{}]*)\}/g, '$1').replace(QUOTE_RE, m => `\\imprintHL{${m}}`);
  return { sty: outSty, tex: head + body };
}

export const countHighlighted = tex => (String(tex).match(/\\imprintHL\{/g) || []).length;

// 자연어: "따옴표 안의 단어들 형광펜 칠해줘" / "빨간색으로 바꿔줘" / "형광펜 지워줘"
const HAS_QUOTE = /(따옴표|인용|‘|’|“|”|작은따옴표|큰따옴표|홑따옴표)/;
const HAS_HL = /(형광펜|하이라이트|배경\s*색|칠해|칠하|마커|밑바탕)/;
const OFF = /(지워|없애|빼\s*줘|해제|취소|제거|원래대로)/;
const COLOR_WORDS = [[/(노랑|노란|yellow)/i, 'yellow'], [/(연두|초록|녹색|green)/i, 'green'], [/(분홍|핑크|pink)/i, 'pink'], [/(하늘|파랑|파란|청색|blue)/i, 'blue'], [/(주황|오렌지|orange)/i, 'orange'], [/(회색|그레이|gray|grey)/i, 'gray']];
const TEXT_WORDS = [[/(빨간|빨강|붉은|레드|red)/i, 'red'], [/(파란|파랑|블루|청색)/i, 'blue'], [/(초록|녹색|연두|그린)/i, 'green'], [/(주황|오렌지)/i, 'orange'], [/(분홍|핑크)/i, 'pink'], [/(회색|그레이)/i, 'gray']];

export function planHighlight(msg = '') {
  const m = String(msg);
  const quoted = HAS_QUOTE.test(m);
  const off = OFF.test(m);
  // 굵게·기울임 — "따옴표 안에 있는 것만 볼드 처리해줘"
  if (quoted && !off) {
    if (/(볼드|굵게|굵은|두껍게|bold)/i.test(m)) return { patches: { quoteHighlight: 'bold' } };
    if (/(기울|이탤릭|italic|비스듬)/i.test(m)) return { patches: { quoteHighlight: 'italic' } };
  }
  if (quoted && off && /(볼드|굵|기울|이탤릭)/.test(m)) return { patches: { quoteHighlight: 'off' } };
  // 글자색 — 형광펜 말이 없고 색 이름이 있을 때
  if (quoted && !/(형광펜|하이라이트|배경)/.test(m) && /(색|빨강|빨간|파랑|파란|초록|주황|분홍|회색)/.test(m)) {
    if (off) return { patches: { quoteHighlight: 'off' } };
    const t = TEXT_WORDS.find(([re]) => re.test(m));
    if (t) return { patches: { quoteHighlight: 'text:' + t[1] } };
  }
  if (!HAS_HL.test(m)) return null;
  if (!quoted && !(off && /형광펜|하이라이트/.test(m))) return null;
  if (off) return { patches: { quoteHighlight: 'off' } };
  const c = COLOR_WORDS.find(([re]) => re.test(m));
  return { patches: { quoteHighlight: c ? c[1] : 'yellow' } };
}

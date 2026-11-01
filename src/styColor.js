// 글자 색 — 요소별(면주·쪽번호·각주·제목·부제목·본문)로 검정의 진하기(%)를 정한다. 100 = 검정, 낮을수록 연한 회색.
// xcolor의 black!N을 쓰고, 원래 정의를 \let으로 보존한 뒤 그 뒤에 \color를 덧붙이는 줄 하나(% imprintColor)로 관리한다.
export const COLOR_ELEMENTS = {
  rh:   { cmd: 'runningheadf', tag: 'Rh',   label: '면주',   key: 'rhColor' },
  pn:   { cmd: 'foliof',       tag: 'Pn',   label: '쪽번호', key: 'pnColor' },
  note: { cmd: 'notef',        tag: 'Note', label: '각주',   key: 'noteColor' },
  h1:   { cmd: 'hone',         tag: 'HOne', label: '제목',   key: 'h1Color' },
  h2:   { cmd: 'htwo',         tag: 'HTwo', label: '부제목', key: 'h2Color' },
  body: { cmd: 'bodyf',        tag: 'Body', label: '본문',   key: 'bodyColor' },
};
export const COLOR_KEYS = Object.values(COLOR_ELEMENTS).map(e => e.key);
export const elementByKey = key => Object.entries(COLOR_ELEMENTS).find(([, e]) => e.key === key)?.[0];

const clamp = v => Math.max(5, Math.min(100, Math.round(Number(v))));

function appendBeforeEndinput(sty, text) {
  if (/\\endinput\s*$/.test(sty)) return sty.replace(/\\endinput\s*$/, `${text}\n\\endinput\n`);
  return sty + '\n' + text + '\n';
}

// el의 글자 진하기를 pct(%)로. 100이면 색 줄을 지워 원래대로 둔다. 숫자가 아니거나 요소 이름이 틀리면 그대로 돌려준다.
export function applyColor(sty, el, pct) {
  const e = COLOR_ELEMENTS[el];
  const v = Number(pct);
  if (!e || !Number.isFinite(v)) return sty;
  const n = clamp(v);
  const mark = `% imprintColor ${el}=`;
  let out = String(sty).replace(new RegExp(`^.*${mark}.*\\r?\\n?`, 'm'), '');
  if (n >= 100) return out;
  if (!new RegExp(`\\\\newcommand\\{\\\\${e.cmd}\\}`).test(out)) return sty; // 이 문서에 해당 서식 명령이 없다
  const orig = `\\imprintOrig${e.tag}`;
  const body = el === 'body' ? `\\AtBeginDocument{\\color{black!${n}}}` : '';
  const line = `\\RequirePackage{xcolor}\\let${orig}\\${e.cmd}\\renewcommand{\\${e.cmd}}{${orig}\\color{black!${n}}}${body} ${mark}${n}`;
  return appendBeforeEndinput(out, line);
}

export function readColor(sty, el) {
  const m = String(sty).match(new RegExp(`% imprintColor ${el}=(\\d+)`));
  return m ? m[1] : undefined;
}

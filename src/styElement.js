// 요소별 글자 모양 — 본문·제목·부제목·각주·면주·쪽번호·본문 속 각주 번호가 각각 색(색 이름 또는 회색 진하기)과
// 꾸밈(굵게·기울임·밑줄·취소선), 각주 번호는 크기까지 독립적으로 정해진다. 상태는 요소마다 한 줄(% imprintEl)로 sty에 남는다.
//   % imprintEl note color=red;deco=bold/underline;size=
// 색: 색 이름(red·blue·green·orange·pink·purple·brown·navy·gray), 회색 진하기 숫자(55), 색 이름+연하기(red!60)
// 꾸밈: bold · italic · underline · strike. 본문 전체 밑줄·취소선은 각주 등과 충돌해 지원하지 않는다.
import { TEXT_COLORS } from './styHighlight.js';

export const DECOS = ['bold', 'italic', 'underline', 'strike'];
export const ELEMENTS = {
  body: { cmd: 'bodyf', tag: 'Body', label: '본문' },
  h1: { cmd: 'hone', tag: 'HOne', label: '제목' },
  h2: { cmd: 'htwo', tag: 'HTwo', label: '부제목' },
  note: { cmd: 'notef', tag: 'Note', label: '각주' },
  rh: { cmd: 'runningheadf', tag: 'Rh', label: '면주' },
  pn: { cmd: 'foliof', tag: 'Pn', label: '쪽번호' },
  mark: { cmd: null, tag: 'Mark', label: '본문 속 각주 번호' },
};
export const STYLE_KEYS = Object.keys(ELEMENTS).map(el => `${el}Style`);
export const elementOfStyleKey = key => Object.keys(ELEMENTS).find(el => `${el}Style` === key);

const MARK_PREFIX = '% imprintEl';
const clampPct = n => Math.max(5, Math.min(100, Math.round(Number(n))));

// 색 지정 → xcolor 식. 형식이 틀리면 null
export function colorExprOf(spec) {
  if (spec === undefined || spec === null || spec === '' || spec === 'off') return null;
  const s = String(spec);
  if (/^\d+(\.\d+)?$/.test(s)) return `black!${clampPct(s)}`;
  const d = s.match(/^dark(\d+)$/);
  if (d) return `black!${clampPct(d[1])}`;
  const m = s.match(/^([a-z]+)(?:!(\d+))?$/);
  if (m && TEXT_COLORS[m[1]]) return m[2] ? `${TEXT_COLORS[m[1]].expr}!${clampPct(m[2])}` : TEXT_COLORS[m[1]].expr;
  return null;
}
export const isColorSpec = s => colorExprOf(s) !== null;

export function parseSpec(str) {
  const o = { color: null, deco: [], size: null };
  for (const part of String(str || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i), v = part.slice(i + 1);
    if (k === 'color' && v) o.color = v;
    else if (k === 'deco' && v) o.deco = v.split(/[/+|,]/).filter(x => DECOS.includes(x));
    else if (k === 'size' && v && Number.isFinite(Number(v))) o.size = Number(v);
  }
  o.deco = [...new Set(o.deco)];
  return o;
}
export const stringifySpec = o => `color=${o.color || ''};deco=${(o.deco || []).join('/')};size=${o.size || ''}`;

function appendBeforeEndinput(sty, text) {
  if (/\\endinput\s*$/.test(sty)) return sty.replace(/\\endinput\s*$/, `${text}\n\\endinput\n`);
  return sty + '\n' + text + '\n';
}

// 지금 상태 읽기: 새 줄이 있으면 그것을, 없으면 예전 방식(% imprintColor / % imprintMarkColor)의 색을 가져온다
export function readElementStyle(sty, el) {
  const s = String(sty);
  const m = s.match(new RegExp(`${MARK_PREFIX} ${el} (\\S+)`));
  if (m) return m[1];
  if (el === 'mark') { const o = s.match(/% imprintMarkColor (\d+)/); return o ? `color=${o[1]};deco=;size=` : undefined; }
  const o = s.match(new RegExp(`% imprintColor ${el}=(\\d+)`));
  return o ? `color=${o[1]};deco=;size=` : undefined;
}

// 밑줄·취소선을 걸 자리(본문 글에 직접 쓸 수 없는 스위치형 서식이라 사용처를 한 번 감싸 둔다)
const MAKE_LINES = /^\\make(?:odd|even)(?:head|foot)\{imprint\}.*$/gm;
function wrapSites(sty, tex, el, on) {
  const tag = ELEMENTS[el].tag;
  const mac = `\\imprintDeco${tag}`;
  let s = String(sty), t = String(tex);
  if (el === 'h1' || el === 'h2') {
    const cmd = ELEMENTS[el].cmd;
    const re = new RegExp(`(\\\\${cmd}\\s+)([^\\\\{}]+?)(\\s*\\\\par)`, 'g');
    const unre = new RegExp(`${mac.replace(/\\/g, '\\\\')}\\{([^{}]*)\\}`, 'g');
    t = t.replace(unre, '$1');
    if (on) t = t.replace(re, (m, a, b, c) => `${a}${mac}{${b}}${c}`);
  } else if (el === 'rh' || el === 'pn') {
    const target = el === 'rh' ? '\\imprintrunninghead' : '\\thepage';
    const unre = new RegExp(`${mac.replace(/\\/g, '\\\\')}\\{${target.replace(/\\/g, '\\\\')}\\}`, 'g');
    s = s.replace(MAKE_LINES, line => line.replace(unre, target));
    if (on) s = s.replace(MAKE_LINES, line => line.split(target).join(`${mac}{${target}}`));
  } else if (el === 'note') {
    const unre = new RegExp(`\\{(\\\\notef) ${mac.replace(/\\/g, '\\\\')}\\{#1\\}\\}`, 'g');
    s = s.replace(unre, '{$1 #1}');
    if (on) s = s.replace(/\{(\\notef) #1\}/g, `{$1 ${mac}{#1}}`);
  }
  return { sty: s, tex: t };
}

const SITE_ELEMENTS = ['h1', 'h2', 'rh', 'pn', 'note'];

// patch: 'color=red;deco=bold/underline;size=1.6' 일부만 있어도 되고, 'off'면 그 요소 꾸밈을 모두 걷어낸다.
// deco는 목록 전체로 바꾼다(말한 것만 더하고 빼는 계산은 호출 쪽 — 계획 단계에서 현재 값과 합쳐 절대값으로 낸다).
export function applyElementStyle(sty, tex, el, patch) {
  const E = ELEMENTS[el];
  if (!E) return { sty, tex };
  const cur = parseSpec(readElementStyle(sty, el));
  let next;
  if (patch === 'off') next = { color: null, deco: [], size: null };
  else {
    const p = parseSpec(patch);
    const has = k => new RegExp(`(?:^|;)${k}=`).test(String(patch));
    next = { color: has('color') ? p.color : cur.color, deco: has('deco') ? p.deco : cur.deco, size: has('size') ? p.size : cur.size };
  }
  const tag = E.tag;
  let out = String(sty)
    .replace(new RegExp(`^.*${MARK_PREFIX} ${el} .*\\r?\\n?`, 'gm'), '')
    .replace(new RegExp(`^.*% imprintColor ${el}=.*\\r?\\n?`, 'gm'), '');
  if (el === 'mark') out = out.replace(/^.*% imprintMarkColor.*\r?\n?/gm, '');
  let outTex = String(tex);
  const ce = colorExprOf(next.color);
  const sw = (ce ? `\\color{${ce}}` : '') + (next.deco.includes('bold') ? '\\bfseries' : '') + (next.deco.includes('italic') ? '\\itshape' : '');
  const ul = next.deco.includes('underline'), st = next.deco.includes('strike');
  const siteOk = SITE_ELEMENTS.includes(el);
  const wantDeco = siteOk && (ul || st);
  // 사용처 감싸기는 켜질 때 한 번, 꺼질 때 걷는다(감싼 채로 매크로 정의가 사라지면 컴파일이 깨진다)
  const w = wrapSites(out, outTex, el, wantDeco);
  out = w.sty; outTex = w.tex;
  // 묶음 없이 쓰인 \bodyf{}는 색을 문서 끝까지 끌고 가므로, 본문 색이 있으면 걷어낸다(문단은 각자 {\bodyf …}로 크기를 정한다)
  // 세로 모드에서 색 명령이 먼저 나가면 앞 줄(부제목)까지 물들 수 있어, 문단을 연 다음 색을 건다
  if (el === 'body') outTex = outTex.replace(/\\bodyf\{\}/g, '').replace(/\{\\bodyf\\noindent(\s)/g, '{\\noindent\\bodyf$1');
  const pieces = [];
  if (ce) pieces.push('\\RequirePackage{xcolor}');
  if (ul || st) pieces.push('\\RequirePackage[normalem]{ulem}');
  if (siteOk) {
    const nest = st && ul ? '\\uline{\\sout{#1}}' : ul ? '\\uline{#1}' : st ? '\\sout{#1}' : '#1';
    pieces.push(`\\providecommand{\\imprintDeco${tag}}[1]{#1}`);
    if (wantDeco) pieces.push(`\\renewcommand{\\imprintDeco${tag}}[1]{${nest}}`);
  }
  if (el === 'mark') {
    const size = next.size && next.size !== 1
      ? `\\fontsize{\\dimexpr${next.size}\\dimexpr\\f@size pt\\relax\\relax}{\\f@baselineskip}\\selectfont ` : '';
    // \@makefnmark·\f@size는 @ 이름이라 줄 전체를 \makeatletter로 감싼다(읽을 때 글자 처리가 달라서)
    if (sw || size) pieces.push(`\\makeatletter\\AtBeginDocument{\\let\\imprintOrigMk\\@makefnmark\\renewcommand\\@makefnmark{{${sw}${size}\\imprintOrigMk}}}\\makeatother`);
  } else if (sw) {
    pieces.push(`\\let\\imprintOrig${tag}\\${E.cmd}\\renewcommand{\\${E.cmd}}{\\imprintOrig${tag}${sw}}`);
    // 본문 색은 본문 문단(\bodyf) 안에서만 — 전역으로 걸면 제목·면주·쪽번호로 번진다. 문단 속 각주는 기본색으로 되돌린다
    if (el === 'body' && ce) pieces.push('\\makeatletter\\AtBeginDocument{\\let\\imprintOrigFnt\\@makefntext\\renewcommand\\@makefntext[1]{\\normalcolor\\imprintOrigFnt{#1}}}\\makeatother');
  }
  const empty = !next.color && !next.deco.length && !next.size;
  if (!empty || wantDeco) {
    // @ 이름(\f@size 등)을 쓰는 경우가 있어 한 줄씩 makeatletter로 감싼다
    out = appendBeforeEndinput(out, `${pieces.join('')} ${MARK_PREFIX} ${el} ${stringifySpec(next)}`);
  }
  return { sty: out, tex: outTex };
}

// 문서를 처음 읽을 때 쓰는 현재 상태 표(cmdMap용)
export function readAllElementStyles(sty) {
  const o = {};
  for (const el of Object.keys(ELEMENTS)) { const v = readElementStyle(sty, el); if (v !== undefined) o[`${el}Style`] = v; }
  return o;
}

// 특수문자만 서체·색 바꾸기 — 본문 속 특수문자를 \imprintSym{…}로 감싸고, 모양(서체 계열·색)은 sty의 \imprintSym 정의 한 줄(% imprintSym)로 정한다.
// 기본은 전부 적용하고, 항목별로 뺄 수 있다. 항목: sym(기호류 ★●→※…) · quote(따옴표 ‘’“”「」) · bracket(괄호 ()) · punct(쉼표·마침표·물음표·느낌표·쌍점·말줄임·줄표) · num(원문자·번호 ①②③).
// 사용자가 말하는 번호: 1=기호류, 2=문장부호(따옴표·괄호·나머지), 3=번호(원문자).
import { TEXT_COLORS, FACE_MODES } from './styHighlight.js';
import { mapSafeLines, fixLocaleLine } from './texSafe.js';
import { decoChanges } from './nlStyle.js';
import { composeJamo } from './jamo.js';
import { SERIF_FONTS, SANS_FONTS, findFontByName } from './styFonts.js';

export const SYMBOL_CATS = ['sym', 'quote', 'bracket', 'punct', 'num'];
export const CAT_LABEL = { sym: '기호류', quote: '따옴표', bracket: '괄호', punct: '쉼표·마침표 등 문장부호', num: '번호(원문자)' };
const GROUP = { 1: ['sym'], 2: ['quote', 'bracket', 'punct'], 3: ['num'] };
const MARK = '% imprintSym';

const RE = {
  sym: /[★☆●○◎◇◆□■▲△▼▽→←↑↓↔※•‣◦♥♡♦♠♣✓✔✕✖†‡§¶©®™°±×÷≠≤≥∞♪♫]/g,
  quote: /[‘’“”「」『』《》〈〉]/g,
  bracket: /[()（）]/g,
  // 쉼표·마침표 등은 명령 안(1.5pt 같은 숫자)을 건드리지 않게 글자 바로 뒤에 붙은 것만
  punct: /(?<=[가-힣A-Za-z’”)])[,.?!:;](?=\s|$|[가-힣‘“(])|[…—–·]/g,
  num: /[①-⓿❶-➓㉑-㊿]/g,
};

function appendBeforeEndinput(sty, text) {
  if (/\\endinput\s*$/.test(sty)) return sty.replace(/\\endinput\s*$/, `${text}\n\\endinput\n`);
  return sty + '\n' + text + '\n';
}

const parse = str => {
  const o = { font: null, color: null, skip: [], deco: [] };
  for (const part of String(str || '').split(';')) {
    const [k, v] = part.split('=');
    if (k === 'font' && v) o.font = v;
    else if (k === 'color' && v) o.color = v;
    else if (k === 'skip' && v) o.skip = v.split('/').filter(x => SYMBOL_CATS.includes(x));
    else if (k === 'deco' && v) o.deco = v.split('/').filter(x => FACE_MODES[x]);
  }
  return o;
};
const stringify = o => `font=${o.font || ''};color=${o.color || ''};skip=${(o.skip || []).join('/')};deco=${(o.deco || []).join('/')}`;

export function readSymbolStyle(sty) {
  const m = String(sty).match(/% imprintSym (\S+)/);
  return m ? m[1] : undefined;
}

const colorExpr = c => {
  if (!c) return null;
  if (TEXT_COLORS[c]) return TEXT_COLORS[c].expr;
  const d = String(c).match(/^dark(\d+)$/);
  return d ? `black!${Math.max(5, Math.min(100, Number(d[1])))}` : null;
};

// 새 설정을 지금 설정에 합친다(말한 것만 바꾸고 나머지는 유지). 'off'면 끈다.
export function mergeSymbolSpec(currentStr, patchStr) {
  if (patchStr === 'off') return null;
  const cur = parse(currentStr), p = parse(patchStr);
  const hasSkipField = /skip=/.test(String(patchStr));
  const hasDeco = /deco=/.test(String(patchStr));
  return { font: p.font ?? cur.font, color: p.color ?? cur.color, skip: hasSkipField ? p.skip : cur.skip, deco: hasDeco ? p.deco : cur.deco };
}

// patch: 'font=sans;color=red;skip=num' 형태(일부만 있어도 됨) 또는 'off'. { sty, tex }를 돌려준다.
export function applySymbolStyle(sty, tex, patch) {
  const cur = readSymbolStyle(sty);
  const spec = mergeSymbolSpec(cur, patch);
  let outSty = String(sty).replace(/^.*% imprintSym.*\r?\n?/gm, '');
  // 이미 감싼 것은 벗기고 다시 감싼다
  let outTex = fixLocaleLine(String(tex)).replace(/\\imprintSym\{([^{}]*)\}/g, '$1');
  if (!spec || (!spec.font && !spec.color && !spec.deco.length)) return { sty: outSty, tex: outTex };
  // 서체 이름(나눔명조·본명조·돋움 등)을 말했으면 그 폰트를 특수문자 전용 서체(\imprintSymFont)로 따로 정의한다. sans/serif는 현재 고딕·명조 계열
  const named = SERIF_FONTS[spec.font] || SANS_FONTS[spec.font];
  const fontDef = named ? namedFontLine(named) : '';
  const fam = named ? '\\imprintSymFont ' : spec.font === 'sans' ? '\\sffamily ' : spec.font === 'serif' ? '\\rmfamily ' : '';
  const ce = colorExpr(spec.color);
  let inner = ce ? `\\textcolor{${ce}}{#1}` : '#1';
  for (const dk of spec.deco) inner = FACE_MODES[dk].replace('#1', () => inner);   // 굵게·기울임·밑줄·취소선을 몇 개든 겹쳐 쓴다
  const needUlem = spec.deco.includes('underline') || spec.deco.includes('strike');
  const def = `{${fam}${inner}}`;
  outSty = appendBeforeEndinput(outSty,
    `${fontDef}${ce ? '\\RequirePackage{xcolor}' : ''}${needUlem ? '\\RequirePackage[normalem]{ulem}' : ''}\\providecommand{\\imprintSym}[1]{#1}\\renewcommand{\\imprintSym}[1]${def} ${MARK} ${stringify(spec)}`);
  const at = outTex.indexOf('\\begin{document}');
  const head = at < 0 ? '' : outTex.slice(0, at);
  let body = at < 0 ? outTex : outTex.slice(at);
  for (const cat of SYMBOL_CATS) {
    if (spec.skip.includes(cat)) continue;
    body = mapSafeLines(body, l => l.replace(RE[cat], m => `\\imprintSym{${m}}`));
  }
  return { sty: outSty, tex: head + body };
}

export const countSymbols = tex => (String(tex).match(/\\imprintSym\{/g) || []).length;

// ── 자연어 ────────────────────────────────────────────────────────────────
const TRIGGER = /(특수\s*문자|특수\s*기호|기호|문장\s*부호)/;
// 특수문자 전용 폰트 정의 — fonts/ 폴더 폰트(Path)는 그대로, TeX Live 한글 폰트는 파일 이름으로
function namedFontLine(f) {
  if (f.path) return `\\newfontfamily\\imprintSymFont{${f.path.name}}[Path=./fonts/,Extension=${f.path.ext},UprightFont=${f.path.up},BoldFont=${f.path.bold}]`;
  return `\\newfontfamily\\imprintSymFont{${f.hangul[0]}}${f.hangul[1] ? `[${f.hangul[1]}]` : ''}`;
}
const FONT_WORDS = [[/(고딕|산세리프|sans)/i, 'sans'], [/(명조|바탕|세리프|serif)/i, 'serif']];
const COLOR_WORDS = [[/(빨간|빨강|붉은|레드)/, 'red'], [/(파란|파랑|블루)/, 'blue'], [/(초록|녹색|연두|그린)/, 'green'], [/(주황|오렌지)/, 'orange'], [/(분홍|핑크)/, 'pink'], [/(회색|그레이)/, 'gray']];
const NAMED_CATS = [
  ['sym', /(기호류|기호|도형|화살표|별표|동그라미\s*기호)/],
  ['quote', /(따옴표)/],
  ['bracket', /(괄호)/],
  ['punct', /(쉼표|마침표|물음표|느낌표|쌍점|말줄임|줄표|점|콤마|문장\s*부호)/],
  ['num', /(원문자|번호|숫자\s*기호|동그라미\s*숫자)/],
];
const STEPS = [8, 15, 25, 40, 55];

// 뺄 항목: "3번만 빼줘", "2번 빼고", "문장부호는 빼고", "따옴표랑 괄호 빼줘"
function excludedCats(m) {
  const out = new Set();
  for (const x of m.matchAll(/([1-3])\s*번\s*(?:만|은|는|이랑|랑|하고|과|와)?\s*(?:만\s*)?(?:빼|제외|말고|적용\s*하지)/g)) GROUP[x[1]].forEach(c => out.add(c));
  // "1번이랑 3번 빼줘"
  const nums = [...m.matchAll(/([1-3])\s*번/g)].map(x => x[1]);
  if (/(빼|제외|말고)/.test(m) && nums.length > 1) nums.forEach(n => GROUP[n].forEach(c => out.add(c)));
  const exTail = m.match(/([가-힣0-9 ,·및와과랑이랑하고]+?)\s*(?:은|는|만)?\s*(?:빼고|빼줘|빼\s*주|제외|말고|적용\s*하지\s*말)/);
  if (exTail) for (const [cat, re] of NAMED_CATS) if (re.test(exTail[1])) out.add(cat);
  return out;
}
// 이것만: "기호만", "따옴표만" — 나머지를 뺀다
function onlyCats(m) {
  if (/(빼|제외|말고)/.test(m)) return null;
  const only = new Set();
  const mm = m.match(/([가-힣0-9 ,·및와과랑이랑하고]+?)\s*만\s*(?:서체|폰트|글꼴|글씨체|색|색상|컬러|고딕|명조|빨|파|초록|주황|분홍|회색|바꿔|바꾸|해)/);
  if (mm) for (const [cat, re] of NAMED_CATS) if (re.test(mm[1]) && !/특수\s*문자|특수\s*기호/.test(mm[1])) only.add(cat);
  for (const x of m.matchAll(/([1-3])\s*번\s*만/g)) GROUP[x[1]].forEach(c => only.add(c));
  return only.size ? only : null;
}

export function planSymbol(msg = '', cmdMap = {}) {
  const m = composeJamo(String(msg));
  if (!TRIGGER.test(m)) return null;
  if (/(각주|주석)\s*(?:번호|숫자|표시)/.test(m) && !/(특수\s*문자|특수\s*기호)/.test(m)) return null; // 각주 번호는 별도 항목
  if (/(원래대로|해제|취소|없애|지워)/.test(m) && /(특수\s*문자|기호|문장\s*부호)/.test(m) && !/(빼|제외)/.test(m) && !/(굵|볼드|기울|이탤릭|밑줄|취소선|언더라인)/.test(m)) return { patches: { symbolStyle: 'off' } };
  let font = (FONT_WORDS.find(([re]) => re.test(m)) || [])[1] || null;
  // "나눔명조로", "돋움체로"처럼 서체 이름을 말하면 그 서체(기본 바탕·프리텐다드는 명조/고딕 계열 그대로)
  const nm = findFontByName(m.replace(/특수\s*문자|특수\s*기호|문장\s*부호/g, ' '));
  if (nm && !['batang', 'pretendard'].includes(nm.id)) font = nm.id;
  let color = (COLOR_WORDS.find(([re]) => re.test(m)) || [])[1] || null;
  const cur = parse(cmdMap.symbolStyle);
  if (!color && /(연하|흐리|옅)/.test(m)) {
    const curD = /^dark(\d+)$/.test(cur.color || '') ? Number(cur.color.slice(4)) : 100;
    color = 'dark' + Math.max(10, curD - STEPS[2]);
  } else if (!color && /(진하|검정|까맣)/.test(m) && /(색|연|진하|검정)/.test(m)) {
    const curD = /^dark(\d+)$/.test(cur.color || '') ? Number(cur.color.slice(4)) : 100;
    color = /검정|까맣/.test(m) ? 'dark100' : 'dark' + Math.min(100, curD + STEPS[2]);
  }
  const excl = excludedCats(m);
  const only = onlyCats(m);
  const hasSkip = excl.size > 0 || !!only;
  // 서체·색·제외 항목 중 하나는 있어야 한다
  const dc = decoChanges(m);
  const decoOn = dc.add.length > 0 || dc.remove.length > 0;
  if (!font && !color && !hasSkip && !decoOn) return null;
  const parts = [];
  if (decoOn) parts.push(`deco=${[...new Set([...cur.deco, ...dc.add])].filter(x => !dc.remove.includes(x)).join('/')}`);
  if (font) parts.push(`font=${font}`);
  if (color) parts.push(`color=${color === 'dark100' ? 'dark100' : color}`);
  if (only) parts.push(`skip=${SYMBOL_CATS.filter(c => !only.has(c)).join('/')}`);
  else if (excl.size) parts.push(`skip=${[...new Set([...cur.skip, ...excl])].join('/')}`);
  // "전부 다"처럼 항목을 다시 넣으라는 말: 빼기 목록을 비운다
  if (!hasSkip && /(전부|다\s|모두|전체)/.test(m) && cur.skip.length) parts.push('skip=');
  return { patches: { symbolStyle: parts.join(';') }, font, color, skip: excl };
}

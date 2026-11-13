// 요소별 색·꾸밈(굵게·기울임·밑줄·취소선)을 자연어에서 한 번에 읽는다. (API 호출 없음)
//   요소: 본문·제목·부제목·각주·면주·쪽번호·본문 속 각주 번호·따옴표 안 글자·"따옴표 아닌" 본문
//   "각주만 파랑", "쪽번호만 초록으로", "제목 빨강에 밑줄", "따옴표 안 빨강 + 굵게 + 밑줄", "각주 번호만 빨간색", "따옴표 아닌 내용만 빨갛게"
import { ELEMENTS, DECOS, parseSpec, stringifySpec } from './styElement.js';
import { elementsIn } from './nlColor.js';
import { detectIntensity } from './nlIntensity.js';
import { HL_COLORS } from './styHighlight.js';
import { composeJamo } from './jamo.js';

export const HUE_WORDS = [
  ['red', /(빨간|빨강|붉은|레드|빨갛)/], ['blue', /(파란|파랑|파랗|블루)/], ['green', /(초록|녹색|그린|연두)/],
  ['orange', /(주황|오렌지)/], ['pink', /(분홍|핑크)/], ['purple', /(보라|퍼플)/], ['brown', /(갈색|브라운)/],
  ['navy', /(남색|네이비)/], ['yellow', /(노랑|노란)/], ['gray', /(회색|그레이)/],
];
const BLACK_RE = /(검정|검은\s*색|까맣|검게|원래\s*색|기본\s*색)/;
const DECO_WORDS = [
  ['bold', /(굵게|굵은|볼드|두껍게|bold)/i], ['italic', /(기울임체|기울임|기울여|기울|이탤릭체|이탤릭|이탈릭|비스듬|italic)/i],
  ['underline', /(밑줄|언더라인|underline)/i], ['strike', /(취소선|가운데\s*줄|삭제선|strike)/i],
];
const REMOVE_AFTER = /\s*(?:은|는|도|만|을|를)?\s*(?:빼|없애|지워|해제|제거|꺼|끄|풀어|취소(?!선))/;
const LIGHTER = /(연하게|연한|흐리게|흐린|옅게|옅은|희미|흐릿|엷게)/;
const DARKER = /(진하게|짙게|또렷하게|선명하게)/;
const STEPS = [8, 15, 25, 40, 55];
const SIZE_STEPS = [1.15, 1.3, 1.5, 1.8, 2.2];

export const hueOf = m => (HUE_WORDS.find(([, re]) => re.test(m)) || [])[0] || null;

// 말에서 꾸밈 켜기/끄기를 읽는다. "밑줄 빼고"는 끄기, 그 외는 켜기
export function decoChanges(m) {
  const add = [], remove = [];
  for (const [d, re] of DECO_WORDS) {
    const hit = m.match(re);
    if (!hit) continue;
    const after = m.slice(hit.index + hit[0].length);
    if (new RegExp(`^${REMOVE_AFTER.source}`).test(after)) remove.push(d); else add.push(d);
  }
  return { add, remove };
}

// 대상 요소 — 따옴표 안/아닌, 본문 속 각주 번호, 일반 요소
function targetsOf(m) {
  if (/(특수\s*문자|특수\s*기호|문장\s*부호)/.test(m)) return { kind: 'skip' };                       // 특수문자는 별도 처리(symbolStyle)
  if (/(구분선|가로줄|각주\s*위\s*(?:에|의)?\s*(?:줄|선))/.test(m)) return { kind: 'skip' };          // 각주 구분선은 구분선 항목이 처리한다
  if (/따옴표\s*(?:가\s*)?(?:아닌|말고|이외|외의|밖|제외|빼고)|따옴표를?\s*(?:제외|빼고)|(?:따옴표|인용)[^,.\n]{0,12}?(?:제외|빼고|말고|이외|외의|아닌)/.test(m)) return { kind: 'nonquote' };
  if (/(따옴표|인용|‘|“)/.test(m) && !/(각주|주석|제목|쪽\s*번호|면주)/.test(m)) return { kind: 'quote' };
  const mark = /각주\s*(?:숫자|번호|표시)|위첨자/.test(m) && !/(밑|아래|목록|하단)\s*(?:에\s*있는\s*)?(?:각주)/.test(m);
  if (mark) return { kind: 'els', els: ['mark'] };
  const els = elementsIn(m);
  return els.length ? { kind: 'els', els } : null;
}

const colorField = (cur, m, hue) => {
  if (hue) return hue;
  if (BLACK_RE.test(m)) return '';                                        // 검정 = 색 해제
  const { level } = detectIntensity(m);
  const step = STEPS[Math.max(1, Math.min(5, level)) - 1];
  const parts = String(cur.color || '').match(/^([a-z]+)(?:!(\d+))?$/);
  const num = /^\d+(\.\d+)?$/.test(String(cur.color || '')) ? Number(cur.color) : null;
  if (LIGHTER.test(m)) {
    if (parts) return `${parts[1]}!${Math.max(10, (parts[2] ? Number(parts[2]) : 100) - step)}`;
    return String(Math.max(10, (num ?? 100) - step));
  }
  if (DARKER.test(m)) {
    if (parts) { const n = (parts[2] ? Number(parts[2]) : 100) + step; return n >= 100 ? parts[1] : `${parts[1]}!${n}`; }
    return String(Math.min(100, (num ?? 100) + step));
  }
  return undefined;
};

// 반환: null | { patches: {noteStyle: 'color=…;deco=…;size=…', …}, targets }
export function planStyle(msg = '', cmdMap = {}) {
  const m = composeJamo(String(msg)).replace(/각\s+주/g, '각주').replace(/주\s+석/g, '주석').replace(/주석/g, '각주');
  const t = targetsOf(m);
  if (!t || t.kind === 'skip') return null;
  const hue = hueOf(m);
  const { add, remove } = decoChanges(m);
  const hasBlack = BLACK_RE.test(m) && /색|검정|검은|까맣|원래|기본/.test(m);
  // 진하게/연하게는 색 말이거나 이미 색이 있는 요소일 때만 색으로 본다(그 외 "진하게"는 굵기)
  const toneWord = LIGHTER.test(m) || DARKER.test(m);
  const wantsSize = /(크게|키워|키우|작게|줄여|줄이|확대|축소)/.test(m);
  const bgWord = /(형광펜|하이라이트|배경\s*색|칠해)/.test(m);

  if (t.kind === 'quote' || t.kind === 'nonquote') {
    const curTok = String(cmdMap.quoteHighlight || 'off').split(/[+|,]/).filter(x => x && x !== 'off');
    let faces = curTok.filter(x => DECOS.includes(x));
    let base = curTok.find(x => !DECOS.includes(x)) || null;
    if (t.kind === 'quote') {
      if (!hue && !hasBlack && !add.length && !remove.length && !bgWord && !(toneWord && base)) return null;
      faces = [...new Set([...faces, ...add])].filter(f => !remove.includes(f));
      if (hue) base = bgWord ? (HL_COLORS[hue] ? hue : (hue === 'blue' ? 'blue' : 'yellow')) : `text:${hue}`;
      else if (bgWord) base = 'yellow';
      else if (hasBlack) base = null;
      const mode = [base, ...faces].filter(Boolean).join('+');
      return { patches: { quoteHighlight: mode || 'off' }, targets: ['quote'] };
    }
    // 따옴표 아닌 내용만: 본문 색·꾸밈을 바꾸고, 따옴표 구절은 그 색을 받지 않게 기본색으로 고정한다
    if (!hue && !add.length && !remove.length && !hasBlack) return null;
    const cur = parseSpec(cmdMap.bodyStyle);
    const spec = { color: hue || (hasBlack ? '' : cur.color), deco: [...new Set([...cur.deco, ...add])].filter(d => !remove.includes(d)), size: cur.size };
    const patches = { bodyStyle: stringifySpec(spec) };
    patches.quoteHighlight = ['reset', ...faces].join('+'); // 따옴표 구절은 항상 기본색으로 고정(이미 빨강이었어도 "아닌 쪽만" 요청이므로 해제)
    return { patches, targets: ['body', 'nonquote'] };
  }

  const patches = {};
  for (const el of t.els) {
    if (!ELEMENTS[el]) continue;
    const legacy = cmdMap[`${el}Color`];
    const cur = parseSpec(cmdMap[`${el}Style`] ?? (legacy !== undefined ? `color=${legacy}` : ''));
    // 연하게는 색 말이다. 진하게는 굵기와 헷갈리므로 색이 이미 있거나 '색'을 말했을 때만 색으로 본다
    const tone = (LIGHTER.test(m) || (DARKER.test(m) && (hue || cur.color || /색|컬러/.test(m)))) ? colorField(cur, m, null) : undefined;
    const color = hue || hasBlack ? colorField(cur, m, hue) : tone;
    // 각주 번호는 굵기 항목이 따로 없어서 "진하게"를 굵게로 읽는다(색을 따로 말하지 않았고 색도 아직 없을 때)
    if (el === 'mark' && DARKER.test(m) && !hue && !cur.color && !/색|컬러/.test(m) && !add.includes('bold')) add.push('bold');
    // 일반 요소의 굵게/굵기 해제는 기존 굵기 항목(제목 굵게·본문 볼드 빼기 등)이 처리한다 — 여기서는 다른 꾸밈과 같이 말했을 때만 굵게를 더한다
    const rem = el === 'mark' ? remove : remove.filter(d => d !== 'bold');
    const decoChanged = add.length > 0 || rem.length > 0;
    let size;
    if (el === 'mark' && wantsSize) {
      const { level } = detectIntensity(m);
      const step = SIZE_STEPS[Math.max(1, Math.min(5, level)) - 1];
      const base = cur.size || 1;
      size = Math.max(0.5, Math.min(3, Math.round((/(작게|줄여|줄이|축소)/.test(m) ? base / step : base * step) * 100) / 100));
    }
    // 굵게만 말한 일반 요소는 기존 굵기 항목(제목 굵게·각주 굵게 등)이 처리한다
    const onlyBold = color === undefined && size === undefined && add.length === 1 && add[0] === 'bold' && !remove.length && el !== 'mark';
    if (color === undefined && !decoChanged && size === undefined) continue;
    if (onlyBold) continue;
    // 밑줄·취소선은 본문 전체에는 걸 수 없다(각주·제목 등과 충돌)
    const deco = [...new Set([...cur.deco, ...add.filter(d => !(el === 'body' && (d === 'underline' || d === 'strike')))])].filter(d => !rem.includes(d));
    const next = { color: color === undefined ? cur.color : color, deco, size: size === undefined ? cur.size : size };
    // 바뀐 항목만 값에 담는다(나머지는 현재 값 유지)
    const parts = [];
    if (color !== undefined) parts.push(`color=${next.color || ''}`);
    if (decoChanged || (el === 'body' && add.length)) parts.push(`deco=${next.deco.join('/')}`);
    if (size !== undefined) parts.push(`size=${next.size ?? ''}`);
    if (parts.length) patches[`${el}Style`] = parts.join(';');
  }
  return Object.keys(patches).length ? { patches, targets: t.els } : null;
}

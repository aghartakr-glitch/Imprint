// 자연어 색 요청 → *Color 값(검정의 진하기 %). 단계표로 직접 계산한다. (API 호출 없음)
//  · "면주 색상 연하게", "각주 흐리게", "쪽번호 옅게" → 현재 값에서 단계만큼 연하게
//  · "제목 검정으로", "각주 회색으로", "면주 연한 회색" → 정해진 값
import { COLOR_ELEMENTS } from './styColor.js';
import { detectIntensity } from './nlIntensity.js';

const ELEMENT_RES = [
  ['rh', /(면주|머리말|머릿글|머리글|러닝\s*헤드|헤더)/],
  ['pn', /(쪽\s*번호|페이지\s*(?:번호|숫자)|쪽수)/],
  ['note', /(각주|주석)/],
  ['h2', /(부제목|부제|소제목|서브\s*(?:타이틀|제목))/],
  ['h1', /(제목|타이틀|표제)/],
  ['body', /(본문|글자|글씨|텍스트)/],
];
const LIGHTER = /(연하게|연한|흐리게|흐린|옅게|옅은|희미|흐릿|엷게|연해|옅어)/;
const DARKER = /(진하게|짙게|까맣게|검게|또렷하게|선명하게|진해)/;
const COLORWORD = /(색상|색깔|색|컬러|회색|그레이|검정|검은|까맣|흑색)/;
const STEPS = [8, 15, 25, 40, 55];

export const hasColorRequest = msg => {
  const m = String(msg);
  if (/(구분선|가로줄|따옴표|형광펜)/.test(m)) return false; // 구분선·따옴표 글자색은 따로 처리한다
  return (LIGHTER.test(m) || (DARKER.test(m) && COLORWORD.test(m)) || /(회색|그레이|검정|검은\s*색|흑색)/.test(m))
    && !/(굵|두껍|얇)/.test(m);
};

export function elementsIn(msg) {
  const m = String(msg);
  const els = [];
  for (const [el, re] of ELEMENT_RES) if (re.test(m)) els.push(el);
  // 제목·부제목이 같이 잡히면 더 구체적인 쪽만, 본문은 글자·글씨가 다른 요소와 함께 나온 말이면 뺀다
  if (els.includes('h2') && els.includes('h1') && !/(제목\s*(?:과|와|이랑|하고|,)\s*부제)|(?:제목.*부제목.*(?:모두|둘\s*다))/.test(m)) els.splice(els.indexOf('h1'), 1);
  if (els.length > 1 && els.includes('body') && !/본문/.test(m)) els.splice(els.indexOf('body'), 1);
  return els;
}

// 반환: null | { patches: {rhColor: 70}, elements: ['rh'] }
export function planColorEdit(msg = '', cmdMap = {}) {
  const mk = String(msg);
  // "본문에 있는 각주 숫자를 연하게" — 각주 문장이 아니라 본문 속 위첨자 숫자의 색이다("밑에 각주는 건들지 말고"는 각주 문장을 그대로 둔다)
  if (/각주\s*(?:숫자|번호|표시)/.test(mk) && /(연하|흐리|옅|진하|짙|회색|그레이|검정|까맣|색)/.test(mk)
      && !/(밑|아래|목록)\s*(?:에\s*있는\s*)?각주\s*(?:숫자|번호)/.test(mk)) {
    const cur = Number(cmdMap.footnoteMarkColor ?? 100);
    const { level } = detectIntensity(mk);
    const L = Math.max(1, Math.min(5, level)) - 1;
    if (/(연하|흐리|옅|희미)/.test(mk)) return { patches: { footnoteMarkColor: String(Math.max(10, cur - STEPS[L])) }, elements: ['mark'], level };
    if (/(검정|까맣|검게)/.test(mk)) return { patches: { footnoteMarkColor: '100' }, elements: ['mark'], level };
    if (/(진하|짙)/.test(mk)) return { patches: { footnoteMarkColor: String(Math.min(100, cur + STEPS[L])) }, elements: ['mark'], level };
    if (/(회색|그레이)/.test(mk)) return { patches: { footnoteMarkColor: '55' }, elements: ['mark'], level };
  }
  // "각주 진하게" — 이미 연하게 만든 요소를 다시 진하게 하는 말은 굵기가 아니라 색이다
  if (/(진하게|짙게)/.test(mk) && !COLORWORD.test(mk) && !/(굵|두껍|볼드)/.test(mk)) {
    const lighter = elementsIn(mk).filter(el => Number(cmdMap[COLOR_ELEMENTS[el].key] ?? 100) < 100);
    if (lighter.length) {
      const { level } = detectIntensity(mk);
      const L = Math.max(1, Math.min(5, level)) - 1;
      const patches = {};
      for (const el of lighter) patches[COLOR_ELEMENTS[el].key] = String(Math.min(100, Number(cmdMap[COLOR_ELEMENTS[el].key]) + STEPS[L]));
      return { patches, elements: lighter, level };
    }
  }
  if (!hasColorRequest(msg)) return null;
  const els = elementsIn(msg);
  if (!els.length) return null;
  const m = String(msg);
  const patches = {};
  const { level } = detectIntensity(m);
  for (const el of els) {
    const key = COLOR_ELEMENTS[el].key;
    const cur = Number(cmdMap[key] ?? 100);
    let next;
    if (/연한\s*(회색|그레이)|옅은\s*(회색|그레이)/.test(m)) next = 30;
    else if (/진한\s*(회색|그레이)/.test(m)) next = 75;
    else if (/(회색|그레이)/.test(m) && !LIGHTER.test(m) && !DARKER.test(m)) next = 55;
    else if (/(검정|검은\s*색|흑색|까맣|검게)/.test(m) && !LIGHTER.test(m)) next = 100;
    else if (LIGHTER.test(m)) next = Math.max(10, cur - STEPS[level - 1]);
    else if (DARKER.test(m)) next = Math.min(100, cur + STEPS[level - 1]);
    else continue;
    patches[key] = String(next);
  }
  return Object.keys(patches).length ? { patches, elements: els, level } : null;
}

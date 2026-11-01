// 여백 4면(상·하·안쪽(내측)·바깥쪽(외측))을 각각 늘리고 줄이는 요청을 절·면 단위로 읽는다. (API 호출 없음)
//   "안쪽은 늘리고 바깥쪽은 줄여줘", "위아래는 줄이고 좌우는 늘려줘", "상단 늘리고 하단 줄여줘",
//   "바깥 여백은 그대로 안쪽만 늘려줘", "사방 여백 각각 조금씩 줄여줘"
// 왼쪽/오른쪽은 쪽(홀·짝)에 따라 안쪽·바깥쪽이 뒤바뀌므로 추측하지 않고 되묻는다.
import { synthesizePatches, detectIntensity, hasExplicitAmount } from './nlIntensity.js';

const KEYS = { top: 'marginTop', bottom: 'marginBottom', inner: 'marginInner', outer: 'marginOuter' };
const OTHER_ELEMENT = /(쪽\s*번호|면주|각주|주석|제목|부제|본문|글자|글씨|행간|자간|문단|단어|구분선|표|그림)/;
const CLAUSE_SPLIT = /\s*[,，]\s*|\s*그리고\s*|(?<=[가-힣](?:고|며|면서|는데|인데|지만))\s+/;
const EXCLUDE = /([가-힣]+(?:\s*여백)?)\s*(?:은|는|도)?\s*(?:그대로|유지|놔두고|냅두고|건드리지\s*말고|손\s*대지\s*말고)(?:\s*(?:두고|놔두고|하고|유지하고))?/g;
const INC = /(늘|넓|키우|키워|크게|여유|더\s*줘|많이\s*줘|확보)/;
const DEC = /(줄|좁|작게|적게|없애|얇게)/;
const FORCE_VERB = { 1: '늘려', [-1]: '줄여' };

// 문장에서 말한 면들을 뽑는다. 복합어(위아래·좌우·사방)를 먼저 처리해 낱말과 겹치지 않게 한다.
function sidesIn(text) {
  let t = text;
  const out = new Set();
  const take = (re, ...sides) => { if (re.test(t)) { sides.forEach(s => out.add(s)); t = t.replace(re, ' '); } };
  take(/(상하좌우|사방|네\s*(?:면|방향|군데)|사면|전체\s*여백|모든\s*여백)/, 'top', 'bottom', 'inner', 'outer');
  take(/(위아래|상하)/, 'top', 'bottom');
  take(/(좌우|양옆|양쪽\s*(?:옆|여백))/, 'inner', 'outer');
  take(/(안쪽|안\s*쪽|내측|책등|제본)/, 'inner');
  take(/(바깥쪽|바깥\s*쪽|바깥|외측)/, 'outer');
  take(/(상단|위쪽|윗\s*여백|윗쪽|맨\s*위|위\s*여백|위\s*쪽|위의?\s*여백|위(?=\s*(?:는|은|만|을|를|도|쪽))|위)(?!아래)/, 'top');
  take(/(하단|아래쪽|아랫\s*여백|맨\s*아래|아래\s*여백|아래\s*쪽|밑\s*여백|밑\s*쪽|아래(?=\s*(?:는|은|만|을|를|도|쪽))|밑(?=\s*(?:는|은|만|을|를|도))|아래|밑)/, 'bottom');
  return { sides: [...out], rest: t };
}

export function planMargins(msg = '', cmdMap = {}) {
  const raw = String(msg);
  const hasMargin = /(여백|마진)/.test(raw);
  const explicitSide = /(안쪽|내측|바깥쪽|외측|바깥|상단|하단|위아래|상하|좌우|사방|상하좌우)/.test(raw);
  if (!hasMargin && !explicitSide) return null;
  if (hasExplicitAmount(raw)) return null; // 양을 직접 말했으면(2mm 등) 그 값은 모델/사용자 값을 그대로 쓴다
  if (OTHER_ELEMENT.test(raw.replace(/(여백|마진)/g, ''))) return null; // 다른 요소 얘기가 섞이면 이 계획은 쓰지 않는다
  // 왼쪽·오른쪽(좌우와 다름)은 쪽마다 안쪽/바깥쪽이 바뀐다 — 되묻는다
  if (/(왼쪽|오른쪽|좌측|우측|왼\s*여백|오른\s*여백)/.test(raw) && !/(좌우)/.test(raw)) {
    return { ask: '왼쪽/오른쪽 여백은 쪽(홀수·짝수)에 따라 안쪽·바깥쪽이 뒤바뀜 — 추측하지 말고 "안쪽(책등 쪽) 여백인지 바깥쪽 여백인지" 되물을 것' };
  }
  // "바깥 여백은 그대로"처럼 건드리지 말라는 면은 먼저 걷어낸다
  const excluded = new Set();
  let text = raw.replace(EXCLUDE, (m, who) => { sidesIn(who).sides.forEach(s => excluded.add(s)); return ' '; });
  const clauses = text.split(CLAUSE_SPLIT).map(x => x && x.trim()).filter(Boolean);
  const patches = {};
  // 절마다 면과 방향을 찾는다. 방향이 없는 절은 같은 문장의 다른 절 방향을 쓰지 않는다(반대로 쓰던 원인)
  for (const clause of clauses) {
    const { sides } = sidesIn(clause);
    const inc = INC.test(clause), dec = DEC.test(clause);
    if (!sides.length || inc === dec) continue;
    const dir = inc ? 1 : -1;
    const { level } = detectIntensity(clause);
    const lvlWord = ['아주 조금', '조금', '적당히', '많이', '아주 많이'][Math.min(4, Math.max(0, level - 1))];
    for (const s of sides) {
      if (excluded.has(s)) continue;
      const r = synthesizePatches(`${FORCE_VERB[dir]} ${lvlWord}`, [KEYS[s]], cmdMap);
      if (r) Object.assign(patches, r.patches);
    }
  }
  // 절이 하나뿐이고 면이 문장 앞에만 있는 말("안쪽만 늘려줘")도 위 루프에서 처리됨. 아무것도 못 정했으면 계획 없음
  return Object.keys(patches).length ? { patches } : null;
}

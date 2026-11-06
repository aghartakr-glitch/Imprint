// 전체 로그 점검에서 모델 판단에만 맡겨져 있던 요청 중 코드로 정할 수 있는 것들. (API 호출 없음)
//  · 굵기: "제목 굵게", "제목이 더 강조되면", "본문 볼드 빼줘"
//  · 정렬: "왼쪽정렬 해줘", "양끝정렬로"
//  · 쪽번호·면주 위치: "쪽번호 아래 바깥쪽, 면주는 아래 안쪽", "면주 좌측 하단으로", "쪽번호 다시 우측으로"
//  · 전체 서체 계열: "전체 고딕으로", "문서 전체 명조로"
import { hasColorRequest } from './nlColor.js';

// ── 굵기 ────────────────────────────────────────────────────────────────
const BOLD_RE = /(굵게|굵은|볼드|두껍게|두꺼운|bold|강조\s*(?:되|해|하|시켜)|돋보이게)/i;
const NORMAL_RE = /(얇게|가늘게|보통\s*굵기|일반\s*굵기|굵기\s*(?:빼|없애|해제)|볼드\s*(?:빼|없애|해제|취소)|굵지\s*않게|normal)/i;
export function planWeight(msg = "") {
  const m = String(msg);
  if (/(따옴표|인용|구분선|형광펜|가로줄|각\s*주\s*위\s*(?:에|의)?\s*(?:줄|선))/.test(m) || hasColorRequest(m)) return null;
  const normal = NORMAL_RE.test(m);
  const bold = !normal && BOLD_RE.test(m); // "볼드 빼줘"는 '볼드'가 들어 있어도 굵기 해제다
  if (bold === normal) return null;
  const value = bold ? 'bold' : 'normal';
  const hasSub = /(부제목|부제|소제목)/.test(m);
  const hasMain = /(?<![소부])(제목|타이틀|표제)/.test(m);
  const patches = {};
  if (hasSub && hasMain) patches.headingWeight = value;
  else if (hasSub) patches.h2Weight = value;
  else if (hasMain) patches.h1Weight = value;
  else if (/(각주|주석)/.test(m)) patches.footnoteWeight = value; // 각주 글자 굵기 (로그: "각주 폰트 굵기도 얇게")
  else if (/본문/.test(m)) patches.bodyWeight = value;
  else return null;
  return { patches };
}

// ── 정렬 ────────────────────────────────────────────────────────────────
export function planAlign(msg = '') {
  const m = String(msg);
  if (/(제목|부제|쪽번호|면주|각주|주석|표|그림|이미지)/.test(m)) return null;
  if (/(왼쪽|좌측)\s*정렬/.test(m)) return { patches: { bodyAlign: 'ragged' } };
  if (/(양끝|양쪽)\s*(?:맞춤|정렬)/.test(m)) return { patches: { bodyAlign: 'justified' } };
  return null;
}

// ── 쪽번호·면주 위치 ──────────────────────────────────────────────────────
const SIDE_RE = [[/(내측|안쪽|안\s*쪽|책등)/, '내측'], [/(외측|바깥|바깥쪽)/, '외측'], [/(가운데|중앙|한가운데)/, '중앙'], [/(우측|오른쪽)/, '우측'], [/(좌측|왼쪽)/, '좌측']];
const CLAUSE_SPLIT = /[ \t]*(?:\r?\n+|;)[ \t]*|\s*[,，]\s*|(?<=[가-힣](?:고|며|면서|는데|인데|지만))\s+|\s*그리고\s*/;
export function planSlotPos(msg = '', cmdMap = {}) {
  const parts = String(msg).split(CLAUSE_SPLIT).map(x => x && x.trim()).filter(Boolean);
  const patches = {};
  let carry = null;
  for (const part of parts) {
    const el = /(쪽\s*번호|페이지\s*번호|쪽수)/.test(part) ? 'pnPos' : /(면주|머리말|머릿글|러닝\s*헤드)/.test(part) ? 'rhPos' : carry;
    if (!el) continue;
    carry = el;
    if (/(색|서체|글꼴|크기|행간|굵|연하|진하|키워|줄여|크게|작게|숨겨|없애|지워)/.test(part)) continue; // 위치가 아닌 요청
    const vert = /(하단|아래|밑|맨\s*아래)/.test(part) ? '하단' : /(상단|위쪽|위로|위에|맨\s*위|위\b)/.test(part) ? '상단' : null;
    const side = (SIDE_RE.find(([re]) => re.test(part)) || [])[1] || null;
    if (!vert && !side) continue;
    const cur = String(patches[el] || cmdMap[el] || '').replace(/\s/g, '');
    const curV = cur.includes('상단') ? '상단' : cur.includes('하단') ? '하단' : null;
    const curS = (SIDE_RE.map(([, s]) => s).find(s => cur.includes(s))) || null;
    // 말하지 않은 쪽(위아래 또는 좌우)은 지금 값을 이어받는다. 아직 값이 없으면 하단·외측
    patches[el] = `${vert || curV || '하단'}-${side || curS || '외측'}`;
  }
  return Object.keys(patches).length ? { patches } : null;
}

// ── 전체 서체 계열 ────────────────────────────────────────────────────────
export function planFamilyAll(msg = '', cmdMap = {}) {
  const m = String(msg);
  if (!/(전체|전부|모두|문서\s*전체|통째로|다\s)/.test(m)) return null;
  const sans = /(고딕|산세리프|돋움)/.test(m), serif = /(명조|바탕|세리프)/.test(m) && !/산세리프/.test(m);
  if (sans === serif) return null;
  if (!/(바꿔|바꾸|변경|로\s*해|으로\s*해|로\s*써|으로\s*써|(?:으?로)\s*$|하고\s*싶)/.test(m)) return null;
  if (/(각주|면주|쪽번호|제목|본문만|서체\s*크기)/.test(m) && !/전체/.test(m)) return null;
  const want = sans ? 'sans' : 'serif';
  const patches = {};
  for (const k of ['bodyFontFamily', 'headingFontFamily', 'footnoteFontFamily', 'rhFontFamily', 'pnFontFamily']) if (cmdMap[k] !== want) patches[k] = want;
  return Object.keys(patches).length ? { patches } : null;
}

// ── 완전히 붙이기 ─────────────────────────────────────────────────────────
// "제목이랑 부제목 완전 붙어야대", "제목 부제목 딱 붙여줘", "문단 사이 아예 붙게" — 강하게 말하면 단계표가 아니라 간격을 0으로 만든다.
// (모델이 "붙어야"를 늘리라는 뜻으로 읽거나 "제어 키가 없다"며 거절한 로그 대응)
const STICK_RE = /(붙(?:여|어|게|이|도록|어야)|딱\s*붙|맞닿|닿게|밀착)/;
const STRONG_RE = /(완전(?:히)?|딱|아예|꽉|전혀|바짝|밀착|붙어야|붙게|붙도록|0\s*(?:으로|pt)|제로|없게)/;
export function planCollapse(msg = '') {
  const m = String(msg);
  const zero = /(0s*(?:pt|포인트)?s*(?:으로|로)|제로|없애|없게|없이)/.test(m) && /(간격|사이)/.test(m);
  if (!((STICK_RE.test(m) && STRONG_RE.test(m)) || zero)) return null;
  if (/(글자|자간|단어|행간|여백|쪽번호|면주|각주\s*번호)/.test(m.replace(/제목|부제/g, ''))) return null;
  const sub = /(부제목|부제|소제목)/.test(m), main = /(?<![소부])(제목|타이틀|표제)/.test(m);
  if (main && sub) return { patches: { headingGap: '0' } };               // 제목↔소제목 사이
  if ((main || sub) && /(본문|내용|글)/.test(m)) return { patches: { bodyGap: '0' } }; // 제목·소제목↔본문 사이
  if (/(문단|단락)/.test(m)) return { patches: { parSkip: '0' } };
  if (/(각주).*(사이|끼리)|각주끼리/.test(m)) return { patches: { footnoteSep: '0' } };
  return null;
}

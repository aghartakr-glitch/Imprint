// 자연어 서체 요청 → serifFont/sansFont 값. 모델이 값을 못 내도 코드가 직접 정한다. (API 호출 없음)
//  · 서체 이름을 말하면 그 서체: "나눔명조로", "본명조", "신문명조", "돋움체로"
//  · "다른 명조", "좀 색다른 고딕"처럼 이름 없이 바꿔 달라면 다음 서체
//  · 분위기로 말하면 어울리는 서체: "손글씨 느낌", "신문 같은", "둥근 고딕"
import { findFontByName, nextFont } from './styFonts.js';

const CHANGE = /(바꿔|바꾸|바꿀|바꾼|변경|교체|써\s*줘|써\s*봐|써\s*볼|써보|쓰고\s*싶|쓰자|적용|로\s*해|으로\s*해|로\s*가|으로\s*가|로\s*하고\s*싶|으로\s*하고\s*싶|로\s*부탁|으로\s*부탁|로\s*좀|으로\s*좀|느낌|스타일로|체로|로\s*만들|으로\s*만들|로\s*바|으로\s*바|해\s*줘|해줘|(?:으?로)\s*[.!?~]*\s*$|했으면|면\s*좋겠|달라|다르게|다른)/;
const SERIF_WORD = /(명조|바탕|(?<!산)세리프|(?<!sans[\s-])serif|신문|궁서|필기|손글씨|붓글씨|캘리|펜글씨|옛글|백묵)/i;
const SANS_WORD = /(고딕|돋움|산세리프|sans|굴림|헤드라인|프리텐다드|디나루|둥근\s*(?:고딕|체)|그래픽체)/i;
const OTHER = /(다른|다르게|색다른|새로운|딴|바꿔|바꾸|변경|교체)/;
const GENERIC_TO = /(명조|고딕|바탕|(?<!산)세리프|산세리프)\s*체?\s*(?:으?로)\s*(?:바꿔|바꾸|변경|해|써|하고|만들|가|좀|만|부탁|[.!?~]*\s*$)/;
const OTHER_ADJ = /(다른|딴|색다른|새로운|특이한)\s*(명조|바탕체?|세리프|고딕|산세리프|서체|글꼴|폰트|글씨체)/;

// 분위기 표현 → 서체 (이름 없이 말했을 때)
const MOODS = [
  [/(손글씨|붓글씨|캘리|필기|손으로\s*쓴)/, 'serif', 'pilgi'],
  [/(신문|뉴스|기사\s*같|일간지)/, 'serif', 'shinmun'],
  [/(궁서|공문서|관공서|임금|고풍|전통|사극)/, 'serif', 'gungseo'],
  [/(펜글씨|만년필)/, 'serif', 'pen'],
  [/(옛글|옛날\s*한글|고어)/, 'serif', 'yetgul'],
  [/(가는|얇은|가벼운|연한)\s*(?:명조|바탕|세리프)/, 'serif', 'notolight'],
  [/(굵은|두꺼운|묵직한|진한)\s*(?:명조|바탕|세리프)/, 'serif', 'notosemibold'],
  [/(부드러운|둥근|따뜻한|친근한)\s*(?:명조|바탕|세리프)/, 'serif', 'nanum'],
  [/(현대적인?|모던한?|깔끔한|산뜻한|세련된)\s*(?:명조|바탕|세리프)/, 'serif', 'noto'],
  [/(디나루|둥근\s*(?:고딕|체)|라운드|귀여운|동글)/, 'sans', 'dinaru'],
  [/(헤드라인|제목체|광고\s*같|포스터\s*같|굵직)/, 'sans', 'headline'],
  [/(가는|얇은|가벼운|연한)\s*(?:고딕|돋움|산세리프)/, 'sans', 'prelight'],
  [/(굵은|두꺼운|묵직한|진한)\s*(?:고딕|돋움|산세리프)/, 'sans', 'presemibold'],
];

// 어느 요소의 서체인지 — 계열 키(FontFamily)를 같이 맞출 때 쓴다
function targetFamilyKey(msg) {
  if (/(각주|주석)/.test(msg)) return 'footnoteFontFamily';
  if (/(면주|머리말|머릿글|러닝헤드|헤더)/.test(msg)) return 'rhFontFamily';
  if (/(쪽\s*번호|페이지\s*(?:번호|숫자)|쪽수)/.test(msg)) return 'pnFontFamily';
  const t = msg.replace(/제목\s*체/g, '');
  const sub = /(부제목|부제|소제목|서브)/.test(t);
  const main = /(?<![소부])(제목|타이틀|표제)/.test(t);
  if (sub && main) return 'headingFontFamily';   // "제목과 부제목 모두"
  if (sub) return 'h2FontFamily';               // 부제목·소제목만
  if (main) return /(제목\s*(?:과|와|이랑|하고)\s*부제|제목.*(?:모두|둘\s*다|전부))/.test(t) ? 'headingFontFamily' : 'h1FontFamily';
  return 'bodyFontFamily';
}

// 반환: null | { patches: {key: value}, role, id, kind: 'named'|'other'|'mood', familyKey }
export function planFontEdit(rawMsg = '', cmdMap = {}) {
  const like = planFontLike(rawMsg);
  if (like) return like;
  // 서체 이름은 정리 전 원문으로 찾는다("헤드라인"·"글씨" 같은 말이 다른 뜻으로 바뀌지 않게). "X 말고 Y"는 Y만 본다
  const msg = String(rawMsg).split(/말고|대신|아니라/).pop();
  if (!msg.trim()) return null;
  // 크기·간격 말이면 서체 요청이 아니다 ("명조 글씨 키워줘")
  const named = findFontByName(msg);
  let mood = MOODS.find(([re]) => re.test(msg));
  if (!mood && !named) {
    const sansW = SANS_WORD.test(msg) && !SERIF_WORD.test(msg); const serifW = SERIF_WORD.test(msg) && !SANS_WORD.test(msg);
    if (sansW || serifW) {
      if (/(얇|가는|가벼|연한)/.test(msg)) mood = [null, sansW ? 'sans' : 'serif', sansW ? 'prelight' : 'notolight'];
      else if (/(굵|두꺼|묵직|진한)/.test(msg) && CHANGE.test(msg)) mood = [null, sansW ? 'sans' : 'serif', sansW ? 'presemibold' : 'notosemibold'];
    }
  }
  const wantsOther = OTHER.test(msg) && (SERIF_WORD.test(msg) || SANS_WORD.test(msg));
  const verb = CHANGE.test(msg) || wantsOther;
  if (!verb) return null;
  if (!named && !mood && !wantsOther && !GENERIC_TO.test(msg)) return null;
  // 이름·분위기 없이 "명조 크기 바꿔줘"처럼 바꿀 속성이 따로 있으면 서체 요청이 아니다
  if (!named && !mood && /(크기|사이즈|간격|행간|자간|여백|정렬|굵기|두께|색상|색깔|글자색)/.test(msg)) return null;

  let role; let id; let kind;
  const adj = msg.match(OTHER_ADJ);
  if (adj && !mood && !/(나눔|본명조|노토|신문|궁서|필기|돋움|굴림|프리텐다드|디나루|백묵)/.test(msg)) {
    role = /(고딕|산세리프)/.test(adj[2]) ? 'sans' : /(서체|글꼴|폰트|글씨체)/.test(adj[2]) ? (SANS_WORD.test(msg) && !SERIF_WORD.test(msg) ? 'sans' : 'serif') : 'serif';
    const cur = role === 'serif' ? (cmdMap.serifFont || 'batang') : (cmdMap.sansFont || 'pretendard');
    id = nextFont(role, cur);
    kind = 'other';
  } else if (named) { role = named.role; id = named.id; kind = 'named'; }
  else if (mood) { role = mood[1]; id = mood[2]; kind = 'mood'; }
  else {
    // "본문 고딕으로 바꿔줘"는 서체 종류가 아니라 계열(명조↔고딕) 전환이라 기존 bodyFontFamily 경로에 맡긴다
    const g = /(다르게|다른|색다른|새로운|딴)/.test(msg) ? null : msg.match(GENERIC_TO);
    if (g) {
      // 계열(명조↔고딕)만 바꾸는 요청 — 지금 이미 그 계열이면 바꿀 것이 없다
      const want = /(고딕|산세리프)/.test(g[1]) ? 'sans' : 'serif';
      const famKey = targetFamilyKey(msg);
      if (cmdMap[famKey] === want) return null;
      return { patches: { [famKey]: want }, role: want, id: want, kind: 'family', familyKey: famKey };
    }
    role = SANS_WORD.test(msg) && !SERIF_WORD.test(msg) ? 'sans' : 'serif';
    const cur = role === 'serif' ? (cmdMap.serifFont || 'batang') : (cmdMap.sansFont || 'pretendard');
    id = nextFont(role, cur);
    kind = 'other';
  }
  const fam = targetFamilyKey(msg);
  const key = role === 'serif' ? 'serifFont' : 'sansFont';
  const patches = { [key]: id };
  // 대상 요소가 반대 계열이면 계열도 맞춘다 — 본문이 고딕인데 "나눔명조로" 하면 본문도 명조로
  const wantFam = role === 'serif' ? 'serif' : 'sans';
  const curFam = cmdMap[fam];
  if (curFam !== undefined ? curFam !== wantFam : fam !== 'bodyFontFamily') patches[fam] = wantFam;
  return { patches, role, id, kind, familyKey: fam };
}

// "각주 서체를 부제랑 같게" — A의 서체 계열·굵기를 B의 것과 맞춘다. 값은 '대상:기준'(예: note:h2)
const EL_RES = [
  ['rh', /(면주|머리말|머릿글|러닝\s*헤드|헤더)/], ['pn', /(쪽\s*번호|페이지\s*번호|쪽수)/], ['note', /(각주|주석)/],
  ['h2', /(부제목|부제|소제목|서브\s*(?:타이틀|제목))/], ['h1', /(?<![소부])(제목|타이틀|표제)/], ['body', /(본문)/],
];
const SAME = /(같게|같은|동일|똑같|맞춰|통일|일치)/;
export function planFontLike(msg = '') {
  const m = String(msg);
  if (!SAME.test(m) || !/(서체|글꼴|폰트|글씨체|글자체)/.test(m)) return null;
  const hits = EL_RES.map(([el, re]) => { const x = m.match(re); return x ? { el, at: x.index } : null; }).filter(Boolean).sort((a, b) => a.at - b.at);
  if (hits.length < 2) return null;
  // 먼저 나온 요소가 바꿀 대상, 그 다음이 기준 ("각주 서체를 부제랑 같게")
  const [target, source] = hits;
  if (target.el === source.el) return null;
  return { patches: { fontSameAs: target.el + ':' + source.el }, role: 'same', id: source.el, kind: 'same', familyKey: target.el };
}

export const patchText = patches => Object.entries(patches).map(([k, v]) => `${k}=${v}`).join(',');

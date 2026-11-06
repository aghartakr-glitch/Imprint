// 자연어 수정의 강도(아주 조금 < 조금 < 적당히 < 많이 < 아주 많이)와 방향(늘림/줄임)을 읽고,
// 단계마다 수치가 확실히 달라지도록 최종 값을 코드가 정한다.
// 예전에는 강도를 프롬프트 문장 하나로만 모델에 맡겨서 "많이"라고 해도 "조금"과 비슷한 값(약 5~10%)이 나왔다.
// 모델은 대상 키와 방향만 고르고, 크기는 여기서 단계표대로 다시 계산한다.

export const LEVEL_NAMES = ['', '아주 조금', '조금', '적당히', '많이', '아주 많이'];

// 말투를 하나로 모은다 — 같은 뜻의 다른 말(동의어)과 어미(줄였으면/줄일/컸으면)를 기본형으로 바꾼 문장을 돌려준다.
// 예전에는 "행간 줄여줘"처럼 아주 기본적인 말도 규칙에 "줄이"만 있어서 안 잡혔다.
// 뜻에서 빠지는 부분을 먼저 지운다 — "제목은 놔두고 본문만", "줄이지 말고 키워줘", "제목을 본문보다 크게"
// 안 지우면 제외하려던 대상(제목)이나 부정된 방향(줄이)이 그대로 잡혀서 엉뚱한 값이 같이 바뀐다.
const PRUNE = [
  // 부정된 방향: "줄이지 말고 키워줘", "작게 말고 크게 해줘" → 말한 쪽만 남긴다
  [/(작게|크게|좁게|넓게|줄이|줄여|키우|키워|늘리|늘려|넓히|넓혀|좁히|좁혀|높이|높여|낮추|낮춰)(?:지|게)?\s*말고\s*/g, ''],
  // 제외 대상: "제목은 놔두고", "각주는 그대로 두고", "본문 빼고", "면주 말고"
  [/[가-힣A-Za-z0-9]+(?:은|는|을|를|이|가)?\s*(?:그대로\s*(?:두고|놔두고|유지하고|냅두고)|놔두고|냅두고|내버려\s*두고|건드리지\s*말고|빼고|제외하고|말고)(?!\s*싶)[,\s]*/g, ''],
  // 비교 기준이 된 대상: "제목을 본문보다 크게"에서 "본문보다"는 바꾸는 대상이 아니다
  [/(?:본문|제목|소제목|각주|면주|쪽번호|글자|행간)\s*보다\s*/g, ''],
  // "한 페이지에 더 많이 들어가게" — 담기는 양을 말한 것이지 바꾸는 정도가 아니다
  [/(?:더\s*)?많이\s*(?:들어가|담기|담게|들어갈|실리|실을)\S*/g, ''],
];
const SYNONYMS = [
  [/sub\s*title|sub\s*heading/gi, '소제목'],
  [/font\s*size/gi, '본문 글자 크기'],
  [/line\s*height|line\s*spacing|leading/gi, '행간'],
  [/letter\s*spacing|tracking|kerning/gi, '자간'],
  [/margins?/gi, '여백'],
  [/foot\s*notes?/gi, '각주'],
  [/page\s*numbers?/gi, '쪽번호'],
  [/paragraph\s*(?:spacing|gap)/gi, '문단 간격'],
  [/\b(?:title|heading|headline)\b/gi, '제목'],
  [/책등\s*쪽?|제본\s*쪽/g, '안쪽 '],
  // 띄어 쓴 낱말("각 주", "주 석")을 붙인다 — 로그에서 "각 주 위에 줄 넣어줘", "하단 주 석은 지워줘"가 항목을 못 찾았다
  [/각\s+주(?=\s|[을를은는이가의에도만]|$)/g, '각주'], [/주\s+석/g, '주석'],
  [/주석/g, '각주'],
  [/구[붆붑불분]s*선|구분s*서ㄴ/g, '구분선'],
  [/덜\s*튀게|튀지\s*않게|덜\s*눈에\s*띄게|차분하게|약하게\s*보이게/g, '작게'],
  [/머리말|머릿글|머리글|러닝\s*헤드|헤더/g, '면주'],
  [/페이지\s*(숫자|번호|넘버)|쪽\s*수(?!정)|쪽\s*숫자/g, '쪽번호'],
  [/대제목|타이틀|헤드라인|표제/g, '제목'],
  [/서브\s*타이틀|서브\s*제목/g, '소제목'],
  [/텍스트\s*(크기|사이즈)|내용\s*(글자|글씨)\s*(크기)?|폰트\s*(크기|사이즈)|글자\s*사이즈|글씨\s*사이즈/g, '본문 글자 크기'],
  [/폰트(?!\s*(?:를|을)?\s*(?:바꿔|바꾸|변경|교체))/g, '글자'],
  [/줄\s*높이|라인\s*(?:간격|높이|스페이싱)|줄\s*띄우기|행\s*간격|줄\s*사이\s*간격/g, '행간'],
  [/트래킹|커닝|글자\s*(?:사이\s*)?간격|글자\s*사이\s*간격/g, '자간'],
  [/마진|테두리\s*여백|가장자리/g, '여백'],
  [/띄우기/g, '간격'],
  [/줄\s*간격/g, '행간'],
  [/줄s*간격/g, '행간'],
];
const CONJUGATIONS = [
  [/줄였|줄일/g, '줄여'], [/키웠|키울/g, '키워'], [/늘렸|늘릴/g, '늘려'], [/넓혔|넓힐/g, '넓혀'], [/좁혔|좁힐/g, '좁혀'],
  [/높였|높일/g, '높여'], [/낮췄|낮출/g, '낮춰'], [/벌렸|벌릴/g, '벌려'], [/띄웠|띄울/g, '띄워'], [/붙였|붙일/g, '붙여'],
  [/올렸|올릴/g, '올려'], [/내렸|내릴/g, '내려'],
  // 연결형·의지형 어미("키우고", "줄이며", "넓히려고")는 명령형 뿌리로 맞춰야 항목 찾기와 방향 읽기가 같이 된다
  [/키우(?=고|며|면서|면|는|려|자)/g, '키워'], [/줄이(?=고|며|면서|면|는|려|자)/g, '줄여'], [/늘리(?=고|며|면서|면|는|려|자)/g, '늘려'],
  [/넓히(?=고|며|면서|면|는|려|자)/g, '넓혀'], [/좁히(?=고|며|면서|면|는|려|자)/g, '좁혀'], [/높이(?=고|며|면서|면|는|려|자)/g, '높여'],
  [/낮추(?=고|며|면서|면|는|려|자)/g, '낮춰'], [/벌리(?=고|며|면서|면|는|려|자)/g, '벌려'],
  [/커졌|컸/g, '크게 '], [/작아졌|작았/g, '작게 '], [/넓어졌|넓었/g, '넓게 '], [/좁아졌|좁았/g, '좁게 '],
];
export function normalizeMsg(msg = '') {
  let t = String(msg);
  for (const [re, to] of PRUNE) t = t.replace(re, to);
  for (const [re, to] of SYNONYMS) t = t.replace(re, to);
  for (const [re, to] of CONJUGATIONS) t = t.replace(re, to);
  // 글자 사이를 말하는 불평 → 자간 ("글자들이 너무 붙어 있어", "글자 사이가 벌어져 있어"), 복수형·붙여 쓴 조사 정리
  t = t.replace(/글자(?:들|끼리)?(?:이|가)?\s*(?:사이(?:가|이)?\s*)?(?=(?:너무\s*|좀\s*)?(?:붙|벌어|떨어|빽빽|촘촘|겹))/g, '자간 ');
  t = t.replace(/글자\s*사이(?:가|이)?/g, '자간 ').replace(/문단들/g, '문단');
  t = t.replace(/(간격|크기|여백|행간|자간)(좀|만)(?=\s|$|[가-힣])/g, '$1 $2');
  // 상태만 말한 불평("너무 작아서", "여백이 많아서")은 반대 방향 동작으로 바꿔 읽는다 — 이미 방향 동사가 있으면 그대로 둔다
  if (!INC.test(t) && !DEC.test(t)) {
    // 글자 크기를 말한 상태("작아", "커서")만 크기 동사를 붙이고, 간격·여백·빽빽함은 '늘려/줄여'만 붙여 다른 항목(각주 크기 등)이 같이 잡히지 않게 한다
    if (STATE_INC.test(t) && !STATE_DEC.test(t)) t += STATE_SIZE.test(t) ? ' 키워 늘려' : ' 늘려';
    else if (STATE_DEC.test(t) && !STATE_INC.test(t)) t += STATE_SIZE.test(t) ? ' 줄여 작게' : ' 줄여';
  }
  return t;
}
const STATE_SIZE = /(작아|작은데|작네|작다|커서|큰데|크네|크다)/;
const STATE_INC = /(작고|좁고|적고|짧고|작아|작은데|작네|작다|좁아|좁은데|좁네|좁다|적어|적은데|없어|없는데|없네|붙어|빽빽|답답|촘촘|얇아|가늘어|부족|줄었)/;
const STATE_DEC = /(크고|넓고|많고|길고|커서|큰데|크네|크다|넓어|넓은데|넓네|넓다|많아|많은데|많네|허전|휑|벌어져|벌어|길어|두꺼워|굵어|과해|거슬|늘었)/;

// 5단계: 아주 많이 → 많이 → 아주 조금 → 조금 → 적당히 순으로 검사한다("아주 조금"이 "조금"에, "아주 많이"가 "많이"에 걸리지 않게).
const LEVEL_PATTERNS = [
  [5, /(?:완전|진짜|아주|매우|엄청|너무){2,}|(아주|매우|굉장히|엄청|완전|진짜|훨씬|한껏)\s*(더\s*)?(많이|크게|대폭|확|세게|넓게|좁게|작게|길게|짧게|넓혀|좁혀|키워|줄여|늘려|굵게|연하게|흐리게|진하게|얇게|가늘게|두껍게)|엄청(나게)?|겁나|최대한|극단|극적|과감(하게|히)|훨씬|거의\s*(없애|안\s*보|0)|최소(한|로)|사전처럼|동화(책)?처럼|포스터처럼/],
  [4, /(?:잡지|카탈로그)처럼|많이|대폭|상당히|꽤|제법|한참|넉넉(히|하게)|듬뿍|쫙|쭉|팍|빡|화끈하게|확\s*(키워|키우|줄여|줄이|늘려|늘리|넓혀|넓히|좁혀|좁히|바꿔|바꾸|벌려|벌리|띄워|띄우|올려|올리|내려|내리|높여|낮춰|크게|작게|넓게|좁게|굵게)|크게\s*(키워|늘려|넓혀)/],
  [1, /아주\s*(조금|살짝|약간|미세)|아주조금|살짝|미세(하게|히)?|찔끔|티\s*(안|도)\s*나게|극미|눈치\s*못\s*챌/],
  [2, /조금|약간|소폭|살며시|좀만|조금씩|한\s*(칸|단계)만/],
  [3, /적당(히|하게)|알맞게|보통|무난(하게|히)|적절(히|하게)|좀(?!만)/],
];

// 강도 표현이 없으면 "적당히"(3단계)로 본다. word가 null이면 기본값이라는 뜻.
export function detectIntensity(msg = '') {
  const text = normalizeMsg(msg);
  for (const [level, re] of LEVEL_PATTERNS) {
    const m = text.match(re);
    if (m) return { level, word: m[0] };
  }
  return { level: 3, word: null };
}

// 사용자가 양을 직접 말한 경우(1.2배, 2mm, 한 포인트, 10%) — 이때는 모델이 그 값을 쓰게 두고 단계표를 쓰지 않는다.
export function hasExplicitAmount(msg = '') {
  return /\d+(\.\d+)?\s*(pt|mm|em|cm|px|%|퍼센트|프로|배|포인트|칸|줄|단계|밀리|미리|센티|센치)/i.test(msg)
    || /(한|두|세|네|다섯)\s*(포인트|칸|줄|배|단계|밀리|센티)/.test(msg)
    || /-?\d+(\.\d+)?\s*(으로|로)(?!\S*\s*[단열])/.test(msg);   // "자간 -3으로" 처럼 값만 말한 경우
}

// "위아래 여백 같게", "원래대로"처럼 값 사이의 관계나 복원을 말하는 요청 — 키별로 단계표를 적용하면 관계가 깨진다.
export function isRelationalRequest(msg = '') {
  return /(같게|똑같|동일하게|맞춰|맞추|통일|균등|원래대로|원래\s*값|기본값|처음\s*(상태|대로)|초기화)/.test(msg)
    // "제목을 본문보다 크게" — 다른 항목과의 비교는 값을 기준 항목에서 읽어야 하므로 모델이 정한다 ("아까보다/지금보다"는 비교가 아니라 후속 발화)
    || /(본문|제목|소제목|각주|면주|쪽번호|글자|행간)\s*보다/.test(msg);
}

// "줄이 너무 빽빽해"의 명사 "줄이", "글자 높이"의 명사 "높이"를 동사로 오인하지 않도록 어간은 어미(고/면/자/는/세요/기…)가 붙을 때만 인정한다.
const E = '(?:고|면|자|는|세요|기|겠|려|라)';
const INC = new RegExp(`(?:공백|여백|간격)(?:을|를)?\\s*(?:많이|좀|조금|더)?\\s*넣|(?:많이|더|넉넉히|넉넉하게|충분히)\\s*(?:줘|주세요|주라|줘봐)|키워|키우${E}|크게|커지게|늘려|늘리${E}|넓혀|넓히${E}|넓게|벌려|벌리${E}|띄워|띄우${E}|올려|올리${E}|높여|높이${E}|굵게|진하게|두껍게|두텁게|강하게|세게|확대|증가|여유롭게|널널하게`);
const DEC = new RegExp(`줄여|줄이${E}|작게|좁혀|좁히${E}|좁게|촘촘하게|빽빽하게|붙여|붙이${E}|내려|내리${E}|낮춰|낮추${E}|얇게|가늘게|연하게|약하게|축소|감소|없애|지워|제거`);

// 문장에 명시된 방향. 늘림(+1)과 줄임(-1)이 둘 다 있거나 없으면 0 — 이때는 모델이 정한 방향을 그대로 쓴다.
export function detectDirection(msg = '') {
  const t = normalizeMsg(msg);
  const inc = INC.test(t), dec = DEC.test(t);
  if (inc && !dec) return 1;
  if (dec && !inc) return -1;
  return 0;
}

// ── 키별 단계표 ─────────────────────────────────────────────
const SIZE = [0.02, 0.05, 0.10, 0.20, 0.35];   // 글자 크기: 현재값 대비 비율
const LEAD = [0.03, 0.07, 0.12, 0.25, 0.45];   // 행간
const SPACE = [0.03, 0.08, 0.15, 0.30, 0.50];  // 여백·간격

// kind 'rel': 현재값 × 비율(base가 있으면 현재값이 그보다 작을 때 base를 기준으로) / 'abs': 현재값에 더하거나 뺌
const SPEC = {
  bodySize:    { kind: 'rel', steps: SIZE, min: 6,  max: 24, dec: 2 },
  bodyLeading: { kind: 'rel', steps: LEAD, min: 6,  max: 48, dec: 2, leader: 'bodySize' },
  noteSize:    { kind: 'rel', steps: SIZE, min: 5,  max: 16, dec: 2 },
  noteLeading: { kind: 'rel', steps: LEAD, min: 5,  max: 32, dec: 2, leader: 'noteSize' },
  footnoteSize:    { kind: 'rel', steps: SIZE, min: 5, max: 16, dec: 2 },
  footnoteLeading: { kind: 'rel', steps: LEAD, min: 5, max: 32, dec: 2, leader: 'footnoteSize' },
  h1Size:      { kind: 'rel', steps: SIZE, min: 8,  max: 72, dec: 2 },
  h1Leading:   { kind: 'rel', steps: LEAD, min: 8,  max: 90, dec: 2, leader: 'h1Size' },
  h2Size:      { kind: 'rel', steps: SIZE, min: 8,  max: 60, dec: 2 },
  h2Leading:   { kind: 'rel', steps: LEAD, min: 8,  max: 75, dec: 2, leader: 'h2Size' },
  h3Size:      { kind: 'rel', steps: SIZE, min: 8,  max: 48, dec: 2 },
  h3Leading:   { kind: 'rel', steps: LEAD, min: 8,  max: 60, dec: 2, leader: 'h3Size' },
  pnSize:      { kind: 'rel', steps: SIZE, min: 5,  max: 16, dec: 2 },
  pnLeading:   { kind: 'rel', steps: LEAD, min: 5,  max: 32, dec: 2, leader: 'pnSize' },
  rhSize:      { kind: 'rel', steps: SIZE, min: 5,  max: 16, dec: 2 },
  rhLeading:   { kind: 'rel', steps: LEAD, min: 5,  max: 32, dec: 2, leader: 'rhSize' },
  marginTop:    { kind: 'rel', steps: SPACE, min: 3, max: 60, dec: 1 },
  marginBottom: { kind: 'rel', steps: SPACE, min: 3, max: 80, dec: 1 },
  marginInner:  { kind: 'rel', steps: SPACE, min: 3, max: 50, dec: 1 },
  marginOuter:  { kind: 'rel', steps: SPACE, min: 3, max: 50, dec: 1 },
  headingGap:  { kind: 'rel', steps: SPACE, min: 0, max: 80, dec: 1, base: 6 },
  bodyGap:     { kind: 'rel', steps: SPACE, min: 0, max: 100, dec: 1, base: 8 },
  footnoteSep: { kind: 'rel', steps: SPACE, min: 0, max: 40, dec: 1, base: 4 },
  footinsSkip: { kind: 'rel', steps: SPACE, min: 2, max: 60, dec: 1, base: 8 },
  colGap:      { kind: 'rel', steps: SPACE, min: 2, max: 30, dec: 1, base: 5 },
  parIndent:   { kind: 'rel', steps: SPACE, min: 0, max: 4,  dec: 2, base: 1 },
  // 0이 기본값인 키는 비율이 의미 없어서 더하거나 뺀다
  letterSpace: { kind: 'abs', steps: [0.5, 1.5, 3, 6, 10],        min: -5,  max: 25, dec: 2 },   // em의 %
  wordSpace:   { kind: 'abs', steps: [0.02, 0.05, 0.10, 0.18, 0.30], min: -0.15, max: 0.6, dec: 3 }, // em
  parSkip:     { kind: 'abs', steps: [1, 2, 4, 7, 11],            min: 0,   max: 40, dec: 1 },   // pt
  headingSpaceBefore: { kind: 'abs', steps: [2, 4, 8, 14, 22],    min: 0,   max: 80, dec: 1 },   // pt
  pnXShift:    { kind: 'abs', steps: [0.5, 1, 2, 3.5, 5],         min: -30, max: 30, dec: 1 },   // mm
  pnYShift:    { kind: 'abs', steps: [0.5, 1, 2, 3.5, 5],         min: -30, max: 30, dec: 1 },
  rhXShift:    { kind: 'abs', steps: [0.5, 1, 2, 3.5, 5],         min: -30, max: 30, dec: 1 },
  rhYShift:    { kind: 'abs', steps: [0.5, 1, 2, 3.5, 5],         min: -30, max: 30, dec: 1 },
};

export const SCALABLE_KEYS = Object.keys(SPEC);

const num = v => (v === undefined || v === null || v === '' ? NaN : Number(v));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round = (x, d) => Number(x.toFixed(d));

// 현재값 cur에서 방향 dir(+1/-1), 단계 level로 옮긴 새 값. 계산할 수 없으면 null.
export function stepValue(key, cur, dir, level, stepsOverride) {
  const spec = SPEC[key];
  if (!spec || !dir) return null;
  const steps = stepsOverride || spec.steps;
  const c = Number.isFinite(cur) ? cur : (spec.kind === 'abs' ? 0 : NaN);
  if (!Number.isFinite(c)) return null;
  const amount = spec.kind === 'abs' ? steps[level - 1] : steps[level - 1] * Math.max(c, spec.base ?? 0);
  const next = round(clamp(c + dir * amount, spec.min, spec.max), spec.dec);
  return next === c ? null : next;
}

// 모델이 낸 sty_patch 값(patches)을 단계표에 맞게 다시 계산한다.
// 방향은 모델 값이 현재값에서 움직인 쪽을 따르고, 안 움직였으면 문장에 명시된 방향을 쓴다.
// 문장에 방향이 하나로 명시돼 있는데 모델이 반대로 움직였으면 문장을 따른다.
export function scalePatches(patches, cmdMap = {}, msg = '') {
  if (hasExplicitAmount(msg) || isRelationalRequest(msg)) return { patches, notes: [], skipped: true };
  const { level } = detectIntensity(msg);
  const msgDir = detectDirection(msg);
  const out = { ...patches };
  const notes = [];
  const dirs = {};
  for (const key of Object.keys(patches)) {
    const spec = SPEC[key];
    if (!spec) continue;
    const cur = num(cmdMap[key]);
    const next = num(patches[key]);
    if (!Number.isFinite(next)) continue;
    if (!Number.isFinite(cur) && spec.kind !== 'abs') continue;
    const base = Number.isFinite(cur) ? cur : 0;
    let dir = Math.sign(next - base);
    if (msgDir && dir !== msgDir) dir = msgDir;
    if (!dir) continue;
    dirs[key] = dir;
  }
  for (const key of Object.keys(dirs)) {
    const spec = SPEC[key];
    // 크기와 행간을 같이 바꿀 때는 행간도 크기와 같은 비율로 움직여서 행간/크기 비율이 유지된다
    const stepsOverride = spec.leader && dirs[spec.leader] === dirs[key] ? SPEC[spec.leader].steps : undefined;
    const cur = num(cmdMap[key]);
    const v = stepValue(key, cur, dirs[key], level, stepsOverride);
    if (v === null) continue;
    out[key] = String(v);
    notes.push(`${key}: ${Number.isFinite(cur) ? cur : 0} → ${v} (${LEVEL_NAMES[level]})`);
  }
  return { patches: out, notes, level };
}

// 모델이 sty_patch를 하나도 안 냈을 때(거부하거나 말로만 답했을 때), 문장에서 읽은 키·방향·강도로 직접 만든다.
// 크기 키가 있으면 짝이 되는 행간 키도 같이 움직여 행간 비율을 유지한다.
export function synthesizePatches(msg, keys, cmdMap = {}) {
  if (hasExplicitAmount(msg) || isRelationalRequest(msg)) return null;
  const dir = detectDirection(msg);
  if (!dir) return null;
  const { level } = detectIntensity(msg);
  const targets = [...new Set((keys || []).filter(k => SPEC[k]))];
  if (targets.length === 0 || targets.length > 4) return null;
  const pairs = { bodySize: 'bodyLeading', noteSize: 'noteLeading', footnoteSize: 'footnoteLeading', h1Size: 'h1Leading', h2Size: 'h2Leading', h3Size: 'h3Leading', pnSize: 'pnLeading', rhSize: 'rhLeading' };
  const all = [...targets];
  for (const k of targets) if (pairs[k] && !all.includes(pairs[k]) && Number.isFinite(num(cmdMap[pairs[k]]))) all.push(pairs[k]);
  const patches = {};
  const notes = [];
  for (const key of all) {
    const spec = SPEC[key];
    const cur = num(cmdMap[key]);
    const stepsOverride = spec.leader && all.includes(spec.leader) ? SPEC[spec.leader].steps : undefined;
    const v = stepValue(key, cur, dir, level, stepsOverride);
    if (v === null) continue;
    patches[key] = String(v);
    notes.push(`${key}: ${Number.isFinite(cur) ? cur : 0} → ${v}`);
  }
  if (Object.keys(patches).length === 0) return null;
  return {
    patches, notes, level, dir,
    text: Object.entries(patches).map(([k, v]) => `${k}=${v}`).join(','),
  };
}

// "더 줄여줘", "줄여달라고"처럼 대상 없이 방향·강도만 말한 짧은 후속 발화인가.
export function isFollowUp(msg = '', hintCount = 0) {
  if (hintCount > 0) return false;
  const compact = String(msg).replace(/[\s.!?~]+/g, '');
  return compact.length > 0 && compact.length <= 14 && detectDirection(msg) !== 0;
}

// 자연어 수정 표현 → sty_patch 키 매핑 (정확히 100개 표현)
// 모델 호출 직전에 사용자 문장을 이 표와 대조해 "표현 → 키 후보" 힌트를 붙인다.
// 키가 없는 요청(key: null)은 힌트로 "미지원: 이유"를 달아 모델이 임의 값을 만들지 않게 한다.
// 각 항목의 sample은 test_nlKnobAliases.js가 실제로 매칭되는지 확인하는 대표 문장이다.

export const KNOB_ALIASES = [
  // ── 본문 크기·행간·문단 (1~18) ─────────────────────────────────
  { key: 'bodySize', re: /본문.*(키워|키우|크게|커지|크기\s*(를)?\s*(올|늘려|키))/, sample: '본문 글씨 좀 키워줘' },
  { key: 'bodySize', re: /본문.*(작게|줄여|줄이|작아)/, sample: '본문 글씨 작게 해줘' },
  { key: 'bodySize', re: /(글씨|글자).*(너무\s*)?작아\s*보/, sample: '글씨가 너무 작아 보여' },
  { key: 'bodyLeading', re: /행간.*(넓|늘|띄|여유|숨)/, sample: '행간 좀 넓혀줘' },
  { key: 'bodyLeading', re: /행간.*(좁|줄이|빽빽|촘촘)/, sample: '행간 좀 좁혀줘' },
  { key: 'bodyLeading', re: /줄\s*간격.*(넓|늘)/, sample: '줄 간격 넓게 해줘' },
  { key: 'bodyLeading', re: /줄\s*사이.*(벌려|넓)/, sample: '줄 사이 좀 벌려줘' },
  { key: 'bodyLeading', re: /(답답|빽빽)\s*해?.*(행간|줄)|(행간|줄).*(답답|빽빽)/, sample: '줄이 빽빽해 보여' },
  { key: 'bodyLeading', re: /숨\s*쉴\s*공간/, sample: '숨 쉴 공간 좀 줘' },
  { key: 'parSkip', re: /문단.*(사이|간격).*(넓|늘|벌|띄)/, sample: '문단 사이를 띄워줘' },
  { key: 'parSkip', re: /문단(끼리|\s*사이).*(붙|좁)/, sample: '문단끼리 너무 붙어 있어' },
  { key: 'parSkip', re: /단락\s*(사이|간격)/, sample: '단락 사이 간격 넓혀줘' },
  { key: 'parSkip', re: /문단.*(구분|나뉘).*(잘|확실|되게)/, sample: '문단이 잘 구분되게 해줘' },
  { key: 'parIndent', re: /들여쓰기.*(통일|맞춰|같게)/, sample: '들여쓰기 통일해줘' },
  { key: 'parIndent', re: /들여쓰기.*(크게|넓|깊게)/, sample: '들여쓰기 더 넓게' },
  { key: 'parIndent', re: /들여쓰기.*(없애|빼|삭제|제거)/, sample: '들여쓰기 빼줘' },
  { key: 'parIndent', re: /첫\s*줄.*(들여|인덴트)/, sample: '문단 첫 줄 들여쓰기 조정해줘' },

  // ── 자간·단어 간격·하이픈·정렬 (19~33) ─────────────────────────
  { key: 'letterSpace', re: /자간.*(좁|줄이|빽빽|촘촘)/, sample: '자간 좁혀줘' },
  { key: 'letterSpace', re: /자간.*(넓|늘|벌리|띄)/, sample: '자간 넓혀줘' },
  { key: 'letterSpace', re: /글자\s*(사이|간격).*(좁|붙)/, sample: '글자 사이 조금 좁혀줘' },
  { key: 'letterSpace', re: /글자가?\s*(붙어|겹쳐)\s*보/, sample: '글자가 붙어 보여' },
  { key: 'wordSpace', re: /단어\s*(사이|간격)/, sample: '단어 사이 간격 좀 줄여줘' },
  { key: 'wordSpace', re: /띄어쓰기.*(벌|넓|유난)/, sample: '띄어쓰기가 너무 벌어져 있어' },
  { key: 'wordSpace', re: /낱말\s*(사이|간격)/, sample: '낱말 사이가 벌어져 보여' },
  { key: 'wordSpace', re: /공백.*(벌|넓|유난|크|커)/, sample: '공백이 너무 커' },
  { key: 'wordSpace', re: /어절\s*사이/, sample: '어절 사이 좁혀줘' },
  { key: 'hyphenation', re: /하이픈|하이폰|분철/, sample: '하이픈 빼줘' },
  { key: 'hyphenation', re: /단어.*(나뉘|쪼개|끊)/, sample: '단어가 어색하게 쪼개져' },
  { key: 'bodyAlign', re: /왼쪽\s*정렬|좌측\s*정렬|라그드|ragged/i, sample: '왼쪽 정렬로 바꿔줘' },
  { key: 'bodyAlign', re: /양쪽\s*정렬|균등\s*정렬/, sample: '양쪽 정렬로 가지런하게 해줘' },
  { key: 'bodyFontFamily', re: /고딕|산세리프|sans/i, sample: '본문 서체를 고딕으로 바꿔줘' },
  { key: 'bodyFontFamily', re: /명조|세리프|바탕체|serif/i, sample: '본문을 명조로 바꿔줘' },

  // ── 본문 굵기 (34~35) ──────────────────────────────────────────
  { key: 'bodyWeight', re: /본문.*(굵|진하|두껍|볼드)/, sample: '본문을 좀 진하게 해줘' },
  { key: 'bodyWeight', re: /본문.*(얇|가늘|연하|가볍)/, sample: '본문을 얇게 해줘' },

  // ── 제목·소제목 (36~53) ────────────────────────────────────────
  { key: 'headingWeight', re: /제목.*(아주|훨씬|확실히|블랙|black|제일).*(굵|진하|두껍)/i, sample: '제목을 아주 굵게 해줘' },
  { key: 'headingWeight', re: /제목.*(굵|진하|두껍|볼드)/, sample: '제목 굵게 해줘' },
  { key: 'headingWeight', re: /제목.*(얇|가늘|연하)/, sample: '제목 얇게 해줘' },
  { key: 'h2Weight', re: /소제목.*(굵|진하)/, sample: '소제목만 굵게 해줘' },
  { key: 'h2Weight', re: /소제목.*(얇|가늘)/, sample: '소제목 얇게 해줘' },
  { key: 'h2Weight', re: /소제목.*(묻히|묻혀|안\s*보|눈에\s*안)/, sample: '소제목이 본문에 묻혀 보여' },
  { key: 'h3Weight', re: /소소제목|세부\s*제목|절\s*제목.*(굵|진하)/, sample: '절 제목 굵게 해줘' },
  { key: 'h2Size', re: /소제목.*(크게|키워)/, sample: '소제목 키워줘' },
  { key: 'h2Size', re: /소제목.*(작게|줄여|작아)/, sample: '소제목 작게 해줘' },
  { key: 'h1Size', re: /제목.*(크게|키워|힘|강조)/, sample: '제목 힘을 키워줘' },
  { key: 'h1Size', re: /제목.*(작게|줄여)/, sample: '제목 좀 작게 해줘' },
  { key: 'h1Leading', re: /제목.*(행간|줄간격)/, sample: '제목 행간 줄여줘' },
  { key: 'h2Leading', re: /소제목.*(행간|줄간격)/, sample: '소제목 행간 넓혀줘' },
  { key: 'headingAlign', re: /제목.*(가운데|중앙)/, sample: '제목 가운데로 옮겨줘' },
  { key: 'headingAlign', re: /제목.*(왼쪽|좌측)/, sample: '제목 왼쪽으로 옮겨줘' },
  { key: 'headingAlign', re: /제목.*(오른쪽|우측)/, sample: '제목 오른쪽으로 옮겨줘' },
  { key: 'headingAlign', re: /제목\s*정렬.*(기본|기본값)/, sample: '제목 정렬 기본값으로' },
  { key: 'headingGap', re: /제목.*(소제목|부제).*(사이|간격)/, sample: '제목과 소제목 간격 좀 줄여줘' },
  { key: 'bodyGap', re: /(제목|소제목).*본문.*(간격|사이)/, sample: '제목 아래 본문 간격 넓혀줘' },
  { key: 'headingSpaceBefore', re: /(제목|소제목)\s*위.*(여백|간격)/, sample: '소제목 위쪽 여백 늘려줘' },
  { key: 'headingKeepLines', re: /(소제목|제목).*(혼자|맨\s*아래|고립)/, sample: '소제목이 페이지 맨 아래 혼자 남지 않게 해줘' },

  // ── 각주 (54~65) ───────────────────────────────────────────────
  { key: 'noteSize', re: /각주.*(키워|크게|커)/, sample: '각주 글씨 조금 키워줘' },
  { key: 'noteSize', re: /각주.*(작게|줄여|작아)/, sample: '각주 글씨 작게 해줘' },
  { key: 'noteLeading', re: /각주.*(행간|줄간격)/, sample: '각주 행간 줄여줘' },
  { key: 'footnoteSep', re: /(각주\s*(항목|끼리|사이)|각주끼리|각주.*(항목|사이)).*(간격|띄|좁|붙|떨어)/, sample: '각주끼리 너무 떨어져 있어' },
  { key: 'footinsSkip', re: /(본문|글).*각주.*(간격|여백|띄)/, sample: '본문이랑 각주 사이 띄워줘' },
  { key: 'footinsSkip', re: /각주.*(위|아래).*(옮|내려|올려|붙)/, sample: '각주 좀 아래로 내려줘' },
  { key: 'footnoteMarker', re: /각주.*번호.*(대괄호|괄호|\[1\])/, sample: '각주 번호를 대괄호로 바꿔줘' },
  { key: 'footnoteMarker', re: /각주.*번호.*(점|1\.)/, sample: '각주 번호를 점 형식으로 바꿔줘' },
  { key: 'footnoteRule', re: /각주.*(구분선|가로줄|선)\s*(넣|추가|그어|보이)/, sample: '각주 위에 구분선 넣어줘' },
  { key: 'footnoteRule', re: /각주.*(구분선|가로줄|선).*(빼|없애|지워)/, sample: '각주 구분선 빼줘' },
  { key: null, reason: '각주를 특정 쪽에서만 다르게 배치하는 설정이 없음', re: /각주.*(쪽|페이지).*(위치|배치|옮)/, sample: '각주를 이 페이지에서만 위로 옮겨줘' },

  // ── 쪽번호·면주 (66~84) ────────────────────────────────────────
  { key: 'pnPos', re: /쪽\s*번호.*(하단|아래|밑|바닥)/, sample: '쪽번호 아래로 내려줘' },
  { key: 'pnPos', re: /쪽\s*번호.*(상단|위쪽)/, sample: '쪽번호 위쪽으로 올려줘' },
  { key: 'pnPos', re: /쪽\s*번호.*(가운데|중앙)/, sample: '쪽번호 하단 중앙으로 옮겨줘' },
  { key: 'pnPos', re: /쪽\s*번호.*(바깥|외측)/, sample: '쪽번호 바깥쪽으로 빼줘' },
  { key: 'pnPos', re: /쪽\s*번호.*(안쪽|내측)/, sample: '쪽번호 안쪽으로 옮겨줘' },
  { key: 'pnPos', re: /쪽\s*번호.*(오른쪽|우측)/, sample: '쪽번호 오른쪽으로 옮겨줘' },
  { key: 'pnPos', re: /쪽\s*번호.*(왼쪽|좌측)/, sample: '쪽번호 왼쪽으로 옮겨줘' },
  { key: 'pnPos', re: /쪽\s*번호.*(없애|지워|빼|끄)/, sample: '쪽번호 없애줘' },
  { key: 'pnSize', re: /쪽\s*번호.*(작게|줄여|작아)/, sample: '쪽번호 작게 해줘' },
  { key: 'pnSize', re: /쪽\s*번호.*(크게|키워)/, sample: '쪽번호 크게 해줘' },
  { key: 'pnXShift', re: /쪽\s*번호.*(좌우|가로).*(옮|이동|밀)/, sample: '쪽번호 좌우로 조금 옮겨줘' },
  { key: 'pnYShift', re: /쪽\s*번호.*(세로|높이|위아래).*(옮|이동|올|내)/, sample: '쪽번호 세로로 조금 올려줘' },
  { key: 'rhPos', re: /면주.*(없애|빼|지워|끄)/, sample: '면주 없애줘' },
  { key: 'rhPos', re: /면주.*(켜|넣어|살려|보이게)/, sample: '면주 다시 넣어줘' },
  { key: 'rhText', re: /면주.*(문구|내용|텍스트|글귀)\s*(바꿔|변경|넣어)/, sample: '면주 문구 바꿔줘' },
  { key: 'rhSize', re: /면주.*(작게|줄여|작아)/, sample: '면주 작게 해줘' },
  { key: 'rhSize', re: /면주.*(크게|키워)/, sample: '면주 크게 해줘' },
  { key: 'rhSize', re: /면주.*(눈에\s*띄|튀|강해)/, sample: '면주가 너무 눈에 띄어' },
  { key: 'rhPos', re: /면주.*(위치|자리|옮)/, sample: '면주 위치 옮겨줘' },
  { key: null, reason: '면주 굵기를 바꾸는 키가 없음 (크기만 rhSize로 조절 가능)', re: /면주.*(굵|진하)/, sample: '면주 굵기 좀 줄여줘' },

  // ── 여백·단 (85~92) ────────────────────────────────────────────
  { key: 'marginTop', re: /(위|상)\s*(쪽\s*)?(여백|마진)|상단\s*여백/, sample: '위쪽 여백 좀 늘려줘' },
  { key: 'marginBottom', re: /(아래|하)\s*(쪽\s*)?(여백|마진)|하단\s*여백/, sample: '아래 여백 넓혀줘' },
  { key: 'marginInner', re: /(안쪽|안|내측)\s*여백|제본.*(여백|안쪽)/, sample: '제본 때문에 안쪽 여백을 늘려줘' },
  { key: 'marginOuter', re: /(바깥|밖|외측)\s*여백/, sample: '바깥 여백 줄여줘' },
  { key: 'marginTop', re: /위아래\s*여백.*같/, sample: '위아래 여백을 같게 해줘' },
  { key: 'colGap', re: /단\s*(간격|사이)|칼럼\s*간격/, sample: '단 사이를 넓혀줘' },
  { key: null, reason: '단 수(1단·2단 전환)를 바꾸는 키가 없음 (재생성 필요)', re: /(1|한|일)\s*단|단\s*수|두\s*단.*(바꿔|없애)/, sample: '1단으로 바꿔줘' },

  // ── 미지원·주의 항목 (93~100) ──────────────────────────────────
  { key: null, reason: '과부·고아줄은 이미 penalty 10000으로 막혀 있음 — 실제 PDF 확인 필요', re: /과부|고아|외로운\s*(줄|행)|마지막\s*(한\s*)?줄.*(넘어|다음)/, sample: '문단 마지막 한 줄이 다음 쪽으로 넘어가지 않게 해줘' },
  { key: null, reason: '마지막 페이지 단 높이 맞춤(\\balance)은 키로 없음', re: /단\s*높이.*(맞춰|같게|비슷)|균형/, sample: '마지막 페이지 양쪽 단 높이를 맞춰줘' },
  { key: null, reason: '특정 쪽만 다르게 하는 설정이 없음', re: /(특정|이|그|한|\d+)\s*(쪽|페이지)만/, sample: '3쪽만 간격을 다르게 해줘' },
  { key: null, reason: '전체 일관성을 검사하는 기능은 채팅에서 제공하지 않음', re: /(전체|일관|통일).*(확인|점검|검사)|(규칙|적용).*(확인|점검)/, sample: '지금까지 규칙이 전체 페이지에 적용됐는지 확인해줘' },
  { key: null, reason: '행간을 넓히면서 쪽수를 유지하는 자동 보정은 없음 — 행간만 바꾸고 쪽수는 확인 필요', re: /(행간|줄).*(쪽\s*수|페이지\s*수).*(유지|그대로)/, sample: '행간 넓히되 전체 페이지 수는 그대로 유지해줘' },
  { key: null, reason: '중간 굵기 단계는 없음 (굵게/보통 두 단계)', re: /조금.*(진하|굵)/, sample: '조금만 더 진하게 해줘' },
  { key: 'marginInner', re: /(글|본문).*묻히/, sample: '글이 안쪽으로 묻히지 않게 해줘' },

  // ── 양끝맞춤 자간 균일 (hangulTrack) ──────────────────────────
  { key: 'hangulTrack', re: /자간.*(균일|고르|일정|들쭉|들쑥|불규칙)/, sample: '양끝맞춤에서 자간을 균일하게 해줘' },
  { key: 'hangulTrack', re: /(글자|글씨)\s*(사이|간격).*(고르|균일|일정)/, sample: '글자 사이 간격을 고르게 해줘' },
  { key: 'hangulTrack', re: /(줄|행)마다.*(글자|자간).*(차이|다르|들쭉)|(글자|자간).*들쭉날쭉/, sample: '줄마다 글자 간격이 들쭉날쭉해' },

  // ── 실제 참여자 발화(05 로그)에서 빠져서 추가한 항목 ───────────
  { key: 'bodyLeading', re: /널널|여유롭|느슨|시원하게|숨통/, sample: '본문을 좀 더 널널하게 해줘' },
  { key: 'bodySize', re: /(글자|글씨)\s*(크기)?.*(커지|커졌|키우)/, sample: '동화처럼 글자가 커지면 좋겠어요' },
  { key: 'bodySize', re: /글자\s*크기.*(줄이|줄여|작게|축소)/, sample: '글자 크기 좀 더 줄여줘' },
  { key: 'bodyLeading', re: /행간.*비례|비례.*행간/, sample: '행간도 비례에 맞게 해줘' },
  { key: 'h1Size', re: /제목.*(크기|폰트).*(축소|줄여|작게)/, sample: '제목 폰트 크기를 조금만 축소해줘' },
  { key: 'h2Size', re: /(부제목|소제목).*(크기|폰트).*(축소|줄여|작게)/, sample: '부제목 폰트 크기를 조금 줄여줘' },
  { key: 'marginTop', re: /여백.*(거의\s*없애|없애|최소|줄여)|사전처럼/, sample: '여백 거의 없애주세요' },
  { key: 'marginBottom', re: /하단.*(넓히|넓혀|늘려|늘리)/, sample: '하단을 넓혀주세요' },
  { key: 'noteLeading', re: /주석.*(행간|줄간격)/, sample: '주석 행간 줄여줘' },
  { key: null, reason: '대상 없이 "본문"만 있음 — 무엇을 어떻게 바꿀지 되물을 것', re: /^\s*본문\s*[.!?]?\s*$/, sample: '본문' },
  { key: null, reason: '"좀 더"만 있음 — 직전 수정의 대상과 방향을 이어받을 것, 대상이 불분명하면 되물을 것', re: /^\s*좀\s*더\s*[.!?]?\s*$/, sample: '좀 더' },
  { key: null, reason: '직전 답변의 결과를 그대로 적용해 달라는 요청 — 히스토리의 마지막 답변 내용을 기준으로 할 것', re: /(위|앞)의?\s*(답변|결과물|수정)/, sample: '위의 답변의 결과물로 수정해줘' },
  { key: null, reason: '잡지·카탈로그·동화처럼 전체 인상만 말함 — 구체 항목(여백, 제목, 행간 등)을 되물을 것', re: /카탈로그|잡지|포스터처럼|느낌/, sample: '좀 더 전체적으로 카탈로그처럼 바꿔줘' },
];

// 사용자 문장에 걸리는 항목을 모두 모은다. 같은 키·같은 사유는 한 번만.
export function detectKnobHints(msg = '') {
  const text = String(msg);
  const hits = [];
  const seen = new Set();
  for (const entry of KNOB_ALIASES) {
    if (!entry.re.test(text)) continue;
    const id = entry.key ? `key:${entry.key}` : `unsupported:${entry.reason}`;
    if (seen.has(id)) continue;
    seen.add(id);
    hits.push(entry.key ? { key: entry.key } : { unsupported: entry.reason });
  }
  return hits;
}

// 모델에 넘기는 사용자 문장 뒤에 붙이는 힌트 문자열. 걸린 것이 없으면 빈 문자열.
export function buildKnobHintSuffix(msg = '') {
  const hits = detectKnobHints(msg);
  if (hits.length === 0) return '';
  const lines = hits.map(h => h.key
    ? `- 키 후보: ${h.key}`
    : `- 미지원: ${h.unsupported} → "적용 불가"로 답하고 sty_patch를 만들지 말 것`);
  return `\n\n[시스템 참고 — 표현 매핑 후보, 사용자에게 보이지 않음]\n${lines.join('\n')}`;
}

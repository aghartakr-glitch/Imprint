// 자연어 수정 표현 → sty_patch 키 매핑 (정확히 100개 표현)
// 모델 호출 직전에 사용자 문장을 이 표와 대조해 "표현 → 키 후보" 힌트를 붙인다.
// 키가 없는 요청(key: null)은 힌트로 "미지원: 이유"를 달아 모델이 임의 값을 만들지 않게 한다.
// 각 항목의 sample은 test_nlKnobAliases.js가 실제로 매칭되는지 확인하는 대표 문장이다.

import { planFontEdit, patchText } from './nlFonts.js';
import { planHighlight } from './styHighlight.js';
import { planRule } from './styRule.js';
import { planNoteMarker } from './styNoteMarker.js';
import { planLayout } from './nlLayout.js';
import { planWeight, planAlign, planSlotPos, planFamilyAll, planCollapse, planFootnotePlace } from './nlMisc.js';
import { planMore, planSizeRelation, planWidthFit, planLeadingRelation, planOneLine } from './nlRelation.js';
import { planMargins } from './nlMargin.js';
import { planDropCap } from './styDropCap.js';
import { planSymbol } from './stySymbol.js';
import { planColorEdit } from './nlColor.js';
import { detectIntensity, detectDirection, hasExplicitAmount, isFollowUp, synthesizePatches, normalizeMsg, LEVEL_NAMES } from './nlIntensity.js';

export const KNOB_ALIASES = [
  // ── 본문 크기·행간·문단 (1~18) ─────────────────────────────────
  { key: 'bodySize', re: /본문.*(키워|키우|크게|커지|크기\s*(를)?\s*(올|늘려|키))/, sample: '본문 글씨 좀 키워줘' },
  { key: 'bodySize', re: /^(?!.*(?:폭|너비|분량)).*본문.*(작게|줄여|줄이|작아)/, sample: '본문 글씨 작게 해줘' },
  { key: 'bodySize', re: /(글씨|글자).*(너무\s*)?작아\s*보/, sample: '글씨가 너무 작아 보여' },
  { key: 'bodyLeading', re: /행간.*(넓|늘|띄|여유|숨|벌려|벌리)/, sample: '행간 좀 넓혀줘' },
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
  { key: 'hyphenation', re: /단어.*(나뉘|쪼개|끊|잘려|잘리)/, sample: '단어가 어색하게 쪼개져' },
  { key: 'bodyAlign', re: /왼쪽\s*정렬|좌측\s*정렬|라그드|ragged/i, sample: '왼쪽 정렬로 바꿔줘' },
  { key: 'bodyAlign', re: /양쪽\s*정렬|균등\s*정렬/, sample: '양쪽 정렬로 가지런하게 해줘' },
  { key: 'rhColor', re: /(면주|머리말|머릿글|러닝\s*헤드|헤더).*(색|연하|흐리|옅|진하|회색|검정)/, sample: '면주 색상 연하게 해줘' },
  { key: 'pnColor', re: /(쪽\s*번호|페이지\s*번호).*(색|연하|흐리|옅|진하|회색|검정)/, sample: '쪽번호 연하게 해줘' },
  { key: 'noteColor', re: /^(?!.*구분선).*(각주|주석).*(색|연하|흐리|옅|진하게|회색|검정)/, sample: '각주 글자 회색으로 해줘' },
  { key: 'h1Color', re: /^(?!.*(?:부제|소제목)).*제목.*(색|연하|흐리|옅|회색|검정)/, sample: '제목 연하게 해줘' },
  { key: 'h2Color', re: /(부제목|부제|소제목).*(색|연하|흐리|옅|회색|검정)/, sample: '부제목 회색으로 해줘' },
  { key: 'bodyColor', re: /^(?!.*(?:제목|각주|주석|면주|쪽번호|구분선|따옴표)).*본문.*(색|연하|흐리|옅|회색)/, sample: '본문 회색으로 해줘' },
  { key: 'marginTop', re: /(상하좌우|사방).*(마진|여백)|(마진|여백).*(상하좌우|사방)/, sample: '상하좌우 마진을 많이 줘' },
  { key: 'marginBottom', re: /(상하좌우|사방).*(마진|여백)|(마진|여백).*(상하좌우|사방)/, sample: '상하좌우 마진을 많이 줘' },
  { key: 'marginInner', re: /(상하좌우|사방).*(마진|여백)|(마진|여백).*(상하좌우|사방)/, sample: '상하좌우 마진을 많이 줘' },
  { key: 'marginOuter', re: /(상하좌우|사방).*(마진|여백)|(마진|여백).*(상하좌우|사방)/, sample: '상하좌우 마진을 많이 줘' },
  { key: 'parSkip', re: /문단.*줄\s*바꿈/, sample: '문단 줄바꿈 없애줘' },
  { key: 'footnoteSep', re: /(각주|주석).*(상하|위아래)\s*간격/, sample: '주석 상하 간격 줄여줘' },
  { key: 'headingGap', re: /(?<![소부])제목.*(부제|소제목).*(붙|좁|가깝|떨어|벌어)|(부제|소제목).*(?<![소부])제목.*(붙|좁|가깝|떨어|벌어)/, sample: '제목이랑 부제목 붙여줘' },
  { key: 'dropCap', re: /(문단|단락|본문)?\s*(시작|첫)\s*(글자|글씨|문자)|드롭\s*캡/, sample: '문단 시작 첫 글자만 크게 해줘' },
  { key: 'footinsSkip', re: /(각\s*주|주\s*석)\s*(위|앞)(?:에|쪽에|의)?\s*(?:있는\s*)?(공백|여백|간격|띄)/, sample: '주석 위에 공백을 많이 넣어줘' },
  { key: null, reason: '각주 시작점을 본문 줄(라인)에 맞추는 키가 없음 — 각주 위치·줄 맞춤은 지원하지 않는다고 알리고, 가능한 것(본문↔각주 간격, 각주 크기·행간)을 제안할 것', re: /(각주|주석).*(시작점|시작s*위치).*(본문).*(라인|줄|행).*(맞춰|맞게|맞추)|(각주|주석).*본문s*(라인|줄)에s*맞/, sample: '주석 시작점을 본문 라인에 맞춰서 나오게 해줘' },
  { key: null, reason: '각주 내용 자체를 지우는 건 지원하지 않음(본문의 각주 표시를 지워야 함) — 각주 칸만 숨기려면 글자 색을 아주 연하게 하거나 크기를 줄이는 방법을 제안할 것', re: /^(?!.*(?:구분선|번호|숫자|표시|서체|색|크기|행간|간격|위치)).*(각주|주석)\s*(?:은|는|을|를)?\s*(지워|없애|삭제|제거)/, sample: '하단 주석은 지워줘' },
  { key: 'symbolStyle', re: /(특수\s*문자|특수\s*기호|문장\s*부호|기호).*(서체|폰트|글꼴|고딕|명조|색|빨|파란|파랑|초록|주황|분홍|회색|연하|진하)/, sample: '특수문자만 고딕으로 바꿔줘' },
  { key: 'footnoteRuleWidth', re: /(구분선|가로줄).*(가로|길이|너비|폭|여백에\s*맞|꽉|길게|짧게|끝까지)/, sample: '구분선 가로 여백에 맞게 늘려줘' },
  { key: 'footnoteRuleThickness', re: /(구분선|가로줄|각주\s*위\s*(?:의\s*)?선).*(얇|가늘|두껍|굵|두텁)/, sample: '각주 구분선 더 얇게 해줘' },
  { key: 'footnoteRuleColor', re: /(구분선|가로줄).*(연하|흐리|옅|진하|짙|희미|엷|색)/, sample: '각주 구분선 더 연하게 해줘' },
  { key: 'quoteHighlight', re: /(따옴표|인용).*(형광펜|하이라이트|칠해|칠하|배경|굵|볼드|기울|이탤릭|빨강|빨간|파랑|파란|초록|주황|분홍|회색|색)|(형광펜|하이라이트).*(따옴표|인용|지워|없애)/, sample: '따옴표 안의 단어들 형광펜 칠해줘' },
  { key: null, reason: '요청이 아니라 상황 설명으로 읽힘("~이야", "~인데") — 값을 바꾸지 말고 이해했다고 짧게 답하고, 무엇을 바꿀지 되물을 것', re: /^(?!.*(?:줘|해줘|바꿔|늘려|줄여|키워|넓혀|좁혀|올려|내려|해주세요|주세요|싶|하자|했으면|면\s*좋겠|말고|보다|맞춰|같게|\?)).*(?:여백|행간|자간|글자|본문|제목|각주|쪽번호|면주|내측|외측|1페이지|기준).*(?:이야|이에요|예요|인데|거든|이라고|인데요|이잖아|잖아)[\s.!~]*$/, sample: '1페이지 기준 우측이 내측 여백이야' },
  { key: null, reason: '대상·방향이 없는 말("알아서", "다", "대충") — 무엇을 어떻게 바꿀지 되물을 것', re: /^\s*(?:알아서|다|전부|아무거나|대충|적당히|그냥|좋게)\s*(?:해줘|해|좀|해주세요)?\s*[.!?~]*\s*$/, sample: '알아서' },
  { key: 'marginInner', re: /^(?=.*여백).*좌우/, sample: '위아래 여백은 줄이고 좌우는 늘려줘' },
  { key: 'marginOuter', re: /^(?=.*여백).*좌우/, sample: '위아래 여백은 줄이고 좌우는 늘려줘' },
  { key: 'noteSize', re: /^(?!.*(?:행간|줄\s*간격|간격|사이|구분선|서체|글꼴)).*각주(?:와|랑|하고|\s*및)\s*.*(키워|크게|커|작게|줄여|작아)/, sample: '각주와 쪽번호 모두 키워줘' },
  { key: 'parSkip', re: /(문단|단락)\s*간격\s*[\d.]+\s*(pt|포인트)/i, sample: '문단 간격 6pt' },
  { key: 'pnSize', re: /쪽번호\s*[\d.]+\s*(pt|포인트)/i, sample: '쪽번호 8pt' },
  { key: null, reason: '되돌리기·취소는 이 채팅에서 지원하지 않음 — 이전 버전 파일(main_v숫자)을 선택하세요', re: /^(?!.*(본문|제목|각주|여백|행간|자간|글자|글씨|쪽번호|면주|문단|서체)).*(원래대로|처음\s*상태|초기화|취소|롤백|undo)/i, sample: '원래대로 돌려줘' },
  { key: 'serifFont', re: /(나눔\s*명조|본명조|노토\s*(?:세리프|명조)|신문\s*명조|신문체|백묵\s*바탕|궁서|필기체|손글씨|붓글씨|캘리|펜글씨|옛글|바탕체|(?:다른|색다른|새로운|딴|특이한)\s*(?:명조|바탕|세리프)|(?:가는|얇은|굵은|두꺼운|부드러운|둥근|현대적인?|깔끔한)\s*(?:명조|바탕|세리프))/, sample: '좀 다른 명조체로 바꿔줘' },
  { key: 'sansFont', re: /(돋움|굴림|헤드라인체?|프리텐다드|디나루|둥근\s*고딕|그래픽체|(?:다른|색다른|새로운|딴|특이한)\s*(?:고딕|산세리프)|(?:가는|얇은|굵은|두꺼운|둥근|라운드)\s*(?:고딕|산세리프))/, sample: '고딕을 돋움체로 바꿔줘' },
  { key: 'bodyFontFamily', re: /^(?!.*(?:각주|주석|면주|쪽\s*번호|번호)).*(?:본문.*(고딕|산세리프|sans)|^(?!.*(?:제목|부제)).*(고딕|산세리프|sans))/i, sample: '본문 서체를 고딕으로 바꿔줘' },
  { key: 'bodyFontFamily', re: /^(?!.*(?:각주|주석|면주|쪽\s*번호|번호)).*(?:본문.*(명조|(?<!산)세리프|바탕체|serif)|^(?!.*(?:제목|부제)).*(명조|(?<!산)세리프|바탕체|serif))/i, sample: '본문을 명조로 바꿔줘' },

  // ── 본문 굵기 (34~35) ──────────────────────────────────────────
  { key: 'bodyWeight', re: /본문.*(굵|진하|두껍|볼드)/, sample: '본문을 좀 진하게 해줘' },
  { key: 'bodyWeight', re: /본문.*(얇|가늘|연하|가볍)/, sample: '본문을 얇게 해줘' },

  // ── 제목·소제목 (36~53) ────────────────────────────────────────
  { key: 'headingWeight', re: /(?<![소부])제목.*(아주|훨씬|확실히|블랙|black|제일).*(굵|진하|두껍)/i, sample: '제목을 아주 굵게 해줘' },
  { key: 'headingWeight', re: /(?<![소부])제목.*(굵|진하|두껍|볼드)/, sample: '제목 굵게 해줘' },
  { key: 'headingWeight', re: /(?<![소부])제목.*(얇|가늘|연하)/, sample: '제목 얇게 해줘' },
  { key: 'h2Weight', re: /(소제목|부제목|부제).*(굵|진하)/, sample: '소제목만 굵게 해줘' },
  { key: 'h2Weight', re: /(소제목|부제목|부제).*(얇|가늘)/, sample: '소제목 얇게 해줘' },
  { key: 'h2Weight', re: /(소제목|부제목|부제).*(묻히|묻혀|안\s*보|눈에\s*안)/, sample: '소제목이 본문에 묻혀 보여' },
  { key: 'h3Weight', re: /소소제목|세부\s*제목|절\s*제목.*(굵|진하)/, sample: '절 제목 굵게 해줘' },
  { key: 'h2Size', re: /^(?!.*(?:행간|줄\s*간격|간격|여백|굵|두껍|정렬)).*(소제목|부제목|부제).*(크게|키워)/, sample: '소제목 키워줘' },
  { key: 'h2Size', re: /^(?!.*(?:행간|줄\s*간격|간격|여백|굵|두껍|정렬)).*(소제목|부제목|부제).*(작게|줄여|작아)/, sample: '소제목 작게 해줘' },
  { key: 'h1Size', re: /^(?!.*(?:행간|줄\s*간격|간격|여백|굵|두껍|정렬|위치|가운데|왼쪽|오른쪽)).*(?<![소부])제목.*(크게|키워|힘|강조)/, sample: '제목 힘을 키워줘' },
  { key: 'h1Size', re: /^(?!.*(?:행간|줄\s*간격|간격|여백|굵|두껍|정렬|위치|가운데|왼쪽|오른쪽)).*(?<![소부])제목.*(작게|줄여)/, sample: '제목 좀 작게 해줘' },
  { key: 'h1Leading', re: /(?<![소부])제목.*(행간|줄\s*간격)/, sample: '제목 행간 줄여줘' },
  { key: 'h2Leading', re: /(소제목|부제목|부제).*(행간|줄\s*간격)/, sample: '소제목 행간 넓혀줘' },
  { key: 'headingAlign', re: /제목.*(가운데|중앙)/, sample: '제목 가운데로 옮겨줘' },
  { key: 'headingAlign', re: /제목.*(왼쪽|좌측)/, sample: '제목 왼쪽으로 옮겨줘' },
  { key: 'headingAlign', re: /제목.*(오른쪽|우측)/, sample: '제목 오른쪽으로 옮겨줘' },
  { key: 'headingAlign', re: /제목\s*정렬.*(기본|기본값)/, sample: '제목 정렬 기본값으로' },
  { key: 'headingGap', re: /^(?!.*(?:행간|줄\s*간격)).*제목.*(소제목|부제).*(사이|간격)/, sample: '제목과 소제목 간격 좀 줄여줘' },
  { key: 'bodyGap', re: /(제목|소제목).*본문.*(간격|사이)/, sample: '제목 아래 본문 간격 넓혀줘' },
  { key: 'headingSpaceBefore', re: /(제목|소제목)\s*위.*(여백|간격)/, sample: '소제목 위쪽 여백 늘려줘' },
  { key: 'headingKeepLines', re: /(소제목|제목).*(혼자|맨\s*아래|고립)/, sample: '소제목이 페이지 맨 아래 혼자 남지 않게 해줘' },

  // ── 각주 (54~65) ───────────────────────────────────────────────
  { key: 'noteSize', re: /^(?!.*(?:행간|줄\s*간격|간격|사이|번호|구분선|서체|글꼴)).*각주.*(키워|크게|커)/, sample: '각주 글씨 조금 키워줘' },
  { key: 'noteSize', re: /^(?!.*(?:행간|줄\s*간격|간격|사이|번호|구분선|서체|글꼴)).*각주.*(작게|줄여|작아)/, sample: '각주 글씨 작게 해줘' },
  { key: 'noteLeading', re: /각주.*(행간|줄간격)/, sample: '각주 행간 줄여줘' },
  { key: 'footnoteSep', re: /^(?!.*(?:본문|글자|글씨)).*(각주\s*(항목|끼리)|각주끼리|각주\s*사이|각주.*항목).*(간격|띄|좁|붙|떨어)/, sample: '각주끼리 너무 떨어져 있어' },
  { key: 'footinsSkip', re: /(본문|글).*각주.*(간격|여백|띄|사이|붙|떨어)/, sample: '본문이랑 각주 사이 띄워줘' },
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
  { key: 'pnSize', re: /^(?!.*(?:행간|줄\s*간격|간격|위치|서체|글꼴)).*쪽\s*번호.*(작게|줄여|작아)/, sample: '쪽번호 작게 해줘' },
  { key: 'pnSize', re: /^(?!.*(?:행간|줄\s*간격|간격|위치|서체|글꼴)).*쪽\s*번호.*(크게|키워)/, sample: '쪽번호 크게 해줘' },
  { key: 'pnLeading', re: /쪽\s*번호.*(행간|줄\s*간격)/, sample: '쪽번호 줄간격 조금 줄여줘' },
  { key: 'pnXShift', re: /쪽\s*번호.*(좌우|가로).*(옮|이동|밀)/, sample: '쪽번호 좌우로 조금 옮겨줘' },
  { key: 'pnYShift', re: /쪽\s*번호.*(세로|높이|위아래).*(옮|이동|올|내)/, sample: '쪽번호 세로로 조금 올려줘' },
  { key: 'rhPos', re: /면주.*(없애|빼|지워|끄)/, sample: '면주 없애줘' },
  { key: 'rhPos', re: /면주.*(켜|넣어|살려|보이게)/, sample: '면주 다시 넣어줘' },
  { key: 'rhText', re: /면주.*(문구|내용|텍스트|글귀).*(바꿔|변경|넣어)/, sample: '면주 문구 바꿔줘' },
  { key: 'rhSize', re: /^(?!.*(?:행간|줄\s*간격|간격|위치|서체|글꼴|문구)).*면주.*(작게|줄여|작아)/, sample: '면주 작게 해줘' },
  { key: 'rhSize', re: /^(?!.*(?:행간|줄\s*간격|간격|위치|서체|글꼴|문구)).*면주.*(크게|키워)/, sample: '면주 크게 해줘' },
  { key: 'rhLeading', re: /면주.*(행간|줄\s*간격)/, sample: '면주 줄간격 줄여줘' },
  { key: 'rhSize', re: /면주.*(눈에\s*띄|튀|강해)/, sample: '면주가 너무 눈에 띄어' },
  { key: 'rhPos', re: /면주.*(위치|자리|옮)/, sample: '면주 위치 옮겨줘' },
  { key: null, reason: '면주 굵기를 바꾸는 키가 없음 (크기만 rhSize로 조절 가능)', re: /면주.*(굵|진하)/, sample: '면주 굵기 좀 줄여줘' },

  // ── 여백·단 (85~92) ────────────────────────────────────────────
  { key: 'marginTop', re: /(?<!제목\s*)(위|상)\s*(쪽\s*)?(여백|마진)|상단\s*여백/, sample: '위쪽 여백 좀 늘려줘' },
  { key: 'marginBottom', re: /(?<!(?:제목|소제목)\s*)(아래|하)\s*(쪽\s*)?(여백|마진)|하단\s*여백/, sample: '아래 여백 넓혀줘' },
  { key: 'marginInner', re: /(안쪽|안|내측)\s*여백|제본.*(여백|안쪽)/, sample: '제본 때문에 안쪽 여백을 늘려줘' },
  { key: 'marginOuter', re: /(바깥|밖|외측)\s*(쪽\s*)?여백/, sample: '바깥 여백 줄여줘' },
  { key: 'marginTop', re: /위아래\s*여백.*같/, sample: '위아래 여백을 같게 해줘' },
  { key: 'colGap', re: /(?<!문)단\s*(간격|사이)|칼럼\s*간격/, sample: '단 사이를 넓혀줘' },
  { key: null, reason: '단 수(1단·2단 전환)를 바꾸는 키가 없음 (재생성 필요)', re: /(1|한|일)\s*단|단\s*수|두\s*단.*(바꿔|없애)/, sample: '1단으로 바꿔줘' },

  // ── 미지원·주의 항목 (93~100) ──────────────────────────────────
  { key: null, reason: '과부·고아줄은 이미 penalty 10000으로 막혀 있음 — 실제 PDF 확인 필요', re: /과부|고아|외로운\s*(줄|행)|마지막\s*(한\s*)?줄.*(넘어|다음)/, sample: '문단 마지막 한 줄이 다음 쪽으로 넘어가지 않게 해줘' },
  { key: null, reason: '마지막 페이지 단 높이 맞춤(\\balance)은 키로 없음', re: /단\s*높이.*(맞춰|같게|비슷)|균형/, sample: '마지막 페이지 양쪽 단 높이를 맞춰줘' },
  { key: null, reason: '특정 쪽만 다르게 하는 설정이 없음', re: /(특정|이|그|한|\d+)\s*(쪽|페이지)만/, sample: '3쪽만 간격을 다르게 해줘' },
  { key: null, reason: '전체 일관성을 검사하는 기능은 채팅에서 제공하지 않음', re: /(전체|일관|통일).*(확인|점검|검사)|(규칙|적용).*(확인|점검)/, sample: '지금까지 규칙이 전체 페이지에 적용됐는지 확인해줘' },
  { key: null, reason: '행간을 넓히면서 쪽수를 유지하는 자동 보정은 없음 — 행간만 바꾸고 쪽수는 확인 필요', re: /(행간|줄).*(쪽\s*수|페이지\s*수).*(유지|그대로)/, sample: '행간 넓히되 전체 페이지 수는 그대로 유지해줘' },
  { key: null, reason: '중간 굵기 단계는 없음 (굵게/보통 두 단계)', re: /조금.*(진하|굵)/, sample: '조금만 더 진하게 해줘' },
  { key: 'marginInner', re: /(글|본문).*묻히/, sample: '글이 안쪽으로 묻히지 않게 해줘' },

  // ── 실패 코퍼스(test_nl_corpus.js) 보완 ──────────────────────────
  { key: 'bodySize', re: /^(?!.*(?:제목|소제목|부제|각주|주석|면주|쪽번호|쪽수)).*(글자|글씨).*(키워|키우|크게|커지)/, sample: '글자 좀 더 키워줘' },
  { key: 'bodyLeading', re: /줄\s*간격.*(벌려|벌리|넓)/, sample: '줄 간격을 조금 더 벌려주세요' },
  { key: 'bodyLeading', re: /줄\s*사이.*(촘촘|좁)/, sample: '본문 줄 사이를 좀 촘촘하게' },
  { key: 'bodyLeading', re: /행간.*(배|맞춰|조정)/, sample: '행간을 1.2배로 맞춰줘' },
  { key: 'bodyFontFamily', re: /^(?!.*(?:각주|면주|쪽번호|주석)).*서체.*(바꿔|변경|바꾸)/, sample: '본문 서체 좀 부드럽게 바꿔줘' },
  { key: 'letterSpace', re: /글자\s*사이.*(빽빽|좁|촘촘|붙)/, sample: '글자 사이가 너무 빽빽해' },
  { key: 'letterSpace', re: /글자\s*끼리.*(붙|겹)/, sample: '글자끼리 너무 붙어 보여' },
  { key: 'wordSpace', re: /띄어쓰기.*(들쭉|불규칙|고르|일정)/, sample: '띄어쓰기 간격이 들쭉날쭉해' },
  { key: 'wordSpace', re: /띄어쓰기.*(간격|사이)?.*(줄여|줄이|좁혀|좁히|좁게|넓혀|넓히|넓게|늘려|늘리|벌려|벌리)/, sample: '띄어쓰기 간격 살짝 줄여줘' },
  { key: 'bodyAlign', re: /양끝\s*(정렬|으로|로)/, sample: '양끝 정렬로 맞춰줘' },
  { key: 'parIndent', re: /들여쓰기.*(줄여|줄이|작게|좁)/, sample: '들여쓰기 한 칸만 줄여줘' },
  { key: 'parSkip', re: /문단이?\s*(너무\s*)?붙/, sample: '문단이 너무 붙어 있어' },
  { key: 'h1Size', re: /^(?!.*(?:아래|위|여백|간격|부제|소제목)).*제목.*(너무\s*커|튀)/, sample: '제목이 너무 커서 튀어' },
  { key: 'bodyGap', re: /(제목|소제목)\s*(아래|밑).*(여백|간격)/, sample: '제목 아래 여백이 너무 커' },
  { key: 'parSkip', re: /문단.*사이.*(없애|없게|지워|없|안)/, sample: '문단 사이를 아예 없애고 싶어' },
  { key: 'h2Size', re: /소제목.*구분.*(안\s*가|안\s*돼|안\s*보)/, sample: '소제목이 본문이랑 구분이 안 가' },
  { key: 'headingSpaceBefore', re: /(제목|소제목)\s*위쪽.*(띄|여백|간격)/, sample: '소제목 위쪽을 좀 띄워줘' },
  { key: 'noteSize', re: /각주.*(크기|글씨).*(비슷|맞춰|같게)/, sample: '각주 크기를 본문이랑 비슷하게' },
  { key: 'noteLeading', re: /각주.*(빽빽|촘촘|답답)/, sample: '각주가 너무 빽빽해' },
  { key: 'footinsSkip', re: /각주.*(내려|올려)/, sample: '각주를 쪽번호 쪽으로 더 내려줘' },
  { key: 'pnSize', re: /쪽\s*번호.*너무\s*(커|크)/, sample: '쪽번호가 너무 커' },
  { key: 'bodyLeading', re: /^(?!.*(?:각주|주석|제목|부제|면주|쪽\s*번호)).*(?<![한두세네]\s*)줄(이|들이|끼리)?\s*(너무\s*)?(붙|촘촘)/, sample: '줄이 너무 붙어 있어' },
  { key: 'pnSize', re: /쪽\s*수.*(작게|줄여|작아|크게|키워)/, sample: '쪽수 표시 좀 작게' },
  { key: 'pnPos', re: /(쪽|페이지)\s*번호.*(안\s*나|안\s*보|없게|없애|지워|빼|끄)/, sample: '페이지 번호를 안 나오게 해줘' },
  { key: 'marginInner', re: /한\s*줄.*(길|짧)|본문\s*(폭|너비|가로).*(좁|줄이|줄여|넓)/, sample: '본문 폭을 좁혀서 한 줄 길이를 줄여줘' },
  { key: null, reason: '책 두께(쪽수·제본 두께)를 조절하는 키가 없음', re: /책\s*두께|판\s*두께|책\s*부피/, sample: '책 두께를 줄여줘' },
  { key: null, reason: '본문 단 개수를 바꾸는 키가 없음 (재생성 필요)', re: /(세|네|다섯)\s*개로?.*(단|나눠)|단.*(세|네|다섯)\s*개/, sample: '본문 단을 세 개로 나눠줘' },
  { key: null, reason: '쪽 마지막 줄의 과부·고아 방지는 이미 penalty로 막혀 있음 — 실제 PDF 확인 필요', re: /마지막\s*줄.*(혼자|남지)|(혼자|외로운)\s*(줄|행)/, sample: '각 쪽 마지막 줄이 혼자 남지 않게' },
  { key: null, reason: '목차 생성은 조판 설정 키로 제공되지 않음', re: /목차|차례/, sample: '목차를 넣어줘' },
  { key: null, reason: '표지·속표지·판권 디자인은 조판 설정 키로 제공되지 않음', re: /표지|속표지|판권/, sample: '표지 디자인을 바꿔줘' },
  { key: null, reason: '분량(글 양)을 직접 조절하는 키가 없음', re: /(글|본문)\s*(양|분량)/, sample: '본문 분량을 줄여' },

  // ── 각주·면주·쪽번호 서체 (본문과 독립) ─────────────────────────
  { key: 'footnoteFontFamily', re: /^(?!.*번호).*각주.*(명조|고딕|세리프|산세리프|바탕|서체|글꼴|폰트|글씨체)/, sample: '각주만 명조체로 바꿔줘' },
  // 본문 안의 각주 번호(위첨자) 서체 — 각주 문장 서체와는 별개
  { key: 'footnoteMarkFont', re: /각주\s*(번호|숫자|표시).*(고딕|산세리프|명조|세리프|바탕|서체|글꼴|폰트|글씨체)/, sample: '본문에 각주 번호도 고딕으로 해줘' },
  { key: 'rhFontFamily', re: /면주.*(명조|고딕|세리프|산세리프|바탕|서체|글꼴|폰트|글씨체)/, sample: '면주 명조체로 바꿔줘' },
  { key: 'pnFontFamily', re: /쪽\s*번호.*(명조|고딕|세리프|산세리프|바탕|서체|글꼴|폰트|글씨체)/, sample: '쪽번호 고딕으로 바꿔줘' },
  // ── 문단 사이 간격 (parSkip) ───────────────────────────────────
  { key: 'parSkip', re: /(문단|단락).*(간격|사이).*(줄여|좁혀|줄이|좁게|붙)/, sample: '단락 간격 줄여줘' },

  // ── 양끝맞춤 자간 균일 (hangulTrack) ──────────────────────────
  { key: 'hangulTrack', re: /자간.*(균일|고르|일정|들쭉|들쑥|불규칙|달라|다르|차이)/, sample: '양끝맞춤에서 자간을 균일하게 해줘' },
  { key: 'hangulTrack', re: /(글자|글씨)\s*(사이|간격).*(고르|균일|일정)/, sample: '글자 사이 간격을 고르게 해줘' },
  { key: 'hangulTrack', re: /(줄|행)마다.*(글자|자간).*(차이|다르|들쭉)|(글자|자간).*들쭉날쭉/, sample: '줄마다 글자 간격이 들쭉날쭉해' },

  // ── 실제 참여자 발화(05 로그)에서 빠져서 추가한 항목 ───────────
  { key: 'bodyLeading', re: /널널|여유롭|느슨|시원하게|숨통/, sample: '본문을 좀 더 널널하게 해줘' },
  { key: 'bodySize', re: /^(?!.*(?:제목|부제|각주|주석|면주|쪽\s*번호|쪽\s*수|머리말)).*(글자|글씨)\s*(크기)?.*(커지|커졌|키우)/, sample: '동화처럼 글자가 커지면 좋겠어요' },
  { key: 'bodySize', re: /^(?!.*(?:제목|부제|각주|주석|면주|쪽\s*번호|쪽\s*수|간격|사이|행간|자간)).*(글자|글씨)\s*(크기)?.*(줄여|줄이|작게|축소)/, sample: '글씨 크기 살짝 줄여줘' },
  { key: 'bodySize', re: /^(?!.*(?:제목|부제|각주|주석|면주|쪽\s*번호|쪽\s*수|간격|사이)).*(글자|글씨)\s*(크기)?.*(늘려|늘리)/, sample: '글자크기 동화책처럼 늘려줘' },
  { key: 'bodySize', re: /^(?!.*(?:제목|부제|각주|주석|면주|쪽\s*번호|쪽\s*수|머리말)).*글자\s*크기.*(줄이|줄여|작게|축소)/, sample: '글자 크기 좀 더 줄여줘' },
  { key: 'bodyLeading', re: /행간.*비례|비례.*행간/, sample: '행간도 비례에 맞게 해줘' },
  { key: 'h1Size', re: /(?<![소부])제목.*(크기|폰트).*(축소|줄여|작게)/, sample: '제목 폰트 크기를 조금만 축소해줘' },
  { key: 'h2Size', re: /(부제목|소제목).*(크기|폰트).*(축소|줄여|작게)/, sample: '부제목 폰트 크기를 조금 줄여줘' },
  { key: 'marginTop', re: /여백.*(거의\s*없애|거의\s*안\s*남|최소(로|한)?)|사전처럼/, sample: '여백 거의 없애주세요' },
  { key: 'marginBottom', re: /여백.*(거의\s*없애|거의\s*안\s*남|최소(로|한)?)|사전처럼/, sample: '여백 거의 없애주세요' },
  { key: 'marginInner', re: /여백.*(거의\s*없애|거의\s*안\s*남|최소(로|한)?)|사전처럼/, sample: '여백 거의 없애주세요' },
  { key: 'marginOuter', re: /여백.*(거의\s*없애|거의\s*안\s*남|최소(로|한)?)|사전처럼/, sample: '여백 거의 없애주세요' },
  { key: 'marginBottom', re: /하단.*(넓히|넓혀|늘려|늘리)/, sample: '하단을 넓혀주세요' },
  { key: 'noteLeading', re: /주석.*(행간|줄간격)/, sample: '주석 행간 줄여줘' },
  { key: null, reason: '대상 없이 "본문"만 있음 — 무엇을 어떻게 바꿀지 되물을 것', re: /^\s*본문\s*[.!?]?\s*$/, sample: '본문' },
  { key: null, reason: '"좀 더"만 있음 — 직전 수정의 대상과 방향을 이어받을 것, 대상이 불분명하면 되물을 것', re: /^\s*좀\s*더\s*[.!?]?\s*$/, sample: '좀 더' },
  { key: null, reason: '직전 답변의 결과를 그대로 적용해 달라는 요청 — 히스토리의 마지막 답변 내용을 기준으로 할 것', re: /(위|앞)의?\s*(답변|결과물|수정)/, sample: '위의 답변의 결과물로 수정해줘' },
  { key: null, reason: '잡지·카탈로그·동화처럼 전체 인상만 말함 — 구체 항목(여백, 제목, 행간 등)을 되물을 것', re: /카탈로그|잡지|포스터처럼|느낌/, sample: '좀 더 전체적으로 카탈로그처럼 바꿔줘' },

  // ── 말투·동의어 보완 (test_nl_edits_50.js에서 안 잡히던 것) ───────────
  // 가장 기본적인 "행간 줄여줘" — 예전 규칙은 "줄이"만 있어서 "줄여"가 안 잡혔다
  { key: 'bodyLeading', re: /행간.*(줄여|줄이|좁|촘촘)/, sample: '행간 줄여줘' },
  { key: 'bodyLeading', re: /행간.*(\d|배)/, sample: '행간 150%로' },
  { key: 'bodyLeading', re: /행간.*(키워|키우|크게|높여|올려)/, sample: '줄 높이 좀 키워줘' },
  { key: 'bodyLeading', re: /행간.*(작게|낮춰|내려)/, sample: '행간 작게 해줘' },
  { key: 'letterSpace', re: /자간.*(벌려|벌리|띄워|띄우|줄여|줄이)/, sample: '자간 쫙 벌려줘' },
  { key: 'letterSpace', re: /자간.*(\d|%)/, sample: '자간 3%로' },
  // 방향·위치 없이 그냥 "여백" — 네 여백 모두를 대상으로 한다 (제목·각주 등 다른 대상의 여백/간격은 제외)
  ...['marginTop', 'marginBottom', 'marginInner', 'marginOuter'].map(key => ({
    key,
    re: /^(?!.*(?:제목|소제목|부제|각주|면주|쪽번호|위쪽|아래쪽|위아래|위\s*여백|아래\s*여백|상단|하단|안쪽|바깥|내측|외측|좌우|좌측|우측|왼쪽|오른쪽|양옆|양쪽)).*여백/,
    sample: '여백 줄여줘',
  })),
  // 일부 여백만 — 위아래 / 좌우
  { key: 'marginTop', re: /위아래\s*여백/, sample: '위아래 여백만 줄여줘' },
  { key: 'marginBottom', re: /위아래\s*여백/, sample: '위아래 여백만 줄여줘' },
  { key: 'marginInner', re: /(좌우|양옆|양쪽)\s*여백/, sample: '좌우 여백만 늘려줘' },
  { key: 'marginOuter', re: /(좌우|양옆|양쪽)\s*여백/, sample: '좌우 여백만 늘려줘' },
  // 절대값으로 지정 — "본문을 11pt로"
  { key: 'bodySize', re: /^(?!.*(?:제목|부제|각주|면주|쪽번호|행간|여백|자간|간격)).*(본문|글자|글씨|글꼴).*\d+(\.\d+)?\s*(pt|포인트)/i, sample: '본문을 11pt로 바꿔줘' },
  { key: 'pnPos', re: /쪽번호.*(숨|감춰|안\s*보이게)/, sample: '쪽수 표시 숨겨줘' },
  { key: 'bodyFontFamily', re: /^(?!.*(?:각주|면주|쪽번호|제목|부제)).*서체.*(단정|부드럽|딱딱|세련|고급|깔끔|무게|가볍|정갈|친근|점잖)/, sample: '본문 서체를 좀 더 단정하게' },
  // 키가 없는 요청 — 없다고 알려야 한다
  { key: 'h2FontFamily', re: /(부제목|부제|소제목).*(서체|글꼴|폰트|글씨체|명조|고딕|돋움|궁서|필기체)/, sample: '부제목 고딕으로' },
  { key: 'h1FontFamily', re: /(?<![소부])(제목|타이틀|표제).*(서체|글꼴|폰트|글씨체|명조|고딕|돋움|궁서|필기체)/, sample: '제목 서체를 명조로 바꿔줘' },
  { key: 'headingFontFamily', re: /(제목|소제목|부제|타이틀|표제).*(서체|글꼴|폰트|글씨체|명조|고딕|돋움|궁서|필기체)/, sample: '제목 서체를 명조로 바꿔줘' },
  { key: null, reason: '본문 오른쪽 정렬은 지원하지 않음 (양끝·왼쪽 정렬만 가능)', re: /^(?!.*(?:제목|쪽번호|면주|각주)).*(오른쪽|우측)\s*(정렬|맞춤)/, sample: '오른쪽 정렬로 해줘' },
  { key: null, reason: '표를 새로 넣는 기능은 조판 설정 키로 제공되지 않음', re: /(^|\s)표(를|도|좀)?\s*(넣|추가|만들|그려)/, sample: '표 넣어줘' },
  { key: null, reason: '그림·사진 요소를 편집하는 키가 없음', re: /(그림|이미지|사진|도판|삽화).*(크기|넣|추가|위치|줄여|키워|바꿔|옮)/, sample: '그림 크기 줄여줘' },
];

// 이 키가 아닌 다른 대상을 말하는 문장이면 그 키 힌트를 버린다 — 안 그러면 직접 계산 때 엉뚱한 값이 같이 바뀐다
// (예: "본문과 각주 사이 간격 줄여줘"에 본문 크기가, "제목 줄간격 늘려줘"에 본문 행간이 같이 걸림)
const KEY_BLOCKERS = {
  bodySize: /(사이|간격)/,
  bodyLeading: /(각주|주석|제목|부제|면주|쪽\s*번호|쪽\s*수)\s*(의\s*)?(행간|줄\s*간격|줄\s*사이)/,
  // 구분선 말에 든 "여백/가로/길이"는 구분선 얘기다
  marginTop: /(구분선|가로줄|(각주|주석)\s*(위|앞))/, marginBottom: /(구분선|가로줄|(각주|주석)\s*(위|앞))/, marginInner: /(구분선|가로줄|(각주|주석)\s*(위|앞))/, marginOuter: /(구분선|가로줄|(각주|주석)\s*(위|앞))/,
};

// 사용자 문장에 걸리는 항목을 모두 모은다. 같은 키·같은 사유는 한 번만.
function scanAliases(text) {
  const hits = [];
  const seen = new Set();
  for (const entry of KNOB_ALIASES) {
    if (!entry.re.test(text)) continue;
    if (entry.key && KEY_BLOCKERS[entry.key]?.test(text)) continue;
    const id = entry.key ? `key:${entry.key}` : `unsupported:${entry.reason}`;
    if (seen.has(id)) continue;
    seen.add(id);
    hits.push(entry.key ? { key: entry.key } : { unsupported: entry.reason });
  }
  return hits;
}

export function detectKnobHints(msg = '') {
  const text = normalizeMsg(msg);
  const hits = scanAliases(text);
  if (hits.length > 0) return hits;
  // 어순을 뒤집어 말한 경우("줄여줘 행간 좀")는 규칙이 "대상 … 동작" 순서라 안 걸린다 — 아무것도 안 걸렸을 때만 단어 순서를 뒤집어 다시 본다
  return scanAliases(text.split(/\s+/).reverse().join(' '));
}

// 모델에 넘기는 사용자 문장 뒤에 붙이는 힌트 문자열. 걸린 것이 없으면 빈 문자열.
// prevKeys: 직전 수정에서 바뀐 키들 — 대상 없이 "더 줄여줘"처럼 말하면 그 키들을 이어받는다.
export function buildKnobHintSuffix(msg = '', prevKeys = []) {
  const hits = detectKnobHints(msg);
  const lines = hits.map(h => h.key
    ? `- 키 후보: ${h.key}`
    : `- 미지원: ${h.unsupported} → "적용 불가"로 답하고 sty_patch를 만들지 말 것`);
  if (hits.length === 0 && prevKeys.length > 0 && isFollowUp(msg, 0)) {
    lines.push(`- 대상 없이 방향·강도만 말한 후속 요청 → 직전에 바꾼 ${prevKeys.join(', ')}에 이어서 적용 (되묻지 말 것)`);
  }
  if (lines.length === 0) return '';
  const { level, word } = detectIntensity(msg);
  if (word && !hasExplicitAmount(msg)) {
    lines.push(`- 강도 "${word}" = ${level}/5단계(${LEVEL_NAMES[level]}) — 수치 크기는 시스템이 단계표로 다시 계산하니 대상 키와 방향(늘림/줄임)만 정확히 고를 것`);
  }
  return `\n\n[시스템 참고 — 표현 매핑 후보, 사용자에게 보이지 않음]\n${lines.join('\n')}`;
}

// 한 문장에서 읽을 수 있는 것을 한 번에 정리한다: 대상 키, 방향, 강도 단계, 그리고 모델이 sty_patch를 못 냈을 때 쓸 직접 계산 결과.
// prevKeys가 있고 문장이 "더 줄여줘"처럼 대상 없는 후속 발화면 직전에 바꾼 키를 이어받는다.
function planSingle(msg = '', cmdMap = {}, prevKeys = []) {
  const hits = detectKnobHints(msg);
  const keys = hits.filter(h => h.key).map(h => h.key);
  let unsupported = hits.filter(h => h.unsupported).map(h => h.unsupported);
  let targets = keys;
  let inherited = false;
  if (hits.length === 0 && prevKeys.length > 0 && isFollowUp(msg, 0) && !ELEMENT_WORD.test(msg) && !/(굵|볼드|두껍|얇|가늘|기울)/.test(msg)) { targets = prevKeys; inherited = true; }
  const { level, word } = detectIntensity(msg);
  const dir = detectDirection(msg);
  let synth = (unsupported.length === 0 || (targets.length > 0 && unsupported.every(u => /전체 인상/.test(u)))) ? synthesizePatches(msg, targets, cmdMap) : null;
  // 서체 요청 — 이름·분위기·"다른 명조"를 코드가 서체 id로 바꿔 준다(크기 요청과 한 문장에 섞여 있어도 함께)
  // "~느낌으로"는 서체 분위기 요청일 수 있다 — 서체로 풀리면 '전체 인상만 말함' 되묻기는 접는다
  const impressionOnly = unsupported.length > 0 && unsupported.every(u => /전체 인상/.test(u));
  const font = (unsupported.length === 0 || impressionOnly) ? planFontEdit(msg, cmdMap) : null;
  if (font && impressionOnly) unsupported = [];
  let fontOnly = false;
  if (font) {
    const ft = patchText(font.patches);
    fontOnly = !synth;
    synth = synth ? { ...synth, text: synth.text + ',' + ft, patches: { ...synth.patches, ...font.patches } } : { text: ft, keys: Object.keys(font.patches), patches: { ...font.patches }, font: true };
  }
  // 따옴표 안 구절 형광펜 — 켜기·끄기·색을 코드가 정한다
  // 각주 구분선 길이·두께·진하기 — "구분선 가로 여백에 맞게"가 여백 요청으로 잘못 읽히지 않게 이 요청이면 구분선 값만 낸다
  const rule = planRule(msg, cmdMap, level);
  if (rule) {
    const ft = patchText(rule.patches);
    synth = { text: ft, keys: Object.keys(rule.patches), patches: { ...rule.patches }, font: true };
    fontOnly = true;
  }
  // 글자 색(면주·쪽번호·각주·제목·부제목·본문) — 연하게/진하게/회색으로를 단계표로 계산한다
  const colorPlan = unsupported.length === 0 ? planColorEdit(msg, cmdMap) : null;
  if (colorPlan) {
    synth = { text: patchText(colorPlan.patches), keys: Object.keys(colorPlan.patches), patches: { ...colorPlan.patches }, font: true };
    fontOnly = true;
  }
  // 전체 인상 요청("전체적으로 좀 비어 보이게") — 여백·행간·문단 간격을 함께 조절한다
  // 널널하게·시원하게는 본문 행간 항목에도 걸리므로, 문장이 문서 전체를 가리킬 때만 행간 단독 힌트를 전체 요청으로 본다
  const airyOk = hits.every(h => (h.unsupported && /전체 인상/.test(h.unsupported)) || (h.key === 'bodyLeading' && /(전체|전반|전부|다 |통째)/.test(msg)));
  const airy = airyOk ? planAiry(msg, cmdMap) : null;
  if (airy) { unsupported = []; synth = airy; fontOnly = true; }
  // 로그에서 모델이 반대로 읽던 요청(행간을 글자 크기에 맞추기·컬럼 가로 크기·본문을 제목 아래로)
  const lay = unsupported.length === 0 || impressionOnly ? planLayout(msg, cmdMap) : null;
  if (lay) { unsupported = []; synth = { text: patchText(lay.patches), keys: Object.keys(lay.patches), patches: { ...lay.patches }, font: true }; fontOnly = true; }
  // 전체 로그 점검에서 나온 것: 굵기·정렬·쪽번호/면주 위치·전체 서체 계열
  // 문단 첫 글자만 키우기 — 본문 전체 크기로 읽히지 않게 이 요청이면 첫 글자 배율만 낸다
  const drop = planDropCap(msg, level);
  if (drop) { unsupported = []; synth = { text: patchText(drop.patches), keys: Object.keys(drop.patches), patches: { ...drop.patches }, font: true }; fontOnly = true; }
  // 여백 4면 — 면마다 방향을 따로 읽는다(안쪽/바깥쪽·위/아래·좌우·사방). 왼쪽/오른쪽은 되묻는다
  const marg = planMargins(msg, cmdMap);
  if (marg?.ask) { unsupported = [marg.ask]; synth = null; }
  else if (marg) { unsupported = []; synth = { text: patchText(marg.patches), keys: Object.keys(marg.patches), patches: { ...marg.patches }, font: true }; fontOnly = true; }
  for (const plan of marg ? [] : [planFootnotePlace(msg, cmdMap, level), planOneLine(msg, cmdMap), planLeadingRelation(msg, cmdMap), planCollapse(msg), planWidthFit(msg, cmdMap), planSizeRelation(msg, cmdMap), planFamilyAll(msg, cmdMap), planSlotPos(msg, cmdMap), planWeight(msg), planAlign(msg)]) {
    if (!plan) continue;
    if (plan.noChange) { unsupported = [plan.noChange]; synth = null; fontOnly = false; break; }
    unsupported = [];
    // 이 계획들은 문장에서 대상과 값을 직접 정한 것이라 앞서 모델/별칭이 잡은 값에 섞지 않고 그대로 쓴다(섞이면 직전 수정 키나 다른 항목이 같이 바뀐다)
    // 굵기 계획(merge)은 같은 문장의 크기 요청("제목 더 크게 해줘 굵게")을 버리지 않게, 직접 말한 값(직전 수정 이어받기가 아닌 것)과 합친다
    let baseP = synth?.patches || {};
    if (plan.merge && !inherited && !Object.keys(baseP).length) {
      // 별칭은 "굵"이 든 문장의 크기 요청을 일부러 잡지 않으므로, 굵기 말을 걷어낸 문장으로 크기 계획을 따로 구한다
      const stripped = normalizeMsg(String(msg)).replace(/(굵게|볼드(?:로)?|두껍게|얇게|가늘게|굵기|강조(?:되게|해|하게)?)/g, ' ');
      if (stripped.trim() !== String(msg).trim()) baseP = planSingle(stripped, cmdMap, []).synth?.patches || {};
    }
    const merged = plan.merge && !inherited ? { ...baseP, ...plan.patches } : { ...plan.patches };
    synth = { text: patchText(merged), keys: Object.keys(merged), patches: merged, font: true };
    fontOnly = true;
  }
  const marker = planNoteMarker(msg);
  if (marker) {
    synth = { text: patchText(marker.patches), keys: Object.keys(marker.patches), patches: { ...marker.patches }, font: true };
    fontOnly = true;
  }
  const hl = unsupported.length === 0 || impressionOnly ? planHighlight(msg) : null;
  if (hl) {
    fontOnly = !synth;
    synth = synth ? { ...synth, text: synth.text + ',' + patchText(hl.patches), patches: { ...synth.patches, ...hl.patches } } : { text: patchText(hl.patches), keys: Object.keys(hl.patches), patches: { ...hl.patches }, font: true };
  }
  // 특수문자(기호·문장부호·원문자)만 서체·색 — 다른 계획(본문 서체·색 등)보다 우선한다. 기본은 전부, "N번 빼고"처럼 말한 항목은 뺀다
  const symPlan = planSymbol(msg, cmdMap);
  if (symPlan) { unsupported = []; synth = { text: patchText(symPlan.patches), keys: Object.keys(symPlan.patches), patches: { ...symPlan.patches }, font: true }; fontOnly = true; }
  return { keys: targets, inherited, unsupported, level, word, dir, explicit: hasExplicitAmount(msg), synth, font: font || (hl ? { kind: 'highlight', role: 'hl', id: hl.patches.quoteHighlight, patches: hl.patches } : null), fontOnly, highlight: hl };
}

// ── 여러 절이 한 문장에 섞인 요청 ───────────────────────────────────────────────
// "각주가 너무 크고 행간이 너무 넓어", "본문은 키우고 각주는 줄여줘" — 절마다 대상·방향이 다르니 따로 계산해 합친다.
// 요소 이름이 빠진 절("행간이 너무 넓어")은 앞 절의 요소(각주)를 이어받는다. 절마다 직접 계산이 되지 않으면 문장 전체를 한 덩어리로 본다.
const ELEMENT_WORD = /(각주|주석|부제목|소제목|부제|제목|면주|머리말|쪽\s*번호|본문)/;
const CLAUSE_SPLIT = /[ \t]*(?:\r?\n+|;|,|，|그리고)[ \t]*|(?<=[가-힣](?:고|며|면서|는데|인데|지만))\s+/;

export function splitClauses(msg) {
  const parts = String(msg).split(CLAUSE_SPLIT).map(x => x && x.trim()).filter(Boolean);
  return parts.length >= 2 && parts.length <= 4 ? parts : null;
}

export function planNaturalEdit(msg = '', cmdMap = {}, prevKeys = [], prevDirs = {}) {
  // 방금 따옴표 안 글자를 바꿨는데 "굵게"만 말하면 그 따옴표 안 글자에 굵게를 더한다("text:red" → "text:red+bold")
  const faceOnly = String(msg).trim().match(/^(굵게|볼드(?:로)?|두껍게|기울여|기울임|이탤릭)(?:\s*해\s*줘|\s*해줘|\s*줘)?[\s.!?~]*$/);
  if (faceOnly && prevKeys.includes('quoteHighlight') && cmdMap.quoteHighlight && cmdMap.quoteHighlight !== 'off') {
    const face = /(굵|볼드|두껍)/.test(faceOnly[1]) ? 'bold' : 'italic';
    const base = String(cmdMap.quoteHighlight).split(/[+|,]/).filter(x => x && x !== 'bold' && x !== 'italic');
    const value = (base.length ? base[0] + '+' : '') + face;
    const base0 = planSingle(msg, cmdMap, []);
    return { ...base0, keys: ['quoteHighlight'], inherited: true, unsupported: [], synth: { text: 'quoteHighlight=' + value, keys: ['quoteHighlight'], patches: { quoteHighlight: value }, font: true } };
  }
  // "조금만 더", "더더더더", "반대로" — 직전에 바꾼 항목과 방향을 이어받는다
  const more = planMore(msg, cmdMap, prevKeys, prevDirs);
  if (more) {
    const text = Object.entries(more.patches).map(([k, v]) => k + '=' + v).join(',');
    const base = planSingle(msg, cmdMap, []);
    return { ...base, keys: more.keys, inherited: true, unsupported: [], level: more.level, dir: more.flip ? -1 : 1, synth: { text, keys: Object.keys(more.patches), patches: more.patches, more: true } };
  }
  const whole = planSingle(msg, cmdMap, prevKeys);
  const parts = splitClauses(msg);
  // 절마다 자기 항목이 있어야 쪼갠다 — "더 얇고 연하게"처럼 뒷절이 앞절의 대상을 그대로 쓰는 말은 한 덩어리로 본다
  // 절마다 자기 항목이 있거나(별칭) 그 절만으로 값이 계산돼야 쪼갠다. "굵게"·"서체를 명조로"처럼 별칭이 없어도 계획이 서는 절을 빠뜨리지 않는다
  if (!parts || !parts.every(p => detectKnobHints(p).length > 0 || planSingle(p, cmdMap, []).synth)) return whole;
  let carry = '';
  const subs = [];
  for (const part of parts) {
    const el = part.match(ELEMENT_WORD);
    const text = el ? part : (carry ? carry + ' ' + part : part);
    if (el) carry = el[1] === '본문' ? '' : el[1]; // 본문은 기본 대상이라 이어받지 않는다("본문 행간"이 되면 본문 글자 크기까지 잡힌다)
    const p = planSingle(text, cmdMap, []);
    if (!p.synth || p.unsupported.length) return whole; // 한 절이라도 직접 계산이 안 되면 모델 판단에 맡긴다
    subs.push(p);
  }
  // 절마다 직접 말한 키가 우선이고, 짝으로 따라붙은 키(글자 크기에 딸린 행간 등)는 다른 절이 이미 정한 값을 덮어쓰지 않는다
  const patches = {};
  for (const p of subs) for (const [k, v] of Object.entries(p.synth.patches)) if (p.keys.includes(k) || !(k in patches)) patches[k] = v;
  const keys = [...new Set([...subs.flatMap(p => p.keys), ...Object.keys(patches)])];
  const text = Object.entries(patches).map(([k, v]) => k + '=' + v).join(',');
  return { ...whole, keys, synth: { text, keys: Object.keys(patches), patches, multi: true }, multi: true, unsupported: [] };
}

// ── 전체 인상: 여유 있게 / 빽빽하게 ─────────────────────────────────────────────
// 특정 항목 없이 "전체적으로 좀 비어 보이게", "다 시원하게", "전반적으로 꽉 차 보이게"처럼 말하면
// 여백 4면 + 본문 행간 + 문단 간격을 같은 방향으로 한 단계씩 움직인다. (값은 단계표로 코드가 계산)
const AIRY_RE = /(비어\s*보|휑하|여유\s*(?:있|롭|를)|넉넉|널널|느슨|숨통|시원(?:시원)?하게|공간.*(?:많|넓)|듬성)/;
const DENSE_RE = /(꽉\s*차|꽉꽉|빽빽하게\s*보|알차\s*보|조밀|밀도.*(?:높|있)|촘촘하게\s*보)/;
const GLOBAL_RE = /(전체|전반|전부|다\s*$|다\s+|통째로|문서\s*전체|페이지\s*전체|전반적)/;
export function planAiry(msg, cmdMap = {}) {
  const m = String(msg);
  if (ELEMENT_WORD.test(m.replace(/전체/g, ''))) return null; // 특정 요소를 말했으면 그 요소의 요청이다
  const airy = AIRY_RE.test(m);
  const dense = !airy && DENSE_RE.test(m) && GLOBAL_RE.test(m);
  if (!airy && !dense) return null;
  if (airy && !GLOBAL_RE.test(m) && !/(좀|조금|약간|많이|아주|매우|확|훨씬)/.test(m) && m.replace(/\s/g, '').length > 14) return null;
  const verb = airy ? ' 늘려' : ' 줄여';
  const margins = synthesizePatches(m + verb, ['marginTop', 'marginBottom', 'marginInner', 'marginOuter'], cmdMap);
  const rest = synthesizePatches(m + verb, ['bodyLeading', 'parSkip'], cmdMap);
  const patches = { ...(margins?.patches || {}), ...(rest?.patches || {}) };
  if (!Object.keys(patches).length) return null;
  return { patches, text: Object.entries(patches).map(([k, v]) => k + '=' + v).join(','), keys: Object.keys(patches), airy: true, level: (margins || rest).level, dir: airy ? 1 : -1 };
}

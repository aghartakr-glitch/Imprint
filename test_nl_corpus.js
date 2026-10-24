// 사용자가 실제로 입력할 만한 자연어 문장 100개와 기대 처리.
// want: 키 이름(예: 'parSkip') → 그 키 힌트가 붙어야 함
//       'unsupported' → 키 없음으로 "적용 불가" 힌트가 붙어야 함
//       'other' → 다른 전처리(판형, 재생성, 목차 등)에서 처리되어야 하므로 힌트 검사 제외
//       'intent' → 질문/의도 분류 경로에서 처리되어야 하므로 힌트 검사 제외
// 실행: node test_nl_corpus.js
import { pathToFileURL } from 'url';
import { detectKnobHints } from './src/nlKnobAliases.js';

export const CORPUS = [
  // ── 본문 크기·행간·굵기·서체·자간·정렬 (1~25) ──
  ['본문 글씨가 너무 작아서 읽기 힘들어', 'bodySize'],
  ['글자 좀 더 키워줘', 'bodySize'],
  ['본문 크기 한 포인트만 줄여줘', 'bodySize'],
  ['행간이 너무 붙어 있어서 답답해', 'bodyLeading'],
  ['줄 간격을 조금 더 벌려주세요', 'bodyLeading'],
  ['본문 줄 사이를 좀 촘촘하게', 'bodyLeading'],
  ['행간을 1.2배로 맞춰줘', 'bodyLeading'],
  ['글씨 줄 간격 좀 넓게 해줘', 'bodyLeading'],
  ['본문 굵기 조금만 더 진하게', 'bodyWeight'],
  ['본문 글자를 살짝 굵게', 'bodyWeight'],
  ['본문이 조금 가늘어 보여', 'bodyWeight'],
  ['본문 서체 좀 부드럽게 바꿔줘', 'bodyFontFamily'],
  ['본문을 바탕체로 바꿔줘', 'bodyFontFamily'],
  ['글씨체를 고딕 계열로 해줘', 'bodyFontFamily'],
  ['자간을 조금 넓혀줘', 'letterSpace'],
  ['글자 사이가 너무 빽빽해', 'letterSpace'],
  ['글자끼리 너무 붙어 보여', 'letterSpace'],
  ['단어 사이가 너무 벌어져 보여', 'wordSpace'],
  ['띄어쓰기 간격이 들쭉날쭉해', 'wordSpace'],
  ['줄 끝에 단어가 어색하게 잘려', 'hyphenation'],
  ['하이픈 넣지 말아줘', 'hyphenation'],
  ['왼쪽 정렬로 바꿔줘', 'bodyAlign'],
  ['양끝 정렬로 맞춰줘', 'bodyAlign'],
  ['양끝맞춤할 때 자간이 줄마다 달라', 'hangulTrack'],
  ['자간을 균일하게 맞춰줘', 'hangulTrack'],

  // ── 단락·들여쓰기 (26~33) ──
  ['문단 사이 간격을 좁혀줘', 'parSkip'],
  ['문단 간격 좀 더 띄워줘', 'parSkip'],
  ['단락이랑 단락 사이를 한 줄 띄우고 싶어', 'parSkip'],
  ['문단 첫 줄 들여쓰기 없애줘', 'parIndent'],
  ['들여쓰기 한 칸만 줄여줘', 'parIndent'],
  ['문단 구분이 잘 안 보여', 'parSkip'],
  ['문단이 너무 붙어 있어', 'parSkip'],
  ['문단 사이를 아예 없애고 싶어', 'parSkip'],

  // ── 제목·소제목 (34~49) ──
  ['제목을 더 크게 만들어줘', 'h1Size'],
  ['제목이 너무 커서 튀어', 'h1Size'],
  ['소제목 글씨를 본문보다 조금 크게', 'h2Size'],
  ['소제목이 본문이랑 구분이 안 가', 'h2Size'],
  ['제목을 좀 더 진하게', 'headingWeight'],
  ['제목을 가장 굵게 해줘', 'headingWeight'],
  ['소제목만 굵기를 올려줘', 'h2Weight'],
  ['제목을 왼쪽에 붙여줘', 'headingAlign'],
  ['제목 위치를 가운데로', 'headingAlign'],
  ['제목과 본문 사이 간격을 줄여줘', 'bodyGap'],
  ['제목 아래 여백이 너무 커', 'bodyGap'],
  ['제목 위 여백을 조금 늘려줘', 'headingSpaceBefore'],
  ['소제목 위쪽을 좀 띄워줘', 'headingSpaceBefore'],
  ['소제목이 페이지 끝에 혼자 있으면 안 돼', 'headingKeepLines'],
  ['제목이 쪽 맨 아래 떨어지지 않게', 'headingKeepLines'],
  ['제목과 부제 사이 간격 줄여줘', 'headingGap'],

  // ── 각주 (50~61) ──
  ['각주 글씨 조금 더 키워줘', 'noteSize'],
  ['각주 크기를 본문이랑 비슷하게', 'noteSize'],
  ['각주가 너무 빽빽해', 'noteLeading'],
  ['각주 사이 간격 좀 넓혀줘', 'footnoteSep'],
  ['본문이랑 각주 사이가 너무 붙어 있어', 'footinsSkip'],
  ['각주를 쪽번호 쪽으로 더 내려줘', 'footinsSkip'],
  ['각주 번호를 괄호 숫자로 바꿔줘', 'footnoteMarker'],
  ['각주 앞에 가로줄 넣어줘', 'footnoteRule'],
  ['각주 위 선 지워줘', 'footnoteRule'],
  ['각주만 명조체로 바꿔줘', 'footnoteFontFamily'],
  ['각주 글꼴을 본문과 다르게', 'footnoteFontFamily'],
  ['각주는 고딕으로 하고 본문은 명조로 유지해줘', 'footnoteFontFamily'],

  // ── 쪽번호·면주 (62~73) ──
  ['면주 글씨를 좀 작게', 'rhSize'],
  ['면주가 너무 튀어', 'rhSize'],
  ['면주 지워줘', 'rhPos'],
  ['면주 문구를 책 제목으로 바꿔줘', 'rhText'],
  ['쪽번호를 가운데 아래로 옮겨줘', 'pnPos'],
  ['쪽번호 크기를 좀 키워줘', 'pnSize'],
  ['쪽번호 바깥쪽으로', 'pnPos'],
  ['쪽번호가 너무 커', 'pnSize'],
  ['쪽수 표시 좀 작게', 'pnSize'],
  ['면주를 명조로', 'rhFontFamily'],
  ['쪽번호 서체는 고딕으로', 'pnFontFamily'],
  ['페이지 번호를 안 나오게 해줘', 'pnPos'],

  // ── 여백·판면 (74~80) ──
  ['위쪽 여백이 너무 많아', 'marginTop'],
  ['아래쪽 여백을 줄여줘', 'marginBottom'],
  ['안쪽 여백을 좀 넓혀줘', 'marginInner'],
  ['바깥 여백 좁혀줘', 'marginOuter'],
  ['본문 폭을 좁혀서 한 줄 길이를 줄여줘', 'margin'],
  ['한 줄이 너무 길어서 눈이 피곤해', 'margin'],
  ['책 두께를 줄여줘', 'unsupported'],

  // ── 단·레이아웃 (81~88) ──
  ['2단을 1단으로 바꿔줘', 'unsupported'],
  ['단 사이 간격 좀 더 넓혀줘', 'colGap'],
  ['본문 단을 세 개로 나눠줘', 'unsupported'],
  ['마지막 페이지 양쪽 단 높이 맞춰줘', 'unsupported'],
  ['각 쪽 마지막 줄이 혼자 남지 않게', 'unsupported'],
  ['문단 마지막 줄이 다음 쪽으로 넘어가', 'unsupported'],
  ['3쪽만 행간을 다르게 해줘', 'unsupported'],
  ['이 페이지만 제목을 크게', 'unsupported'],

  // ── 전체 확인·페이지 수 등 미지원 (89~93) ──
  ['지금까지 바꾼 것들이 전체 쪽에 다 적용됐는지 확인해줘', 'unsupported'],
  ['행간을 넓히는데 페이지 수는 그대로 두고 싶어', 'unsupported'],
  ['본문 분량을 줄여', 'unsupported'],
  ['목차를 넣어줘', 'unsupported'],
  ['표지 디자인을 바꿔줘', 'unsupported'],

  // ── 다른 경로에서 처리되어야 하는 것 (94~97) ──
  ['판형을 A5로 바꿔줘', 'other'],
  ['조판 스타일을 처음부터 다시 만들어줘', 'other'],
  ['이전 상태로 돌려줘', 'other'],
  ['왜 행간이 안 바뀌었어?', 'intent'],

  // ── 모호한 말투 (98~100) ──
  ['좀 더 편하게 읽히게 해줘', 'ambiguous'],
  ['뭔가 답답해 보여', 'ambiguous'],
  ['전체적으로 좀 고급스럽게', 'ambiguous'],
];

// 직접 실행했을 때만 검사한다 (다른 스크립트가 CORPUS만 가져다 쓸 수 있게)
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const failures = [];
  for (const [sentence, want] of CORPUS) {
    if (['other', 'intent', 'ambiguous'].includes(want)) continue;
    const hits = detectKnobHints(sentence);
    const ok = want === 'unsupported'
      ? hits.some(h => h.unsupported)
      : want === 'margin'
        ? hits.some(h => ['marginTop', 'marginBottom', 'marginInner', 'marginOuter'].includes(h.key))
        : hits.some(h => h.key === want);
    if (!ok) failures.push({ sentence, want, got: hits.map(h => h.key ?? `미지원:${h.unsupported.slice(0, 18)}`) });
  }
  const checked = CORPUS.filter(([, w]) => !['other', 'intent', 'ambiguous'].includes(w)).length;
  console.log(`전체 ${CORPUS.length}문장 중 힌트 검사 ${checked}개, 실패 ${failures.length}개`);
  for (const f of failures) {
    console.log(`- "${f.sentence}"  기대: ${f.want}  실제: ${f.got.length ? f.got.join(', ') : '(힌트 없음)'}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

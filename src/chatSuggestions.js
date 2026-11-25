// 채팅 추천 문장 풀 — docs/nl_corpus_100.md(힌트 매칭 통과분)에서 추출. [문장, 기대 키]
// 키는 현재 문서에 해당 요소가 있을 때만 추천하도록 거르는 데 쓴다 (chatSuggestions.js의 pickSuggestions 참고).
export const SUGGESTION_POOL = [
  [ "본문 글씨가 너무 작아서 읽기 힘들어", "bodySize" ],
  [ "글자 좀 더 키워줘", "bodySize" ],
  [ "본문 크기 한 포인트만 줄여줘", "bodySize" ],
  [ "행간이 너무 붙어 있어서 답답해", "bodyLeading" ],
  [ "줄 간격을 조금 더 벌려주세요", "bodyLeading" ],
  [ "본문 줄 사이를 좀 촘촘하게", "bodyLeading" ],
  [ "행간을 1.2배로 맞춰줘", "bodyLeading" ],
  [ "글씨 줄 간격 좀 넓게 해줘", "bodyLeading" ],
  [ "본문 굵기 조금만 더 진하게", "bodyWeight" ],
  [ "본문 글자를 살짝 굵게", "bodyWeight" ],
  [ "본문이 조금 가늘어 보여", "bodyWeight" ],
  [ "본문 서체 좀 부드럽게 바꿔줘", "bodyFontFamily" ],
  [ "본문을 바탕체로 바꿔줘", "bodyFontFamily" ],
  [ "글씨체를 고딕 계열로 해줘", "bodyFontFamily" ],
  [ "자간을 조금 넓혀줘", "letterSpace" ],
  [ "글자 사이가 너무 빽빽해", "letterSpace" ],
  [ "글자끼리 너무 붙어 보여", "letterSpace" ],
  [ "단어 사이가 너무 벌어져 보여", "wordSpace" ],
  [ "띄어쓰기 간격이 들쭉날쭉해", "wordSpace" ],
  [ "줄 끝에 단어가 어색하게 잘려", "hyphenation" ],
  [ "하이픈 넣지 말아줘", "hyphenation" ],
  [ "왼쪽 정렬로 바꿔줘", "bodyAlign" ],
  [ "양끝 정렬로 맞춰줘", "bodyAlign" ],
  [ "양끝맞춤할 때 자간이 줄마다 달라", "hangulTrack" ],
  [ "자간을 균일하게 맞춰줘", "hangulTrack" ],
  [ "문단 사이 간격을 좁혀줘", "parSkip" ],
  [ "문단 간격 좀 더 띄워줘", "parSkip" ],
  [ "단락이랑 단락 사이를 한 줄 띄우고 싶어", "parSkip" ],
  [ "문단 첫 줄 들여쓰기 없애줘", "parIndent" ],
  [ "들여쓰기 한 칸만 줄여줘", "parIndent" ],
  [ "문단 구분이 잘 안 보여", "parSkip" ],
  [ "문단이 너무 붙어 있어", "parSkip" ],
  [ "문단 사이를 아예 없애고 싶어", "parSkip" ],
  [ "제목을 더 크게 만들어줘", "h1Size" ],
  [ "제목이 너무 커서 튀어", "h1Size" ],
  [ "소제목 글씨를 본문보다 조금 크게", "h2Size" ],
  [ "소제목이 본문이랑 구분이 안 가", "h2Size" ],
  [ "제목을 좀 더 진하게", "headingWeight" ],
  [ "제목을 가장 굵게 해줘", "headingWeight" ],
  [ "소제목만 굵기를 올려줘", "h2Weight" ],
  [ "제목을 왼쪽에 붙여줘", "headingAlign" ],
  [ "제목 위치를 가운데로", "headingAlign" ],
  [ "제목과 본문 사이 간격을 줄여줘", "bodyGap" ],
  [ "제목 아래 여백이 너무 커", "bodyGap" ],
  [ "제목 위 여백을 조금 늘려줘", "headingSpaceBefore" ],
  [ "소제목 위쪽을 좀 띄워줘", "headingSpaceBefore" ],
  [ "소제목이 페이지 끝에 혼자 있으면 안 돼", "headingKeepLines" ],
  [ "제목이 쪽 맨 아래 떨어지지 않게", "headingKeepLines" ],
  [ "제목과 부제 사이 간격 줄여줘", "headingGap" ],
  [ "각주 글씨 조금 더 키워줘", "noteSize" ],
  [ "각주 크기를 본문이랑 비슷하게", "noteSize" ],
  [ "각주가 너무 빽빽해", "noteLeading" ],
  [ "각주 사이 간격 좀 넓혀줘", "footnoteSep" ],
  [ "본문이랑 각주 사이가 너무 붙어 있어", "footinsSkip" ],
  [ "각주를 쪽번호 쪽으로 더 내려줘", "footinsSkip" ],
  [ "각주 번호를 괄호 숫자로 바꿔줘", "footnoteMarker" ],
  [ "각주 앞에 가로줄 넣어줘", "footnoteRule" ],
  [ "각주 위 선 지워줘", "footnoteRule" ],
  [ "각주만 명조체로 바꿔줘", "footnoteFontFamily" ],
  [ "각주 글꼴을 본문과 다르게", "footnoteFontFamily" ],
  [ "각주는 고딕으로 하고 본문은 명조로 유지해줘", "footnoteFontFamily" ],
  [ "면주 글씨를 좀 작게", "rhSize" ],
  [ "면주가 너무 튀어", "rhSize" ],
  [ "면주 지워줘", "rhPos" ],
  [ "면주 문구를 책 제목으로 바꿔줘", "rhText" ],
  [ "쪽번호를 가운데 아래로 옮겨줘", "pnPos" ],
  [ "쪽번호 크기를 좀 키워줘", "pnSize" ],
  [ "쪽번호 바깥쪽으로", "pnPos" ],
  [ "쪽번호가 너무 커", "pnSize" ],
  [ "쪽수 표시 좀 작게", "pnSize" ],
  [ "면주를 명조로", "rhFontFamily" ],
  [ "쪽번호 서체는 고딕으로", "pnFontFamily" ],
  [ "페이지 번호를 안 나오게 해줘", "pnPos" ],
  [ "위쪽 여백이 너무 많아", "marginTop" ],
  [ "아래쪽 여백을 줄여줘", "marginBottom" ],
  [ "안쪽 여백을 좀 넓혀줘", "marginInner" ],
  [ "바깥 여백 좁혀줘", "marginOuter" ],
  [ "본문 폭을 좁혀서 한 줄 길이를 줄여줘", "margin" ],
  [ "한 줄이 너무 길어서 눈이 피곤해", "margin" ],
  [ "단 사이 간격 좀 더 넓혀줘", "colGap" ],
  // 요소별 색·꾸밈·특수 요청 (docs 로그 기반 — 코드가 직접 처리하는 문장들)
  [ "각주만 연하게 해줘", "noteStyle" ],
  [ "각주 번호만 빨간색으로 바꿔줘", "markStyle" ],
  [ "쪽번호만 초록색으로", "pnStyle" ],
  [ "면주만 보라색으로 해줘", "rhStyle" ],
  [ "제목 빨강에 밑줄 넣어줘", "h1Style" ],
  [ "소제목 파랑 기울임으로", "h2Style" ],
  [ "따옴표 안에 있는 글자만 파랑색으로", "quoteHighlight" ],
  [ "따옴표 안 글자만 고딕으로 바꿔줘", "quoteFont" ],
  [ "따옴표 안 내용 빨강 굵게 밑줄", "quoteDeco" ],
  [ "따옴표 아닌 본문만 빨간색으로", "bodyStyle" ],
  [ "문단 첫 글자만 겁나 크게", "dropCap" ],
  [ "단락 첫 글자만 빨강으로", "dropCapColor" ],
  [ "특수문자만 색 바꿔줘 빨강으로", "symbolStyle" ],
  [ "쪽번호 4배로 키워줘", "pnSizeMul" ],
  [ "제목 크기 두 배로", "h1SizeMul" ],
  [ "각주 줄간격을 본문이랑 똑같이", "noteLeadingSame" ],
  [ "각주 덩어리를 조금 위로 올려줘", "footnoteShift" ]
];

// 기대 키 → 현재 문서에 그 요소가 실제로 있는지. 없는 요소를 건드리는 문장은 추천하지 않는다
// (예: 면주가 꺼진 문서에 "면주 글씨 키워줘"를 추천하면 곧바로 "적용 불가"가 돌아온다).
const GATES = {
  rhText: m => m.rhText !== undefined,
  rhPos: m => m.rhPos !== undefined,
  rhSize: m => m.rhSize !== undefined,
  rhFontFamily: m => m.rhSize !== undefined,
  pnPos: m => m.pnPos !== undefined,
  pnSize: m => m.pnSize !== undefined,
  pnFontFamily: m => m.pnSize !== undefined,
  noteSize: m => m.noteSize !== undefined,
  noteLeading: m => m.noteSize !== undefined,
  footnoteSep: m => m.footnoteSep !== undefined || m.noteSize !== undefined,
  footnoteMarker: m => m.noteSize !== undefined,
  footnoteRule: m => m.noteSize !== undefined,
  footnoteFontFamily: m => m.noteSize !== undefined,
  footinsSkip: m => m.noteSize !== undefined,
  colGap: m => m.colGap !== undefined,
  noteStyle: m => m.noteSize !== undefined,
  markStyle: m => m.noteSize !== undefined,
  pnStyle: m => m.pnSize !== undefined,
  rhStyle: m => m.rhSize !== undefined,
  pnSizeMul: m => m.pnSize !== undefined,
  noteLeadingSame: m => m.noteSize !== undefined,
  footnoteShift: m => m.noteSize !== undefined,
};

// cmdMap: extractLatexCommandMap 결과. sentHistory: 지금까지 사용자가 보낸 문장들.
// prev: 직전에 보여준 3개 (연속으로 같은 걸 또 보여주지 않으려고).
// 같은 키에서 하나만 뽑아 3개가 서로 다른 종류의 수정이 되게 한다.
export function pickSuggestions(cmdMap, sentHistory = [], prev = [], n = 3) {
  const sent = new Set(sentHistory.map(s => s.trim()));
  const avoid = new Set(prev);
  const ok = SUGGESTION_POOL.filter(([text, key]) => !sent.has(text) && (!GATES[key] || GATES[key](cmdMap || {})));
  const fresh = ok.filter(([text]) => !avoid.has(text));
  const pool = fresh.length >= n * 2 ? fresh : ok; // 후보가 너무 적으면 직전 것도 허용
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const picked = [], usedKeys = new Set();
  for (const [text, key] of shuffled) {
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    picked.push(text);
    if (picked.length === n) break;
  }
  return picked;
}

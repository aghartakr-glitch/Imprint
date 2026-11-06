// 문단 들여쓰기 — 생성되는 main.tex는 본문 문단마다 {\bodyf\noindent …}로 시작해서 \parindent를 아무리 키워도 들여쓰기가 나오지 않는다.
// 들여쓰기를 켤 때는 본문 문단의 \noindent를 걷어내고(제목 바로 다음 첫 문단은 관례대로 유지), 0으로 끌 때는 다시 붙인다.
const BODY_NOINDENT = /\{\\bodyf\\noindent[ \t]*/g;
const BODY_PLAIN = /\{\\bodyf[ \t]+(?=[^\\\s{}])/g;

// tex 본문에서 몇 문단이 들여쓰기를 막고 있는지
export const countBlockedParagraphs = tex => (String(tex).match(BODY_NOINDENT) || []).length;

// on=true: 첫 문단을 뺀 모든 본문 문단의 \noindent 제거 / on=false: 본문 문단에 \noindent 복구
export function applyParIndentToTex(tex, on) {
  const s = String(tex);
  if (on) {
    let first = true;
    return s.replace(BODY_NOINDENT, m => { if (first) { first = false; return m; } return '{\\bodyf '; });
  }
  return s.replace(BODY_PLAIN, '{\\bodyf\\noindent ');
}

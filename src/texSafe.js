// main.tex 본문에서 글자를 감싸는 기능(따옴표 색·특수문자 서체·첫 글자 확대 등)이 건드리면 안 되는 줄을 지킨다.
// "\XeTeXlinebreaklocale “ko”" 줄의 “ko”가 따옴표 구절로 오인돼 \imprintHL{“ko”}로 감싸지면 "ko"가 글자로 찍힌다(화면 위쪽에 보이던 ko).
const LOCALE_LINE = /\\XeTeXlinebreaklocale/;

// 줄 단위로 fn을 적용하되 설정 줄(\XeTeXlinebreaklocale 등)은 그대로 둔다
export const mapSafeLines = (text, fn) => String(text).split('\n').map(l => (LOCALE_LINE.test(l) ? l : fn(l))).join('\n');

// 이미 \imprintHL{…}·\imprintSym{…}로 감싸진 로케일 값을 원래대로 벗긴다("ko" 글자가 찍히던 기존 문서 복구). 원래 값(“ko”)은 그대로 둔다
export function fixLocaleLine(tex) {
  return String(tex).replace(/^(\\XeTeXlinebreaklocale[ \t]*)(.*)$/gm, (m, pre, val) => {
    const plain = val.replace(/\\imprint(?:HL|Sym)\{([^{}]*)\}/g, '$1').trim();
    return `${pre}${plain}`;
  });
}

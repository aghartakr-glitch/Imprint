// 자판이 갈라져 들어간 한글("ㅍ ㅏ랑색", "ㅍㅏ랑")을 글자로 합친다 — 초성+모음이 따로 떨어진 것만 합치고 나머지는 그대로 둔다.
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';

export function composeJamo(text) {
  return String(text).replace(/([ㄱ-ㅎ])[ \t]?([ㅏ-ㅣ])/g, (m, c, v) => {
    const ci = CHO.indexOf(c), vi = JUNG.indexOf(v);
    if (ci < 0 || vi < 0) return m;
    return String.fromCharCode(0xAC00 + (ci * 21 + vi) * 28);
  });
}

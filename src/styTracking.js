// 자간(글자 사이 간격) — 한글에는 fontspec LetterSpace가 전혀 먹지 않는다(xelatex 실측: 값을 0→10으로 바꿔도 한글 폭 동일).
// 영문은 fontspec LetterSpace(em의 %), 한글은 xetexko의 InterHangul 폰트 옵션(명조)과 selectfont 훅(고딕)으로
// 음절 사이 간격(em)을 준다. 두 값을 같은 크기로 맞춰서 한 키(letterSpace, 단위 em의 %)로 다룬다.
import { readFonts, serifHangulLine } from './styFonts.js';

const MARK = '% imprintTrack';

const fmt = n => String(Number(Number(n).toFixed(4)));

export function trackingLines(pct, sty = '') {
  const em = fmt(Number(pct) / 100);
  return [
    serifHangulLine(readFonts(sty).serif, em, MARK),
    `\\ifdefined\\setmainhangulfont\\AddToHook{selectfont}{\\def\\xetexkointerhchar{${em}em}}\\fi ${MARK}`,
  ];
}

function appendBeforeEndinput(sty, text) {
  if (/\\endinput\s*$/.test(sty)) return sty.replace(/\\endinput\s*$/, `${text}\n\\endinput\n`);
  return sty + '\n' + text + '\n';
}

// .sty에 자간 pct(em의 %)를 적용한다. 값이 숫자가 아니면 그대로 돌려준다.
export function applyTracking(sty, pct) {
  const v = Number(pct);
  if (!Number.isFinite(v)) return sty;
  let out = sty;
  if (/LetterSpace=/.test(out)) out = out.replace(/(LetterSpace=)[-\d.]+/g, `$1${fmt(v)}`);
  else out = out.replace(/(Path=\.\/fonts\/,)/g, `$1\n  LetterSpace=${fmt(v)},`);
  out = out.replace(/^.*% imprintTrack.*\r?\n?/gm, '');
  return appendBeforeEndinput(out, trackingLines(v, out).join('\n'));
}

// 현재 자간(em의 %) — 한글 줄이 있으면 그 값을, 없으면 영문 LetterSpace 값을 읽는다.
export function readTracking(sty) {
  const h = String(sty).match(/InterHangul=([-\d.]+)em/);
  if (h) return fmt(Number(h[1]) * 100);
  const l = String(sty).match(/LetterSpace=([-\d.]+)/);
  return l ? l[1] : undefined;
}

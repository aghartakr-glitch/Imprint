// 각주 굵기 — 보통보다 더 가늘게(Light). 지금 폰트(Pretendard)에는 Light 파일이 있으므로 각주(\notef)에만 Light 서체를 쓴다.
// 가는 굵기는 고딕(Pretendard)일 때만 가능하다: 명조 각주는 Light 폰트가 없어 보통으로 둔다.
const MARK = '% imprintNoteLight';
const LIGHT_DEF = '\\newfontfamily\\imprintLightSans{Pretendard}[Path=./fonts/,Extension=.otf,UprightFont=Pretendard-Light,BoldFont=Pretendard-Regular]';

function appendBeforeEndinput(sty, text) {
  if (/\\endinput\s*$/.test(sty)) return sty.replace(/\\endinput\s*$/, `${text}\n\\endinput\n`);
  return sty + '\n' + text + '\n';
}

const NOTEF = /(\\newcommand\{\\notef\}\{)(\\imprintLightSans|\\sffamily|\\rmfamily|\\normalfont)?/;

export const isNoteLight = sty => /\\newcommand\{\\notef\}\{\\imprintLightSans/.test(String(sty));

// 각주 서체 계열이 고딕이면 Light 가능
export const canNoteLight = sty => {
  const m = String(sty).match(NOTEF);
  return !!m && (m[2] === '\\sffamily' || m[2] === '\\imprintLightSans');
};

// on=true: 각주를 Light로, false: 원래 고딕(보통)으로 되돌린다. 고딕이 아니면 그대로 돌려준다.
export function applyNoteLight(sty, on) {
  let out = String(sty);
  if (on) {
    if (!canNoteLight(out)) return out;
    out = out.replace(NOTEF, (m, pre) => `${pre}\\imprintLightSans`);
    if (!/% imprintNoteLight/.test(out)) out = appendBeforeEndinput(out, `${LIGHT_DEF} ${MARK}`);
    return out;
  }
  out = out.replace(/(\\newcommand\{\\notef\}\{)\\imprintLightSans/, '$1\\sffamily');
  return out.replace(/^.*% imprintNoteLight.*\r?\n?/gm, '');
}

// 각주 번호 모양 — 각주 목록의 번호(\ImpNoteLabel)와 본문 속 위첨자 번호를 함께 바꾼다.
// 기본 점(1.), 대괄호([1]), 소괄호(1)), 동그라미(①처럼 원 안의 숫자). 동그라미는 본문 위첨자도 원으로 만든다.
const FORMS = {
  dot:     '#1.\\ ',
  bracket: '[#1]\\ ',
  paren:   '#1)\\ ',
  circle:  '\\textcircled{\\scriptsize #1}\\ ',
};
const CIRCLE_MARK = '% imprintFnCircle';
export const NOTE_MARKER_VALUES = Object.keys(FORMS);

function appendBeforeEndinput(sty, text) {
  if (/\\endinput\s*$/.test(sty)) return sty.replace(/\\endinput\s*$/, `${text}\n\\endinput\n`);
  return sty + '\n' + text + '\n';
}

export function applyNoteMarker(sty, val) {
  const form = FORMS[val];
  if (!form) return sty;
  let out = String(sty).replace(/^.*% imprintFnCircle.*\r?\n?/gm, '');
  const labelRe = /^\\newcommand\{\\ImpNoteLabel\}\[1\]\{.*\}[ \t]*$/m;
  if (labelRe.test(out)) out = out.replace(labelRe, () => `\\newcommand{\\ImpNoteLabel}[1]{${form}}`);
  else out = appendBeforeEndinput(out, `\\newcommand{\\ImpNoteLabel}[1]{${form}}`);
  if (val === 'circle') {
    out = appendBeforeEndinput(out, `\\makeatletter\\renewcommand\\@makefnmark{\\hbox{\\@textsuperscript{\\textcircled{\\tiny\\@thefnmark}}}}\\makeatother ${CIRCLE_MARK}`);
  }
  return out;
}

export function readNoteMarker(sty) {
  const s = String(sty);
  if (/% imprintFnCircle/.test(s)) return 'circle';
  const m = s.match(/\\newcommand\{\\ImpNoteLabel\}\[1\]\{(.*)\}[ \t]*$/m);
  if (!m) return undefined;
  if (/textcircled/.test(m[1])) return 'circle';
  if (m[1].startsWith('[')) return 'bracket';
  if (/#1\)/.test(m[1])) return 'paren';
  return 'dot';
}

// 자연어 — "각주 번호를 동그라미로", "각주 표시 소괄호로"
export function planNoteMarker(msg = '') {
  const m = String(msg);
  if (!/(각주|주석)/.test(m) || !/(번호|표시|숫자|기호|넘버|마크)/.test(m)) return null;
  if (!/(바꿔|바꾸|변경|해줘|하고\s*싶|로\s*해|으로\s*해|로\s*써|으로\s*써|주세요|(?:으?로)\s*$)/.test(m)) return null;
  if (/(동그라미|원\s*숫자|원문자|원\s*안|○|⓵|①|서클|circle)/i.test(m)) return { patches: { footnoteMarker: 'circle' } };
  if (/(소괄호|괄호\s*숫자|\(1\)|1\))/.test(m) && !/대괄호/.test(m)) return { patches: { footnoteMarker: 'paren' } };
  if (/(대괄호|\[1\]|네모\s*괄호)/.test(m)) return { patches: { footnoteMarker: 'bracket' } };
  if (/(점|1\.|마침표|기본)/.test(m)) return { patches: { footnoteMarker: 'dot' } };
  return null;
}

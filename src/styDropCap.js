// 문단 첫 글자 키우기 — 본문 문단 맨 앞 글자를 \imprintDrop{글자}로 감싸고, 확대 배율은 sty의 \imprintDrop 정의 한 줄(% imprintDropCap)로 정한다.
// 글자 크기·행간(본문 전체)은 건드리지 않는다. 켜기/배율 바꾸기/끄기를 여러 번 해도 겹치지 않는다.
const MARK = '% imprintDropCap';
export const DROP_STEPS = [1.3, 1.6, 2, 2.6, 3.3]; // 아주 조금 ~ 아주 많이
const PARA_HEAD = /(\{\\bodyf(?:\\noindent)?[ \t]+)(\\imprintDrop\{[^{}]*\}|[‘“'"([]?[^\s\\{}%])/g;

function appendBeforeEndinput(sty, text) {
  if (/\\endinput\s*$/.test(sty)) return sty.replace(/\\endinput\s*$/, `${text}\n\\endinput\n`);
  return sty + '\n' + text + '\n';
}

export function readDropCap(sty) {
  const m = String(sty).match(/% imprintDropCap ([\d.]+)/);
  return m ? m[1] : undefined;
}

export const countDropCaps = tex => (String(tex).match(/\\imprintDrop\{/g) || []).length;

// scale <= 1 이면 끈다. { sty, tex }를 돌려준다.
export function applyDropCap(sty, tex, scale) {
  const v = Number(scale);
  let outSty = String(sty).replace(/^.*% imprintDropCap.*\r?\n?/gm, '');
  // 이미 감싼 글자는 벗기고 다시 감싼다 — 같은 글자가 두 번 감싸지지 않게
  let outTex = String(tex).replace(/\\imprintDrop\{([^{}]*)\}/g, '$1');
  if (!Number.isFinite(v) || v <= 1) return { sty: outSty, tex: outTex };
  const s = Math.min(6, v);
  // 2.6배 이상이면 글자가 첫 줄 높이를 밀어내 문단 위가 벌어지므로, 줄 높이를 본문 한 줄로 고정(\raisebox[높이][깊이])해 줄 간격 격자를 유지한다
  const big = s >= 2.6;
  const open = big ? '\\raisebox{0pt}[\\ht\\strutbox][\\dp\\strutbox]{' : '';
  const close = big ? '}' : '';
  outSty = appendBeforeEndinput(outSty,
    // \f@size 같은 @ 이름을 쓰므로 \makeatletter로 감싼다(.sty 앞쪽의 \makeatother 뒤에서는 @가 글자가 아니다)
    `\\makeatletter\\providecommand{\\imprintDrop}[1]{}\\renewcommand{\\imprintDrop}[1]{{${open}\\fontsize{\\dimexpr${s}\\dimexpr\\f@size pt\\relax\\relax}{\\f@baselineskip}\\selectfont #1${close}}}\\makeatother ${MARK} ${s}`);
  outTex = outTex.replace(PARA_HEAD, (m, head, ch) => `${head}\\imprintDrop{${ch}}`);
  return { sty: outSty, tex: outTex };
}

// 자연어 — "문단 시작 첫 글자만 겁나 크게", "첫 글자 조금만 키워", "드롭캡 없애줘"
const HEAD_RE = /((?:문단|단락|본문)\s*(?:의\s*)?)?(시작|첫)\s*(?:글자|글씨|문자)|드롭\s*캡|대문자\s*처럼/;
export function planDropCap(msg = '', level = 3) {
  const m = String(msg);
  if (!HEAD_RE.test(m)) return null;
  if (/(없애|지워|빼\s*줘|해제|원래대로|취소)/.test(m)) return { patches: { dropCap: '1' } };
  if (/(작게|줄여|줄이)/.test(m) && !/(키워|크게)/.test(m)) return { patches: { dropCap: '1' } }; // 줄이기는 끄기로 처리
  const L = Math.max(1, Math.min(5, level));
  return { patches: { dropCap: String(DROP_STEPS[L - 1]) } };
}

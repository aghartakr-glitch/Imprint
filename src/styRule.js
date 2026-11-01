// 각주 구분선 — 켜기/끄기, 가로 길이(판면 폭 %), 두께(pt), 진하기(검정 %)를 한 줄(% imprintRule)로 관리한다.
// 예전 방식(\renewcommand{\footnoterule}{[^}]*} 정규식)은 줄 안에 중괄호가 들어가면 반만 바꿔 "Too many }'s" 컴파일 오류를 냈다.
const MARK = '% imprintRule';
export const RULE_DEFAULT = { on: false, width: 40, thickness: 0.4, darkness: 100 };
export const RULE_KEYS = ['footnoteRule', 'footnoteRuleWidth', 'footnoteRuleThickness', 'footnoteRuleColor'];

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const fmt = n => String(Number(Number(n).toFixed(2)));

function appendBeforeEndinput(sty, text) {
  if (/\\endinput\s*$/.test(sty)) return sty.replace(/\\endinput\s*$/, `${text}\n\\endinput\n`);
  return sty + '\n' + text + '\n';
}

export function readRule(sty) {
  const s = String(sty);
  const m = s.match(/% imprintRule (on|off) ([\d.]+) ([\d.]+) ([\d.]+)/);
  if (m) return { on: m[1] === 'on', width: Number(m[2]), thickness: Number(m[3]), darkness: Number(m[4]) };
  // 예전에 만들어진 줄 — 비어 있으면 끔, hrule이 있으면 켬(두께·길이는 기본값)
  const line = s.match(/^\\renewcommand\{\\footnoterule\}(.*)$/m);
  if (!line) return undefined;
  const on = /hrule|rule\{/.test(line[1]);
  return { ...RULE_DEFAULT, on };
}

// patch: { on, width, thickness, darkness } 중 바꿀 것만. 줄이 없던 문서도 처리한다.
export function applyRule(sty, patch) {
  const cur = readRule(sty) || RULE_DEFAULT;
  const next = {
    on: patch.on === undefined ? cur.on : !!patch.on,
    width: patch.width === undefined ? cur.width : num(patch.width, 10, 100, cur.width),
    thickness: patch.thickness === undefined ? cur.thickness : num(patch.thickness, 0.1, 3, cur.thickness),
    darkness: patch.darkness === undefined ? cur.darkness : num(patch.darkness, 5, 100, cur.darkness),
  };
  let out = String(sty).replace(/^\\renewcommand\{\\footnoterule\}.*\r?\n?/gm, '').replace(/^.*% imprintRule.*\r?\n?/gm, '');
  const line = next.on
    ? `\\RequirePackage{xcolor}\\renewcommand{\\footnoterule}{\\vspace*{-3pt}{\\color{black!${fmt(next.darkness)}}\\hrule width ${fmt(next.width / 100)}\\linewidth height ${fmt(next.thickness)}pt}\\vspace*{2.6pt}} ${MARK} on ${fmt(next.width)} ${fmt(next.thickness)} ${fmt(next.darkness)}`
    : `\\renewcommand{\\footnoterule}{} ${MARK} off ${fmt(next.width)} ${fmt(next.thickness)} ${fmt(next.darkness)}`;
  return appendBeforeEndinput(out, line);
}

// 자연어 — 구분선의 길이·두께·진하기·켜기/끄기. 단계표로 직접 계산한다.
const STEPS_ADD = [5, 10, 20, 30, 40];             // 길이(%p)
const STEPS_THICK = [0.9, 0.8, 0.65, 0.5, 0.35];    // 두께 배율(얇게)
const STEPS_DARK = [8, 15, 25, 40, 55];            // 진하기(%p)
export function planRule(msg = '', cmdMap = {}, level = 3) {
  const m = String(msg);
  if (!/(구[붆붑불분]\s*선|각주\s*선|각주\s*위\s*(?:의\s*)?선|가로줄)/.test(m)) return null;
  const cur = { ...RULE_DEFAULT, width: Number(cmdMap.footnoteRuleWidth ?? RULE_DEFAULT.width), thickness: Number(cmdMap.footnoteRuleThickness ?? RULE_DEFAULT.thickness), darkness: Number(cmdMap.footnoteRuleColor ?? RULE_DEFAULT.darkness) };
  const patches = {};
  const L = Math.max(1, Math.min(5, level)) - 1;
  if (/(없애|지워|빼\s*줘|빼고|제거|숨겨|안\s*보이게)/.test(m)) return { patches: { footnoteRule: 'off' } };
  if (/(넣어|추가|그어|보이게|켜)/.test(m)) patches.footnoteRule = 'on';
  // 길이 — "여백에 맞게/꽉 차게/전체 폭"은 판면 폭 전체
  if (/(여백에\s*맞|꽉\s*차|전체\s*폭|판면\s*(?:폭|너비)|가로\s*(?:전체|끝까지)|끝까지)/.test(m)) patches.footnoteRuleWidth = '100';
  else if (/(가로|길이|너비|폭)/.test(m) || /(길게|짧게)/.test(m)) {
    if (/(늘려|늘리|넓|길게|길어|키워|크게)/.test(m)) patches.footnoteRuleWidth = fmt(Math.min(100, cur.width + STEPS_ADD[L]));
    else if (/(줄여|줄이|좁|짧게|짧아|작게)/.test(m)) patches.footnoteRuleWidth = fmt(Math.max(10, cur.width - STEPS_ADD[L]));
  }
  // 두께
  if (/(얇|가늘|가볍게)/.test(m)) patches.footnoteRuleThickness = fmt(Math.max(0.1, cur.thickness * STEPS_THICK[L]));
  else if (/(두껍|굵|두텁)/.test(m)) patches.footnoteRuleThickness = fmt(Math.min(3, cur.thickness / STEPS_THICK[L]));
  // 진하기(색)
  if (/(연하|흐리|옅|희미|엷)/.test(m)) patches.footnoteRuleColor = fmt(Math.max(5, cur.darkness - STEPS_DARK[L]));
  else if (/(진하|짙|까맣|검게|선명|또렷)/.test(m)) patches.footnoteRuleColor = fmt(Math.min(100, cur.darkness + STEPS_DARK[L]));
  return Object.keys(patches).length ? { patches } : null;
}

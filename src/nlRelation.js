// 한계로 남아 있던 두 가지를 코드로 처리한다. (API 호출 없음)
//  1) 방향 없는 후속 발화 — "조금만 더", "더더더더", "한 번 더", "반대로": 직전에 바꾼 항목과 그 방향을 기억해 이어서 적용(반대로는 뒤집기)
//  2) 다른 요소를 기준으로 한 크기 — "주석을 본문보다 차이나게 작게", "소제목을 제목과 같게": 기준 요소의 크기에 비율을 곱해 정한다
import { synthesizePatches, detectIntensity, normalizeMsg } from './nlIntensity.js';

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const r2 = n => String(Math.round(n * 100) / 100);

// ── 1) 이어서 / 반대로 ───────────────────────────────────────────────────
const FLIP_RE = /(반대로|거꾸로|역으로|반대\s*방향)/;
const MORE_RE = /^(?:조금|좀|약간|살짝|아주|많이|한\s*번|또|계속|다시|더|조금만|좀만)?\s*(?:만\s*)?(?:더+|또|한\s*번\s*더|계속|다시|한\s*번\s*더\s*해|더\s*해)(?:\s*(?:해줘|해|줘|주세요|해주세요|부탁))?[\s.!?~'"]*$/;

export function planMore(msg = '', cmdMap = {}, prevKeys = [], prevDirs = {}) {
  const raw = String(msg).trim();
  const compact = raw.replace(/[\s.!?~'"]+/g, '');
  if (!prevKeys.length || compact.length === 0 || compact.length > 12) return null;
  const flip = FLIP_RE.test(raw);
  const more = !flip && (MORE_RE.test(raw) || /^더{2,}$/.test(compact) || /^(?:더|또)(?:더|또)*(?:해줘|해)?$/.test(compact));
  if (!flip && !more) return null;
  // 방향이 기록된 키만 이어간다(서체·위치처럼 방향이 없는 항목은 제외)
  const keys = prevKeys.filter(k => prevDirs[k]);
  if (!keys.length) return null;
  // 강도: "조금만 더"는 조금, "더더더더"는 더 많이
  const dCount = (compact.match(/더/g) || []).length;
  let level = detectIntensity(raw).level;
  if (dCount >= 4) level = 5; else if (dCount === 3) level = 4; else if (dCount === 2 && level < 4) level = Math.max(level, 4);
  const patches = {};
  for (const k of keys) {
    const dir = flip ? -prevDirs[k] : prevDirs[k];
    const forcedMsg = (dir > 0 ? '늘려' : '줄여') + ' ' + ['아주 조금', '조금', '적당히', '많이', '아주 많이'][Math.min(4, Math.max(0, level - 1))];
    const s = synthesizePatches(forcedMsg, [k], cmdMap);
    if (s) Object.assign(patches, s.patches);
  }
  if (!Object.keys(patches).length) return null;
  return { patches, level, flip, keys };
}

// ── 3) 가로 폭 맞추기 ──────────────────────────────────────────────────────
// "소제목도 제목 가로 폭에 맞춰서 키워줘" — 글자 수(한글=1, 영문·숫자·공백≈0.55)로 두 줄의 폭을 어림해,
// 대상 글자 크기 = 기준 글자 크기 × (기준 글자 수 ÷ 대상 글자 수) 로 맞춘다. 제목·소제목 본문 글자는 cmdMap의 h1Chars/h2Chars에 있다.
export function planWidthFit(msg = '', cmdMap = {}) {
  const m = String(msg);
  if (!/(가로\s*폭|가로\s*길이|가로\s*너비|폭|너비)\s*(?:에|과|와|랑|이랑)?\s*(맞춰|맞게|맞추|같게|같은|꽉\s*차게|똑같)/.test(m)) return null;
  const sub = m.match(/(소제목|부제목|부제)/), main = m.match(/(?<![소부])(제목|타이틀|표제)/);
  if (!sub || !main) return null;
  const target = sub.index < main.index ? 'h2' : 'h1';
  const ref = target === 'h2' ? 'h1' : 'h2';
  const tChars = num(cmdMap[target + 'Chars']), rChars = num(cmdMap[ref + 'Chars']);
  const tSize = num(cmdMap[target + 'Size']), rSize = num(cmdMap[ref + 'Size']);
  if (![tChars, rChars, tSize, rSize].every(Number.isFinite) || tChars <= 0) return null;
  // 기준 줄의 폭과 같아지는 크기. 한 줄에 못 들어가거나 너무 작아지지 않게 현재의 0.5~3배로 제한
  const size = Math.max(tSize * 0.5, Math.min(tSize * 3, rSize * rChars / tChars));
  // 폭 기준으로 계산한 방향이 말한 방향(키워/줄여)과 반대면 글자 수 어림이 맞지 않는 것이니 모델 판단에 맡긴다
  if ((/(키워|키우|크게|늘려)/.test(m) && size <= tSize) || (/(줄여|줄이|작게)/.test(m) && size >= tSize)) return null;
  const patches = { [target + 'Size']: r2(size) };
  const lead = num(cmdMap[target + 'Leading']);
  if (Number.isFinite(lead) && tSize > 0) patches[target + 'Leading'] = r2(Math.max(size, lead * size / tSize));
  return { patches };
}

// ── 2) 다른 요소 기준 크기 ────────────────────────────────────────────────
const EL = [
  ['h2', /(소제목|부제목|부제)/, 'h2Size', 'h2Leading', '소제목'],
  ['h1', /(?<![소부])(제목|타이틀|표제)/, 'h1Size', 'h1Leading', '제목'],
  ['note', /(각주|주석)/, 'noteSize', 'noteLeading', '각주'],
  ['pn', /(쪽\s*번호|페이지\s*번호)/, 'pnSize', 'pnLeading', '쪽번호'],
  ['rh', /(면주|머리말)/, 'rhSize', 'rhLeading', '면주'],
  ['body', /(본문)/, 'bodySize', 'bodyLeading', '본문'],
];
const SMALLER = [0.95, 0.9, 0.85, 0.75, 0.6];
const BIGGER = [1.05, 1.1, 1.15, 1.3, 1.5];
const SAME_RE = /(같게|같은|동일|똑같|맞춰|맞추|비슷하게|비슷한|통일)/;

export function planSizeRelation(msg = '', cmdMap = {}) {
  const m = String(msg);
  if (/(행간|줄\s*간격|간격|여백|서체|글꼴|색|굵|정렬|위치|가로\s*폭|폭|너비)/.test(m)) return null; // 크기가 아닌 속성 얘기
  const found = EL.map(([id, re, sk, lk]) => { const x = m.match(re); return x ? { id, at: x.index, len: x[0].length, sk, lk } : null; }).filter(Boolean);
  if (found.length < 2) return null;
  let target, ref, ratio;
  const than = m.match(/(각주|주석|본문|제목|소제목|부제목|부제|쪽\s*번호|면주|머리말)\s*(?:의\s*)?(?:글자\s*)?(?:크기)?\s*보다/);
  if (than) {
    ref = found.find(f => than.index <= f.at && f.at <= than.index + than[0].length);
    target = found.find(f => f !== ref);
    if (!ref || !target) return null;
    const { level } = detectIntensity(normalizeMsg(m).replace(/(차이\s*나게|차이가\s*나게|확실히|뚜렷하게)/, ''));
    const strong = /(차이\s*나게|차이가\s*나게|확실히|뚜렷하게|구분되게)/.test(m);
    const L = Math.max(1, Math.min(5, strong ? Math.max(level, 4) : level)) - 1;
    if (/(작게|줄여|줄이|낮춰|낮게|작아)/.test(m)) ratio = SMALLER[L];
    else if (/(크게|키워|키우|높여|크게|커)/.test(m)) ratio = BIGGER[L];
    else return null;
  } else if (SAME_RE.test(m)) {
    const sorted = [...found].sort((a, b) => a.at - b.at);
    [target, ref] = sorted; // 먼저 나온 요소가 바꿀 대상, 다음이 기준
    ratio = 1;
  } else return null;
  const refSize = num(cmdMap[ref.sk]);
  const curSize = num(cmdMap[target.sk]);
  if (!Number.isFinite(refSize)) return null;
  let size = refSize * ratio;
  // "보다 작게"인데 기준이 이미 작아 지금보다 커지는 경우는 만들지 않는다(반대도 마찬가지)
  if (Number.isFinite(curSize) && than) {
    if (ratio < 1 && size > curSize) size = curSize * ratio;
    if (ratio > 1 && size < curSize) size = curSize * ratio;
  }
  const patches = { [target.sk]: r2(size) };
  const curLead = num(cmdMap[target.lk]);
  if (Number.isFinite(curLead) && Number.isFinite(curSize) && curSize > 0) patches[target.lk] = r2(Math.max(size, curLead * (size / curSize)));
  return { patches, target: target.id, ref: ref.id, ratio };
}

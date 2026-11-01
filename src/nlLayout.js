// 11월 1일 로그에서 모델이 반대로 읽거나 엉뚱한 항목을 바꾼 요청을 코드가 직접 계산한다. (API 호출 없음)
//  · "행간 글자 크기에 맞게 늘려줘" → 글자 크기는 두고 행간만 크기에 비례해 맞춘다 (모델은 글자 크기를 줄여 버렸다)
//  · "컬럼 가로 크기를 늘려줘" → 좌우 여백을 줄여 판면(단) 폭을 키운다 (모델은 주석 글자 크기를 키웠다)
//  · "본문이 제목보다 아래로 내려가게" → 제목↔본문 간격을 늘린다 (모델은 간격을 줄였다)
import { synthesizePatches } from './nlIntensity.js';

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const r2 = n => String(Math.round(n * 100) / 100);

const FIT_RE = /(행간|줄\s*간격|줄간격).*(글자\s*크기|글씨\s*크기|글자|크기)(?:에|와|랑)?\s*(맞게|맞춰|맞추|비례|어울리게|알맞게|걸맞게)/;
const COLW_RE = /(컬럼|칼럼|단|열)\s*(?:의\s*)?(가로|너비|폭|넓이|가로\s*크기|가로\s*길이)/;
// 합성기는 문장 속 방향 동사로 단계를 계산한다 — 원문의 방향어(늘려·내려가게 등)를 걷어내고 우리가 정한 방향어만 붙여 넘긴다
const DIR_WORDS = /늘려|늘리|넓혀|넓히|키워|키우|크게|길게|줄여|줄이|좁혀|좁히|작게|짧게|내려가게|내려|올려/g;
const forced = (m, verb) => m.replace(DIR_WORDS, ' ').replace(/보다/g, ' ').replace(/(?:해\s*)?(?:줘요?|주세요)/g, ' ') + ' ' + verb; // "~보다"는 비교 요청으로 읽혀 합성이 막히므로 뺀다

const BELOW_RE = /(본문|글자).*(제목|부제목|소제목|부제).*(아래|밑|내려가|내려오|내려와)/;

export function planLayout(msg = '', cmdMap = {}) {
  const m = String(msg);

  // 행간을 글자 크기에 맞추기 — 글자 크기는 그대로, 행간만 비율로
  if (FIT_RE.test(m)) {
    const target = /(각주|주석)/.test(m) ? ['noteSize', 'noteLeading', 1.5]
      : /(부제목|소제목|부제)/.test(m) ? ['h2Size', 'h2Leading', 1.25]
      : /(?<![소부])제목/.test(m) ? ['h1Size', 'h1Leading', 1.25]
      : ['bodySize', 'bodyLeading', 1.6];
    const size = num(cmdMap[target[0]]);
    if (!Number.isFinite(size)) return null;
    let v = size * target[2];
    // "맞게 늘려줘"인데 비율 값이 지금보다 작으면 늘려 달라는 뜻을 우선한다 (반대 방향도 마찬가지)
    const cur = num(cmdMap[target[1]]);
    if (Number.isFinite(cur)) {
      if (/(늘려|늘리|넓혀|넓히|키워|크게)/.test(m) && v <= cur) v = cur * 1.1;
      else if (/(줄여|줄이|좁혀|좁히|작게)/.test(m) && v >= cur) v = cur * 0.9;
    }
    return { patches: { [target[1]]: r2(v) } };
  }

  // 컬럼 가로 크기 — 좌우 여백으로 판면 폭을 조절한다
  if (COLW_RE.test(m) && /(늘|넓|키|크게|길게|줄|좁|작게|짧게)/.test(m)) {
    const wider = /(늘|넓|키|크게|길게)/.test(m);
    // 판면이 넓어지려면 여백은 줄어든다 — 합성기는 "방향어"로 단계를 계산하므로 반대 동사를 붙여 넘긴다
    const synth = synthesizePatches(forced(m, wider ? '줄여' : '늘려'), ['marginInner', 'marginOuter'], cmdMap);
    return synth ? { patches: synth.patches } : null;
  }

  // 본문이 제목보다 아래로 — 제목↔본문 간격을 늘린다
  if (BELOW_RE.test(m)) {
    const synth = synthesizePatches(forced(m, '늘려'), ['bodyGap'], cmdMap);
    return synth ? { patches: synth.patches } : null;
  }
  return null;
}

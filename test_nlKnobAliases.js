// 자연어 수정 표현 100개가 각자 기대한 키(또는 미지원 사유)에 매칭되는지 확인한다.
// 실행: node test_nlKnobAliases.js
import { KNOB_ALIASES, detectKnobHints, buildKnobHintSuffix } from './src/nlKnobAliases.js';

let failed = 0;
const check = (cond, label) => {
  if (!cond) { failed++; console.log('FAIL', label); }
};

check(KNOB_ALIASES.length === 100, `표현 개수 100 기대, 실제 ${KNOB_ALIASES.length}`);

KNOB_ALIASES.forEach((entry, i) => {
  const hits = detectKnobHints(entry.sample);
  const matched = entry.key
    ? hits.some(h => h.key === entry.key)
    : hits.some(h => h.unsupported === entry.reason);
  check(matched, `#${i + 1} "${entry.sample}" → 기대 ${entry.key ?? '미지원'}, 실제 ${JSON.stringify(hits)}`);
});

// 걸리는 표현이 없는 일반 문장에는 힌트가 붙지 않아야 한다
check(buildKnobHintSuffix('안녕하세요 오늘 날씨 어때요') === '', '무관한 문장에 힌트가 붙음');
// 힌트는 키 후보와 미지원을 구분해서 보여야 한다
const suffix = buildKnobHintSuffix('쪽번호 아래로 내려주고 과부 줄도 막아줘');
check(suffix.includes('키 후보: pnPos') && suffix.includes('미지원:'), `힌트 형식 확인: ${suffix}`);

console.log(failed === 0 ? `OK — ${KNOB_ALIASES.length}개 표현 모두 매칭` : `${failed}개 실패`);
process.exit(failed === 0 ? 0 : 1);

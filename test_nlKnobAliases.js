// 자연어 수정 표현 100개가 각자 기대한 키(또는 미지원 사유)에 매칭되는지 확인한다.
// 실행: node test_nlKnobAliases.js
import { KNOB_ALIASES, detectKnobHints, buildKnobHintSuffix } from './src/nlKnobAliases.js';

let failed = 0;
const check = (cond, label) => {
  if (!cond) { failed++; console.log('FAIL', label); }
};

// 처음 100개는 설계한 표현이고, 그 뒤는 실제 참여자 발화에서 빠진 것을 채운 항목이다
check(KNOB_ALIASES.length >= 100, `표현 개수 100 이상 기대, 실제 ${KNOB_ALIASES.length}`);

// 05 로그의 실제 발화 중 이전에 힌트가 전혀 안 붙던 문장들 (회귀 방지)
const REAL_GAP_UTTERANCES = [
  '본문을 좀 더 널널하게 해줘',
  '좀 더 전체적으로 카탈로그처럼 바꿔줘',
  '위의 답변의 결과물로 수정해줘',
  '본문',
  '제목 부제목 폰트 크기를 같은 비례로 조금만 축소해줘',
  '좀 더',
  '글자 크기 좀 더 줄이고 행간도 비례에 맞게 해줘',
  '아에 사전처럼 여백 거의 없애주세요',
  '동화처럼 글자가 커지면 좋겠어요',
  '하단을 넓혀주세요',
  '주석 행간 줄여줘.',
];
for (const s of REAL_GAP_UTTERANCES) {
  check(detectKnobHints(s).length > 0, `실제 발화 힌트 없음: "${s}"`);
}

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

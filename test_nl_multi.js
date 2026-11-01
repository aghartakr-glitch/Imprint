// 여러 절이 섞인 요청 — 절마다 대상·방향을 따로 계산하는지. (API 호출 없음)  실행: node test_nl_multi.js
import { planNaturalEdit, splitClauses } from './src/nlKnobAliases.js';

const CM = { bodySize: '9.5', bodyLeading: '15.2', noteSize: '8', noteLeading: '13.2', h1Size: '21', h1Leading: '26.3', h2Size: '18', h2Leading: '22.5', letterSpace: '0', parSkip: '4', marginTop: '10', marginBottom: '10', marginInner: '10', marginOuter: '10', pnSize: '9', pnLeading: '11', rhSize: '9', rhLeading: '11' };
const up = (k, p) => Number(p[k]) > Number(CM[k]);
const down = (k, p) => Number(p[k]) < Number(CM[k]);

// [문장, 검사들(p => bool)의 이름과 함수, 나오면 안 되는 키]
const CASES = [
  ['각주가 너무 크고 행간이 너무 넓어', [['각주 크기↓', p => down('noteSize', p)], ['각주 행간↓', p => down('noteLeading', p)]], ['bodySize', 'bodyLeading']],
  ['본문은 키우고 각주는 줄여줘', [['본문↑', p => up('bodySize', p)], ['각주↓', p => down('noteSize', p)]]],
  ['본문 크기는 키우고 행간은 줄여줘', [['본문 크기↑', p => up('bodySize', p)], ['행간↓', p => down('bodyLeading', p)]]],
  ['제목은 키우고 부제목은 줄여줘', [['제목↑', p => up('h1Size', p)], ['부제목↓', p => down('h2Size', p)]]],
  ['각주는 줄이고 본문은 키워줘', [['각주↓', p => down('noteSize', p)], ['본문↑', p => up('bodySize', p)]]],
  ['여백은 줄이고 행간은 넓히고 자간은 좁혀줘', [['여백↓', p => down('marginTop', p)], ['행간↑', p => up('bodyLeading', p)], ['자간↓', p => Number(p.letterSpace) < 0]]],
  ['본문은 크게, 각주는 작게', [['본문↑', p => up('bodySize', p)], ['각주↓', p => down('noteSize', p)]]],
  ['제목은 작게 하고 쪽번호는 크게 해줘', [['제목↓', p => down('h1Size', p)], ['쪽번호↑', p => up('pnSize', p)]]],
  ['면주는 줄이고 쪽번호도 줄여줘', [['면주↓', p => down('rhSize', p)], ['쪽번호↓', p => down('pnSize', p)]]],
  ['본문 키우고 각주 키워줘', [['본문↑', p => up('bodySize', p)], ['각주↑', p => up('noteSize', p)]]],
  ['본문 글자는 줄이고 문단 간격은 늘려줘', [['본문↓', p => down('bodySize', p)], ['문단 간격↑', p => up('parSkip', p)]]],
  ['제목은 줄이며 본문은 키워줘', [['제목↓', p => down('h1Size', p)], ['본문↑', p => up('bodySize', p)]]],
  // 쪼개면 안 되는 말 — 한 덩어리로 처리되어야 한다
  ['본문을 키우고 싶어', [['본문↑', p => up('bodySize', p)]]],
  ['행간 줄이고 싶어', [['행간↓', p => down('bodyLeading', p)]]],
  ['각주 구분선 더 얇고 연하게 해줘', [['구분선 두께', p => 'footnoteRuleThickness' in p], ['구분선 색', p => 'footnoteRuleColor' in p]], ['noteColor', 'noteSize']],
];

let bad = 0; const out = [];
for (const [msg, checks, notKeys = []] of CASES) {
  const plan = planNaturalEdit(msg, CM, []);
  const p = plan.synth?.patches || {};
  const why = [];
  if (!plan.synth) why.push('직접 계산 결과 없음');
  else {
    for (const [name, fn] of checks) { try { if (!fn(p)) why.push(`${name} 실패`); } catch { why.push(`${name} 오류`); } }
    for (const k of notKeys) if (k in p) why.push(`나오면 안 되는 ${k}`);
  }
  if (why.length) { bad++; out.push(`  ✗ "${msg}": ${why.join(', ')} ${JSON.stringify(p)}`); }
}
const one = splitClauses('본문을 키우고 싶어');
console.log(`여러 절 문장 ${CASES.length}개: ${CASES.length - bad}개 통과, ${bad}개 실패`);
out.forEach(o => console.log(o));
process.exit(bad ? 1 : 0);

// 여백 4면(안쪽·바깥쪽·위·아래·좌우·사방)을 면마다 맞는 방향으로 읽는지. (API 호출 없음)  실행: node test_nl_margin.js
import { planNaturalEdit } from './src/nlKnobAliases.js';

const CM = { marginTop: '10', marginBottom: '10', marginInner: '10', marginOuter: '10' };
const K = { top: 'marginTop', bottom: 'marginBottom', inner: 'marginInner', outer: 'marginOuter' };
const d = (p, k) => (k in p ? Math.sign(Number(p[K[k]] ?? p[k]) - 10) : undefined);
// [문장, {면: +1|-1|0(바뀌면 안 됨)}]
const CASES = [
  ['내측 여백 늘려줘', { inner: 1, outer: 0, top: 0, bottom: 0 }],
  ['외측 여백 줄여줘', { outer: -1, inner: 0 }],
  ['안쪽 여백은 늘리고 바깥쪽 여백은 줄여줘', { inner: 1, outer: -1, top: 0, bottom: 0 }],
  ['바깥쪽은 늘리고 안쪽은 줄여줘', { outer: 1, inner: -1 }],
  ['위 여백은 줄이고 아래 여백은 늘려줘', { top: -1, bottom: 1, inner: 0, outer: 0 }],
  ['위아래 여백은 줄이고 좌우 여백은 늘려줘', { top: -1, bottom: -1, inner: 1, outer: 1 }],
  ['상단 늘리고 하단 줄여줘', { top: 1, bottom: -1 }],
  ['하단은 줄이고 상단은 늘려줘', { top: 1, bottom: -1 }],
  ['사방 여백 줄여줘', { top: -1, bottom: -1, inner: -1, outer: -1 }],
  ['사방 여백 각각 조금씩 늘려줘', { top: 1, bottom: 1, inner: 1, outer: 1 }],
  ['상하는 줄이고 내측은 늘려줘', { top: -1, bottom: -1, inner: 1, outer: 0 }],
  ['책등 쪽 여백 늘려줘', { inner: 1, outer: 0 }],
  ['바깥 여백은 그대로 안쪽만 늘려줘', { inner: 1, outer: 0 }],
  ['바깥쪽 여백은 놔두고 안쪽 여백만 줄여줘', { inner: -1, outer: 0 }],
  ['안쪽은 많이 늘리고 바깥쪽은 조금만 줄여줘', { inner: 1, outer: -1 }],
  ['위 여백 아주 많이 줄여줘', { top: -1, bottom: 0 }],
  ['여백 늘려줘', { top: 1, bottom: 1, inner: 1, outer: 1 }],
  ['마진 줄여줘', { top: -1, bottom: -1, inner: -1, outer: -1 }],
  ['좌우 여백만 줄여줘', { inner: -1, outer: -1, top: 0, bottom: 0 }],
  ['위아래만 늘려줘 여백', { top: 1, bottom: 1, inner: 0, outer: 0 }],
];
let bad = 0; const out = [];
for (const [msg, want] of CASES) {
  const p = planNaturalEdit(msg, CM, [], {}).synth?.patches || {};
  const why = [];
  for (const [side, dir] of Object.entries(want)) {
    const key = K[side]; const got = key in p ? Math.sign(Number(p[key]) - 10) : 0;
    if (got !== dir) why.push(`${side} 기대 ${dir} 실제 ${got}`);
  }
  if (why.length) { bad++; out.push(`  ✗ "${msg}": ${why.join(', ')} ${JSON.stringify(p)}`); }
}
// 왼쪽·오른쪽은 되묻는다(값을 바꾸면 안 된다)
for (const msg of ['왼쪽 여백 늘려줘', '오른쪽 여백 줄여줘', '좌측 여백 키워줘']) {
  const pl = planNaturalEdit(msg, CM, [], {});
  if (pl.synth || !pl.unsupported.length) { bad++; out.push(`  ✗ "${msg}": 되묻지 않고 ${JSON.stringify(pl.synth?.patches || {})}`); }
}
// 다른 요소 얘기가 섞이면 여백 계획을 쓰지 않는다
for (const msg of ['각주 아래 간격 줄여줘', '제목 위 여백 늘려줘']) {
  const p = planNaturalEdit(msg, CM, [], {}).synth?.patches || {};
  if ('marginTop' in p || 'marginBottom' in p) { bad++; out.push(`  ✗ "${msg}": 페이지 여백을 바꿈 ${JSON.stringify(p)}`); }
}
console.log(`여백 문장 ${CASES.length + 5}개: ${bad}개 실패`);
out.forEach(o => console.log(o));
process.exit(bad ? 1 : 0);

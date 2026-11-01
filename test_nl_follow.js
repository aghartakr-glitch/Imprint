// 후속 발화(조금만 더·더더더·반대로)와 다른 요소 기준 크기(본문보다·제목과 같게). (API 호출 없음)  실행: node test_nl_follow.js
import { planNaturalEdit } from './src/nlKnobAliases.js';

const CM = { bodySize: '10', bodyLeading: '16', noteSize: '8', noteLeading: '12', h1Size: '24', h1Leading: '28', h2Size: '14', h2Leading: '18', marginInner: '10', marginOuter: '10', pnSize: '9', rhSize: '9' };
const up = (k, p) => Number(p[k]) > Number(CM[k]);
const down = (k, p) => Number(p[k]) < Number(CM[k]);
const FU = [
  // [문장, 직전 키, 직전 방향, 검사]
  ['조금만 더', ['marginInner'], { marginInner: 1 }, p => up('marginInner', p) && Number(p.marginInner) < 11],
  ['더', ['marginInner'], { marginInner: 1 }, p => up('marginInner', p)],
  ['한 번 더', ['marginInner'], { marginInner: 1 }, p => up('marginInner', p)],
  ['계속', ['marginInner'], { marginInner: 1 }, p => up('marginInner', p)],
  ['더더더더', ['marginInner'], { marginInner: 1 }, p => Number(p.marginInner) >= 14],
  ['반대로', ['marginInner'], { marginInner: 1 }, p => down('marginInner', p)],
  ['조금만 더', ['bodySize', 'bodyLeading'], { bodySize: -1, bodyLeading: -1 }, p => down('bodySize', p) && down('bodyLeading', p)],
  ['반대로', ['bodySize', 'bodyLeading'], { bodySize: -1, bodyLeading: -1 }, p => up('bodySize', p) && up('bodyLeading', p)],
  ['더더', ['noteSize'], { noteSize: -1 }, p => down('noteSize', p)],
  // 방향이 기록되지 않은 직전(서체·위치) — 이어받지 않는다
  ['더', ['pnPos'], {}, p => Object.keys(p).length === 0],
  // 직전 없음 — 이어받지 않는다
  ['더', [], {}, p => Object.keys(p).length === 0],
  // 요소 이름이 있는 말은 후속 발화가 아니다
  ['쪽번호 다시 우측으로', ['marginInner'], { marginInner: 1 }, p => p.pnPos === '하단-우측' && !('marginInner' in p)],
];
const REL = [
  ['주석 글자 크기를 본문보다 차이나게 줄여줘', p => Number(p.noteSize) <= 7.6 && Number(p.noteSize) < 8],
  ['각주를 본문보다 작게', p => Number(p.noteSize) < 8 && Number(p.noteSize) < 10],
  ['본문보다 각주를 많이 작게', p => Number(p.noteSize) <= 7.6],
  ['제목을 본문보다 크게', p => Number(p.h1Size) > 24 || Number(p.h1Size) > 10],
  ['소제목을 제목과 같게 해줘', p => Number(p.h2Size) === 24],
  ['본문 크기를 각주랑 맞춰줘', p => Number(p.bodySize) === 8],
  ['쪽번호를 면주와 같은 크기로', p => Number(p.pnSize) === 9],
  // 크기가 아닌 속성은 건드리지 않는다
  ['각주 크기 줄여줘', p => Number(p.noteSize) < 8],
  ['각주 서체를 본문과 같게', p => !('noteSize' in p)],
  ['각주 행간을 본문과 같게', p => !('noteSize' in p)],
];
// 폭 맞추기(글자 수로 어림) — cmdMap에 제목·소제목 글자 수가 있을 때
const WCM = { ...CM, h1Size: '21', h1Leading: '26', h2Size: '10', h2Leading: '14', h1Chars: '12', h2Chars: '8' };
const WID = [
  ['소제목도 제목 가로 폭에 맞춰서 키워줘', p => Number(p.h2Size) === 31.5 || (Number(p.h2Size) > 10 && Number(p.h2Size) <= 30)],
  ['소제목을 제목 폭에 맞게 키워줘', p => Number(p.h2Size) > 10],
  ['제목을 소제목 가로 폭에 맞춰줘', p => Number(p.h1Size) < 21],
];
let bad = 0; const out = [];
for (const [msg, ok] of WID) {
  const p = planNaturalEdit(msg, WCM, [], {}).synth?.patches || {};
  let pass = false; try { pass = ok(p); } catch {}
  if (!pass) { bad++; out.push('  ✗ [폭] "' + msg + '" → ' + JSON.stringify(p)); }
}
// 설명 문장·뜻 없는 말 — 값을 바꾸지 않고 되묻는다
for (const msg of ['1페이지 기준 우측이 내측 여백이야', '알아서', '다', '대충 해줘', '지금 제목 명조야']) {
  const pl = planNaturalEdit(msg, CM, [], {});
  if (pl.synth) { bad++; out.push('  ✗ [되묻기] "' + msg + '"에서 값을 바꾸려 함 ' + JSON.stringify(pl.synth.patches)); }
}
for (const [msg, pk, pd, ok] of FU) {
  const p = planNaturalEdit(msg, CM, pk, pd).synth?.patches || {};
  let pass = false; try { pass = ok(p); } catch {}
  if (!pass) { bad++; out.push(`  ✗ [후속] "${msg}" (직전 ${pk.join(',') || '없음'}) → ${JSON.stringify(p)}`); }
}
for (const [msg, ok] of REL) {
  const p = planNaturalEdit(msg, CM, [], {}).synth?.patches || {};
  let pass = false; try { pass = ok(p); } catch {}
  if (!pass) { bad++; out.push(`  ✗ [기준] "${msg}" → ${JSON.stringify(p)}`); }
}
console.log(`후속·기준·폭 문장 ${FU.length + REL.length + WID.length + 5}개: ${bad}개 실패`);
out.forEach(o => console.log(o));
process.exit(bad ? 1 : 0);

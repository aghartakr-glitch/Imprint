// 여러 줄·여러 요청을 한 번에 입력했을 때 한 줄도 빠지지 않는지. (API 호출 없음)  실행: node test_nl_lines.js
import { planNaturalEdit } from './src/nlKnobAliases.js';

const CM = { noteSize: '7', noteLeading: '12', h1Size: '15.5', h1Leading: '21.7', h2Size: '11', h2Leading: '17', bodySize: '8', bodyLeading: '13', headingGap: '7.8', bodyFontFamily: 'sans', pnPos: '상단-외측', rhPos: '상단-외측', marginTop: '10', marginBottom: '10', marginInner: '10', marginOuter: '10' };
const up = (k, p) => Number(p[k]) > Number(CM[k]);
const down = (k, p) => Number(p[k]) < Number(CM[k]);
const CASES = [
  ['주석 행간 더 줄여줘\n소제목 크기를 줄이고 제목이랑 소제목 줄간격 줄여줘', p => down('noteLeading', p) && down('h2Size', p) && down('h1Leading', p) && !('bodySize' in p)],
  ['제목 크기를 키워줘\n본문 서체를 명조로 해줘', p => up('h1Size', p) && p.bodyFontFamily === 'serif'],
  ['쪽번호 아래로\n면주는 위로', p => String(p.pnPos).startsWith('하단') && String(p.rhPos).startsWith('상단')],
  ['본문 키워줘\n각주 줄여줘', p => up('bodySize', p) && down('noteSize', p)],
  ['제목 굵게\n본문 행간 넓혀줘', p => p.h1Weight === 'bold' && up('bodyLeading', p)],
  ['1. 쪽번호를 하단으로 내려줘.\n2. 소제목 글자 크기를 적당히 줄여줘', p => String(p.pnPos).startsWith('하단') && down('h2Size', p) && !('bodySize' in p)],
  ['본문 키워줘; 각주 줄여줘', p => up('bodySize', p) && down('noteSize', p)],
  ['위아래 여백은 줄이고 좌우는 늘려줘', p => down('marginTop', p) && up('marginInner', p)],
  ['안쪽 여백 늘려줘\n바깥쪽 여백 줄여줘', p => up('marginInner', p) && down('marginOuter', p)],
  // 쪼개면 안 되는 두 줄
  ['각주 구분선 더 얇고\n연하게 해줘', p => !('noteColor' in p)],
];
let bad = 0; const out = [];
for (const [msg, ok] of CASES) {
  const p = planNaturalEdit(msg, CM, [], {}).synth?.patches || {};
  let pass = false; try { pass = ok(p); } catch {}
  if (!pass) { bad++; out.push(`  ✗ ${JSON.stringify(msg)} → ${JSON.stringify(p)}`); }
}
console.log(`여러 줄 문장 ${CASES.length}개: ${CASES.length - bad}개 통과, ${bad}개 실패`);
out.forEach(o => console.log(o));
process.exit(bad ? 1 : 0);

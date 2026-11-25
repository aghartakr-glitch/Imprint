// 각주 덩어리 올리기/내리기·본문↔각주 간격·한 줄 맞춤·행간 똑같이. (API 호출 없음)  실행: node test_nl_foot.js
import { planNaturalEdit } from './src/nlKnobAliases.js';

const CM = { footinsSkip: '10', marginBottom: '20', noteLeading: '9', noteSize: '7', paperWidth: '150', marginInner: '10', marginOuter: '10', h2Size: '12', h2Leading: '17', h2Chars: '45', h1Size: '21', h1Leading: '26', h1Chars: '7', bodySize: '9', bodyLeading: '15' };
const p0 = msg => planNaturalEdit(msg, CM, [], {}).synth?.patches || {};
const CASES = [
  ['각주 덩어리를 조금 올려줘', p => Number(p.footnoteShift) > 0 && Number(p.footnoteShift) <= 2 && Object.keys(p).length === 1],
  ['각주 전체 아래로 내려줘', p => Number(p.footnoteShift) < 0 && Object.keys(p).length === 1],
  ['각주 좀 아래로 내려줘', p => Number(p.footnoteShift) < 0 && !('footinsSkip' in p)],
  ['주석 위로 올려줘 많이', p => Number(p.footnoteShift) >= 6],
  ['주석 아주 많이 올려줘', p => Number(p.footnoteShift) >= 9],
  ['각주 위로 확 올려줘', p => Number(p.footnoteShift) > 0],
  ['주석 전체 위치를 본문과 많이 떨어트려줘, 하단으로 내려줘', p => Number(p.footinsSkip) > 10 && Number(p.footnoteShift) < 0],
  ['하단 여백을 줄이고 주석 전체를 하단으로 더 내려줘', p => Number(p.marginBottom) < 20 && Number(p.footnoteShift) < 0],
  ['1번 주석 앞에 커서 놓고 엔터 두번 친것처럼 늘려줘', p => Number(p.footinsSkip) > 10 && !('footnoteShift' in p)],
  ['각주 줄간격 본문이랑 똑같이', p => Math.abs(Number(p.noteLeading) - 11.67) < 0.02],
  ['각주 행간을 본문과 같게 해줘', p => Math.abs(Number(p.noteLeading) - 11.67) < 0.02],
  ['부제목 글자 크기 줄여줘 한줄에 들어오게', p => Number(p.h2Size) < 12 && Number(p.h2Size) > 7],
  ['부제목 한 줄에 들어오게 해줘', p => Number(p.h2Size) < 12],
  ['제목 한줄에 들어오게', p => Object.keys(p).length === 0],
  // 영향 없어야 하는 말
  ['각주 글자 크기 줄여줘', p => !('footnoteShift' in p)],
  ['각주 줄간격 줄여줘', p => !('footnoteShift' in p) && Number(p.noteLeading) <= 9],
  ['각주 끼리 간격 줄여줘', p => !('footnoteShift' in p)],
];
let bad = 0; const out = [];
for (const [msg, ok] of CASES) {
  const p = p0(msg);
  let pass = false; try { pass = ok(p); } catch {}
  if (!pass) { bad++; out.push(`  ✗ "${msg}" → ${JSON.stringify(p)}`); }
}
// 한 줄 맞춤: 이미 들어가는 제목은 값을 바꾸지 않고 안내만
const pl = planNaturalEdit('제목 한줄에 들어오게', CM, [], {});
if (pl.synth || !pl.unsupported.length) { bad++; out.push('  ✗ 이미 한 줄에 들어가는데 안내가 없음'); }
console.log(`각주 위치·한 줄·행간 문장 ${CASES.length + 1}개: ${bad}개 실패`);
out.forEach(o => console.log(o));
process.exit(bad ? 1 : 0);

// sty_patch 키 일관성 점검
//  1) 프롬프트에 안내한 키마다 적용 루프(Object.entries(patches))에 처리 코드가 있어야 한다
//     (없으면 모델이 값을 줘도 조용히 무시된다)
//  2) nlKnobAliases의 키는 모두 프롬프트 키 목록에 있어야 한다
// 실행: node test_sty_patch_keys.js
import fs from 'fs';
import { KNOB_ALIASES } from './src/nlKnobAliases.js';

const src = fs.readFileSync('./src/App.jsx', 'utf8');

const listLine = src.split('\n').find(l => l.includes('사용 가능한 키:'));
const promptKeys = listLine.split('사용 가능한 키:')[1].trim().split(/\s+/).filter(Boolean);

const loopStart = src.indexOf('for (const [key, val] of Object.entries(patches))');
const loopEnd = src.indexOf('if (patchedSty !== styCode)', loopStart);
const handlerRegion = src.slice(loopStart, loopEnd);

let failed = 0;
const missingHandlers = promptKeys.filter(k => !new RegExp(`['"]${k}['"]`).test(handlerRegion));
if (missingHandlers.length) {
  failed++;
  console.log('핸들러 없음 (프롬프트엔 있음):', missingHandlers.join(', '));
}

const aliasKeys = [...new Set(KNOB_ALIASES.map(e => e.key).filter(Boolean))];
const notInPrompt = aliasKeys.filter(k => !promptKeys.includes(k));
if (notInPrompt.length) {
  failed++;
  console.log('별칭 키가 프롬프트 목록에 없음:', notInPrompt.join(', '));
}

console.log(`프롬프트 키 ${promptKeys.length}개, 별칭 키 ${aliasKeys.length}개`);
console.log(failed === 0 ? 'OK — 키 일관성 통과' : `${failed}개 항목 실패`);
process.exit(failed === 0 ? 0 : 1);

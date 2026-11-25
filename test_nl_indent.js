// 들여쓰기: 본문 문단이 \noindent로 시작하면 \parindent를 키워도 안 나온다 — 켜면 걷어내고, 0이면 되돌리는지. (API 호출 없음)
// 실행: node test_nl_indent.js
import { applyParIndentToTex, countBlockedParagraphs } from './src/styIndent.js';

const T0 = '{\\noindent\\hone 제목\\par}\n{\\bodyf\\noindent 첫 문단\\par}\n{\\bodyf\\noindent 둘째\\par}\n{\\bodyf\\noindent 셋째\\par}\n\\bodyf{}';
const T1 = applyParIndentToTex(T0, true);
const T2 = applyParIndentToTex(T1, false);
const fails = [];
if (countBlockedParagraphs(T0) !== 3) fails.push('시작 문단 수');
if (countBlockedParagraphs(T1) !== 1) fails.push('켜면 첫 문단만 남아야 함');
if (!T1.includes('{\\noindent\\hone')) fails.push('제목의 noindent를 건드림');
if (!T1.includes('\\bodyf{}')) fails.push('\\bodyf{} 줄을 건드림');
if (countBlockedParagraphs(T2) !== 3) fails.push('끄면 3문단 모두 복구');
if (applyParIndentToTex(T1, true) !== T1) fails.push('두 번 켜도 같아야 함');
console.log(`들여쓰기 점검: ${fails.length ? fails.join(', ') + ' 실패' : '통과'}`);
process.exit(fails.length ? 1 : 0);

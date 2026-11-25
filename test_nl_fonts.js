// 서체 자연어 요청 110여 문장 — 이름으로 부르기·분위기·"다른 명조"·대상 요소 지정·서체 아닌 말(오탐 방지). (API 호출 없음)
// 실행: node test_nl_fonts.js
import { planNaturalEdit } from './src/nlKnobAliases.js';
import { applyFont, readFonts, fontIds, SERIF_FONTS, SANS_FONTS } from './src/styFonts.js';
import { applyTracking, readTracking } from './src/styTracking.js';

const SERIF_BODY = { bodyFontFamily: 'serif', footnoteFontFamily: 'sans', rhFontFamily: 'sans', pnFontFamily: 'sans', serifFont: 'batang', sansFont: 'pretendard' };
const SANS_BODY = { ...SERIF_BODY, bodyFontFamily: 'sans' };
const NANUM = { ...SERIF_BODY, serifFont: 'nanum' };

// [문장, cmdMap, 기대 패치(객체) | null]  — null이면 서체 변경이 일어나면 안 된다
const CASES = [
  // 이름으로 부르기 — 명조 (1~24)
  ['나눔명조로 바꿔줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['본문 서체를 나눔명조로 해줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['나눔 명조 써줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['본명조로 바꿔줘', SERIF_BODY, { serifFont: 'noto' }],
  ['노토 세리프로 해줘', SERIF_BODY, { serifFont: 'noto' }],
  ['노토세리프 쓰고 싶어', SERIF_BODY, { serifFont: 'noto' }],
  ['신문명조로 바꿔줘', SERIF_BODY, { serifFont: 'shinmun' }],
  ['신문체로 해주세요', SERIF_BODY, { serifFont: 'shinmun' }],
  ['바탕체로 되돌려줘', NANUM, { serifFont: 'batang' }],
  ['바탕으로 다시 바꿔줘', NANUM, { serifFont: 'batang' }],
  ['궁서체로 바꿔줘', SERIF_BODY, { serifFont: 'gungseo' }],
  ['본문 궁서로 해줘', SERIF_BODY, { serifFont: 'gungseo' }],
  ['필기체로 바꿔줘', SERIF_BODY, { serifFont: 'pilgi' }],
  ['손글씨체로 해줘', SERIF_BODY, { serifFont: 'pilgi' }],
  ['붓글씨 느낌으로 바꿔줘', SERIF_BODY, { serifFont: 'pilgi' }],
  ['캘리 느낌으로 해줘', SERIF_BODY, { serifFont: 'pilgi' }],
  ['펜글씨체로 바꿔줘', SERIF_BODY, { serifFont: 'pen' }],
  ['옛글체로 바꿔줘', SERIF_BODY, { serifFont: 'yetgul' }],
  ['백묵바탕으로 바꿔줘', SERIF_BODY, { serifFont: 'baekmuk' }],
  ['백묵 바탕체로 해줘', SERIF_BODY, { serifFont: 'baekmuk' }],
  ['본명조 가는 굵기로 바꿔줘', SERIF_BODY, { serifFont: 'notolight' }],
  ['본명조 미디엄으로 해줘', SERIF_BODY, { serifFont: 'notomedium' }],
  ['본명조 세미볼드로 바꿔줘', SERIF_BODY, { serifFont: 'notosemibold' }],
  ['명조를 나눔명조로 변경해줘', SERIF_BODY, { serifFont: 'nanum' }],
  // 이름으로 부르기 — 고딕 (25~42)
  ['돋움체로 바꿔줘', SANS_BODY, { sansFont: 'dotum' }],
  ['고딕을 돋움으로 해줘', SANS_BODY, { sansFont: 'dotum' }],
  ['굴림체로 바꿔줘', SANS_BODY, { sansFont: 'gulim' }],
  ['백묵굴림으로 해줘', SANS_BODY, { sansFont: 'gulim' }],
  ['헤드라인체로 바꿔줘', SANS_BODY, { sansFont: 'headline' }],
  ['제목체 느낌의 고딕으로 해줘', SANS_BODY, { sansFont: 'headline' }],
  ['그래픽체로 바꿔줘', SANS_BODY, { sansFont: 'graphic' }],
  ['디나루로 바꿔줘', SANS_BODY, { sansFont: 'dinaru' }],
  ['둥근 고딕으로 해줘', SANS_BODY, { sansFont: 'dinaru' }],
  ['둥근체로 바꿔줘', SANS_BODY, { sansFont: 'dinaru' }],
  ['라운드 고딕 느낌으로 해줘', SANS_BODY, { sansFont: 'dinaru' }],
  ['프리텐다드로 바꿔줘', SANS_BODY, { sansFont: 'pretendard' }],
  ['프리텐다드 라이트로 해줘', SANS_BODY, { sansFont: 'prelight' }],
  ['프리텐다드 미디엄으로 바꿔줘', SANS_BODY, { sansFont: 'premedium' }],
  ['프리텐다드 세미볼드로 해줘', SANS_BODY, { sansFont: 'presemibold' }],
  ['가는 고딕으로 바꿔줘', SANS_BODY, { sansFont: 'prelight' }],
  ['굵은 고딕으로 해줘', SANS_BODY, { sansFont: 'presemibold' }],
  ['고딕체를 좀 얇은 걸로 바꿔줘', SANS_BODY, { sansFont: 'prelight' }],
  // 이름 없이 "다른 서체" (43~58)
  ['좀 다른 명조체로 바꿔줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['다른 명조로 해줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['다른 명조체로 바꿔줘', NANUM, { serifFont: 'noto' }],
  ['색다른 명조 없어? 바꿔줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['명조 말고 다른 명조로 바꿔줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['새로운 세리프로 바꿔줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['딴 바탕체로 해줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['명조를 다른 걸로 바꿔줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['다른 고딕으로 바꿔줘', SANS_BODY, { sansFont: 'dotum' }],
  ['다른 고딕체로 해줘', { ...SANS_BODY, sansFont: 'dotum' }, { sansFont: 'headline' }],
  ['색다른 고딕으로 해줘', SANS_BODY, { sansFont: 'dotum' }],
  ['산세리프를 다른 걸로 바꿔줘', SANS_BODY, { sansFont: 'dotum' }],
  ['명조체 좀 바꿔줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['고딕체 좀 바꿔줘', SANS_BODY, { sansFont: 'dotum' }],
  ['서체를 다르게 해줘 명조로', SERIF_BODY, { serifFont: 'nanum' }],
  ['명조 다른 걸로 부탁해', SERIF_BODY, { serifFont: 'nanum' }],
  // 분위기·용도 (59~76)
  ['신문 기사 같은 느낌으로 명조 바꿔줘', SERIF_BODY, { serifFont: 'shinmun' }],
  ['신문 같은 서체로 해줘', SERIF_BODY, { serifFont: 'shinmun' }],
  ['공문서 같은 느낌으로 바꿔줘', SERIF_BODY, { serifFont: 'gungseo' }],
  ['전통적인 느낌으로 바꿔줘', SERIF_BODY, { serifFont: 'gungseo' }],
  ['사극 같은 서체로 해줘', SERIF_BODY, { serifFont: 'gungseo' }],
  ['손으로 쓴 느낌으로 바꿔줘', SERIF_BODY, { serifFont: 'pilgi' }],
  ['부드러운 명조로 바꿔줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['따뜻한 명조로 해줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['현대적인 명조로 바꿔줘', SERIF_BODY, { serifFont: 'noto' }],
  ['깔끔한 명조체로 해줘', SERIF_BODY, { serifFont: 'noto' }],
  ['가는 명조로 바꿔줘', SERIF_BODY, { serifFont: 'notolight' }],
  ['얇은 명조체로 해줘', SERIF_BODY, { serifFont: 'notolight' }],
  ['굵은 명조로 바꿔줘', SERIF_BODY, { serifFont: 'notosemibold' }],
  ['묵직한 명조로 해줘', SERIF_BODY, { serifFont: 'notosemibold' }],
  ['귀여운 고딕으로 바꿔줘', SANS_BODY, { sansFont: 'dinaru' }],
  ['광고 같은 굵직한 서체로 해줘', SANS_BODY, { sansFont: 'headline' }],
  ['포스터 같은 고딕으로 바꿔줘', SANS_BODY, { sansFont: 'headline' }],
  ['가벼운 고딕으로 바꿔줘', SANS_BODY, { sansFont: 'prelight' }],
  // 본문 계열과 반대 서체 요청 — 계열도 같이 맞춘다 (77~84)
  ['본문을 나눔명조로 바꿔줘', SANS_BODY, { serifFont: 'nanum', bodyFontFamily: 'serif' }],
  ['본문 신문명조로 해줘', SANS_BODY, { serifFont: 'shinmun', bodyFontFamily: 'serif' }],
  ['본문을 다른 명조로 바꿔줘', SANS_BODY, { serifFont: 'nanum', bodyFontFamily: 'serif' }],
  ['본문을 돋움으로 바꿔줘', SERIF_BODY, { sansFont: 'dotum', bodyFontFamily: 'sans' }],
  ['본문 둥근 고딕으로 해줘', SERIF_BODY, { sansFont: 'dinaru', bodyFontFamily: 'sans' }],
  ['본문을 프리텐다드로 바꿔줘', SERIF_BODY, { sansFont: 'pretendard', bodyFontFamily: 'sans' }],
  ['본문 궁서체로 바꿔줘', SANS_BODY, { serifFont: 'gungseo', bodyFontFamily: 'serif' }],
  ['본문 필기체로 해줘', SANS_BODY, { serifFont: 'pilgi', bodyFontFamily: 'serif' }],
  // 각주·면주·쪽번호만 (85~96)
  ['각주를 나눔명조로 바꿔줘', SERIF_BODY, { serifFont: 'nanum', footnoteFontFamily: 'serif' }],
  ['각주 서체를 신문명조로 해줘', SERIF_BODY, { serifFont: 'shinmun', footnoteFontFamily: 'serif' }],
  ['주석을 돋움체로 바꿔줘', SERIF_BODY, { sansFont: 'dotum' }],
  ['면주를 궁서체로 바꿔줘', SERIF_BODY, { serifFont: 'gungseo', rhFontFamily: 'serif' }],
  ['머리말을 나눔명조로 해줘', SERIF_BODY, { serifFont: 'nanum', rhFontFamily: 'serif' }],
  ['쪽번호를 돋움으로 바꿔줘', SERIF_BODY, { sansFont: 'dotum' }],
  ['페이지 번호를 나눔명조로 해줘', SERIF_BODY, { serifFont: 'nanum', pnFontFamily: 'serif' }],
  ['쪽번호를 둥근 고딕으로 바꿔줘', SERIF_BODY, { sansFont: 'dinaru' }],
  ['각주를 둥근체로 바꿔줘', { ...SERIF_BODY, footnoteFontFamily: 'serif' }, { sansFont: 'dinaru', footnoteFontFamily: 'sans' }],
  ['면주를 헤드라인체로 해줘', SERIF_BODY, { sansFont: 'headline' }],
  ['각주 서체를 본명조로 바꿔줘', SERIF_BODY, { serifFont: 'noto', footnoteFontFamily: 'serif' }],
  ['쪽번호 필기체로 해줘', SERIF_BODY, { serifFont: 'pilgi', pnFontFamily: 'serif' }],
  // 영어·붙여쓰기·말투 (97~108)
  ['나눔명조로바꿔줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['신문명조체로해줘', SERIF_BODY, { serifFont: 'shinmun' }],
  ['궁서로 좀 바꿔주세요', SERIF_BODY, { serifFont: 'gungseo' }],
  ['나눔명조 써볼까', SERIF_BODY, { serifFont: 'nanum' }],
  ['명조를 본명조로 바꾸고 싶어요', SERIF_BODY, { serifFont: 'noto' }],
  ['본명조였으면 좋겠어', SERIF_BODY, { serifFont: 'noto' }],
  ['돋움체면 좋겠어요', SANS_BODY, { sansFont: 'dotum' }],
  ['필기체로 하면 어떨까? 해줘', SERIF_BODY, { serifFont: 'pilgi' }],
  ['serif 다른 걸로 바꿔줘', SERIF_BODY, { serifFont: 'nanum' }],
  ['sans 다른 걸로 바꿔줘', SANS_BODY, { sansFont: 'dotum' }],
  ['본문 폰트를 나눔명조로', SANS_BODY, { serifFont: 'nanum', bodyFontFamily: 'serif' }],
  ['글씨체를 궁서로', SERIF_BODY, { serifFont: 'gungseo' }],
  // 서체 요청이 아닌 말 — 서체가 바뀌면 안 된다 (109~124)
  ['명조 글씨 키워줘', SERIF_BODY, null],
  ['나눔명조 행간 줄여줘', SERIF_BODY, null],
  ['본명조 크기 조금 키워줘', SERIF_BODY, null],
  ['고딕 각주 글자 줄여줘', SERIF_BODY, null],
  ['명조 크기 바꿔줘', SERIF_BODY, null],
  ['고딕 간격 바꿔줘', SANS_BODY, null],
  ['행간 줄여줘', SERIF_BODY, null],
  ['여백 늘려줘', SERIF_BODY, null],
  ['자간 넓혀줘', SERIF_BODY, null],
  ['본문 글자 크게', SERIF_BODY, null],
  ['제목 서체를 명조로 바꿔줘', SERIF_BODY, { h1FontFamily: 'serif' }],
  ['정각주 서체 부제랑 같게 해줘', SERIF_BODY, { fontSameAs: 'note:h2' }],
  ['따옴표 안의 단어들 빨간색으로 바꿔줘', SERIF_BODY, { quoteHighlight: 'text:red' }],
  ['따옴표 안의 단어들 형광펜 칠해줘', SERIF_BODY, { quoteHighlight: 'yellow' }],
  ['제목을 필기체로 해줘', SERIF_BODY, { serifFont: 'pilgi', h1FontFamily: 'serif' }],
  ['표 넣어줘', SERIF_BODY, null],
  ['오른쪽 정렬로 해줘', SERIF_BODY, null],
  ['굵게 해줘', SERIF_BODY, null],
  ['궁서 크기로 키워줘', SERIF_BODY, null],
];

let bad = 0;
const diff = [];
for (const [msg, cm, want] of CASES) {
  const plan = planNaturalEdit(msg, cm, []);
  const text = plan.font ? plan.font.patches : (plan.synth?.font && /quoteHighlight/.test(plan.synth.text) ? plan.synth.patches : null); // 따옴표 안 색은 통합 스타일 해석기가 낸다
  const ok = want === null
    ? !text
    : text && Object.keys(want).length === Object.keys(text).length && Object.entries(want).every(([k, v]) => text[k] === v);
  if (!ok) { bad++; diff.push(`  ✗ "${msg}"\n      기대 ${JSON.stringify(want)}\n      결과 ${JSON.stringify(text)}`); }
}

// 서체 적용 자체 점검 — 같은 sty에서 id를 바꿨다 되돌려도 줄이 쌓이지 않고, 자간과 함께 쓸 수 있어야 한다
const sty0 = `\\RequirePackage{fontspec}\n\\setmainfont{NotoSerif}[\n  Path=./fonts/,\n  Extension=.ttf,\n  UprightFont=NotoSerif-Regular,\n  BoldFont=NotoSerif-Bold\n]\n\\setsansfont{Pretendard}[\n  Path=./fonts/,\n  Extension=.otf,\n  UprightFont=Pretendard-Regular,\n  BoldFont=Pretendard-Bold\n]\n\\endinput\n`;
const unit = [];
for (const role of ['serif', 'sans']) {
  for (const id of fontIds(role)) {
    let sty = applyTracking(applyFont(sty0, role, id), 3);
    sty = applyTracking(applyFont(sty, role, id), readTracking(sty));
    const f = readFonts(sty);
    if (f[role] !== id) unit.push(`${role}:${id} 읽기 실패 ${JSON.stringify(f)}`);
    if ((sty.match(/% imprintFonts/g) || []).length !== 1) unit.push(`${role}:${id} 서체 줄이 ${(sty.match(/% imprintFonts/g) || []).length}개`);
    if ((sty.match(/\\setmainfont\{/g) || []).length !== 1) unit.push(`${role}:${id} setmainfont가 여러 개`);
    if (readTracking(sty) !== '3') unit.push(`${role}:${id} 자간이 사라짐 ${readTracking(sty)}`);
    if ((sty.match(/% imprintTrack/g) || []).length !== 2) unit.push(`${role}:${id} 자간 줄 ${(sty.match(/% imprintTrack/g) || []).length}개`);
  }
}
const back = applyFont(applyFont(sty0, 'serif', 'nanum'), 'serif', 'batang');
if (!/NotoSerif-Regular/.test(back)) unit.push('기본 명조로 되돌려도 라틴 서체가 복구되지 않음');

console.log(`서체 문장 ${CASES.length}개: ${CASES.length - bad}개 통과, ${bad}개 실패 / 적용 점검 ${unit.length ? unit.length + '건 실패' : '통과'} (명조 ${Object.keys(SERIF_FONTS).length}종·고딕 ${Object.keys(SANS_FONTS).length}종)`);
diff.forEach(d => console.log(d));
unit.forEach(u => console.log('  ✗', u));
process.exit(bad || unit.length ? 1 : 0);

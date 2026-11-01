// 각주 구분선 자연어(켜기·끄기·길이·두께·진하기) + 적용 결과 점검. (API 호출 없음)  실행: node test_nl_rule.js
import { planNaturalEdit } from './src/nlKnobAliases.js';
import { applyRule, readRule } from './src/styRule.js';

const OFF = { footnoteRule: 'off', footnoteRuleWidth: '40', footnoteRuleThickness: '0.4', footnoteRuleColor: '100', marginTop: '6', bodyLeading: '12' };
const ON = { ...OFF, footnoteRule: 'on' };
const num = v => (v === undefined ? undefined : Number(v));

// [문장, cmdMap, 기대 키 목록, 값 검사(p => 문자열|null), 나오면 안 되는 키]
const CASES = [
  ['각주 위에 구분선 넣어줘', OFF, ['footnoteRule'], p => p.footnoteRule === 'on', ['marginTop']],
  ['각주 구분선 빼줘', ON, ['footnoteRule'], p => p.footnoteRule === 'off'],
  ['구분선 없애줘', ON, ['footnoteRule'], p => p.footnoteRule === 'off'],
  ['구분선 가로 여백에 맞게 늘려줘', ON, ['footnoteRuleWidth'], p => p.footnoteRuleWidth === '100', ['marginTop', 'marginBottom', 'marginInner', 'marginOuter']],
  ['구분선을 판면 폭 전체로', ON, ['footnoteRuleWidth'], p => p.footnoteRuleWidth === '100'],
  ['구분선 꽉 차게 해줘', ON, ['footnoteRuleWidth'], p => p.footnoteRuleWidth === '100'],
  ['구분선 길게 해줘', ON, ['footnoteRuleWidth'], p => num(p.footnoteRuleWidth) > 40],
  ['구분선 가로 길이 줄여줘', ON, ['footnoteRuleWidth'], p => num(p.footnoteRuleWidth) < 40],
  ['구분선 짧게', ON, ['footnoteRuleWidth'], p => num(p.footnoteRuleWidth) < 40],
  ['각주 구분선 더 얇게 해줘', ON, ['footnoteRuleThickness'], p => num(p.footnoteRuleThickness) < 0.4],
  ['구분선 가늘게', ON, ['footnoteRuleThickness'], p => num(p.footnoteRuleThickness) < 0.4],
  ['구분선 두껍게 해줘', ON, ['footnoteRuleThickness'], p => num(p.footnoteRuleThickness) > 0.4],
  ['구분선 굵게', ON, ['footnoteRuleThickness'], p => num(p.footnoteRuleThickness) > 0.4],
  ['각주 구분선 연하게 해줘', ON, ['footnoteRuleColor'], p => num(p.footnoteRuleColor) < 100],
  ['구분선 흐리게', ON, ['footnoteRuleColor'], p => num(p.footnoteRuleColor) < 100],
  ['구분선 진하게 해줘', { ...ON, footnoteRuleColor: '50' }, ['footnoteRuleColor'], p => num(p.footnoteRuleColor) > 50],
  ['각주 구분선 더 얇고 연하게 해줘', ON, ['footnoteRuleThickness', 'footnoteRuleColor'], p => num(p.footnoteRuleThickness) < 0.4 && num(p.footnoteRuleColor) < 100, ['marginTop', 'marginBottom']],
  ['구분선 완전완전완전 더 얇고 연하게 해줘', ON, ['footnoteRuleThickness', 'footnoteRuleColor'], p => num(p.footnoteRuleThickness) < 0.2 && num(p.footnoteRuleColor) < 60],
  ['구분선 아주 조금만 연하게', ON, ['footnoteRuleColor'], p => num(p.footnoteRuleColor) >= 90],
  ['구분선 많이 연하게', ON, ['footnoteRuleColor'], p => num(p.footnoteRuleColor) <= 70],
  ['가로줄 얇게 해줘', ON, ['footnoteRuleThickness'], p => num(p.footnoteRuleThickness) < 0.4],
  ['각주 위 선 가늘게 해줘', ON, ['footnoteRuleThickness'], p => num(p.footnoteRuleThickness) < 0.4],
  // 단계가 클수록 더 크게 바뀐다
  ['구분선 아주 조금 얇게', ON, ['footnoteRuleThickness'], p => num(p.footnoteRuleThickness) > 0.33],
  ['구분선 아주 많이 얇게', ON, ['footnoteRuleThickness'], p => num(p.footnoteRuleThickness) < 0.2],
  // 구분선 말이 아닌 것 — 구분선 키가 나오면 안 된다
  ['여백 늘려줘', OFF, [], null, ['footnoteRuleWidth', 'footnoteRuleThickness', 'footnoteRuleColor', 'footnoteRule']],
  ['행간 줄여줘', OFF, [], null, ['footnoteRuleWidth', 'footnoteRuleThickness', 'footnoteRuleColor']],
];

let bad = 0; const out = [];
for (const [msg, cm, want, check, notKeys = []] of CASES) {
  const plan = planNaturalEdit(msg, cm, ['bodySize']);
  const p = plan.synth?.patches || {};
  const keys = Object.keys(p);
  const why = [];
  if (want.length) {
    for (const k of want) if (!(k in p)) why.push(`${k} 값이 안 나옴(실제 ${keys.join(',') || '없음'})`);
    if (check && !check(p)) why.push(`값이 기대와 다름 ${JSON.stringify(p)}`);
  }
  for (const k of notKeys) if (k in p || plan.keys.includes(k)) why.push(`나오면 안 되는 ${k}`);
  if (why.length) { bad++; out.push(`  ✗ "${msg}": ${why.join('; ')}`); }
}

// 적용 점검 — 같은 값을 여러 번 적용해도 줄이 쌓이지 않고, 중괄호 오류가 안 나는 형태여야 한다
const sty0 = '\\feetbelowfloat\n\\renewcommand{\\footnoterule}{}\n\\setlength{\\footnotesep}{14pt}\n\\endinput\n';
const unit = [];
let sty = sty0;
for (const patch of [{ on: true }, { thickness: 0.2 }, { darkness: 40 }, { width: 100 }, { on: true }, { thickness: 0.15 }]) sty = applyRule(sty, patch);
if ((sty.match(/\\renewcommand\{\\footnoterule\}/g) || []).length !== 1) unit.push('footnoterule 줄이 여러 개');
if ((sty.match(/% imprintRule/g) || []).length !== 1) unit.push('표식 줄이 여러 개');
const r = readRule(sty);
if (!r || !r.on || r.width !== 100 || r.thickness !== 0.15 || r.darkness !== 40) unit.push('읽은 값이 다름 ' + JSON.stringify(r));
const line = sty.split('\n').find(l => l.includes('% imprintRule'));
const depth = [...line.replace(/\\[{}]/g, '')].reduce((d, c) => d + (c === '{' ? 1 : c === '}' ? -1 : 0), 0);
if (depth !== 0) unit.push('중괄호가 맞지 않음');
if (readRule(applyRule(sty, { on: false })).on !== false) unit.push('끄기가 안 됨');

console.log(`구분선 문장 ${CASES.length}개: ${CASES.length - bad}개 통과, ${bad}개 실패 / 적용 점검 ${unit.length ? unit.join(', ') : '통과'}`);
out.forEach(o => console.log(o));
process.exit(bad || unit.length ? 1 : 0);

// test_nl_corpus.js의 100문장을 사람이 읽기 쉬운 표(마크다운)로 만든다.
// 실행: node scripts/make_nl_corpus_md.mjs  → docs/nl_corpus_100.md
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CORPUS } = await import(pathToFileURL(path.join(root, 'test_nl_corpus.js')).href);
const { detectKnobHints } = await import(pathToFileURL(path.join(root, 'src/nlKnobAliases.js')).href);

const DESC = {
  other: '다른 처리 경로(판형·재생성·되돌리기)',
  intent: '질문 분류 경로',
  ambiguous: '모호한 말투 — 되묻기 필요',
};

const rows = CORPUS.map(([s, want], i) => {
  let result;
  if (DESC[want]) result = `⏭ ${DESC[want]}`;
  else {
    const hits = detectKnobHints(s);
    const ok = want === 'unsupported' ? hits.some(h => h.unsupported)
      : want === 'margin' ? hits.some(h => ['marginTop','marginBottom','marginInner','marginOuter'].includes(h.key))
      : hits.some(h => h.key === want);
    const got = hits.map(h => h.key ?? '미지원').join(', ') || '없음';
    result = ok ? '✅ 통과' : `❌ 실패 (실제: ${got})`;
  }
  return `| ${i + 1} | ${s} | ${want} | ${result} |`;
});

const fails = rows.filter(r => r.includes('❌')).length;
const md = [
  '# 자연어 수정 문장 100개 — 현재 힌트 매칭 결과',
  '',
  '이 표는 **힌트 매칭 단계까지만** 확인한 결과입니다. 채팅 모델이 실제로 어떻게 답하는지는 아직 검증하지 않았습니다.',
  `힌트 검사 대상 ${CORPUS.length - rows.filter(r => r.includes('⏭')).length}개 중 실패 ${fails}개.`,
  '',
  '| # | 문장 | 기대 | 결과 |',
  '|---|---|---|---|',
  ...rows,
  '',
];
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'nl_corpus_100.md'), md.join('\n'), 'utf8');
console.log(`wrote docs/nl_corpus_100.md (${CORPUS.length} rows, ${fails} failing)`);

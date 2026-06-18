// Test the mapFeedbackToPatch function

function normalizePercentage(value) {
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?%?/);
    if (!match) return 'unknown';
    value = parseFloat(match[0]);
  } else if (typeof value === 'number') {
    // Handle number inputs - use directly
  } else {
    return 'unknown';
  }
  const rounded = Math.round(value);
  return `${rounded}%`;
}

function mapFeedbackToPatch(feedbackUnit, systemRules) {
  const snippet = feedbackUnit.snippet;
  const patches = [];

  const variableMappings = {
    '각주 행간|footnote.*leading|주석.*행간': { var: 'footnote_leading', group: 'footnote' },
    '각주 크기|footnote.*size|주석.*크기': { var: 'footnote_size', group: 'footnote' },
    '각주 번호 크기|marker.*size|주석.*번호': { var: 'footnote_marker_size', group: 'footnote' },
    '제목.*소제목.*간격|제목.*gap|heading.*gap': { var: 'heading_gap', group: 'heading' },
    '제목 크기|h1.*size|heading.*1.*size': { var: 'heading_h1_size', group: 'heading' },
    '소제목 크기|h2.*size|heading.*2.*size': { var: 'heading_h2_size', group: 'heading' },
    '본문 행간|body.*leading|본문.*라인': { var: 'body_leading', group: 'body_text' },
    '본문 크기|body.*size|글자.*크기': { var: 'body_size', group: 'body_text' },
    '여백|margin|마진': { var: 'margin_all', group: 'margin' },
    '단수|2단|column.*count|다단': { var: 'column_count', group: 'column' },
  };

  for (const [pattern, mapping] of Object.entries(variableMappings)) {
    if (new RegExp(pattern, 'i').test(snippet)) {
      const direction = /늘려|증가|크게|높혀|높이|높여|상향|확대/.test(snippet) ? 'increase' : 'decrease';
      const magnitude = feedbackUnit.numeric_raw || 'unknown';

      patches.push({
        interpreted_variable: mapping.var,
        intended_variable: mapping.var,
        group: mapping.group,
        direction_requested: direction,
        magnitude_requested: normalizePercentage(magnitude),
        confidence: 'high'
      });
      break;
    }
  }

  if (patches.length === 0) {
    patches.push({
      interpreted_variable: 'unknown',
      intended_variable: 'unknown',
      group: 'unknown',
      direction_requested: 'unknown',
      magnitude_requested: 'unknown',
      confidence: 'low'
    });
  }

  return patches;
}

// Test Cases
console.log('===== Test Case 1: 각주 행간을 10% 늘려줘 =====');
let result = mapFeedbackToPatch({ snippet: '각주 행간을 10% 늘려줘', numeric_raw: '10' });
console.log(JSON.stringify(result[0], null, 2));
console.log('Expected: footnote_leading, increase, 10%');
console.log('Match:', result[0].interpreted_variable === 'footnote_leading' && result[0].direction_requested === 'increase' && result[0].magnitude_requested === '10%' ? 'PASS' : 'FAIL');

console.log('\n===== Test Case 2: 본문 크기를 5% 줄여줘 =====');
result = mapFeedbackToPatch({ snippet: '본문 크기를 5% 줄여줘', numeric_raw: '5' });
console.log(JSON.stringify(result[0], null, 2));
console.log('Expected: body_size, decrease, 5%');
console.log('Match:', result[0].interpreted_variable === 'body_size' && result[0].direction_requested === 'decrease' && result[0].magnitude_requested === '5%' ? 'PASS' : 'FAIL');

console.log('\n===== Test Case 3: 제목 gap을 2배 늘려줘 =====');
result = mapFeedbackToPatch({ snippet: '제목 gap을 2배 늘려줘', numeric_raw: '2' });
console.log(JSON.stringify(result[0], null, 2));
console.log('Expected: heading_gap, increase, 2%');
console.log('Match:', result[0].interpreted_variable === 'heading_gap' && result[0].direction_requested === 'increase' ? 'PASS' : 'FAIL');

console.log('\n===== Test Case 4: 여백을 20% 증가시켜줘 =====');
result = mapFeedbackToPatch({ snippet: '여백을 20% 증가시켜줘', numeric_raw: '20' });
console.log(JSON.stringify(result[0], null, 2));
console.log('Expected: margin_all, increase, 20%');
console.log('Match:', result[0].interpreted_variable === 'margin_all' && result[0].direction_requested === 'increase' && result[0].magnitude_requested === '20%' ? 'PASS' : 'FAIL');

console.log('\n===== Test Case 5: 모르는 피드백 =====');
result = mapFeedbackToPatch({ snippet: '뭔가 이상해', numeric_raw: '' });
console.log(JSON.stringify(result[0], null, 2));
console.log('Expected: unknown, unknown, low confidence');
console.log('Match:', result[0].interpreted_variable === 'unknown' && result[0].confidence === 'low' ? 'PASS' : 'FAIL');

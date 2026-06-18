function parseFeedbackUnits(feedbackText) {
  if (!feedbackText) return [];

  const sentences = feedbackText
    .split(/[。\.!\n]/gi)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return sentences.map((snippet, index) => ({
    order: index + 1,
    snippet: snippet,
    type: detectFeedbackType(snippet),
    design_area: detectDesignArea(snippet),
    language_type: detectLanguageType(snippet),
    has_numeric: /\d+/.test(snippet),
    numeric_raw: extractNumeric(snippet),
    unit: extractUnit(snippet)
  }));
}

function detectFeedbackType(text) {
  if (/늘려|증가|크게|크면|높혀|높이|높여|높이|상향|확대/.test(text)) return 'direct_numeric';
  if (/줄여|감소|작게|작으면|낮춰|낮춤|낮게|하향|축소/.test(text)) return 'direct_numeric';
  if (/높이|낮추/.test(text)) return 'direct_numeric';
  return 'other';
}

function detectDesignArea(text) {
  if (/각주|주석|footnote/.test(text)) return 'footnote';
  if (/제목|소제목|h[1-2]|heading|title|subtitle/.test(text)) return 'heading';
  if (/여백|마진|margin|padding/.test(text)) return 'margin';
  if (/본문|body|본|text/.test(text)) return 'body_text';
  if (/단수|2단|3단|column|칼럼/.test(text)) return 'column';
  if (/행간|라인|leading|line.?height|line.?spacing/.test(text)) return 'line_spacing';
  if (/글자.?크기|폰트.?크기|font.?size|size/.test(text)) return 'font_size';
  if (/자간|글자.?간격|자.?간|spacing|tracking/.test(text)) return 'letter_spacing';
  return 'overall_layout';
}

function detectLanguageType(text) {
  if (/\d+%|[0-9]/.test(text)) return 'direct_numeric';
  return 'sensory_expression';
}

function extractNumeric(text) {
  const matches = text.match(/-?\d+(?:\.\d+)?/g);
  if (!matches) return '';
  return matches.join('~');
}

function extractUnit(text) {
  if (/%/.test(text)) return '%';
  if (/pt|px|em|mm|cm|in/.test(text)) {
    const match = text.match(/(pt|px|em|mm|cm|in)/);
    return match ? match[0] : '';
  }
  return '';
}

// Test with sample feedback
const units = parseFeedbackUnits("각주 행간을 10% 늘려줘. 여백은 25% 줄여줘.");
console.log("Test 1: Basic split by period");
console.log("Parsed units count:", units.length);
console.log("Unit 0 order:", units[0].order);
console.log("Unit 0 snippet:", units[0].snippet);
console.log("Unit 0 design_area:", units[0].design_area);
console.log("Unit 0 has_numeric:", units[0].has_numeric);
console.log("Unit 0 numeric_raw:", units[0].numeric_raw);
console.log("Unit 0 unit:", units[0].unit);
console.log("\nUnit 1 order:", units[1].order);
console.log("Unit 1 snippet:", units[1].snippet);
console.log("Unit 1 design_area:", units[1].design_area);
console.log("Unit 1 has_numeric:", units[1].has_numeric);
console.log("Unit 1 numeric_raw:", units[1].numeric_raw);
console.log("Unit 1 unit:", units[1].unit);

// Test with longer example
const units2 = parseFeedbackUnits("제목과 소제목 사이의 행간을 10% 정도 띄워야 해. 각주 행간은 15% 늘려야 해. 여백은 25% 줄여야 해.");
console.log("\n\nTest 2: Longer feedback with 3 units");
console.log("Parsed units count:", units2.length);
units2.forEach((u, i) => {
  console.log(`\nUnit ${i+1}:`);
  console.log("  snippet:", u.snippet);
  console.log("  design_area:", u.design_area);
  console.log("  numeric_raw:", u.numeric_raw);
});

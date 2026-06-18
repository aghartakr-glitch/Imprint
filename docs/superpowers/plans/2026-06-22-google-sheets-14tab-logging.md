# Google Sheets 14-Tab 자동 기록 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `피드백 적용하기` 버튼 실행 시 사용자의 감각적 디자인 피드백을 퍼센트 기반 상대 조정값으로 분석하고, Google Sheets 14개 탭에 자동으로 구조화된 연구 데이터를 기록하는 시스템 구현

**Architecture:** 
- Apps Script: `getNextAppendRowByKey()` 함수로 각 탭의 마지막 데이터 행 자동 탐지 → 기존 데이터 아래에만 append
- App.jsx: `analyzeExperiment()` 함수 확장 → 사용자 피드백을 feedback_unit/patch/value_check 단위로 분해 → 14개 탭 데이터 객체 생성 → Google Sheet 각 탭에 순차 기록
- ID 체계: experiment_id, raw_id, feedback_unit_id, patch_id, value_check_id 등으로 모든 탭 상호 연결 가능

**Tech Stack:** Google Apps Script (doPost, Sheets API), JavaScript (App.jsx), JSON payload structure

---

## Task 1: Apps Script - getNextAppendRowByKey() 함수 구현

**Files:**
- Modify: `imprint-sheet/apps-script.gs`

**Context:** 
Google Sheet에 새 데이터를 기록할 때 기존 행을 덮어쓰지 않도록, 각 탭의 실제 마지막 데이터 행을 ID 열 기준으로 찾는 함수 필요

**Specification:**
- 함수명: `getNextAppendRowByKey(sheet, keyColumnIndex)`
- 입력: Sheet 객체, 기준 열 번호 (1-indexed)
- 출력: 새 데이터를 append할 행 번호
- 로직: A열부터 마지막까지 순회하면서 가장 마지막에 값이 있는 행을 찾고, 그 다음 행 번호 반환
- 예: 현재 마지막 데이터가 61행이면 62 반환

- [ ] **Step 1: Write the function with header row skip logic**

```javascript
function getNextAppendRowByKey(sheet, keyColumnIndex) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 2; // 헤더(1행)만 있으면 2행부터 시작
  
  const values = sheet.getRange(2, keyColumnIndex, lastRow - 1, 1).getValues();
  let lastDataRow = 1;
  
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i][0];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      lastDataRow = i + 2;
      break;
    }
  }
  
  return lastDataRow + 1;
}
```

- [ ] **Step 2: Add comment documentation**

```javascript
// 각 탭의 기준 열 (A열 = 1)
// 01-Raw Experiment Log: raw_id (1)
// 02-Experiment Summary: experiment_id (1)
// 03-Feedback Unit Log: feedback_unit_id (1)
// ... 이하 모든 탭 동일: A열 기준
```

- [ ] **Step 3: Commit**

```bash
git add imprint-sheet/apps-script.gs
git commit -m "feat: add getNextAppendRowByKey function for safe append-only sheet operations"
```

---

## Task 2: Apps Script - writeToSheet() 통합 기록 함수 구현

**Files:**
- Modify: `imprint-sheet/apps-script.gs`

**Context:**
14개 탭에 데이터를 기록하는 공통 로직 필요. 각 탭의 마지막 행을 찾고 append하는 과정을 통일.

- [ ] **Step 1: Write the unified write function**

```javascript
function writeToSheet(sheetName, rowValues, mode = 'append', keyValue = null, keyColumnIndex = 1) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  
  if (mode === 'append') {
    // append only: 항상 마지막 행 아래에 추가
    const nextRow = getNextAppendRowByKey(sheet, keyColumnIndex);
    sheet.getRange(nextRow, 1, 1, rowValues.length).setValues([rowValues]);
    return { status: 'success', sheet: sheetName, row: nextRow, mode: 'append' };
  } else if (mode === 'upsert') {
    // upsert: 같은 keyValue가 있으면 업데이트, 없으면 append
    const lastRow = sheet.getLastRow();
    const keyValues = sheet.getRange(2, keyColumnIndex, lastRow - 1, 1).getValues();
    
    let foundRow = null;
    for (let i = 0; i < keyValues.length; i++) {
      if (String(keyValues[i][0]).trim() === String(keyValue).trim()) {
        foundRow = i + 2;
        break;
      }
    }
    
    if (foundRow) {
      // 기존 행 업데이트
      sheet.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
      return { status: 'success', sheet: sheetName, row: foundRow, mode: 'upsert-update' };
    } else {
      // 새 행 append
      const nextRow = getNextAppendRowByKey(sheet, keyColumnIndex);
      sheet.getRange(nextRow, 1, 1, rowValues.length).setValues([rowValues]);
      return { status: 'success', sheet: sheetName, row: nextRow, mode: 'upsert-append' };
    }
  }
}
```

- [ ] **Step 2: Add error handling**

```javascript
function writeToSheet(sheetName, rowValues, mode = 'append', keyValue = null, keyColumnIndex = 1) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      return { status: 'error', message: `Sheet "${sheetName}" not found` };
    }
    
    if (!rowValues || rowValues.length === 0) {
      return { status: 'error', message: 'rowValues is empty' };
    }
    
    // ... rest of logic
  } catch (error) {
    return { status: 'error', message: error.toString() };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add imprint-sheet/apps-script.gs
git commit -m "feat: add writeToSheet unified function for append/upsert operations"
```

---

## Task 3: App.jsx - ID 생성 유틸리티 함수 구현

**Files:**
- Modify: `src/App.jsx` (새 섹션: 라인 ~400)

**Context:**
모든 기록의 핵심은 ID 체계. 동일한 experiment에서 생성된 모든 데이터는 experiment_id로 연결되어야 함.

- [ ] **Step 1: Write ID generation functions**

```javascript
function generateExperimentId() {
  const now = new Date();
  const yyyymmdd = String(now.getFullYear()) +
                   String(now.getMonth() + 1).padStart(2, '0') +
                   String(now.getDate()).padStart(2, '0');
  const hhmmss = String(now.getHours()).padStart(2, '0') +
                 String(now.getMinutes()).padStart(2, '0') +
                 String(now.getSeconds()).padStart(2, '0');
  return `exp_${yyyymmdd}_${hhmmss}`;
}

function generateRawId(experimentId) {
  return `raw_${experimentId.substring(4)}`;
}

function generateFeedbackUnitId(experimentId, unitIndex) {
  return `${experimentId}_fu${String(unitIndex + 1).padStart(2, '0')}`;
}

function generatePatchId(experimentId, feedbackUnitIndex, patchIndex) {
  return `${experimentId}_p${String(feedbackUnitIndex + 1).padStart(2, '0')}_${String(patchIndex + 1).padStart(2, '0')}`;
}

function generateValueCheckId(experimentId, unitIndex) {
  return `${experimentId}_v${String(unitIndex + 1).padStart(2, '0')}`;
}

function generateLockCheckId(experimentId, unitIndex) {
  return `${experimentId}_l${String(unitIndex + 1).padStart(2, '0')}`;
}

function generateScoreId(experimentId, unitIndex) {
  return `${experimentId}_s${String(unitIndex + 1).padStart(2, '0')}`;
}

function generateFailureId(experimentId, failureIndex) {
  return `${experimentId}_f${String(failureIndex + 1).padStart(2, '0')}`;
}

function generateCodingId(experimentId, unitIndex) {
  return `${experimentId}_c${String(unitIndex + 1).padStart(2, '0')}`;
}
```

- [ ] **Step 2: Test ID generation**

```javascript
// 테스트 실행 시 이 함수들이 호출되는지 확인
const expId = generateExperimentId(); // exp_20260622_153000
const rawId = generateRawId(expId); // raw_20260622_153000
// ... 등등
```

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add ID generation utility functions for experiment tracking"
```

---

## Task 4: App.jsx - normalizePercentage() 퍼센트 정규화 함수

**Files:**
- Modify: `src/App.jsx`

**Context:**
사용자 피드백의 퍼센트 값을 정규화: 75.50% → 76%, 소수 버림, % 기호 포함

- [ ] **Step 1: Write normalization function**

```javascript
function normalizePercentage(value) {
  // 문자열에서 퍼센트 기호와 숫자만 추출
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (!match) return '0%';
    value = parseFloat(match[0]);
  } else if (typeof value === 'number') {
    // 이미 숫자면 그대로
  } else {
    return 'unknown';
  }
  
  // 반올림 (소수점 제거)
  const rounded = Math.round(value);
  return `${rounded}%`;
}
```

- [ ] **Step 2: Test with examples**

```javascript
// 테스트
console.assert(normalizePercentage('75.50%') === '76%');
console.assert(normalizePercentage('59.63%') === '60%');
console.assert(normalizePercentage('0.00%') === '0%');
console.assert(normalizePercentage(10.1) === '10%');
console.assert(normalizePercentage('-15.6%') === '-16%');
```

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add normalizePercentage utility for consistent percentage formatting"
```

---

## Task 5: App.jsx - parseFeedbackUnits() 피드백 의미 단위 분해

**Files:**
- Modify: `src/App.jsx` (라인 ~5332, analyzeExperiment 내부)

**Context:**
사용자 피드백 원문을 의미 단위로 분해.
예: "각주 행간을 10~15% 늘려줘. 여백은 25% 줄여줘." → [unit1, unit2]

- [ ] **Step 1: Write feedback parsing function**

```javascript
function parseFeedbackUnits(feedbackText) {
  if (!feedbackText) return [];
  
  // 마침표, 개행, 문장 부호로 분해
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
  // 피드백 유형 자동 판정
  if (/늘려|증가|크게|크면/.test(text)) return 'direct_numeric';
  if (/줄여|감소|작게|작으면/.test(text)) return 'direct_numeric';
  if (/높이|낮추/.test(text)) return 'direct_numeric';
  return 'other';
}

function detectDesignArea(text) {
  // 디자인 영역 판정
  if (/각주|주석/.test(text)) return 'footnote';
  if (/제목|소제목|h[1-2]/.test(text)) return 'heading';
  if (/여백|마진|margin/.test(text)) return 'margin';
  if (/본문|body/.test(text)) return 'body_text';
  if (/단수|2단|column/.test(text)) return 'column';
  return 'overall_layout';
}

function detectLanguageType(text) {
  if (/\d+%|10|20|30/.test(text)) return 'direct_numeric';
  return 'sensory_expression';
}

function extractNumeric(text) {
  const matches = text.match(/-?\d+(?:\.\d+)?/g);
  if (!matches) return '';
  return matches.join('~');
}

function extractUnit(text) {
  if (/%/.test(text)) return '%';
  if (/pt|px|em/.test(text)) return text.match(/pt|px|em/)[0];
  return '';
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add parseFeedbackUnits and helper functions for feedback segmentation"
```

---

## Task 6: App.jsx - mapFeedbackToPatch() 피드백→패치 변수 매핑

**Files:**
- Modify: `src/App.jsx`

**Context:**
각 feedback unit을 조판 변수(patch)로 매핑. 예: "각주 행간 10% 늘려" → {variable: footnote_leading, direction: increase, magnitude: 10%}

- [ ] **Step 1: Write variable mapping function**

```javascript
function mapFeedbackToPatch(feedbackUnit, systemRules) {
  const snippet = feedbackUnit.snippet;
  const patches = [];
  
  // 변수 사전
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
    '단.*간격|column.*gap|다단.*간격': { var: 'column_gap', group: 'column' },
  };
  
  // 변수 매핑
  for (const [pattern, mapping] of Object.entries(variableMappings)) {
    if (new RegExp(pattern, 'i').test(snippet)) {
      const direction = /늘려|증가|크게|높이/.test(snippet) ? 'increase' : 'decrease';
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
      direction_requested: 'unknown',
      magnitude_requested: 'unknown',
      confidence: 'low'
    });
  }
  
  return patches;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add mapFeedbackToPatch for semantic variable mapping from user feedback"
```

---

## Task 7: App.jsx - buildSheetPayload() 14탭 데이터 객체 생성

**Files:**
- Modify: `src/App.jsx` (analyzeExperiment 내부)

**Context:**
분석 완료 후 14개 탭에 기록할 모든 데이터를 하나의 큰 JSON 객체로 구성.

- [ ] **Step 1: Write payload builder**

```javascript
function buildSheetPayload(analysis, pdf, sty, tex, inputData, satisfactionScore, userFeedback) {
  const experimentId = generateExperimentId();
  const rawId = generateRawId(experimentId);
  const timestamp = new Date().toISOString();
  
  const feedbackUnits = parseFeedbackUnits(userFeedback);
  
  const payload = {
    experiment_id: experimentId,
    raw_id: rawId,
    timestamp: timestamp,
    
    // 01-Raw Experiment Log용
    raw_log: {
      raw_id: rawId,
      experiment_id: experimentId,
      timestamp: timestamp,
      source: 'feedback_apply_button',
      input_title: inputData.title,
      input_subtitle: inputData.subtitle,
      input_body: inputData.body.substring(0, 100) + '...',
      input_footnote: inputData.footnote || 'none',
      genre_hint: inputData.genre,
      selected_reference: inputData.reference,
      generated_pdf_path: pdf ? pdf.url : 'not_verified',
      generated_tex_path: tex ? 'main.tex' : 'not_verified',
      generated_sty_path: sty ? 'imprint-style.sty' : 'not_verified',
      user_feedback_raw: userFeedback,
      satisfaction_score: satisfactionScore,
      notes: ''
    },
    
    // 02-Experiment Summary용 (upsert)
    experiment_summary: {
      experiment_id: experimentId,
      timestamp: timestamp,
      input_title: inputData.title,
      input_genre: inputData.genre,
      feedback_count: feedbackUnits.length,
      satisfaction_score: satisfactionScore,
      overall_match_score: 'not_verified',
      overall_status: 'not_verified'
    },
    
    // 03-Feedback Unit Log용 (여러 행)
    feedback_units: feedbackUnits.map((unit, idx) => ({
      feedback_unit_id: generateFeedbackUnitId(experimentId, idx),
      experiment_id: experimentId,
      raw_id: rawId,
      feedback_order: unit.order,
      user_feedback_raw: userFeedback,
      feedback_snippet: unit.snippet,
      feedback_type: unit.type,
      design_issue_area: unit.design_area,
      user_language_type: unit.language_type,
      is_numeric_feedback: unit.has_numeric,
      numeric_value_raw: unit.numeric_raw,
      numeric_unit: unit.unit,
      intended_change_summary: unit.snippet
    })),
    
    // 04-Variable Patch Log용 (여러 행)
    patches: [],
    
    // 기타 탭...
  };
  
  // patches 생성
  feedbackUnits.forEach((unit, unitIdx) => {
    const patches_for_unit = mapFeedbackToPatch(unit, null);
    patches_for_unit.forEach((patch, patchIdx) => {
      payload.patches.push({
        patch_id: generatePatchId(experimentId, unitIdx, patchIdx),
        experiment_id: experimentId,
        feedback_unit_id: generateFeedbackUnitId(experimentId, unitIdx),
        patch_order: patchIdx + 1,
        feedback_snippet: unit.snippet,
        interpreted_variable_by_claude: patch.interpreted_variable,
        intended_variable_by_user: patch.intended_variable,
        actual_changed_variable: 'not_verified',
        direction_requested: patch.direction_requested,
        magnitude_requested: patch.magnitude_requested,
        magnitude_applied: 'not_verified',
        confidence_score: patch.confidence
      });
    });
  });
  
  return payload;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add buildSheetPayload for generating complete 14-tab data structure"
```

---

## Task 8: App.jsx - analyzeExperiment() 함수 확장 (buildSheetPayload 호출)

**Files:**
- Modify: `src/App.jsx` (라인 ~5332)

**Context:**
기존 analyzeExperiment()는 console.log와 피드백 분석만 함. 이제 buildSheetPayload()를 호출해서 Google Sheet 기록 준비.

- [ ] **Step 1: Find and update analyzeExperiment function**

현재 코드 (라인 ~5500):
```javascript
// 기존: 간단한 sendToSheet 호출만 함
const sheetData = {
  feedback_raw: userFeedbackText,
  satisfaction: satisfactionScore,
  ...
};
await sendToSheet(sheetData);
```

변경할 코드:
```javascript
// 새 코드: buildSheetPayload 호출
const payload = buildSheetPayload(
  analysis,
  pdf,
  sty,
  tex,
  { title, subtitle, body, footnote, genre, reference },
  satisfactionScore,
  userFeedbackText
);

// 이 payload를 Google Sheet에 기록 (다음 Task에서)
window._pendingSheetPayload = payload;
```

- [ ] **Step 2: Commit**

```bash
git add src/App.jsx
git commit -m "refactor: extend analyzeExperiment to call buildSheetPayload for multi-tab logging"
```

---

## Task 9: App.jsx - sendPayloadToSheet() Google Sheet 기록 함수

**Files:**
- Modify: `src/App.jsx`

**Context:**
buildSheetPayload()가 생성한 payload를 Google Sheet의 14개 탭에 실제로 기록하는 함수.

- [ ] **Step 1: Write sheet recording function**

```javascript
async function sendPayloadToSheet(payload) {
  if (!payload || !payload.experiment_id) {
    console.error('Invalid payload');
    return;
  }
  
  const sheetRecordOrder = [
    '01-Raw Experiment Log',
    '02-Experiment Summary',
    '03-Feedback Unit Log',
    '04-Variable Patch Log',
    '05-Before After Values',
    '06-Lock Check',
    '07-Score Breakdown',
    '08-Failure Analysis',
    '10-Rule Application Log',
    '11-Research Coding'
  ];
  
  const results = [];
  
  // 01-Raw Experiment Log: append
  const rawLogRow = [
    payload.raw_log.raw_id,
    payload.raw_log.experiment_id,
    payload.raw_log.timestamp,
    payload.raw_log.source,
    payload.raw_log.input_title,
    payload.raw_log.input_subtitle,
    payload.raw_log.input_body,
    payload.raw_log.input_footnote,
    payload.raw_log.genre_hint,
    payload.raw_log.selected_reference,
    payload.raw_log.generated_pdf_path,
    payload.raw_log.generated_tex_path,
    payload.raw_log.generated_sty_path,
    payload.raw_log.user_feedback_raw,
    payload.raw_log.satisfaction_score,
    payload.raw_log.notes
  ];
  
  results.push(await sendToGoogleSheet({
    sheetName: '01-Raw Experiment Log',
    row: rawLogRow,
    mode: 'append'
  }));
  
  // 02-Experiment Summary: upsert
  const summaryRow = [
    payload.experiment_summary.experiment_id,
    new Date(payload.experiment_summary.timestamp).toLocaleDateString(),
    payload.experiment_summary.timestamp,
    '',
    '',
    '',
    '',
    payload.experiment_summary.input_title,
    payload.experiment_summary.input_genre,
    '',
    payload.experiment_summary.selected_reference,
    '',
    '',
    '',
    '',
    payload.experiment_summary.feedback_count,
    '',
    payload.experiment_summary.satisfaction_score,
    payload.experiment_summary.overall_match_score,
    payload.experiment_summary.overall_status
  ];
  
  results.push(await sendToGoogleSheet({
    sheetName: '02-Experiment Summary',
    row: summaryRow,
    mode: 'upsert',
    keyValue: payload.experiment_id,
    keyColumnIndex: 1
  }));
  
  // 03-Feedback Unit Log: append (여러 행)
  for (const unit of payload.feedback_units) {
    const feedbackRow = [
      unit.feedback_unit_id,
      unit.experiment_id,
      unit.raw_id,
      unit.feedback_order,
      unit.user_feedback_raw,
      unit.feedback_snippet,
      unit.feedback_type,
      unit.design_issue_area,
      unit.user_language_type,
      unit.is_numeric_feedback ? 'YES' : 'NO',
      unit.numeric_value_raw,
      unit.numeric_unit,
      '',
      unit.intended_change_summary
    ];
    
    results.push(await sendToGoogleSheet({
      sheetName: '03-Feedback Unit Log',
      row: feedbackRow,
      mode: 'append'
    }));
  }
  
  // 04-Variable Patch Log: append (여러 행)
  for (const patch of payload.patches) {
    const patchRow = [
      patch.patch_id,
      patch.experiment_id,
      patch.feedback_unit_id,
      patch.patch_order,
      patch.feedback_snippet,
      patch.interpreted_variable_by_claude,
      patch.intended_variable_by_user,
      patch.actual_changed_variable,
      '',
      '',
      '',
      '',
      patch.direction_requested,
      '',
      'unknown',
      'unknown',
      patch.magnitude_requested,
      patch.magnitude_applied,
      'unknown',
      'unknown',
      '',
      patch.confidence_score
    ];
    
    results.push(await sendToGoogleSheet({
      sheetName: '04-Variable Patch Log',
      row: patchRow,
      mode: 'append'
    }));
  }
  
  // TODO: 05~11 탭도 동일 패턴으로 추가
  
  return { status: 'success', experiment_id: payload.experiment_id, results: results };
}

async function sendToGoogleSheet(config) {
  try {
    const response = await fetch('/api/sheet-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    return await response.json();
  } catch (error) {
    console.error('Sheet record error:', error);
    return { status: 'error', error: error.toString() };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add sendPayloadToSheet for multi-tab Google Sheet recording"
```

---

## Task 10: App.jsx - 피드백 적용 버튼 onClick에 sendPayloadToSheet 연결

**Files:**
- Modify: `src/App.jsx` (기존 피드백 적용 버튼 handler)

**Context:**
"피드백 적용하기" 버튼의 onClick 핸들러 끝에 sendPayloadToSheet 호출 추가.

- [ ] **Step 1: Find feedback apply button handler**

라인 ~5000 근처에서 피드백 적용 버튼 찾기

- [ ] **Step 2: Add sendPayloadToSheet call**

```javascript
// 기존 코드
const handleFeedbackSubmit = async (correctionsData) => {
  // ... 기존 분석 로직
  await analyzeExperiment(correctionsData);
  
  // 새 코드: Google Sheet 기록
  if (window._pendingSheetPayload) {
    const result = await sendPayloadToSheet(window._pendingSheetPayload);
    console.log('Sheet record result:', result);
    window._pendingSheetPayload = null;
  }
};
```

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: integrate sendPayloadToSheet into feedback apply button handler"
```

---

## Task 11: Backend - /api/sheet-record 엔드포인트 구현

**Files:**
- Modify: `imprint-sheet/apps-script.gs` (doPost 확장)

**Context:**
Frontend에서 /api/sheet-record POST 요청이 오면, 14개 탭에 데이터를 기록하는 엔드포인트.

- [ ] **Step 1: Add doPost handler for /api/sheet-record**

```javascript
function doPost(e) {
  const path = e.parameter.path || '';
  
  if (path === '/api/sheet-record') {
    return handleSheetRecord(e);
  }
  
  // ... 기존 doPost 로직
}

function handleSheetRecord(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { sheetName, row, mode, keyValue, keyColumnIndex } = payload;
    
    if (!sheetName || !row) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'error', message: 'Missing sheetName or row' })
      ).setMimeType(ContentService.MimeType.JSON);
    }
    
    const result = writeToSheet(sheetName, row, mode, keyValue, keyColumnIndex || 1);
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', message: error.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add imprint-sheet/apps-script.gs
git commit -m "feat: add /api/sheet-record POST handler for multi-tab logging"
```

---

## Task 12: 통합 테스트 - 전체 흐름 검증

**Files:**
- Test: 피드백 적용 → Google Sheet 자동 기록 확인

**Context:**
실제 피드백을 입력하고 "피드백 적용하기"를 눌렀을 때:
1. Google Sheet 14개 탭에 새 행이 추가되는지
2. 기존 데이터가 덮어써지지 않는지
3. experiment_id로 모든 탭이 연결되는지

- [ ] **Step 1: Test feedback entry**

```
입력:
- 제목: "테스트 문서"
- 피드백: "각주 행간을 10% 늘려줘. 여백은 25% 줄여줘."
- 만족도: 3
```

- [ ] **Step 2: Verify Google Sheet**

```
확인 사항:
1. 01-Raw Experiment Log: 새 행 추가 (61행 → 62행)
2. 02-Experiment Summary: 새 experiment_id 행 추가
3. 03-Feedback Unit Log: 2개 행 추가 (fu01, fu02)
4. 04-Variable Patch Log: 2개 행 추가 (p01_01, p02_01)
5. 모든 행의 experiment_id가 동일한지 확인
```

- [ ] **Step 3: Verify no data overwrite**

```javascript
// Apps Script 콘솔에서:
const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('01-Raw Experiment Log');
const allRows = sheet.getRange('A:A').getValues();
console.log('Total rows:', allRows.length); // 62 (61개 기존 + 1개 새로 추가)
console.log('Row 60:', allRows[59][0]); // legacy_00059 유지되어야 함
console.log('Row 62:', allRows[61][0]); // 새로 추가된 raw_id
```

- [ ] **Step 4: Commit test results**

```bash
git add tests/sheet-integration-test.md
git commit -m "test: verify 14-tab Google Sheet auto-logging on feedback apply"
```

---

## Task 13: 데이터 검증 및 스키마 확인

**Files:**
- Modify: `imprint-sheet/apps-script.gs`
- Document: `docs/sheet-schema.json`

**Context:**
Google Sheet의 13번 탭에 "Auto Input Schema" 탭이 있어야 하고, 각 필드가 정의되어 있어야 함.

- [ ] **Step 1: Document schema**

```json
{
  "sheets": [
    {
      "name": "01-Raw Experiment Log",
      "mode": "append_only",
      "key_column": "raw_id",
      "fields": [
        { "name": "raw_id", "type": "string", "required": true },
        { "name": "experiment_id", "type": "string", "required": true },
        { "name": "timestamp", "type": "string", "format": "ISO8601" },
        { "name": "user_feedback_raw", "type": "string", "required": true }
        // ... 나머지
      ]
    },
    {
      "name": "02-Experiment Summary",
      "mode": "upsert",
      "key_column": "experiment_id",
      "fields": [...]
    }
    // ... 나머지 탭
  ]
}
```

- [ ] **Step 2: Add schema validation function**

```javascript
function validateRowData(sheetName, rowData) {
  const schema = loadSheetSchema();
  const sheetSchema = schema.sheets.find(s => s.name === sheetName);
  
  if (!sheetSchema) {
    return { valid: false, error: `No schema for sheet: ${sheetName}` };
  }
  
  for (const field of sheetSchema.fields) {
    if (field.required && !rowData[field.name]) {
      return { valid: false, error: `Missing required field: ${field.name}` };
    }
  }
  
  return { valid: true };
}
```

- [ ] **Step 3: Commit**

```bash
git add docs/sheet-schema.json imprint-sheet/apps-script.gs
git commit -m "docs: add comprehensive 14-tab schema and validation function"
```

---

## Task 14: 문서화 및 최종 검수

**Files:**
- Document: `IMPLEMENTATION.md`

**Context:**
전체 구현을 정리하고, 향후 유지보수를 위한 문서 작성.

- [ ] **Step 1: Create implementation guide**

```markdown
# 14-Tab Google Sheet 자동 기록 구현

## 개요
`피드백 적용하기` 버튼 실행 시 Imprint의 피드백 분석 결과를 Google Sheets 14개 탭에 자동으로 구조화하여 기록.

## 데이터 흐름
1. 사용자 피드백 입력
2. analyzeExperiment() 실행
3. buildSheetPayload() → 14탭 데이터 객체 생성
4. sendPayloadToSheet() → Google Sheet에 순차 기록

## 주요 함수

### Apps Script
- `getNextAppendRowByKey(sheet, keyColumnIndex)`: 마지막 데이터 행 탐지
- `writeToSheet(sheetName, rowValues, mode, keyValue, keyColumnIndex)`: 통합 기록 함수

### App.jsx
- `generateExperimentId()`: experiment_id 생성
- `parseFeedbackUnits(text)`: 피드백 의미 단위 분해
- `mapFeedbackToPatch(unit)`: 피드백 → 조판 변수 매핑
- `buildSheetPayload(...)`: 14탭 데이터 객체 생성
- `sendPayloadToSheet(payload)`: Google Sheet 기록

## 14개 탭 설명

| # | 탭 이름 | 기능 | 기록 방식 |
|---|--------|------|---------|
| 1 | 01-Raw Experiment Log | 원본 실험 로그 | append_only |
| 2 | 02-Experiment Summary | 실험 요약 | upsert |
| 3 | 03-Feedback Unit Log | 피드백 의미 단위 | append_only |
| 4 | 04-Variable Patch Log | 조판 변수 패치 | append_only |
| 5 | 05-Before After Values | 변수 수정 전후 | append_only |
| 6 | 06-Lock Check | 의도하지 않은 변수 변경 | append_only |
| 7 | 07-Score Breakdown | 점수 분해 | append_only |
| 8 | 08-Failure Analysis | 실패 분석 | append_only |
| 9 | 09-Rule Memory | 규칙 저장 | upsert |
| 10 | 10-Rule Application Log | 규칙 적용 로그 | append_only |
| 11 | 11-Research Coding | 연구 코딩 | append_only |
| 12 | 12-Variable Dictionary | 변수 사전 | upsert |
| 13 | 13-Auto Input Schema | 자동 입력 스키마 | reference |

## ID 체계
모든 기록은 experiment_id로 연결됨.
- `experiment_id`: exp_YYYYMMDD_HHMMSS
- `raw_id`: raw_exp_YYYYMMDD_HHMMSS
- `feedback_unit_id`: exp_YYYYMMDD_HHMMSS_fu01, fu02, ...
- `patch_id`: exp_YYYYMMDD_HHMMSS_p01_01, p01_02, p02_01, ...

## 실행 예시

사용자 피드백: "각주 행간을 10% 늘려줘. 여백은 25% 줄여줘."

결과:
- 01-Raw: 1행 append
- 02-Summary: 1행 append
- 03-Feedback: 2행 append (fu01, fu02)
- 04-Patch: 2행 append (p01_01, p02_01)
- 기타: 추가 분석 결과 기록

## 주의사항
- 절대 기존 행 덮어쓰지 말 것
- 모든 퍼센트는 `%` 포함 정수형
- 확인 안 된 값은 `not_verified` 사용
- append_only 탭은 항상 마지막 행 아래 추가
- upsert 탭은 같은 ID가 없으면 마지막 행 아래 추가
```

- [ ] **Step 2: Commit**

```bash
git add IMPLEMENTATION.md
git commit -m "docs: add comprehensive 14-tab implementation guide and maintenance notes"
```

---

## Final Verification Checklist

- [ ] All 14 functions in Apps Script work correctly
- [ ] All ID generation functions produce unique IDs
- [ ] buildSheetPayload creates valid JSON structure
- [ ] Google Sheet has all 13 tabs with correct headers
- [ ] First manual test: feedback → 14-tab auto-logging succeeds
- [ ] Verify no data overwrite: row 61 still contains legacy_00060
- [ ] Verify all tabs connected by experiment_id
- [ ] Performance check: sheet-record API responds in <2s
- [ ] Error handling: invalid payload rejected gracefully
- [ ] Documentation complete and accurate


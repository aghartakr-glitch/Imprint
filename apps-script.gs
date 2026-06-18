// Imprint Record — Apps Script v3 (14-tab research database)
// writeByColMap: 헤더 읽지 않고 컬럼 인덱스로 직접 기록. appendRow 사용 안 함.

const SPREADSHEET_ID = '17kAuiIrDVDNtE2YHY0pvxizeAeHOiZN5bHD3jm3eW3s';

// ── 컬럼 맵 ─────────────────────────────────────────────────────

const RAW_LOG_COL = {
  raw_id:1, experiment_id:2, timestamp:3, source:4,
  input_title:5, input_subtitle:6, input_body:7, input_footnote:8,
  genre_hint:9, user_intent_raw:10, selected_reference:11, system_intent:12,
  generated_pdf_path:13, generated_tex_path:14, generated_sty_path:15,
  user_feedback_raw:16, satisfaction_score:17, original_match_rate:18,
  system_adjustment_raw:19, user_target_raw:20, next_rule_raw:21,
  md_log_path:22, csv_log_path:23, json_log_path:24, notes:25,
};

const EXP_SUMMARY_COL = {
  experiment_id:1, date:2, timestamp:3, session_id:4, test_round:5,
  text_id:6, version_id:7, input_title:8, input_genre:9, experiment_goal:10,
  selected_reference:11, reference_reason:12,
  generated_pdf_path:13, generated_tex_path:14, generated_sty_path:15,
  feedback_count:16, patch_count:17, satisfaction_score:18,
  overall_match_score:19, overall_status:20, main_success:21, main_failure:22,
  research_note:23,
};

const FEEDBACK_UNIT_COL = {
  feedback_unit_id:1, experiment_id:2, raw_id:3, feedback_order:4,
  user_feedback_raw:5, feedback_snippet:6, feedback_type:7, design_issue_area:8,
  user_language_type:9, is_numeric_feedback:10, numeric_value_raw:11, numeric_unit:12,
  qualitative_expression:13, intended_change_summary:14,
  ambiguity_level:15, needs_user_confirmation:16,
};

const VARIABLE_PATCH_COL = {
  patch_id:1, experiment_id:2, feedback_unit_id:3, patch_order:4,
  feedback_snippet:5, interpreted_variable_by_claude:6, intended_variable_by_user:7,
  actual_changed_variable:8, saved_rule_variable:9, variable_group:10,
  variable_scope:11, before_value:12, system_planned_value:13, actual_after_value:14,
  user_target_value:15, unit:16, direction_requested:17, direction_interpreted:18,
  direction_applied:19, direction_match:20, magnitude_requested:21, magnitude_applied:22,
  magnitude_match:23, patch_success:24, patch_status:25, failure_type:26,
  confidence_score:27, research_memo:28,
};

const BEFORE_AFTER_COL = {
  value_check_id:1, experiment_id:2, patch_id:3, variable_name:4,
  before_value:5, after_value:6, difference_value:7, difference_percent:8,
  expected_change:9, actual_change:10, unit:11, extracted_from:12,
  extraction_method:13, verified:14, verification_note:15,
};

const LOCK_CHECK_COL = {
  lock_check_id:1, experiment_id:2, patch_id:3, target_variable:4,
  locked_variables:5, locked_before_values:6, locked_after_values:7,
  unintended_changed_variables:8, lock_success:9, lock_failure_detail:10,
  severity:11, fix_required:12,
};

const SCORE_BREAKDOWN_COL = {
  score_id:1, experiment_id:2, feedback_unit_id:3, patch_id:4,
  satisfaction_score:5, variable_match_score:6, direction_match_score:7,
  magnitude_match_score:8, lock_success_score:9, actual_patch_score:10,
  rule_application_score:11, overall_match_score:12, score_formula:13, score_reason:14,
};

const FAILURE_ANALYSIS_COL = {
  failure_id:1, experiment_id:2, feedback_unit_id:3, patch_id:4,
  failure_type:5, failure_stage:6, description:7, example_user_feedback:8,
  wrong_system_interpretation:9, expected_behavior:10, actual_behavior:11,
  severity:12, fix_required:13, related_rule_id:14, resolved:15, resolution_note:16,
};

const RULE_MEMORY_COL = {
  rule_id:1, variable_name:2, variable_group:3, rule_condition:4, rule_action:5,
  current_rule_value:6, source_feedback_count:7, success_count:8, failure_count:9,
  confidence:10, first_created:11, last_updated:12, example_feedback:13,
  related_experiments:14, rule_description:15, risk_note:16, active_status:17,
};

const RULE_APPLICATION_COL = {
  rule_application_id:1, experiment_id:2, rule_id:3, variable_name:4,
  rule_loaded:5, rule_applied:6, applied_value:7, expected_effect:8,
  actual_effect:9, application_success:10, failure_reason:11, note:12,
};

const RESEARCH_CODING_COL = {
  coding_id:1, experiment_id:2, feedback_unit_id:3, patch_id:4,
  research_category:5, design_tacit_knowledge_type:6, user_language_type:7,
  design_decision_level:8, interpretation_result:9, operational_result:10,
  research_quote:11, memo:12,
};

const VARIABLE_DICT_COL = {
  variable_name:1, variable_group:2, description:3, possible_user_expressions:4,
  unit:5, allowed_range:6, default_value:7, related_latex_command:8,
  related_css_or_style_key:9, common_failure_type:10, example_feedback:11, note:12,
};

const AUTO_SCHEMA_COL = {
  field_name:1, target_sheet:2, required:3, data_type:4, allowed_values:5,
  auto_generated:6, source:7, example:8, note:9,
};

// 기존 02-Feedback Test Log 보존 (마이그레이션 소스 / 레거시 호환)
const LEGACY_FEEDBACK_COL = {
  date:1, title:2, subtitle:3, body:4, footnote:5, running_head:6,
  mode:7, genre:8,
  col_auto:9, col_fixed:10, col_var_total:11, col_body:12, col_note:13,
  col_gap_mm:14, note_position:15, body_columns:16, note_columns:17,
  select_mode:18, reference:19, content_match:20,
  design_concept:21, design_task:22, visual_element:23, ref_detail:24,
  font_choice:25, margin_design:26, tracking:27, rejected:28,
  user_feedback:29, satisfaction:30,
  target_variable:31, system_action:32, user_correct_action:33,
  direction_match:34, match_rate:35, difference:36, next_rule:37,
  match_formula:38, csv_flag:39, md_flag:40, design_rules:41, json_flag:42,
};

const SHEET_CONFIG = {
  raw_log:          { name:'01-Raw Experiment Log',   mode:'append',                        colMap:RAW_LOG_COL },
  exp_summary:      { name:'02-Experiment Summary',   mode:'upsert', key:'experiment_id',   colMap:EXP_SUMMARY_COL },
  feedback_unit:    { name:'03-Feedback Unit Log',    mode:'append',                        colMap:FEEDBACK_UNIT_COL },
  variable_patch:   { name:'04-Variable Patch Log',   mode:'upsert', key:'patch_id',        colMap:VARIABLE_PATCH_COL },
  before_after:     { name:'05-Before After Values',  mode:'upsert', key:'value_check_id',  colMap:BEFORE_AFTER_COL },
  lock_check:       { name:'06-Lock Check',           mode:'upsert', key:'lock_check_id',   colMap:LOCK_CHECK_COL },
  score_breakdown:  { name:'07-Score Breakdown',      mode:'upsert', key:'score_id',        colMap:SCORE_BREAKDOWN_COL },
  failure_analysis: { name:'08-Failure Analysis',     mode:'append',                        colMap:FAILURE_ANALYSIS_COL },
  rule_memory:      { name:'09-Rule Memory',          mode:'upsert', key:'rule_id',         colMap:RULE_MEMORY_COL },
  rule_application: { name:'10-Rule Application Log', mode:'append',                        colMap:RULE_APPLICATION_COL },
  research_coding:  { name:'11-Research Coding',      mode:'append',                        colMap:RESEARCH_CODING_COL },
  variable_dict:    { name:'12-Variable Dictionary',  mode:'upsert', key:'variable_name',   colMap:VARIABLE_DICT_COL },
  auto_schema:      { name:'13-Auto Input Schema',    mode:'upsert', key:'field_name',      colMap:AUTO_SCHEMA_COL },
  // 레거시 — 기존 데이터 보존 및 마이그레이션 소스
  legacy_feedback:  { name:'02-Feedback Test Log',    mode:'append',                        colMap:LEGACY_FEEDBACK_COL },
};

// ── 헬퍼 ──────────────────────────────────────────────────────

function writeByColMap(sheet, rowNum, colMap, payload) {
  Object.entries(colMap).forEach(function([key, col]) {
    var val = payload[key];
    if (val !== undefined && val !== null && val !== '') {
      sheet.getRange(rowNum, col).setValue(val);
    }
  });
}

function findUpsertRow(sheet, keyCol, keyValue) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var vals = sheet.getRange(2, keyCol, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(keyValue)) return i + 2;
  }
  return -1;
}

function getNextAppendRowByKey(sheet, keyColumnIndex) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 2; // 헤더(1행)만 있으면 2행부터 시작

  var values = sheet.getRange(2, keyColumnIndex, lastRow - 1, 1).getValues();
  var lastDataRow = 1;

  for (var i = values.length - 1; i >= 0; i--) {
    var value = values[i][0];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      lastDataRow = i + 2;
      break;
    }
  }

  return lastDataRow + 1;
}

function writeToSheet(sheetName, rowValues, mode, keyValue, keyColumnIndex) {
  try {
    // Input validation
    if (!sheetName || !rowValues || rowValues.length === 0) {
      return {
        status: 'error',
        message: 'Missing sheetName or rowValues',
        sheet: sheetName
      };
    }

    if (mode !== 'append' && mode !== 'upsert') {
      return {
        status: 'error',
        message: 'Invalid mode: ' + mode + ' (expected "append" or "upsert")',
        sheet: sheetName
      };
    }

    // Get spreadsheet and sheet
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreateSheet(ss, sheetName);

    // Default keyColumnIndex to 1 if not provided
    if (!keyColumnIndex) keyColumnIndex = 1;

    // Append mode
    if (mode === 'append') {
      var nextRow = getNextAppendRowByKey(sheet, keyColumnIndex);
      sheet.getRange(nextRow, 1, 1, rowValues.length).setValues([rowValues]);
      return {
        status: 'success',
        sheet: sheetName,
        row: nextRow,
        mode: 'append'
      };
    }

    // Upsert mode
    if (mode === 'upsert') {
      if (!keyValue && keyValue !== 0) {
        return {
          status: 'error',
          message: 'upsert mode requires keyValue parameter',
          sheet: sheetName
        };
      }

      // Try to find existing row with keyValue
      var existingRow = findUpsertRow(sheet, keyColumnIndex, keyValue);

      if (existingRow > 0) {
        // Update existing row
        sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
        return {
          status: 'success',
          sheet: sheetName,
          row: existingRow,
          mode: 'upsert-update'
        };
      } else {
        // Append as new row
        var nextRow = getNextAppendRowByKey(sheet, keyColumnIndex);
        sheet.getRange(nextRow, 1, 1, rowValues.length).setValues([rowValues]);
        return {
          status: 'success',
          sheet: sheetName,
          row: nextRow,
          mode: 'upsert-append'
        };
      }
    }

  } catch (error) {
    return {
      status: 'error',
      message: error.toString(),
      sheet: sheetName
    };
  }
}

function getOrCreateSheet(ss, name) {
  var s = ss.getSheetByName(name);
  if (!s) s = ss.insertSheet(name);
  return s;
}

// ── 진입점 ────────────────────────────────────────────────────

function doPost(e) {
  try {
    var path = e.parameter.path || '';

    // Handle /api/sheet-record endpoint
    if (path === '/api/sheet-record') {
      var data = JSON.parse(e.postData.contents);
      var sheetName = data.sheetName;
      var rowValues = data.rowValues;
      var mode = data.mode || 'append';
      var keyValue = data.keyValue;
      var keyColumnIndex = data.keyColumnIndex || 1;

      if (!sheetName || !rowValues) {
        return ContentService.createTextOutput(
          JSON.stringify({ status: 'error', message: 'Missing sheetName or rowValues' })
        ).setMimeType(ContentService.MimeType.JSON);
      }

      var result = writeToSheet(sheetName, rowValues, mode, keyValue, keyColumnIndex);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Existing logic for other endpoints...
    var data = JSON.parse(e.postData.contents);
    var sheetKey = data.sheet || 'raw_log';
    var config = SHEET_CONFIG[sheetKey];
    if (!config) return ContentService.createTextOutput('unknown sheet: ' + sheetKey);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreateSheet(ss, config.name);

    var payload = Object.assign({}, data);
    delete payload.sheet;

    if (config.mode === 'upsert' && config.key && payload[config.key]) {
      var keyCol = config.colMap[config.key];
      if (keyCol) {
        var existingRow = findUpsertRow(sheet, keyCol, payload[config.key]);
        if (existingRow > 0) {
          writeByColMap(sheet, existingRow, config.colMap, payload);
          return ContentService.createTextOutput('updated');
        }
      }
    }

    var nextRow = Math.max(sheet.getLastRow() + 1, 2);
    writeByColMap(sheet, nextRow, config.colMap, payload);
    return ContentService.createTextOutput('ok');

  } catch (err) {
    return ContentService.createTextOutput('error: ' + err.message);
  }
}

// ── 기존 데이터 마이그레이션 (한 번만 수동 실행) ──────────────────

function migrateFromFeedbackTestLog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName('02-Feedback Test Log');
  if (!src) { Logger.log('02-Feedback Test Log 없음'); return; }

  var last = src.getLastRow();
  if (last < 4) { Logger.log('데이터 없음'); return; }

  // row 1-3 = 헤더, row 4 부터 데이터
  var rows = src.getRange(4, 1, last - 3, 42).getValues();
  var migrated = 0;

  rows.forEach(function(row, i) {
    if (!row[0] && !row[1]) return; // 빈 행 skip
    var expId = 'migrated_' + String(i + 1).padStart(4, '0');
    var ts = row[0] ? new Date(row[0]).toISOString() : new Date().toISOString();

    // 01-Raw Experiment Log
    var rawSheet = getOrCreateSheet(ss, '01-Raw Experiment Log');
    var rawRow = Math.max(rawSheet.getLastRow() + 1, 2);
    writeByColMap(rawSheet, rawRow, RAW_LOG_COL, {
      raw_id: 'raw_' + expId,
      experiment_id: expId,
      timestamp: ts,
      source: 'migrated_from_02',
      input_title: row[1] || '',
      input_subtitle: row[2] || '',
      input_body: (row[3] || '').toString().slice(0, 500),
      input_footnote: row[4] || '',
      genre_hint: row[7] || '',
      user_feedback_raw: row[28] || '',
      satisfaction_score: row[29] || '',
      original_match_rate: row[34] || '',
      system_adjustment_raw: row[31] || '',
      user_target_raw: row[32] || '',
      next_rule_raw: row[36] || '',
      notes: '마이그레이션',
    });

    // 02-Experiment Summary
    var expSheet = getOrCreateSheet(ss, '02-Experiment Summary');
    var expRow = Math.max(expSheet.getLastRow() + 1, 2);
    var matchRate = parseFloat(String(row[34]).replace('%', '')) || 0;
    writeByColMap(expSheet, expRow, EXP_SUMMARY_COL, {
      experiment_id: expId,
      date: ts.slice(0, 10),
      timestamp: ts,
      input_title: row[1] || '',
      input_genre: row[7] || '',
      selected_reference: row[18] || '',
      satisfaction_score: row[29] || '',
      overall_match_score: row[34] || '',
      overall_status: matchRate >= 70 ? 'success' : matchRate >= 40 ? 'partial_success' : 'failure',
      research_note: row[36] || '',
    });

    migrated++;
  });

  Logger.log('마이그레이션 완료: ' + migrated + '행');
}

// ── 쓰레기 컬럼 삭제 (기존 AP+ 열) ─────────────────────────────

function cleanupExtraColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('02-Feedback Test Log');
  if (!sheet) { Logger.log('02-Feedback Test Log 없음'); return; }

  var last = sheet.getLastColumn();
  if (last <= 42) { Logger.log('삭제할 컬럼 없음 (현재 ' + last + '열)'); return; }

  sheet.deleteColumns(43, last - 42);
  Logger.log('삭제 완료: ' + (last - 42) + '열 제거 (43~' + last + ')');
}

// ── 데이터 유효성 검증 함수 ─────────────────────────────────────

/**
 * Main validation function for sheet data based on schema
 * @param {string} sheetName - Name of the sheet
 * @param {Object} rowData - Object with field names as keys
 * @returns {Object} { valid: boolean, errors: array<string> }
 */
function validateSheetData(sheetName, rowData) {
  var errors = [];

  if (!sheetName) {
    errors.push('Sheet name is required');
    return { valid: false, errors: errors };
  }

  // Validate based on sheet type
  switch(sheetName) {
    case '01-Raw Experiment Log':
      errors = errors.concat(validate_01_RawLog(rowData));
      break;
    case '02-Experiment Summary':
      errors = errors.concat(validate_02_ExpSummary(rowData));
      break;
    case '03-Feedback Unit Log':
      errors = errors.concat(validate_03_FeedbackUnit(rowData));
      break;
    case '04-Variable Patch Log':
      errors = errors.concat(validate_04_VariablePatch(rowData));
      break;
    case '05-Before After Values':
      errors = errors.concat(validate_05_BeforeAfter(rowData));
      break;
    case '06-Lock Check':
      errors = errors.concat(validate_06_LockCheck(rowData));
      break;
    case '07-Score Breakdown':
      errors = errors.concat(validate_07_ScoreBreakdown(rowData));
      break;
    case '08-Failure Analysis':
      errors = errors.concat(validate_08_FailureAnalysis(rowData));
      break;
    case '09-Rule Memory':
      errors = errors.concat(validate_09_RuleMemory(rowData));
      break;
    case '10-Rule Application Log':
      errors = errors.concat(validate_10_RuleApplication(rowData));
      break;
    case '11-Research Coding':
      errors = errors.concat(validate_11_ResearchCoding(rowData));
      break;
    case '12-Variable Dictionary':
      errors = errors.concat(validate_12_VariableDict(rowData));
      break;
    case '13-Auto Input Schema':
      errors = errors.concat(validate_13_AutoSchema(rowData));
      break;
    case '14-Legacy Migration Map':
      errors = errors.concat(validate_14_LegacyMap(rowData));
      break;
    default:
      errors.push('Unknown sheet: ' + sheetName);
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    sheetName: sheetName
  };
}

// ── Individual Sheet Validators ──────────────────────────────────

function validate_01_RawLog(data) {
  var errors = [];

  // Required fields
  if (!data.raw_id) errors.push('01: raw_id is required');
  if (!data.experiment_id) errors.push('01: experiment_id is required');
  if (!data.source) errors.push('01: source is required');
  if (!data.user_feedback_raw) errors.push('01: user_feedback_raw is required');

  // Format validation
  if (data.raw_id && !/^raw_\d{8}_\d{6}$/.test(data.raw_id)) {
    errors.push('01: raw_id must match format raw_YYYYMMDD_HHMMSS, got: ' + data.raw_id);
  }
  if (data.experiment_id && !/^exp_\d{8}_\d{6}$/.test(data.experiment_id)) {
    errors.push('01: experiment_id must match format exp_YYYYMMDD_HHMMSS, got: ' + data.experiment_id);
  }

  // Enum validation
  var allowed_sources = ['feedback_apply_button', 'migrated_from_02'];
  if (data.source && allowed_sources.indexOf(String(data.source)) === -1) {
    errors.push('01: source must be one of: ' + allowed_sources.join(', '));
  }

  // Range validation
  if (data.satisfaction_score) {
    var score = parseInt(data.satisfaction_score);
    if (isNaN(score) || score < 1 || score > 5) {
      errors.push('01: satisfaction_score must be 1-5, got: ' + data.satisfaction_score);
    }
  }

  return errors;
}

function validate_02_ExpSummary(data) {
  var errors = [];

  // Required fields
  if (!data.experiment_id) errors.push('02: experiment_id is required');

  // Format validation
  if (data.experiment_id && !/^exp_\d{8}_\d{6}$/.test(data.experiment_id)) {
    errors.push('02: experiment_id must match format exp_YYYYMMDD_HHMMSS');
  }

  // Range validation
  if (data.satisfaction_score) {
    var score = parseInt(data.satisfaction_score);
    if (isNaN(score) || score < 1 || score > 5) {
      errors.push('02: satisfaction_score must be 1-5');
    }
  }

  // Enum validation
  if (data.overall_status) {
    var allowed = ['success', 'partial_success', 'failure', 'not_verified'];
    if (allowed.indexOf(String(data.overall_status)) === -1) {
      errors.push('02: overall_status must be one of: ' + allowed.join(', '));
    }
  }

  // Percentage format
  if (data.overall_match_score) {
    if (!validatePercentageFormat(data.overall_match_score)) {
      errors.push('02: overall_match_score must be XX% format or "unknown", got: ' + data.overall_match_score);
    }
  }

  return errors;
}

function validate_03_FeedbackUnit(data) {
  var errors = [];

  // Required fields
  if (!data.feedback_unit_id) errors.push('03: feedback_unit_id is required');
  if (!data.experiment_id) errors.push('03: experiment_id is required');
  if (!data.raw_id) errors.push('03: raw_id is required');
  if (data.feedback_order === undefined) errors.push('03: feedback_order is required');
  if (!data.feedback_snippet) errors.push('03: feedback_snippet is required');
  if (!data.is_numeric_feedback) errors.push('03: is_numeric_feedback is required');

  // Enum validation
  if (data.is_numeric_feedback && ['YES', 'NO'].indexOf(String(data.is_numeric_feedback)) === -1) {
    errors.push('03: is_numeric_feedback must be YES or NO');
  }

  if (data.feedback_type) {
    var allowed = ['direct_numeric', 'problem_description', 'preference', 'other'];
    if (allowed.indexOf(String(data.feedback_type)) === -1) {
      errors.push('03: feedback_type must be one of: ' + allowed.join(', '));
    }
  }

  if (data.design_issue_area) {
    var allowed = ['margin', 'heading', 'footnote', 'body_text', 'column', 'overall_layout'];
    if (allowed.indexOf(String(data.design_issue_area)) === -1) {
      errors.push('03: design_issue_area must be one of: ' + allowed.join(', '));
    }
  }

  if (data.ambiguity_level) {
    var allowed = ['clear', 'somewhat_clear', 'ambiguous', 'contradictory'];
    if (allowed.indexOf(String(data.ambiguity_level)) === -1) {
      errors.push('03: ambiguity_level must be one of: ' + allowed.join(', '));
    }
  }

  if (data.needs_user_confirmation && ['YES', 'NO'].indexOf(String(data.needs_user_confirmation)) === -1) {
    errors.push('03: needs_user_confirmation must be YES or NO');
  }

  return errors;
}

function validate_04_VariablePatch(data) {
  var errors = [];

  // Required fields
  if (!data.patch_id) errors.push('04: patch_id is required');
  if (!data.experiment_id) errors.push('04: experiment_id is required');
  if (!data.feedback_unit_id) errors.push('04: feedback_unit_id is required');

  // Enum validation
  if (data.direction_requested && ['increase', 'decrease', 'unknown'].indexOf(String(data.direction_requested)) === -1) {
    errors.push('04: direction_requested must be increase/decrease/unknown');
  }

  if (data.direction_interpreted && ['increase', 'decrease', 'unknown'].indexOf(String(data.direction_interpreted)) === -1) {
    errors.push('04: direction_interpreted must be increase/decrease/unknown');
  }

  if (data.direction_applied && ['increase', 'decrease', 'unknown'].indexOf(String(data.direction_applied)) === -1) {
    errors.push('04: direction_applied must be increase/decrease/unknown');
  }

  if (data.direction_match && ['match', 'mismatch', 'unknown'].indexOf(String(data.direction_match)) === -1) {
    errors.push('04: direction_match must be match/mismatch/unknown');
  }

  if (data.confidence_score && ['high', 'medium', 'low'].indexOf(String(data.confidence_score)) === -1) {
    errors.push('04: confidence_score must be high/medium/low');
  }

  if (data.patch_success && ['yes', 'partial', 'no', 'unknown'].indexOf(String(data.patch_success)) === -1) {
    errors.push('04: patch_success must be yes/partial/no/unknown');
  }

  // Percentage format
  if (data.magnitude_requested && !validatePercentageFormat(data.magnitude_requested)) {
    errors.push('04: magnitude_requested must be XX% format or "unknown"');
  }
  if (data.magnitude_applied && !validatePercentageFormat(data.magnitude_applied)) {
    errors.push('04: magnitude_applied must be XX% format or "unknown"');
  }

  return errors;
}

function validate_05_BeforeAfter(data) {
  var errors = [];

  // Required fields
  if (!data.value_check_id) errors.push('05: value_check_id is required');
  if (!data.experiment_id) errors.push('05: experiment_id is required');
  if (!data.patch_id) errors.push('05: patch_id is required');

  // Enum validation
  if (data.verified && ['YES', 'NO', 'PARTIAL'].indexOf(String(data.verified)) === -1) {
    errors.push('05: verified must be YES/NO/PARTIAL');
  }

  return errors;
}

function validate_06_LockCheck(data) {
  var errors = [];

  // Required fields
  if (!data.lock_check_id) errors.push('06: lock_check_id is required');
  if (!data.experiment_id) errors.push('06: experiment_id is required');
  if (!data.patch_id) errors.push('06: patch_id is required');

  // Enum validation
  if (data.lock_success && ['YES', 'NO', 'PARTIAL'].indexOf(String(data.lock_success)) === -1) {
    errors.push('06: lock_success must be YES/NO/PARTIAL');
  }

  if (data.severity && ['low', 'medium', 'high'].indexOf(String(data.severity)) === -1) {
    errors.push('06: severity must be low/medium/high');
  }

  if (data.fix_required && ['YES', 'NO'].indexOf(String(data.fix_required)) === -1) {
    errors.push('06: fix_required must be YES/NO');
  }

  return errors;
}

function validate_07_ScoreBreakdown(data) {
  var errors = [];

  // Required fields
  if (!data.score_id) errors.push('07: score_id is required');
  if (!data.experiment_id) errors.push('07: experiment_id is required');

  // Range validation
  if (data.satisfaction_score) {
    var score = parseInt(data.satisfaction_score);
    if (isNaN(score) || score < 1 || score > 5) {
      errors.push('07: satisfaction_score must be 1-5');
    }
  }

  // Percentage format validation
  var percent_fields = ['variable_match_score', 'direction_match_score', 'magnitude_match_score', 'lock_success_score', 'actual_patch_score', 'rule_application_score', 'overall_match_score'];
  percent_fields.forEach(function(field) {
    if (data[field] && !validatePercentageFormat(data[field])) {
      errors.push('07: ' + field + ' must be XX% format or "unknown"');
    }
  });

  return errors;
}

function validate_08_FailureAnalysis(data) {
  var errors = [];

  // Required fields
  if (!data.failure_id) errors.push('08: failure_id is required');
  if (!data.experiment_id) errors.push('08: experiment_id is required');

  // Enum validation
  if (data.severity && ['low', 'medium', 'high', 'critical'].indexOf(String(data.severity)) === -1) {
    errors.push('08: severity must be low/medium/high/critical');
  }

  if (data.fix_required && ['YES', 'NO'].indexOf(String(data.fix_required)) === -1) {
    errors.push('08: fix_required must be YES/NO');
  }

  if (data.resolved && ['YES', 'NO', 'PENDING'].indexOf(String(data.resolved)) === -1) {
    errors.push('08: resolved must be YES/NO/PENDING');
  }

  return errors;
}

function validate_09_RuleMemory(data) {
  var errors = [];

  // Required fields
  if (!data.rule_id) errors.push('09: rule_id is required');
  if (!data.variable_name) errors.push('09: variable_name is required');

  // Enum validation
  if (data.confidence && ['high', 'medium', 'low'].indexOf(String(data.confidence)) === -1) {
    errors.push('09: confidence must be high/medium/low');
  }

  if (data.active_status && ['active', 'inactive', 'deprecated'].indexOf(String(data.active_status)) === -1) {
    errors.push('09: active_status must be active/inactive/deprecated');
  }

  return errors;
}

function validate_10_RuleApplication(data) {
  var errors = [];

  // Required fields
  if (!data.rule_application_id) errors.push('10: rule_application_id is required');
  if (!data.experiment_id) errors.push('10: experiment_id is required');
  if (!data.rule_id) errors.push('10: rule_id is required');

  // Enum validation
  if (data.rule_loaded && ['YES', 'NO'].indexOf(String(data.rule_loaded)) === -1) {
    errors.push('10: rule_loaded must be YES/NO');
  }

  if (data.rule_applied && ['YES', 'NO'].indexOf(String(data.rule_applied)) === -1) {
    errors.push('10: rule_applied must be YES/NO');
  }

  if (data.application_success && ['yes', 'no', 'partial'].indexOf(String(data.application_success)) === -1) {
    errors.push('10: application_success must be yes/no/partial');
  }

  return errors;
}

function validate_11_ResearchCoding(data) {
  var errors = [];

  // Required fields
  if (!data.coding_id) errors.push('11: coding_id is required');
  if (!data.experiment_id) errors.push('11: experiment_id is required');

  return errors;
}

function validate_12_VariableDict(data) {
  var errors = [];

  // Required fields
  if (!data.variable_name) errors.push('12: variable_name is required');

  return errors;
}

function validate_13_AutoSchema(data) {
  var errors = [];

  // Required fields
  if (!data.field_name) errors.push('13: field_name is required');

  // Enum validation
  if (data.required && ['YES', 'NO'].indexOf(String(data.required)) === -1) {
    errors.push('13: required must be YES/NO');
  }

  if (data.auto_generated && ['YES', 'NO'].indexOf(String(data.auto_generated)) === -1) {
    errors.push('13: auto_generated must be YES/NO');
  }

  return errors;
}

function validate_14_LegacyMap(data) {
  var errors = [];

  // Required fields
  if (!data.legacy_id) errors.push('14: legacy_id is required');

  // Enum validation
  if (data.migration_status) {
    var allowed = ['completed', 'partial', 'failed', 'not_migrated'];
    if (allowed.indexOf(String(data.migration_status)) === -1) {
      errors.push('14: migration_status must be one of: ' + allowed.join(', '));
    }
  }

  if (data.data_integrity_check && ['pass', 'warning', 'fail'].indexOf(String(data.data_integrity_check)) === -1) {
    errors.push('14: data_integrity_check must be pass/warning/fail');
  }

  return errors;
}

// ── Helper Functions ────────────────────────────────────────────

/**
 * Validates percentage format (XX% or "unknown")
 * @param {string} value - Value to validate
 * @returns {boolean}
 */
function validatePercentageFormat(value) {
  if (String(value).toLowerCase() === 'unknown') return true;
  return /^\d{1,3}%$/.test(String(value));
}

/**
 * Validates ID format
 * @param {string} id - ID to validate
 * @param {string} format - Expected format (raw_YYYYMMDD_HHMMSS, exp_YYYYMMDD_HHMMSS, etc.)
 * @returns {boolean}
 */
function validateIDFormat(id, format) {
  switch(format) {
    case 'raw_YYYYMMDD_HHMMSS':
      return /^raw_\d{8}_\d{6}$/.test(id);
    case 'exp_YYYYMMDD_HHMMSS':
      return /^exp_\d{8}_\d{6}$/.test(id);
    case 'exp_YYYYMMDD_HHMMSS_fu##':
      return /^exp_\d{8}_\d{6}_fu\d{2}$/.test(id);
    case 'exp_YYYYMMDD_HHMMSS_p##_##':
      return /^exp_\d{8}_\d{6}_p\d{2}_\d{2}$/.test(id);
    case 'failure_YYYYMMDD_HHMMSS':
      return /^failure_\d{8}_\d{6}$/.test(id);
    case 'coding_YYYYMMDD_HHMMSS':
      return /^coding_\d{8}_\d{6}$/.test(id);
    default:
      return true;
  }
}

/**
 * Run all validation tests on current spreadsheet
 * @returns {Object} Report with pass/fail counts
 */
function runValidationTests() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var report = {
    timestamp: new Date().toISOString(),
    sheets: [],
    total_rows_checked: 0,
    total_errors: 0
  };

  var sheetNames = [
    '01-Raw Experiment Log',
    '02-Experiment Summary',
    '03-Feedback Unit Log',
    '04-Variable Patch Log',
    '05-Before After Values',
    '06-Lock Check',
    '07-Score Breakdown',
    '08-Failure Analysis',
    '09-Rule Memory',
    '10-Rule Application Log',
    '11-Research Coding',
    '12-Variable Dictionary',
    '13-Auto Input Schema',
    '14-Legacy Migration Map'
  ];

  sheetNames.forEach(function(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      report.sheets.push({ sheet: sheetName, status: 'not_found', rows_checked: 0 });
      return;
    }

    var lastRow = sheet.getLastRow();
    var colCount = sheet.getLastColumn();
    var errors = [];
    var rowsChecked = 0;

    // Check header row (row 1) exists
    if (lastRow < 1) {
      report.sheets.push({ sheet: sheetName, status: 'empty', rows_checked: 0 });
      return;
    }

    // Check first 10 data rows for validation (rows 2-11)
    for (var i = 2; i <= Math.min(lastRow, 11); i++) {
      var row = sheet.getRange(i, 1, 1, colCount).getValues()[0];
      var rowObject = convertRowToObject(sheet.getRange(1, 1, 1, colCount).getValues()[0], row);
      var validation = validateSheetData(sheetName, rowObject);

      if (!validation.valid) {
        errors = errors.concat(validation.errors);
      }
      rowsChecked++;
    }

    report.sheets.push({
      sheet: sheetName,
      rows_checked: rowsChecked,
      total_rows_in_sheet: lastRow,
      errors_found: errors.length,
      errors: errors.slice(0, 5), // Show first 5 errors
      status: errors.length === 0 ? 'pass' : 'fail'
    });

    report.total_rows_checked += rowsChecked;
    report.total_errors += errors.length;
  });

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * Helper: Convert sheet row to object using headers
 */
function convertRowToObject(headers, row) {
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    obj[headers[i]] = row[i];
  }
  return obj;
}

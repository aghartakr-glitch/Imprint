// Imprint Record — Apps Script
// 각 시트마다 컬럼 순서 고정. 동적 컬럼 자동 추가 없음.

const SHEET_CONFIG = {
  feedback: {
    name: '02-Feedback Test Log',
    mode: 'append',
    dataStartRow: 3, // row 1: 카테고리 그룹, row 2: 한국어 컬럼명, row 3~: 데이터
    columns: [
      'date', 'title', 'subtitle', 'body', 'footnote', 'running_head',
      'mode', 'genre',
      'col_auto', 'col_fixed', 'col_var_total', 'col_body', 'col_note',
      'col_gap_mm', 'note_position', 'body_columns', 'note_columns',
      'select_mode', 'reference', 'content_match', 'design_concept',
      'design_task', 'visual_element', 'ref_detail', 'font_choice',
      'margin_design', 'tracking', 'rejected',
      'user_feedback', 'satisfaction',
      'target_variable', 'system_action', 'user_correct_action',
      'direction_match', 'match_rate', 'difference', 'next_rule', 'match_formula',
      'csv_flag', 'md_flag', 'design_rules', 'json_flag',
    ],
  },
  experiment_summary: {
    name: '03-Experiment Summary',
    mode: 'upsert',
    key: 'experiment_id',
    columns: [
      'experiment_id', 'date', 'timestamp',
      'input_title', 'input_subtitle',
      'genre', 'mode',
      'reference_selected', 'reference_candidates',
      'design_concept', 'design_task', 'visual_elements',
      'user_feedback_raw', 'satisfaction_score',
      'overall_match_score', 'overall_status', 'research_note',
    ],
  },
  variable_patch: {
    name: '04-Variable Patch Log',
    mode: 'upsert',
    key: 'patch_id',
    columns: [
      'patch_id', 'experiment_id', 'date',
      'feedback_snippet', 'feedback_type',
      'interpreted_variable_by_claude', 'intended_variable_by_user', 'actual_changed_variable',
      'variable_group', 'before_value', 'system_planned_value', 'actual_after_value', 'user_target_value',
      'unit', 'direction_requested', 'direction_applied', 'direction_match', 'magnitude_match',
      'locked_variables', 'unintended_changed_variables', 'lock_success',
      'patch_status', 'failure_type', 'next_rule', 'research_memo',
    ],
  },
  rule_summary: {
    name: '05-Rule Summary',
    mode: 'upsert',
    key: 'rule_id',
    columns: [
      'rule_id', 'variable_name', 'variable_group',
      'current_rule_value', 'confidence', 'evidence_count',
      'success_count', 'failure_count',
      'last_updated', 'example_feedback', 'rule_description', 'risk_note',
    ],
  },
  failure_analysis: {
    name: '06-Failure Analysis',
    mode: 'append',
    columns: [
      'failure_id', 'experiment_id', 'patch_id',
      'failure_type', 'description', 'example_user_feedback',
      'wrong_system_interpretation', 'expected_behavior', 'actual_behavior',
      'severity', 'fix_required',
    ],
  },
};

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheetKey = data.sheet || 'feedback';
    const config = SHEET_CONFIG[sheetKey];
    if (!config) return ContentService.createTextOutput('unknown sheet: ' + sheetKey);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(config.name);
    if (!sheet) {
      sheet = ss.insertSheet(config.name);
    }

    const payload = Object.assign({}, data);
    delete payload.sheet;

    // 헤더가 아직 없는 새 시트면 row 1에 컬럼명 작성
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(config.columns);
    }

    if (config.mode === 'upsert' && config.key && payload[config.key]) {
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        // row 1 = 헤더. key 컬럼 위치 = config.columns에서 찾기 (1-indexed)
        const keyColIdx = config.columns.indexOf(config.key);
        if (keyColIdx >= 0) {
          const keyCol = keyColIdx + 1;
          const keyValues = sheet.getRange(2, keyCol, lastRow - 1, 1).getValues();
          const existingRow = keyValues.findIndex(r => r[0] === payload[config.key]);
          if (existingRow >= 0) {
            const rowNum = existingRow + 2;
            const row = config.columns.map(h => payload[h] !== undefined ? payload[h] : '');
            sheet.getRange(rowNum, 1, 1, config.columns.length).setValues([row]);
            return ContentService.createTextOutput('updated');
          }
        }
      }
    }

    // append: 컬럼 순서 고정, 없는 필드는 빈칸
    const row = config.columns.map(h => payload[h] !== undefined ? payload[h] : '');

    // feedback 시트는 row 1-2가 헤더라 appendRow가 자동으로 3행 이후에 붙음
    sheet.appendRow(row);
    return ContentService.createTextOutput('ok');

  } catch (err) {
    return ContentService.createTextOutput('error: ' + err.message);
  }
}

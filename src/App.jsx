import { useState, useRef, useEffect } from "react";

// Imprint 1.0.0
// 편집 디자인 타이포그래피 스타일 패키지 선택기
// Concept: 각 레퍼런스 = LaTeX .sty 패키지 (재사용 가능한 타이포 규칙 묶음)
// Pipeline: 텍스트 → analyzeText → scoreKw → semanticRerank → inferAlignment → LaTeX → Refine

const IMPRINT_VERSION = "1.3.0";
const ENABLE_GOOGLE_SHEET_LOGGING = true;
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz5AyD3yHe8fwwE0kWozSXi2x77hL8rw8hklNpEeuLIVxVfsjkLcDAMfs0cOg5u9MnB/exec';

// ── LaTeX escape (note content용 — 특수문자 안전 처리) ─────────────
const latexEscNote = s => String(s || '')
  .replace(/\\/g, '\\textbackslash{}')
  .replace(/~/g, '\\textasciitilde{}')
  .replace(/\^/g, '\\textasciicircum{}')
  .replace(/\$/g, '\\$').replace(/\{/g, '\\{').replace(/\}/g, '\\}')
  .replace(/&/g, '\\&').replace(/%/g, '\\%').replace(/#/g, '\\#').replace(/_/g, '\\_');

// ── 유니코드 위첨자 / 원문자 → 숫자 매핑 (상수) ─────────────────────
const SUP_TO_NUM = {'¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'};
const CIRC_TO_NUM = {'①':'1','②':'2','③':'3','④':'4','⑤':'5','⑥':'6','⑦':'7','⑧':'8','⑨':'9','⑩':'10'};
// 역방향: 숫자 → 위첨자/원문자 (마커 정규화용)
const NUM_TO_SUP  = Object.fromEntries(Object.entries(SUP_TO_NUM).map(([k,v])=>[v,k]));
const NUM_TO_CIRC = Object.fromEntries(Object.entries(CIRC_TO_NUM).map(([k,v])=>[v,k]));

function makeGenerationId() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g,"").replace(/\..+/,"").replace("T","_");
  const rand = Math.random().toString(16).slice(2, 6);
  return `IM_${stamp}_${rand}`;
}
function simpleHash(str = "") {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
  return String(h >>> 0);
}
const AI_CACHE_KEY = 'imprint_ai_cache_v2';
const AI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function makeAiCacheKey(namespace, parts = []) {
  return `${namespace}:${simpleHash(JSON.stringify(parts))}`;
}
function loadAiCacheStore() {
  try {
    const saved = localStorage.getItem(AI_CACHE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch { return {}; }
}
function saveAiCacheStore(store) {
  try { localStorage.setItem(AI_CACHE_KEY, JSON.stringify(store)); } catch {}
}
function getAiCache(namespace, key) {
  const store = loadAiCacheStore();
  const entry = store?.[namespace]?.[key];
  if (!entry || Date.now() - entry.t > AI_CACHE_TTL_MS) return null;
  return entry.value;
}
function setAiCache(namespace, key, value, maxEntries = 40) {
  if (value === null || value === undefined) return;
  const store = loadAiCacheStore();
  const bucket = { ...(store[namespace] || {}), [key]: { t: Date.now(), value } };
  store[namespace] = Object.fromEntries(
    Object.entries(bucket)
      .filter(([, entry]) => entry && Date.now() - entry.t <= AI_CACHE_TTL_MS)
      .sort((a, b) => b[1].t - a[1].t)
      .slice(0, maxEntries)
  );
  saveAiCacheStore(store);
}

function extractBalancedJson(raw = '', openChar = '{', closeChar = '}') {
  const text = String(raw || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = text.indexOf(openChar);
  if (start < 0) throw new Error('JSON 시작 문자를 찾지 못했습니다');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('JSON 닫는 문자를 찾지 못했습니다');
}

function repairCommonJson(raw = '') {
  return String(raw || '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/}\s*(?=\s*\{)/g, '},')
    .replace(/]\s*(?=\s*")/g, '],');
}

function parseLooseJsonObject(raw = '') {
  const jsonStr = extractBalancedJson(raw, '{', '}');
  try {
    return JSON.parse(jsonStr);
  } catch (firstErr) {
    try {
      return JSON.parse(repairCommonJson(jsonStr));
    } catch {
      throw firstErr;
    }
  }
}

function buildFallbackExperimentAnalysis(feedbackText = '', raw = '', parseError = null) {
  const inferred = inferSystemRuleCorrectionsFromText(`${feedbackText}\n${raw}`);
  const corrections = inferred.map(c => ({
    target_variable: c.target_variable,
    system_pct: '미반영',
    user_pct: c.user_pct,
    direction_match: false,
  }));
  return {
    difference: corrections.length
      ? `Claude 분석 JSON 형식 오류로 로컬 규칙 추출을 사용했습니다${parseError?.message ? ` (${parseError.message})` : ''}.`
      : `Claude 분석 JSON 형식 오류로 피드백 원문을 규칙으로 저장했습니다${parseError?.message ? ` (${parseError.message})` : ''}.`,
    next_rule: feedbackText.trim(),
    corrections,
    _fallback: true,
  };
}
const _LOG_STORE = { logs: [] };
function saveGenerationLog(log) { _LOG_STORE.logs = [log, ..._LOG_STORE.logs].slice(0, 100); }
function loadGenerationLogs() { return _LOG_STORE.logs; }
const _EXPERIMENT_STORE = (() => {
  try {
    const saved = localStorage.getItem('imprint_experiments');
    return { experiments: saved ? JSON.parse(saved) : [] };
  } catch { return { experiments: [] }; }
})();
function saveExperiment(exp) {
  _EXPERIMENT_STORE.experiments = [..._EXPERIMENT_STORE.experiments, exp];
  try { localStorage.setItem('imprint_experiments', JSON.stringify(_EXPERIMENT_STORE.experiments)); } catch {}
}
function loadExperiments() { return _EXPERIMENT_STORE.experiments; }
// ── System Rules: localStorage 기반 구조적 학습 시스템 ──────────────
// 이전 applyLearnedCorrections / getLearnedColumnCount 대체
// 변수별 history + weighted_count + confidence 등급으로 반영 강도 조절

function _defaultSystemRules() {
  return {
    version: 2,
    last_updated: '',
    rules: {
      column_count:      { value: null, weighted_count: 0, confidence: 'none', history: [] },
      font_style:        { value: null, weighted_count: 0, confidence: 'none', history: [] },
      paragraph_spacing: { value: null, weighted_count: 0, confidence: 'none', history: [] },
      body_leading:      { value: null, weighted_count: 0, confidence: 'none', history: [] },
      body_size:         { value: null, weighted_count: 0, confidence: 'none', history: [] },
      margin_top:        { value: null, weighted_count: 0, confidence: 'none', history: [] },
      margin_bottom:     { value: null, weighted_count: 0, confidence: 'none', history: [] },
      margin_inner:      { value: null, weighted_count: 0, confidence: 'none', history: [] },
      margin_outer:      { value: null, weighted_count: 0, confidence: 'none', history: [] },
      tracking:          { value: null, weighted_count: 0, confidence: 'none', history: [] },
      heading_h1_size:    { value: null, weighted_count: 0, confidence: 'none', history: [] },
      heading_h1_leading: { value: null, weighted_count: 0, confidence: 'none', history: [] },
      heading_h2_size:    { value: null, weighted_count: 0, confidence: 'none', history: [] },
      heading_h2_leading: { value: null, weighted_count: 0, confidence: 'none', history: [] },
      heading_h3_size:    { value: null, weighted_count: 0, confidence: 'none', history: [] },
      heading_h3_leading: { value: null, weighted_count: 0, confidence: 'none', history: [] },
      footnote_size:     { value: null, weighted_count: 0, confidence: 'none', history: [] },
      footnote_leading:  { value: null, weighted_count: 0, confidence: 'none', history: [] },
      column_gap:        { value: null, weighted_count: 0, confidence: 'none', history: [] },
      folio_size:        { value: null, weighted_count: 0, confidence: 'none', history: [] },
      heading_layout:    { value: null, weighted_count: 0, confidence: 'none', history: [] },
      heading_gap:       { value: null, weighted_count: 0, confidence: 'none', history: [] },
      heading_indent:    { value: null, weighted_count: 0, confidence: 'none', history: [] },
      footnote_marker_format: { value: null, weighted_count: 0, confidence: 'none', history: [] },
    }
  };
}
function loadSystemRules() {
  try {
    const saved = localStorage.getItem('imprint_system_rules');
    if (!saved) return _defaultSystemRules();
    const parsed = JSON.parse(saved);
    const def = _defaultSystemRules();
    return { ...def, ...parsed, rules: { ...def.rules, ...parsed.rules } };
  } catch { return _defaultSystemRules(); }
}
function saveSystemRules(sr) {
  try { localStorage.setItem('imprint_system_rules', JSON.stringify(sr)); } catch {}
}

// satisfaction → 학습 가중치 (낮을수록 더 강한 교정 신호)
function _satWeight(sat) {
  if (sat <= 2) return 1.5;
  if (sat === 3) return 1.0;
  return 0.7; // 4-5: 만족했지만 방향 제시가 있으면 약하게 반영
}

// weighted_count → confidence 등급
function _calcConfidence(wc) {
  if (wc >= 3.5) return 'high';
  if (wc >= 1.5) return 'medium';
  if (wc > 0)    return 'low';
  return 'none';
}

function normalizeSystemRuleTarget(target) {
  const raw = String(target || '').trim();
  if (!raw) return '';
  const v = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s.-]+/g, '_')
    .toLowerCase();
  const aliases = {
    margin: 'margin_all',
    margins: 'margin_all',
    margin_all: 'margin_all',
    all_margins: 'margin_all',
    margin_y: 'margin_vertical',
    vertical_margin: 'margin_vertical',
    vertical_margins: 'margin_vertical',
    margin_x: 'margin_horizontal',
    horizontal_margin: 'margin_horizontal',
    horizontal_margins: 'margin_horizontal',
    top_margin: 'margin_top',
    page_margin_top: 'margin_top',
    margin_top_mm: 'margin_top',
    upper_margin: 'margin_top',
    bottom_margin: 'margin_bottom',
    page_margin_bottom: 'margin_bottom',
    margin_bottom_mm: 'margin_bottom',
    lower_margin: 'margin_bottom',
    inner_margin: 'margin_inner',
    inside_margin: 'margin_inner',
    left_margin: 'margin_inner',
    page_margin_inner: 'margin_inner',
    margin_inner_mm: 'margin_inner',
    gutter: 'margin_inner',
    outer_margin: 'margin_outer',
    outside_margin: 'margin_outer',
    right_margin: 'margin_outer',
    page_margin_outer: 'margin_outer',
    margin_outer_mm: 'margin_outer',
    title_leading: 'heading_h1_leading',
    title_line_height: 'heading_h1_leading',
    heading_h1_line_height: 'heading_h1_leading',
    subtitle_leading: 'heading_h2_leading',
    subtitle_line_height: 'heading_h2_leading',
    heading_h2_line_height: 'heading_h2_leading',
    heading_h3_line_height: 'heading_h3_leading',
    heading_spacing: 'heading_gap',
    heading_gap_pt: 'heading_gap',
    heading_title_subtitle_gap: 'heading_gap',
    title_subtitle_gap: 'heading_gap',
    title_subtitle_spacing: 'heading_gap',
    heading_indent: 'heading_indent',
    heading_indentation: 'heading_indent',
    footnote_marker: 'footnote_marker_format',
    footnote_number_format: 'footnote_marker_format',
    제목_행간: 'heading_h1_leading',
    제목_줄간격: 'heading_h1_leading',
    부제목_행간: 'heading_h2_leading',
    부제목_줄간격: 'heading_h2_leading',
    소제목_행간: 'heading_h3_leading',
    소제목_줄간격: 'heading_h3_leading',
    제목_소제목_간격: 'heading_gap',
    제목_소제목_사이: 'heading_gap',
    제목_들여쓰기: 'heading_indent',
    소제목_들여쓰기: 'heading_indent',
    각주_번호_형식: 'footnote_marker_format',
    각주_번호표기: 'footnote_marker_format',
    상단_여백: 'margin_top',
    상_여백: 'margin_top',
    하단_여백: 'margin_bottom',
    하_여백: 'margin_bottom',
    내측_여백: 'margin_inner',
    안_여백: 'margin_inner',
    바깥_여백: 'margin_outer',
    외측_여백: 'margin_outer',
    밖_여백: 'margin_outer',
    여백: 'margin_all',
  };
  return aliases[v] || v;
}

function inferSystemRuleCorrectionsFromText(text = '') {
  const out = [];
  const src = String(text || '');
  if (!src.trim()) return out;

  const push = (target_variable, user_pct) => {
    if (!target_variable || !user_pct) return;
    out.push({ target_variable: normalizeSystemRuleTarget(target_variable), user_pct });
  };
  const pctNear = (re, fallback = 10) => {
    const m = src.match(re);
    return `${m?.[1] || fallback}%`;
  };

  const explicit = /\b(body_leading|body_size|heading_h[123]_(?:size|leading)|heading_gap|footnote_(?:size|leading)|column_gap|folio_size|tracking|paragraph_spacing|margin_(?:top|bottom|inner|outer))\b[^.\n;。]*?([+-]?\d+(?:\.\d+)?)\s*%/gi;
  let m;
  while ((m = explicit.exec(src)) !== null) {
    push(m[1], `${m[2]}%`);
  }

  const h1Leading = out.find(c => c.target_variable === 'heading_h1_leading')?.user_pct;
  if (h1Leading && /\bheading_h2_leading\b[^.\n;。]*(동일\s*비율|같은\s*비율|same\s*ratio)/i.test(src)) {
    push('heading_h2_leading', h1Leading);
  }
  if (h1Leading && /\bheading_h3_leading\b[^.\n;。]*(동일\s*비율|같은\s*비율|same\s*ratio)/i.test(src)) {
    push('heading_h3_leading', h1Leading);
  }

  if (/(제목|타이틀)[^.\n;。]*(소제목|부제목)[^.\n;。]*(사이|간격|행간|줄간격|수직|띄)/i.test(src)) {
    push('heading_gap', pctNear(/(?:제목|타이틀)[^.\n;。]*(?:소제목|부제목)[^.\n;。]*?([+-]?\d+(?:\.\d+)?)\s*%/i, 10));
  }
  if (/(각주|주석)[^.\n;。]*(행간|줄간격)[^.\n;。]*(늘|확대|넓|띄|최소|이상|부족)/i.test(src)) {
    push('footnote_leading', pctNear(/(?:각주|주석)[^.\n;。]*?([+-]?\d+(?:\.\d+)?)\s*%/i, 10));
  }
  if (/(제목|소제목|부제목)[^.\n;。]*(들여쓰기|인덴트|indent)[^.\n;。]*(삭제|제거|없|빼|0)/i.test(src)) {
    push('heading_indent', 'none');
  }
  if (/(각주|주석)[^.\n;。]*(번호|마커|표기|형식)[^.\n;。]*(1\.|\[1\])/i.test(src)) {
    push('footnote_marker_format', /\[1\]/.test(src) ? '[1]' : '1.');
  }
  return out;
}

function normalizeSystemRulePct(userPct, feedbackText = '') {
  let up = String(userPct ?? '').trim();
  if (!up) return up;
  const hasExplicitSign = /^[+-]/.test(up) || /[+-]\s*\d+(?:\.\d+)?\s*%/.test(up);
  if (hasExplicitSign) return up;

  const text = `${up} ${feedbackText || ''}`;
  const isNumericPct = /\d+(?:\.\d+)?\s*%/.test(up);
  if (!isNumericPct) return up;

  const decrease = /줄|감소|축소|좁|작게|낮/.test(text);
  const increase = /늘|증가|확대|넓|크게|높/.test(text);
  if (decrease && !increase) return '-' + up;
  if (increase && !decrease) return '+' + up;
  return up;
}

function expandSystemRuleCorrection(correction) {
  const c = correction || {};
  const v = normalizeSystemRuleTarget(c.target_variable);
  if (v === 'margin_all') {
    return ['margin_top', 'margin_bottom', 'margin_inner', 'margin_outer'].map(target_variable => ({ ...c, target_variable }));
  }
  if (v === 'margin_vertical') {
    return ['margin_top', 'margin_bottom'].map(target_variable => ({ ...c, target_variable }));
  }
  if (v === 'margin_horizontal') {
    return ['margin_inner', 'margin_outer'].map(target_variable => ({ ...c, target_variable }));
  }
  return [{ ...c, target_variable: v }];
}

// 피드백 분석 결과(corrections[]) → system_rules 업데이트 및 저장
function updateSystemRules(corrections, satisfactionScore, feedbackText = '') {
  const directCorrections = Array.isArray(corrections) ? corrections : [];
  const inferredCorrections = inferSystemRuleCorrectionsFromText(feedbackText);
  if (directCorrections.length === 0 && inferredCorrections.length === 0) return;
  const sr = loadSystemRules();
  const weight = _satWeight(satisfactionScore || 3);
  const now = new Date().toISOString();
  const expandedCorrections = [
    ...directCorrections,
    ...inferredCorrections,
  ].flatMap(expandSystemRuleCorrection);
  const seenCorrections = new Set();

  for (const c of expandedCorrections) {
    let v = normalizeSystemRuleTarget(c.target_variable);
    const context = `${c.user_pct || ''} ${c.system_pct || ''} ${feedbackText || ''}`;
    const headingSizeAsLeading = v.match(/^heading_h([123])_size$/);
    if (headingSizeAsLeading && /(행간|줄간격|leading|line\s*height|수직\s*리듬)/i.test(context)) {
      v = `heading_h${headingSizeAsLeading[1]}_leading`;
    }
    const up = normalizeSystemRulePct(c.user_pct, feedbackText);
    if (!v || !up || !sr.rules[v]) continue;
    const dedupeKey = `${v}|${up}`;
    if (seenCorrections.has(dedupeKey)) continue;
    seenCorrections.add(dedupeKey);

    const rule = sr.rules[v];
    let parsedValue = null;

    if (v === 'column_count') {
      const m = up.match(/(\d+)/);
      if (m) parsedValue = parseInt(m[1]);
    } else if (v === 'font_style') {
      if (/고딕|gothic|sans/i.test(up)) parsedValue = 'gothic';
      else if (/명조|serif|부리/i.test(up)) parsedValue = 'serif';
    } else if (v === 'heading_layout') {
      if (/중앙|가운데|center/i.test(up)) parsedValue = 'center';
      else if (/우측|오른쪽|right/i.test(up)) parsedValue = 'right';
      else if (/좌측|왼쪽|left/i.test(up)) parsedValue = 'left';
    } else if (v === 'heading_indent') {
      if (/none|no|삭제|제거|없|빼|0/i.test(up)) parsedValue = 'none';
      else if (/indent|들여쓰기|들여/i.test(up)) parsedValue = 'indent';
    } else if (v === 'footnote_marker_format') {
      if (/\[1\]|bracket|대괄호/i.test(up)) parsedValue = 'bracket';
      else if (/1\.|dot|period|마침표/i.test(up)) parsedValue = 'dot';
    } else {
      // 수치형: user_pct에서 % 또는 배율(body×N, ×N) 파싱
      const mPct = up.match(/([+-]?\d+(?:\.\d+)?)%/);
      if (mPct) {
        parsedValue = parseFloat(mPct[1]);
      } else {
        // "body×1.15" 또는 "×0.9" 형식: (배율-1)×100 = %
        const mMult = up.match(/[×x*](\d+(?:\.\d+)?)/i);
        if (mMult) parsedValue = Math.round((parseFloat(mMult[1]) - 1) * 100 * 10) / 10;
      }
    }
    if (parsedValue === null) continue;

    // history 추가 (최대 10개)
    rule.history = [...(rule.history || []), { value: parsedValue, weight, timestamp: now }].slice(-10);
    rule.weighted_count = rule.history.reduce((s, h) => s + h.weight, 0);

    // consensus: 카테고리형은 최다 weighted, 수치형은 가중 평균
    if (v === 'font_style' || v === 'column_count' || v === 'heading_layout' || v === 'heading_indent' || v === 'footnote_marker_format') {
      const tally = {};
      for (const h of rule.history) tally[h.value] = (tally[h.value] || 0) + h.weight;
      rule.value = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
      if (v === 'column_count') rule.value = parseInt(rule.value);
    } else {
      const totalW = rule.history.reduce((s, h) => s + h.weight, 0);
      rule.value = totalW > 0 ? rule.history.reduce((s, h) => s + h.value * h.weight, 0) / totalW : null;
    }

    rule.confidence = _calcConfidence(rule.weighted_count);
  }

  sr.last_updated = now;
  saveSystemRules(sr);
}

// base 수치 보정 (numeric rules)
// confidence high: 강도 100%, medium: 70%, low: 30%
function applySystemRules(base) {
  const sr = loadSystemRules();
  const r = sr.rules;
  const result = { ...base };

  const numericMap = {
    body_size:     'bodySize',
    body_leading:  'bodyLeading',
    tracking:      'tracking',
    margin_top:    'marginTop',
    margin_bottom: 'marginBottom',
    margin_inner:  'marginInner',
    margin_outer:  'marginOuter',
  };

  for (const [ruleName, baseKey] of Object.entries(numericMap)) {
    const rule = r[ruleName];
    if (!rule || rule.confidence === 'none' || rule.value === null) continue;
    const isMargin = ruleName.startsWith('margin_');
    // 마진은 confidence 무관 항상 full strength (사용자가 명시적으로 % 요청하면 즉시 반영)
    // 나머지는 confidence 단계별 강도
    const strength = isMargin ? 1.0
      : rule.confidence === 'high' ? 1.0
      : rule.confidence === 'medium' ? 0.7
      : 0.3;
    const current = parseFloat(result[baseKey]);
    if (isNaN(current)) continue;
    const rawNew = current * (1 + (rule.value * strength) / 100);
    // 마진 변수는 최대 60% 감소 허용, 나머지는 40%
    const minFactor = isMargin ? 0.4 : 0.6;
    const maxFactor = isMargin ? 1.6 : 1.4;
    result[baseKey] = Math.round(Math.max(current * minFactor, Math.min(current * maxFactor, rawNew)) * 10) / 10;
  }

  // paragraph_spacing: 별도 필드로 전달 (LaTeX 생성 시 \parskip에 반영)
  if (r.paragraph_spacing?.confidence !== 'none' && r.paragraph_spacing?.value !== null) {
    result.paragraphSpacingPct  = r.paragraph_spacing.value;
    result.paragraphSpacingConf = r.paragraph_spacing.confidence;
  }

  return result;
}

function hasActiveSystemRule(ruleName) {
  const rule = loadSystemRules().rules[ruleName];
  return !!rule && rule.confidence !== 'none' && rule.value !== null;
}

function keepLearnedNumericDirection(ruleName, referenceValue, learnedBaseValue, candidateValue) {
  if (!hasActiveSystemRule(ruleName)) return candidateValue;
  const ref = Number(referenceValue);
  const base = Number(learnedBaseValue);
  const candidate = Number(candidateValue);
  if (![ref, base, candidate].every(Number.isFinite)) return candidateValue;
  if (Math.abs(ref - base) <= 0.05) return candidate;
  if (base < ref) return Math.min(candidate, base);
  if (base > ref) return Math.max(candidate, base);
  return candidate;
}

// 학습된 단 수 반환 — confidence medium 이상 (satisfaction 조건 제거)
function getSystemColumnCount() {
  const rule = loadSystemRules().rules.column_count;
  if (!rule || rule.confidence === 'none' || rule.confidence === 'low') return null;
  return typeof rule.value === 'number' ? rule.value : null;
}

// 학습된 서체 스타일 반환 — confidence medium 이상
function getSystemFontStyle() {
  const rule = loadSystemRules().rules.font_style;
  if (!rule || rule.confidence === 'none' || rule.confidence === 'low') return null;
  return rule.value; // 'gothic' | 'serif'
}

// 학습된 제목 정렬 방향 반환 — confidence medium 이상
function getSystemHeadingLayout() {
  const rule = loadSystemRules().rules.heading_layout;
  if (!rule || rule.confidence === 'none' || rule.confidence === 'low') return null;
  return rule.value; // 'left' | 'center' | 'right'
}

function getSystemHeadingIndent() {
  const rule = loadSystemRules().rules.heading_indent;
  if (!rule || rule.confidence === 'none' || rule.confidence === 'low') return null;
  return rule.value; // 'none' | 'indent'
}

function getSystemFootnoteMarkerFormat() {
  const rule = loadSystemRules().rules.footnote_marker_format;
  if (!rule || rule.confidence === 'none' || rule.confidence === 'low') return 'dot';
  return rule.value === 'bracket' ? 'bracket' : 'dot';
}

// 학습된 % 보정값을 baseValue에 적용 — heading/footnote/column_gap/folio 등 sty 생성 시 직접 호출
function getLearnedDesignOverride(ruleName, baseValue) {
  if (!baseValue || isNaN(baseValue)) return baseValue;
  const rule = loadSystemRules().rules[ruleName];
  if (!rule || rule.confidence === 'none' || rule.value === null) return baseValue;
  const strength = rule.confidence === 'high' ? 1.0
    : rule.confidence === 'medium' ? 0.7
    : 0.3; // low
  const adjusted = baseValue * (1 + (rule.value * strength) / 100);
  // 최소 50%, 최대 200% 범위 제한
  return Math.round(Math.max(baseValue * 0.5, Math.min(baseValue * 2.0, adjusted)) * 10) / 10;
}

function buildDesignRules() {
  const exps = loadExperiments();
  if (exps.length === 0) return '';

  // 모든 실험의 next_rule 포함 — 만족도와 무관하게 학습
  // analyzeExperiment가 이미 "다음엔 이렇게"로 방향 정리해서 반환함
  // 만족도에 따라 강도 표시만 다르게
  const rules = exps
    .filter(e => e.next_rule?.trim())
    .map(e => {
      const s = e.satisfaction_score;
      const rule = e.next_rule.trim();
      if (s <= 2) return `[강하게 수정] ${rule}`;   // 1~2: 많이 틀림
      if (s === 3) return `[부분 수정] ${rule}`;     // 3: 방향은 맞으나 부족
      return rule;                                    // 4~5: 그대로 강화
    });

  // 중복 제거 (앞 40자 기준)
  const seen = new Set();
  const unique = rules.filter(r => {
    const key = r.slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  // 최대 8개 (만족도 낮은 것 우선 — 더 강한 학습 신호)
  const sorted = [
    ...unique.filter(r => r.startsWith('[강하게')),
    ...unique.filter(r => r.startsWith('[부분')),
    ...unique.filter(r => !r.startsWith('[')),
  ];
  return sorted.slice(0, 8).map(r => `- ${r}`).join('\n');
}
async function sendToSheet(payload) {
  try {
    // Content-Type: text/plain → CORS preflight 없이 전송 가능
    // Apps Script doPost에서 e.postData.contents로 JSON 수신
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
  } catch { /* silent fail — logging must not break the app */ }
}

// ─── Design Tokens ───────────────────────────────────────────────
const T = {
  bg:      "#F4F4F4",
  surface: "#FFFFFF",
  border:  "#E0E0E0",
  muted:   "#8C8C8C",
  ink:     "#1A1A1A",
  accent:  "#1A1A1A",
  code:    "#EFEFEF",
  tagBg:   "#E8E8E8",
  mono:    "'JetBrains Mono','Fira Code',monospace",
  sans:    "system-ui,-apple-system,sans-serif",
};

// Style Packages (DB) + Typographic System
const DB = [
  {g:"타이포그래피",pub_type:"전시도록",t:"원형체—탈네모틀 한글의 기원",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/protoform-origins-of-unsquared-hangeul-kr/",img:"001_원형체—탈네모틀 한글의 기원",kw:["타이포그래피","전시도록","원형체","탈네모틀","한글의","기원","점선","그리드","노출","좌우","대비","시스템","(Protoform)"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:150,h:210},m:{상:22,하:14,안:20,밖:10},c:{구성:"1단",간격:0},b:{크기:14,행간:21,자간:0},ty:{이름:"원형체 (Protoform)",분류:"디스플레이 (실험적, 모듈형)"},pn:"상단-우측-세로",pn_x_left:"135.6mm",pn_y_left:"67.1mm",pn_x_right:"135.6mm",pn_y_right:"67.1mm",pn_size:"13pt",pn_font:"디스플레이",pn_style:"흑색 / 세로 / 숫자+챕터",running:"10.5pt",subheading:"14pt",footnote:"-",특:"점선 그리드 노출, 좌우 대비, 시스템 기반 비대칭",summary:"탈네모틀 한글의 역사와 조영제 연구 기반, 원형체 서체를 통해 한글 구조를 재해석한 이론+표본집",why_dim:"연구서+표본집 병행, 그리드 안정성과 휴대성 고려",why_margin:"하단 여백 확장으로 시각적 무게 지지 및 그리드 프레임 강조",why_font:"콘텐츠 자체가 서체 구조이며 네모틀 해체 목적",why_tracking:"형태 인식 강조 및 구조 드러내기",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"전시도록",t:"동시",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/simultaneity-kr/",img:"002_동시",kw:["아트이론·비평","전시도록","동시","제목","본문","각주","동일","스타일","좌우","태명조"],align_title:"좌측 정렬",align_body:"양끝 정렬",align_note:"양끝 정렬",f:{w:112,h:180},m:{상:18,하:15,안:11,밖:10},c:{구성:"1단",간격:0},b:{크기:9.5,행간:17,자간:-10},ty:{이름:"SM 태명조 / Adobe Caslon",분류:"명조"},pn:"상단-외측-가로",pn_x_left:"10.8mm",pn_y_left:"6.0mm",pn_x_right:"97.2mm",pn_y_right:"6.0mm",pn_size:"9.5pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"-",footnote:"10pt",특:"제목·본문·각주 동일 스타일, 좌우 페이지 대비 최소화, 정렬 기반 질서",summary:"예술가 오민의 ‘동시’ 개념을 중심으로 비위계적 관계와 감각 언어를 탐구하며 텍스트, 질문, 대화를 병치한 이론적 출판물",why_dim:"소형 판형으로 밀도 높은 텍스트를 압축하고 개념서의 집중도 강화",why_margin:"균일한 여백으로 위계 제거 및 텍스트 동등성 강조",why_font:"고전적 인문서 느낌 유지하면서 위계 제거 실험",why_tracking:"동등한 텍스트 흐름 유지 및 판독성 확보",layout_type:"본문 1단"},
  {g:"시각문화·매체",pub_type:"잡지·저널",t:"옵.신 10호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/ob-scene-10-kr/",img:"003_옵.신 10호",kw:["시각문화·매체","잡지·저널","옵.신","10호","텍스트","구성이","페이지마다","유동적으로","변화하며","이미지와","노이에","하스"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:210,h:276},m:{상:12,하:21,안:15,밖:12},c:{구성:"3단",간격:10},b:{크기:9,행간:17,자간:0},ty:{이름:"노이에 하스 그로테스크 / 쓔이써60",분류:"고딕 (네오그로테스크, 디스플레이 혼용)"},pn:"하단-외측-가로",pn_x_left:"5.9mm",pn_y_left:"266.9mm",pn_x_right:"202.3mm",pn_y_right:"266.9mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"8pt",특:"텍스트 단 구성이 페이지마다 유동적으로 변화하며, 이미지와 텍스트가 위계 없이 충돌·병치됨",summary:"무대(scene)를 벗어나 삶과 예술을 다른 각도에서 바라보는 감각적·비위계적 경험을 다루는 예술 저널. 텍스트와 이미지가 분절 없이 흐르며 서로 간섭하는 구조.",why_dim:"대형 판형으로 이미지와 텍스트의 충돌과 병치를 극대화하고, 저널의 물성적 존재감 강조",why_margin:"큰 이미지와 텍스트 혼합 구조에서 여백을 최소화하여 밀도 높은 판면 구성",why_font:"현대적 중립성과 시스템성을 가진 산세리프 기반, 디스플레이 혼용",why_tracking:"좁은 자간으로 텍스트 밀도 강화",layout_type:"본문 2-4단 가변"},
  {g:"타이포그래피",pub_type:"단행본",t:"*새로운* 그래픽 디자인 교육 과정",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/a-new-program-for-graphic-design-kr/",img:"004_-새로운- 그래픽 디자인 교육 과정",kw:["타이포그래피","단행본","*새로운*","그래픽","디자인","교육","과정","텍스트","중심","이미지","삽입","구조","게르스트너","프로그람"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:150,h:225},m:{상:36,하:18,안:16,밖:12},c:{구성:"1단",간격:0},b:{크기:11.5,행간:17,자간:-30},ty:{이름:"게르스트너 프로그람 / 그래픽 / 하이츠 와이드",분류:"고딕 (네오그로테스크, 디스플레이 혼용)"},pn:"상단-우측-가로",pn_x_left:"127.5mm",pn_y_left:"11.1mm",pn_x_right:"133.6mm",pn_y_right:"11.1mm",pn_size:"11pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"11.5pt",subheading:"11pt",footnote:"-",특:"1단 텍스트 중심, 이미지 삽입 구조",summary:"프린스턴 그래픽 디자인 교육 과정을 기반으로 디자인을 ‘자유과’로 확장하는 이론서",why_dim:"교과서적 읽기 경험 최적화 판형",why_margin:"하단 여백 확장으로 읽기 리듬 안정화",why_font:"가독성 중심 + 디스플레이 혼용 대비",why_tracking:"안정적 읽기 흐름 유지",layout_type:"본문 1단"},
  {g:"건축·공간",pub_type:"전시도록",t:"2024 서펀타인 파빌리온—군도의 여백—매스스터디스",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/serpentine-pavilion-2024-archipelagic-void-mass-studies-kr/",img:"005_2024 서펀타인 파빌리온—군도의 여백—매스스터디스",kw:["건축·공간","전시도록","2024","서펀타인","파빌리온","군도의","여백","매스스터디스","좌측","이미지","우측","텍스트","구조","인터뷰","도버","산스"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:148,h:210},m:{상:15,하:20,안:15,밖:15},c:{구성:"1단",간격:0},b:{크기:11,행간:14,자간:0},ty:{이름:"도버 산스 텍스트 / 도버 세리프 텍스트 / 소로굿 그로테스크 / 아리따 부리",분류:"혼합 (고딕 + 명조 + 디스플레이)"},pn:"하단-중앙-가로",pn_x_left:"73.4mm",pn_y_left:"198,6mm",pn_x_right:"73.4mm",pn_y_right:"198,6mm",pn_size:"7pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7pt",subheading:"16pt",footnote:"5pt",특:"좌측 이미지, 우측 텍스트  구조 / 인터뷰 및 에세이 구성",summary:"다섯 개 소책자로 분리된 건축 도록. 탈중심 구조를 반영해 각 권이 독립적이면서도 전체를 구성",why_dim:"분권 구조로 개별 단위 경험 + 전체 집합 구조 형성",why_margin:"여백 유지하며 이미지와 텍스트 균형",why_font:"본문은 세리프 기반, 제목은 산세리프 및 디스플레이 혼용",why_tracking:"안정적 가독성 유지",layout_type:"본문 1-2단 가변"},
  {g:"그래픽디자인",pub_type:"전시도록",t:"경이로운 여행",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/voyages-extraordinaires-catalog-kr/",img:"006_경이로운 여행",kw:["그래픽디자인","전시도록","경이로운","여행","언어별","동일","그리드","반복","세로","블루","그래픽","맞춤"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:240,h:240},m:{상:8,하:14,안:8,밖:6},c:{구성:"3단",간격:16},b:{크기:10,행간:12,자간:-30},ty:{이름:"그래픽 / 맞춤 서체 / 탈 / 푸투라 / 하이츠 와이드",분류:"고딕"},pn:"하단-외측-가로",pn_x_left:"6.5mm",pn_y_left:"223mm",pn_x_right:"73.4mm",pn_y_right:"230.5mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"6pt",subheading:"13pt",footnote:"7pt",특:"언어별 동일 그리드 반복, 세로 블루 라인으로 열 구분, 이미지-텍스트 명확 분리",summary:"프랑스 FRAC 컬렉션 전시 도록. 지도 도법과 풍선 모티프를 기반으로 전시 아이덴티티와 출판이 통합된 프로젝트",why_dim:"정사각형 판형으로 ‘구체/지구/풍선’ 개념을 물리적 형식으로 반영",why_margin:"중앙 집중형 구조와 다언어 병렬 텍스트를 위한 균형 여백",why_font:"기하학적 산세리프 기반으로 지도/도형/시스템적 인상 강화",why_tracking:"다언어 병렬 가독성 유지",layout_type:"본문 3단"},
  {g:"전시·큐레이션",pub_type:"전시도록",t:"알파벳의 발명—문자의 기원을 향한 탐구의 역사",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/inventing-the-alphabet-kr/",img:"007_알파벳의 발명—문자의 기원을 향한 탐구의 역사",kw:["전시·큐레이션","전시도록","알파벳의","발명","문자의","기원을","향한","탐구의","역사","본문은","흐름","유지","이미지","도판은","독립된","산돌","정체"],align_title:"우측 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:175,h:240},m:{상:26,하:18,안:20,밖:17},c:{구성:"1단",간격:0},b:{크기:9.5,행간:18,자간:0},ty:{이름:"산돌 정체 / 지백",분류:"명조"},pn:"상단-외측-가로",pn_x_left:"42.9mm",pn_y_left:"14.8mm",pn_x_right:"73.4mm",pn_y_right:"128.6mm",pn_size:"8pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"7pt",subheading:"19pt",footnote:"8pt",특:"본문은 흐름 유지, 이미지 및 도판은 독립된 정보 블록으로 분리",summary:"장문의 학술 텍스트를 절제된 타이포그래피 시스템으로 담아낸 출판물. 본문은 안정적 독서 구조를 유지하고, 소제목과 섹션 전환에서만 반전과 대비를 사용해 최소한의 그래픽 개입으로 정보 구조를 드러냄",why_dim:"텍스트 중심 판형으로 장문 독서에 적합한 비례",why_margin:"본문 가독성 확보와 이미지·주석 수용을 위한 균형 여백",why_font:"학술적 신뢰성과 장시간 독서를 위한 중립적 타이포그래피",why_tracking:"과도한 개입 없이 읽기 리듬 유지",layout_type:"본문 1단 + 이미지 가변 배치"},
  {g:"타이포그래피",pub_type:"전시도록",t:"올해의 작가상 2023",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/korea-artist-prize-2023-catalog/",img:"008_올해의 작가상 2023",kw:["타이포그래피","전시도록","올해의","작가상","2023","사분면","점대칭","높이","가변","이미지/텍스트","유동적","단조","맞춤서체"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:207,h:288},m:{상:6,하:9,안:6,밖:5},c:{구성:"2단",간격:15},b:{크기:9,행간:13,자간:10},ty:{이름:"단조 / 맞춤서체 / 죄네",분류:"고딕"},pn:"중잉-중앙-가로",pn_x_left:"100.6mm",pn_y_left:"140.6mm",pn_x_right:"100.6mm",pn_y_right:"140.6mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"13pt",footnote:"9pt",특:"사분면 점대칭, 단 높이 가변, 이미지/텍스트 유동적 배치",summary:"탈네모틀 한글 개념을 기반으로 맞춤 서체를 개발하고, 다양한 굵기와 무작위 조합을 통해 기하학적 질서와 불규칙성을 동시에 드러낸 실험적 타이포그래피 시스템. 4분할 구조와 점대칭 레이아웃이 전시 구성과 연동됨",why_dim:"전시 도판과 텍스트를 수용하는 대형 판형",why_margin:"가변 레이아웃 대응 및 점대칭 구성 확보",why_font:"전시 아이덴티티를 직접 생성하는 타이포 시스템",why_tracking:"불규칙 질감 형성",layout_type:"본문 2단 + 이미지 가변 배치"},
  {g:"전시·큐레이션",pub_type:"전시도록",t:"작품 설명 (중국어판)",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/explained-chinese-edition-kr/",img:"009_작품 설명 (중국어판)",kw:["전시·큐레이션","전시도록","작품","설명","(중국어판)","번호","기반","섹션","극단적","미니멀","레이아웃","미상","(산세리프"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:105,h:150},m:{상:6,하:15,안:14,밖:9},c:{구성:"1-2단",간격:4},b:{크기:10,행간:15,자간:-30},ty:{이름:"미상 (산세리프 계열 추정)",분류:"고딕"},pn:"하단-외측-가로",pn_x_left:"17.8mm",pn_y_left:"138.8mm",pn_x_right:"81.6mm",pn_y_right:"138.8mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"-",footnote:"7.5pt",특:"번호 기반 섹션, 극단적 미니멀 레이아웃, 이미지 배제",summary:"작품을 설명하지 않는 대신 설명 자체를 작품처럼 제시하는 역전된 개념의 텍스트 중심 출판물. 번호 기반 구조와 최소한의 타이포그래피로 내용=형식 구조를 강조",why_dim:"휴대성과 텍스트 집중을 위한 소형 판형",why_margin:"텍스트를 오브젝트처럼 보이게 하는 여백",why_font:"읽기 중심 + 개념 강조",why_tracking:"가독성 유지",layout_type:"본문 1-2단 가변"},
  {g:"현대미술",pub_type:"전시도록",t:"이력서—박미나와 Sasa[44]",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/cv-meena-park-sasa44-catalog-kr/",img:"010_이력서—박미나와 Sasa[44]",kw:["현대미술","전시도록","이력서","박미나와","Sasa[44]","연표형","배열","작가별","분리","구조","이미지와","노이에","하스"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:210,h:297},m:{상:12,하:18,안:15,밖:15},c:{구성:"9단",간격:5},b:{크기:7.5,행간:14,자간:20},ty:{이름:"노이에 하스 그로테스크 / 단조 / 산돌 정체 / 죄네 / 탈",분류:"고딕 / 명조 / 디스플레이"},pn:"하단-외측-가로",pn_x_left:"5.9mm",pn_y_left:"287.4mm",pn_x_right:"200.2mm",pn_y_right:"287.4mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"-",footnote:"6.5pt",특:"연표형 배열, 작가별 분리 구조, 이미지와 텍스트 병치",summary:"이력서 형식을 전시 구조로 확장한 데이터 기반 도록. 연표형 배열과 상중하 분할을 통해 작가별 서사를 구조적으로 시각화",why_dim:"문서와 아카이브 형식을 직접 환기하는 A4 판형",why_margin:"문서처럼 보이되 전시 구조를 담는 균형 여백",why_font:"데이터와 아카이브의 문서적 인상을 강조",why_tracking:"정보 밀도 확보",layout_type:"본문 2단 + 이미지 가변 배치 + 주석은 본문 1단 내부 2단으로 배치"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"계간 시청각 6호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/avp-quarterly-6-kr/",img:"011_계간 시청각 6호",kw:["아트이론·비평","잡지·저널","계간","시청각","6호","아이콘","삽입","규칙-예외","혼합","메종","노이에"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:126,h:204},m:{상:9,하:24,안:15,밖:10},c:{구성:"2단",간격:4},b:{크기:10,행간:17,자간:0},ty:{이름:"메종 노이에 / SM 태고딕",분류:"고딕"},pn:"상단-우측-가로",pn_x_left:"101.8mm",pn_y_left:"191.1mm",pn_x_right:"101.8mm",pn_y_right:"191.1mm",pn_size:"11pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"15pt",footnote:"8pt",특:"아이콘 삽입, 규칙-예외 혼합",summary:"텍스트 일부를 아이콘(삼각형)으로 치환한 저널 디자인. 규칙 기반 타이포에 예외를 허용하는 유연한 시스템",why_dim:"절제된 타이포그래피와 아이콘 개입을 수용하는 저널 판형",why_margin:"단순한 구조 안에서 아이콘과 규칙 이탈을 허용하는 유연한 여백",why_font:"저널과 비평지의 절제된 톤 유지",why_tracking:"가독성 중심",layout_type:"본문 1-2단 가변"},
  {g:"그래픽디자인",pub_type:"잡지·저널",t:"디자인360° 105호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/award360-2023-annual-kr/",img:"012_디자인360° 105호",kw:["그래픽디자인","잡지·저널","디자인360°","105호","그래프","반복","시스템","통계","다이어그램과","에디토리얼","란팅헤이","레터"],align_title:"좌측 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:210,h:285},m:{상:21,하:23,안:10,밖:10},c:{구성:"4단",간격:9},b:{크기:8,행간:11,자간:0},ty:{이름:"란팅헤이 / 레터 고딕 / 유니버스 넥스트 / 핑팡",분류:"고딕 / 모노스페이스"},pn:"상단-우측-가로",pn_x_left:"190mm",pn_y_left:"5.5mm",pn_x_right:"190mm",pn_y_right:"5.5mm",pn_size:"25pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"25pt",subheading:"16pt",footnote:"7.5pt",특:"그래프 반복 시스템, 통계 다이어그램과 에디토리얼 템플릿의 결합",summary:"통계 그래프를 정보 전달이 아닌 상징적 시각 언어로 사용하며 명확성과 모호성의 이중성을 강조한 연감형 매거진",why_dim:"데이터 그래픽과 다단 편집을 수용하는 대형 매거진 판형",why_margin:"통계 그래프와 본문 사이의 긴장을 유지하며 정보와 추상의 이중성을 지탱하는 여백",why_font:"에디토리얼과 데이터 저널의 성격을 동시에 확보",why_tracking:"가독성 유지",layout_type:"본문 1-2단 가변"},
  {g:"인문·사회",pub_type:"아카이브",t:"우리가 공유하는 시간",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/the-time-we-share-kr/",img:"013_우리가 공유하는 시간",kw:["인문·사회","아카이브","우리가","공유하는","시간","전각반각","시스템","신명조"],align_title:"좌측 정렬",align_body:"좌측 정렬, 중앙 정렬",align_note:"좌측 정렬",f:{w:152,h:214},m:{상:12,하:12,안:12,밖:12},c:{구성:"1-2단",간격:7},b:{크기:11,행간:17,자간:0},ty:{이름:"SM 신명조 / 파나마",분류:"명조 / 세리프"},pn:"상단-외측-세로",pn_x_left:"3.9mm",pn_y_left:"54.3mm",pn_x_right:"145.4mm",pn_y_right:"5.6mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 세로 / 숫자",running:"8pt",subheading:"11pt",footnote:"7.5pt",특:"전각반각 시스템",summary:"방형 격자 기반 한글 조판과 전각반각 시스템을 통해 비서구적 타이포그래피를 실험한 공연예술 아카이브 출판물",why_dim:"격자 기반 조판 실험을 수용하면서 장문 읽기에 대응하는 판형",why_margin:"방형 격자와 전각 반각 규칙이 지면 전체를 지배하며 텍스트를 구조물처럼 보이게 하는 여백",why_font:"비서구 조판 규칙을 전면화하는 타이포 실험",why_tracking:"전각반각 규칙으로 자간 대신 고정 셀 간격을 적용",layout_type:"본문 1단"},
  {g:"건축·공간",pub_type:"단행본",t:"아모레퍼시픽의 조경",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/landscape-architecture-of-amorepacific-kr/",img:"014_아모레퍼시픽의 조경",kw:["건축·공간","단행본","아모레퍼시픽의","조경","본문은","병렬","챕터","제목면은","단독","APHQ","GT"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:207,h:261},m:{상:9,하:9,안:9,밖:9},c:{구성:"11단 균일 간격 ",간격:9},b:{크기:10,행간:17,자간:0},ty:{이름:"APHQ / GT 발스하임(GT Walsheim) / 도멘 텍스트(Domaine Text) / 아리따 돋움 / 아리따 부리",분류:"고딕 / 명조 (코퍼레이트, 기하학적, 전용)"},pn:"상단-외측-세로",pn_x_left:"7.6mm",pn_y_left:"9mm",pn_x_right:"190.8mm",pn_y_right:"9.2mm",pn_size:"20pt",pn_font:"고딕",pn_style:"흑색 / 세로 / 숫자",running:"7.5pt",subheading:"19pt",footnote:"7pt",특:"본문은 2단 한·영 병렬, 챕터 제목면은 단독 대형 타이포그래피, 부록은 다단 연표·식물 목록표로 전환. 면주·쪽번호 세로 방향 배치가 시각적 특이점. 덧표지 수평선 그래픽이 조경 주제를 상징.",summary:"아모레퍼시픽의 주요 조경 프로젝트를 깊이 다룬 총서 2권. 『아모레퍼시픽의 건축』과 동일 판형·장정을 이어가되 조경 주제에 맞춰 변용. 한·영 병렬 편집.",why_dim:"전작 『아모레퍼시픽의 건축』과 총서 통일성을 유지하는 판형. 사진·도면·연표 등 다양한 정보를 충분한 밀도로 담으면서도 과도하게 크지 않은 학술서 비율.",why_margin:"좌우 정렬(justified) 조판으로 텍스트 블록에 건축적 긴장감 부여. 전작의 좌측 정렬에서 변경하여 수평선 모티프(조경)와 조응. 면주·쪽번호 90도 회전 수직 배치로 판면에 방향성 강조.",why_font:"APHQ: 아모레퍼시픽 전용 서체로 브랜드 정체성 직결. GT 발스하임: 기하학적 산세리프로 건축·조경의 구조적 명확성 표현, 전작 연속성 유지. 도멘 텍스트: 장문 영문 본문의 품격 있는 가독성 확보. 아리따 부리: 전작의 아리따 돋움에서 변경, 수직선→수평선 주제 전환에 조응하는 부리(세리프) 계열 채택으로 조경의 유기적 수평성 표현.",why_tracking:"본문 좌우 정렬에 맞게 자연스러운 낱말 간격 확보. 챕터 제목의 넓은 자간은 건축·조경 모노그래프의 권위 있는 고전적 분위기 연출.",layout_type:"본문 1단 + 이미지 가변 배치"},
  {g:"문학",pub_type:"전시도록",t:"시간의 형태—1989년 이후 한국 현대 미술",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/the-shape-of-time-korean-art-after-1989-kr/",img:"015_시간의 형태—1989년 이후 한국 현대 미술",kw:["문학","전시도록","시간의","형태","1989년","이후","한국","현대","미술","본문은","양측정렬","섹션","타이틀은","대형","퓨처","(The"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:205,h:250},m:{상:19,하:24,안:15,밖:16},c:{구성:"2단",간격:8},b:{크기:9,행간:11,자간:0},ty:{이름:"더 퓨처 (The Future)",분류:"고딕 (디스플레이 혼용)"},pn:"상단-우측-가로",pn_x_left:"188.1mm",pn_y_left:"6.9mm",pn_x_right:"188.1mm",pn_y_right:"6.9mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"20pt",footnote:"7.5pt",특:"본문은 2단 양측정렬, 섹션 타이틀은 대형 음절 분해 타이포로 비대칭 배치",summary:"1989년 이후 한국 현대미술을 전환·긴장·변위·순응·페미니즘 부흥의 다섯 키워드로 분석한 전시 도록. 대형 이미지와 에세이 텍스트, 키워드 기반 섹션 타이포그래피가 병치됨",why_dim:"이미지 도판과 장문 텍스트를 균형 있게 수용하는 중대형 판형",why_margin:"하단 여백 확장으로 이미지 캡션 및 판면 안정 확보",why_font:"영문을 음절 단위 블록으로 분해해 한글 구조를 전이한 실험적 타이포그래피",why_tracking:"본문 가독성 유지 및 대형 타이포 대비 확보",layout_type:"본문 2단 + 섹션별 비정형"},
  {g:"문학",pub_type:"전시도록",t:"젊은 그들—한국 실험 미술 1960~70년대",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/only-the-young-kr/",img:"016_젊은 그들—한국 실험 미술 1960~70년대",kw:["문학","전시도록","젊은","그들","한국","실험","미술","1960~70년대","대형","외곽선","타이포","제목","이미지","반복","MT","그로테스크"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:210,h:270},m:{상:9,하:14,안:18,밖:11},c:{구성:"1-4단 가변",간격:7},b:{크기:10,행간:14,자간:10},ty:{이름:"MT 그로테스크 / 파운더스 그로테스크 컨덴스드 / 산돌 정체 / 맞춤 서체",분류:"혼합 (고딕 / 명조 / 디스플레이)"},pn:"하단-좌측-가로",pn_x_left:"10.4mm",pn_y_left:"257.6mm",pn_x_right:"26.2mm",pn_y_right:"257.6mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"30pt",footnote:"7.5pt",특:"대형 외곽선 타이포 제목, 이미지 반복 배열, 본문은 안정적 1단 구조(3열 사용)",summary:"1960–70년대 한국 실험미술을 다룬 회고전 도록. 대형 타이틀 타이포그래피와 이미지 시퀀스 배치, 본문 에세이 구조 병치",why_dim:"대형 이미지 시퀀스와 장문 텍스트를 동시에 수용하는 전시 도록 판형",why_margin:"하단 여백 확장으로 캡션 및 이미지 호흡 확보",why_font:"아카이브성과 전시 타이틀의 강한 아이덴티티를 동시에 확보",why_tracking:"본문 가독성과 디스플레이 대비 조절",layout_type:"본문 1단 + 디스플레이 혼합"},
  {g:"문학",pub_type:"단행본",t:"어렴풋한 부티크",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/la-boutique-obscure-kr/",img:"017_어렴풋한 부티크",kw:["문학","단행본","어렴풋한","부티크","본문은","중앙부","단일","텍스트","블록","주석은","신신명조"],align_title:"중앙 정렬",align_body:"중앙 정렬",align_note:"좌측 정렬",f:{w:144,h:216},m:{상:18,하:30,안:24,밖:24},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:-20},ty:{이름:"SM 신신명조 / 산돌 고딕네오 / 아브니르 / 어도비 개러몬드",분류:"혼합 (명조 / 고딕)"},pn:"하단-중앙-가로",pn_x_left:"70.1mm",pn_y_left:"194.6mm",pn_x_right:"70.1mm",pn_y_right:"194.6mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"11pt",footnote:"7pt",특:"본문은 중앙부 단일 텍스트 블록, 주석은 하단 분리, 면주와 세로 표기가 보조적으로 개입",summary:"조르주 페렉의 꿈 기록 124편을 묶은 문학동네 시리즈 출판물. 반복 초상 이미지와 절제된 본문 조판으로 내향적·사적 서사 구조를 시각화함",why_dim:"장문 소설 읽기와 시리즈 통일성을 동시에 확보하는 문고형 변형 판형",why_margin:"하단 여백 확장으로 주석·쪽번호·본문 리듬을 안정화",why_font:"문학 전집의 고전성과 장문 가독성을 유지하면서 시리즈 정보와 보조 정보에 현대적 대비를 부여",why_tracking:"장문 독서 가독성 확보와 꿈 기록의 느슨한 호흡 유지",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"단행본",t:"방법으로서의 출판",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/publishing-as-method-book-kr/",img:"018_방법으로서의 출판",kw:["아트이론·비평","단행본","방법으로서의","출판","본문은","좁은","여백의","텍스트","블록","크다이크다이","므르데카"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:148,h:210},m:{상:3,하:4,안:20,밖:4},c:{구성:"4단",간격:4},b:{크기:9.5,행간:14,자간:0},ty:{이름:"크다이크다이 므르데카 / 파보리트 / 파보리트 한글",분류:"혼합 (디스플레이 / 고딕)"},pn:"하단-외측-가로",pn_x_left:"131.8mm",pn_y_left:"202.2mm",pn_x_right:"12.7mm",pn_y_right:"202.2mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 세로 / 숫자+챕터",running:"9pt",subheading:"18pt",footnote:"7pt",특:"본문은 좁은 여백의 1단 텍스트 블록, 인터뷰·캡션·웹주소는 세로 방향으로 삽입, 색지 교차와 검은 점 마커가 반복되어 섹션 리듬 형성",summary:"아시아 지역의 소규모 출판 실천을 조사한 연구 기반 출판물. 출판인·편집자·저술가·디자이너·미술가 30여 명의 인터뷰와 사례를 통해 출판의 동기, 제작 방식, 연대 구조를 아카이브함",why_dim:"일반 사무용 프린터 출력과 PDF 배포까지 고려한 표준 판형으로, DIY 복제 가능성과 유통 효율을 동시에 확보",why_margin:"최소 여백과 흑백 1도 인쇄로 경제성을 확보하고, 안쪽 기준점·세로 정보 배치로 복제 가능성과 제작 논리를 드러냄",why_font:"표지의 혼성 활자체로 프로젝트의 다지역·다언어 성격을 드러내고, 본문은 중립적 산세리프로 인터뷰와 연구 텍스트의 높은 밀도를 안정적으로 소화",why_tracking:"고밀도 인터뷰 텍스트의 판독성을 유지하면서도 저예산·실용적 편집 리듬을 해치지 않기 위해 과도한 자간 조정을 피함",layout_type:"본문 3단 + 설명 2단 좌우배치"},
  {g:"현대미술",pub_type:"단행본",t:"존재생명서판",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/life-being-stone-tablets-kr/",img:"019_존재생명서판",kw:["현대미술","단행본","존재생명서판","좌우","페이지","역할","분리(이미지","vs","텍스트)","산돌","정체"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:120,h:189},m:{상:30,하:64,안:6,밖:6},c:{구성:"1-2단",간격:10},b:{크기:9,행간:11,자간:0},ty:{이름:"산돌 정체",분류:"명조"},pn:"하단-중앙-가로",pn_x_left:"58.4mm",pn_y_left:"180.2mm",pn_x_right:"58.3mm",pn_y_right:"180.2mm",pn_size:"8pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자 형식",running:"9pt",subheading:"9pt",footnote:"-",특:"좌우 페이지 역할 분리(이미지 vs 텍스트), 상단 캡션/제목, 하단 페이지 번호, 넓은 여백 유지",summary:"신범순의 ‘석판’ 개념을 기반으로 한 창작·연구 프로젝트 기록. 돌 표면을 읽는 독자적 체계를 통해 생명의 서사를 해석하며, 텍스트·도해·사진·회화를 병치",why_dim:"소형 판형으로 개인적 연구·기록물 성격과 휴대성을 강조",why_margin:"이미지와 텍스트를 분리해 안정적인 독서 흐름 확보, 하단 여백을 통해 페이지 호흡 조절",why_font:"고전적이고 해석적 성격의 텍스트와 맞는 차분한 인상",why_tracking:"자연스러운 독서 흐름 유지",layout_type:"본문 1단 + 소제목 및 쪽번호는 2열 기준 배치,  (좌:이미지 / 우:텍스트)"},
  {g:"그래픽디자인",pub_type:"잡지·저널",t:"거울들 5권—대중문화",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/mirrors-5-pop-culture-kr/",img:"020_거울들 5권—대중문화",kw:["그래픽디자인","잡지·저널","거울들","5권","대중문화","이미지","아카이브를","격자","단위로","배열하고","본문과","노토","산스"],align_title:"중앙 정렬",align_body:"양끝 정렬(한자), 좌측 정렬(영어)",align_note:"좌측 정렬",f:{w:182,h:257},m:{상:5,하:9,안:14,밖:7},c:{구성:"3단",간격:3},b:{크기:8,행간:9.5,자간:0},ty:{이름:"노토 산스 / 본고딕 / 유니버스 넥스트 / 윈딩스",분류:"혼합 (고딕 / 디스플레이)"},pn:"하단-내측-가로",pn_x_left:"172.2mm",pn_y_left:"205.5mm",pn_x_right:"5.1mm",pn_y_right:"205.5mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"8pt",footnote:"7.5pt",특:"이미지 아카이브를 격자 단위로 배열하고 본문과 캡션을 교차 배치한다. 세로 제목, 별표 기호, 도해성 장식 요소가 반복되며 잡지 기사와 소책자 디자인의 성격을 동시에 유지한다.",summary:"일본인의 시점에서 한국 그래픽 디자인을 조명하는 연재 기사 거울들의 마지막 회. 헬리콥터 레코드, SM 엔터테인먼트, 이재민, 프로파간다 등 대중문화와 디자인의 관계를 사례 중심으로 다루며, 잡지 안에 삽입된 소형 별책 구조로 독립된 독서 단위를 형성한다.",why_dim:"아이디어 401호 안에 삽입되는 책 속의 책 형식으로, 본지와 구분되는 독립 판형을 확보하면서도 잡지 유통 구조 안에서 별도 읽기 경험을 만들기 위한 선택",why_margin:"하단 여백을 상대적으로 넓혀 쪽번호와 시각적 호흡을 확보하고, 작은 판형 안에서도 이미지와 텍스트가 과밀해 보이지 않도록 균형 유지",why_font:"작은 판형과 다국어 환경에서 높은 판독성을 유지하기 위해 중립적 고딕을 중심에 두고, 기호성 장식 요소와 제목 처리에서 디스플레이 성격을 보강",why_tracking:"이미지와 텍스트가 혼합된 좁은 지면에서 판독성과 밀도를 동시에 맞추기 위해 과도한 압축 없이 중립 자간 유지",layout_type:"본문 3단 "},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"국립현대미술관 연구 14집",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/mmca-studies-14-kr/",img:"021_국립현대미술관 연구 14집",kw:["아트이론·비평","잡지·저널","국립현대미술관","연구","14집","좌우","페이지를","영문과","국문으로","대응시키고","본문","A2","인디펜던트"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:185,h:260},m:{상:10,하:37,안:16,밖:15},c:{구성:"4단",간격:5},b:{크기:9,행간:17,자간:0},ty:{이름:"A2 인디펜던트 텍스트 / 노토 산스 / 본고딕 / 바른바탕체 / 아틀라스 그로테스크",분류:"혼합 (명조 / 고딕)"},pn:"하단-중앙-가로",pn_x_left:"84.8mm",pn_y_left:"234.9mm",pn_x_right:"87.2mm",pn_y_right:"234.9mm",pn_size:"6.5pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"6.5pt",subheading:"16pt",footnote:"6pt",특:"좌우 페이지를 영문과 국문으로 대응시키고, 본문 상단의 세로 규칙선과 외곽 주석 컬럼, 전면 이미지 페이지를 병치해 학술지와 전시 도록의 성격을 함께 유지한다.",summary:"국립현대미술관 연구 총서 14집. 데이터 사회와 예술을 주제로 한·영 병렬 에세이, 대담, 도판을 수록하며, 현대 미디어 환경과 예술의 관계를 이론적·사례적으로 다룬다.",why_dim:"한·영 병렬 텍스트와 도판, 주석을 함께 수용하는 연구 저널 판형으로 장문 독서와 기관 총서의 안정적 비례를 동시에 확보",why_margin:"하단 여백을 확장해 면주·쪽번호·주석 정보를 안정적으로 배치하고, 본문과 도판 사이의 리듬을 정돈",why_font:"장문 본문에는 안정적인 명조 계열을 사용하고, 면주·표지·보조 정보에는 중립적 고딕을 써서 연구 총서의 공공성과 현대적 인상을 동시에 확보",why_tracking:"이중언어 장문 독서에서 판독성을 우선하되, 제목과 면주 정보에는 약한 자간 확장으로 정보 위계를 정리",layout_type:"본문 3단 + 주석 1단"},
  {g:"아트이론·비평",pub_type:"단행본",t:"안무가의 핸드북",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/a-choreographers-handbook-kr/",img:"022_안무가의 핸드북",kw:["아트이론·비평","단행본","안무가의","핸드북","기본은","텍스트","블록이지만","일부","면에서는","공간","산돌"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:112,h:180},m:{상:9,하:24,안:12,밖:11},c:{구성:"7단",간격:3},b:{크기:9.5,행간:18,자간:0},ty:{이름:"공간 / 산돌 정체",분류:"혼합 (고딕 / 명조)"},pn:"하단-외측-가로",pn_x_left:"16.1mm",pn_y_left:"167.7mm",pn_x_right:"92mm",pn_y_right:"167.7mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"11pt",footnote:"-",특:"기본은 1단 텍스트 블록이지만 일부 면에서는 단어와 문장을 넓게 흩뿌리거나 반복 배열해 안무의 리듬, 변주, 시간성을 시각적으로 번역한다.",summary:"안무가 조나단 버로우스가 오랜 시간 창작하며 축적한 아이디어를 짧은 문장, 예시, 역설, 반복 구조로 엮은 실용서이자 시적 지침서. 느슨한 공책 같은 외형과 변주되는 조판으로 안무적 사고와 리듬을 시각화한다.",why_dim:"휴대 가능한 소형 판형으로 핸드북의 실용성을 강조하고, 공책처럼 일상적으로 펼쳐 볼 수 있는 읽기 경험을 만들기 위한 선택",why_margin:"균일한 좌우 여백 위에 하단 여백을 약간 넓혀 쪽번호와 텍스트 호흡을 안정시키고, 느슨한 조판 실험을 지지",why_font:"핸드북의 격의 없는 어조와 선명한 정보 전달에는 고딕을, 사유와 인용의 문학적 결에는 명조를 사용해 실용성과 사색성을 함께 확보",why_tracking:"짧은 문장 중심의 느슨한 리듬을 유지하면서도 일부 분산 조판 면과의 대비를 위해 과도한 압축 없이 중립 자간 유지",layout_type:"본문 1단 + 실험적 2단"},
  {g:"문학",pub_type:"단행본",t:"파르마코-AI",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/pharmako-ai-kr/",img:"023_파르마코-AI",kw:["문학","단행본","파르마코-AI","기본은","장문","조판이며","제목과","차례는","AG","최정호"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:112,h:180},m:{상:12,하:27,안:16,밖:16},c:{구성:"1단",간격:0},b:{크기:11,행간:16,자간:-10},ty:{이름:"AG 최정호 민부리 / SM 신명조 / 고래실 / 시몬치니 개러몬드 / 아틀라스 그로테스크",분류:"혼합 (명조 / 고딕)"},pn:"하단-중앙-가로",pn_x_left:"54.2mm",pn_y_left:"167.3mm",pn_x_right:"54.2mm",pn_y_right:"167.3mm",pn_size:"10.5pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"14pt",footnote:"-",특:"기본은 1단 장문 조판이며, 장 제목과 차례는 절제된 위계로 구성된다. 표지는 얇은 규칙선과 작은 정보 블록, 본문은 넉넉한 행간과 하단 중앙 쪽번호로 차분한 리듬을 유지한다.",summary:"GPT-3와 인간 저자가 공동 창작한 수필·시·이야기 모음집. 인간과 언어 모델의 대화를 통해 자연, 기술, 문명과 창작의 의미를 탐색하며, 여섯 가지 다른 표지에는 DALL-E 2가 생성한 이미지가 사용되었다.",why_dim:"휴대 가능한 소형 판형으로 사유와 단문 중심의 읽기 흐름을 만들고, 핸드북에 가까운 친밀한 독서 경험을 유지하기 위한 선택",why_margin:"좁은 판형 안에서 본문 밀도를 안정시키고, 하단 여백을 넓혀 쪽번호와 문단 호흡을 정리",why_font:"본문에는 문학적 밀도와 장문 가독성을 위한 명조 계열을, 표지와 보조 정보에는 절제된 고딕을 사용해 실험적 내용과 고전적 독서감을 함께 확보",why_tracking:"긴 문단과 산문 중심 구성에서 판독성을 유지하고, 제목 및 보조 정보와의 위계 차이를 미세하게 조정하기 위한 설정",layout_type:"본문 1단"},
  {g:"그래픽디자인",pub_type:"전시도록",t:"네버 얼론—인터랙티브 디자인으로서 비디오 게임",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/never-alone-kr/",img:"024_네버 얼론—인터랙티브 디자인으로서 비디오 게임",kw:["그래픽디자인","전시도록","네버","얼론","인터랙티브","디자인으로서","비디오","게임","전면","흑색","바탕","위에","스크린샷","LL","유니카77"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:203,h:254},m:{상:43,하:13,안:13,밖:19},c:{구성:"4단",간격:6},b:{크기:12,행간:14.5,자간:-5},ty:{이름:"LL 유니카77 / 맞춤 서체",분류:"고딕"},pn:"상단-외측-세로",pn_x_left:"6.7mm",pn_y_left:"43.6mm",pn_x_right:"191.8mm",pn_y_right:"43.6mm",pn_size:"10.5pt",pn_font:"고딕",pn_style:"백색 / 세로 / 숫자",running:"10pt",subheading:"19pt",footnote:"7.5pt",특:"전면 흑색 바탕 위에 게임 스크린샷, 도판, 해설 텍스트를 병치하고, 섹션 표제와 표지에는 템페스트 화면 문자에서 파생된 맞춤 레터링을 적용한다. 이미지와 정보 블록이 규칙적으로 정렬되며 인터페이스적 질서를 강조한다.",summary:"MoMA의 첫 비디오 게임 컬렉션 전시에 맞춰 발간된 도록. 비디오 게임을 단순한 오락이 아니라 인간과 기계의 상호작용을 매개하는 인터페이스로 해석하며, 검은 지면과 벡터 그래픽 기반 레터링으로 전시의 ‘화이트 큐브 속 블랙 박스’ 성격을 시각화한다.",why_dim:"전시 도판, 장문 해설, 게임 인터페이스 이미지를 함께 수용하면서도 몰입감 있는 시각 경험을 만들기 위한 중대형 판형",why_margin:"전면 흑색 지면 위에서 텍스트와 이미지 대비를 안정적으로 확보하고, 하단 여백을 넓혀 쪽번호와 판면 호흡을 정리",why_font:"본문과 해설에는 중립적 고딕을 사용해 검은 바탕에서도 높은 판독성을 확보하고, 표지와 섹션 표제에는 벡터 그래픽 게임의 조형 언어를 반영한 디스플레이 레터링으로 전시 아이덴티티를 강화",why_tracking:"어두운 바탕 위의 장문 조판에서 문자 식별성을 높이고, 디스플레이 제목과 본문 사이의 위계를 안정적으로 유지하기 위한 설정",layout_type:"본문 2-3단 가변 + 주석 1단"},
  {g:"그래픽디자인",pub_type:"잡지·저널",t:"거울들 4권—독립 스튜디오",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/mirrors-4-independent-practice-kr/",img:"025_거울들 4권—독립 스튜디오",kw:["그래픽디자인","잡지·저널","거울들","4권","독립","스튜디오","대각선","규칙선과","세로","회전","텍스트(MIRRORS)를","반복적으로","노토","산스"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:225,h:297},m:{상:5,하:9,안:20,밖:10},c:{구성:"4단",간격:4},b:{크기:8,행간:9,자간:-10},ty:{이름:"노토 산스 / 본고딕 / 윈딩스 / 유니버스 넥스트",분류:"고딕"},pn:"하단-내측-가로",pn_x_left:"216.7mm",pn_y_left:"245.4mm",pn_x_right:"8.3mm",pn_y_right:"245.4mm",pn_size:"7.5pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"7.5pt",특:"대각선 규칙선과 세로 회전 텍스트(MIRRORS)를 반복적으로 배치해 시리즈 정체성을 유지하고, 도판과 텍스트를 모듈 단위로 배열한다. 이미지 페이지와 텍스트 페이지가 교차하며 리듬을 형성한다.",summary:"일본인의 시점에서 한국 그래픽 디자인을 조명하는 연재 ‘거울들’의 4번째 권. 독립 스튜디오 신신과 오디너리 피플의 작업을 중심으로 2000년대 이후 독립 디자인 실천을 분석한다.",why_dim:"잡지 아이디어 본지 내 삽입되는 ‘책 속의 책’ 구조로 시각적 분리와 독립된 읽기 단위를 확보하기 위한 대형 판형",why_margin:"이미지와 텍스트 혼합 지면에서 정보 밀도와 시각적 여백의 균형을 유지",why_font:"잡지 기사 특성상 명확한 정보 전달과 다양한 언어 혼용 환경에서의 가독성을 확보하기 위해 고딕 계열을 중심으로 구성",why_tracking:"2단 구성에서 판독성을 유지하고 이미지 캡션 및 보조 정보와의 위계를 조정",layout_type:"본문 4단 + 이미지 가변 배치"},
  {g:"아트이론·비평",pub_type:"실험출판",t:"포스트텍스처",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/post-texture-kr/",img:"026_포스트텍스처",kw:["아트이론·비평","실험출판","포스트텍스처","텍스트","중심","일반","소설형","신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:105,h:150},m:{상:10,하:16,안:12,밖:12},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:-20},ty:{이름:"SM 신명조 / 푸르니에",분류:"명조"},pn:"하단-외측-가로",pn_x_left:"7.5mm",pn_y_left:"137mm",pn_x_right:"93.5mm",pn_y_right:"137mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"12.5pt",footnote:"6.5pt",특:"1단 텍스트 중심 일반 소설형",summary:"음악·무용·미술의 교차점에서 시간과 신체 감각을 ‘텍스처’ 개념으로 재해석하고, 이를 넘어서기 위한 동시적·다성적 읽기 구조를 제안하는 이론서. 다중 텍스트 흐름을 통해 비선형 독서 경험을 설계한다.",why_dim:"소형 판형으로 독자의 손에 밀착된 상태에서 다중 텍스트 흐름을 능동적으로 탐색하도록 유도",why_margin:"다중 텍스트 흐름과 시선 이동을 유도하기 위한 여백 확보 및 기준선 역할",why_font:"이론 텍스트의 밀도 높은 독해를 위해 명조 계열을 사용하고, 전통적 독서 경험과 실험적 레이아웃 간 긴장 형성",why_tracking:"다중 텍스트 흐름에서도 기본 가독성을 유지하기 위한 중립 자간",layout_type:"본문 1단"},
  {g:"타이포그래피",pub_type:"단행본",t:"트랜스포머—아이소타이프 도표를 만드는 원리",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/the-transformer-rev-edn-kr/",img:"027_트랜스포머—아이소타이프 도표를 만드는 원리",kw:["타이포그래피","단행본","트랜스포머","아이소타이프","도표를","만드는","원리","도표","이미지와","본문","텍스트가","병렬로","배치되며","산돌","그레타산스"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:150,h:210},m:{상:24,하:15,안:14,밖:12},c:{구성:"11단",간격:5},b:{크기:9,행간:17,자간:0},ty:{이름:"산돌 그레타산스 / 산돌 정체",분류:"명조"},pn:"상단-우측-가로",pn_x_left:"128.6mm",pn_y_left:"8.9mm",pn_x_right:"133.1mm",pn_y_right:"137mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"-",footnote:"7pt",특:"도표 이미지와 본문 텍스트가 병렬로 배치되며, 캡션과 주석이 하단 및 측면에 정리되는 학술서 구조. 페이지 상단에 러닝헤드와 구획선 사용",summary:"아이소타이프의 핵심 원리인 ‘변형’을 중심으로 정보 디자인의 시각화 방법을 설명하는 이론서. 도표와 이미지, 텍스트를 통해 정보의 구조적 변환 방식을 분석한다.",why_dim:"도표와 텍스트를 병렬적으로 안정적으로 배치하기 위한 표준적인 중형 판형",why_margin:"도판과 텍스트의 균형 배치 및 주석 영역 확보",why_font:"정보 전달 중심의 도표 설명과 본문 독해를 병행하기 위해 명조를 혼합 사용",why_tracking:"도표와 텍스트 간 위계 구분과 안정적 가독성 유지",layout_type:"본문 8단 + 주석 3단"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"계간 시청각 5호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/avp-quarterly-5-kr/",img:"028_계간 시청각 5호",kw:["아트이론·비평","잡지·저널","계간","시청각","5호","기본은","구성이나","특정","글에서","태고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:126,h:204},m:{상:9,하:24,안:15,밖:10},c:{구성:"6단",간격:3},b:{크기:9,행간:13,자간:0},ty:{이름:"SM 태고딕 / 메종 노이에",분류:"고딕"},pn:"하단-내측-가로",pn_x_left:"104mm",pn_y_left:"191.2mm",pn_x_right:"111mm",pn_y_right:"191.2mm",pn_size:"11pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"11pt",subheading:"17pt",footnote:"8pt",특:"기본은 1단 구성이나 특정 글에서 3단 변형. 아이콘(삼각형)으로 텍스트 일부 대체, 구획선과 리스트 구조 강조",summary:"텍스트 일부를 삼각형 아이콘으로 치환하고 규칙 기반 타이포그래피에 예외를 허용하는 미술 평론지. 일부 글은 3단 구성으로 변주됨",why_dim:"저널 형식의 가독성과 실험적 타이포그래피를 병행하기 위한 판형",why_margin:"규칙 기반 레이아웃 안에서 아이콘과 변형 수용",why_font:"비평지의 중립성과 실험적 아이콘 시스템을 동시에 반영",why_tracking:"기본 가독성 유지하면서 변형 구조 대응",layout_type:"본문 1-2-3단 가변"},
  {g:"건축·공간",pub_type:"단행본",t:"누가 화이트 큐브를 두려워하랴—그래픽 디자인을 전시하는 전략들",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/whos-afraid-of-the-white-cube-kr/",img:"029_누가 화이트 큐브를 두려워하랴—그래픽 디자인을 전시하는 전략들",kw:["건축·공간","단행본","누가","화이트","큐브를","두려워하랴","그래픽","디자인을","전시하는","전략들","텍스트","중심","단일","컬럼","구조에","이미지","AG","최정호"],align_title:"좌측 정렬, 우측 정렬",align_body:"양끝 정렬",align_note:"양끝 정렬",f:{w:120,h:180},m:{상:27,하:30,안:20,밖:20},c:{구성:"1단",간격:0},b:{크기:9.5,행간:16,자간:0},ty:{이름:"AG 최정호 민부리 / 유니버스",분류:"고딕"},pn:"하단-외측-가로",pn_x_left:"21.4mm",pn_y_left:"14.6mm",pn_x_right:"21.4mm",pn_y_right:"14.6mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"6pt",subheading:"9.5pt",footnote:"9pt",특:"텍스트 중심 단일 컬럼 구조에 이미지 도판과 캡션을 하단에 배치. 박스 처리된 제목과 인용문으로 위계 형성",summary:"그래픽 디자인을 화이트 큐브 공간에서 어떻게 전시할 것인가를 다루는 비평서. 전시 사례 분석과 이론 텍스트를 병치하며 디자인과 전시 환경의 관계를 탐구",why_dim:"이론 텍스트 중심 독서를 위한 소형 판형",why_margin:"텍스트 중심 독서를 안정화하고 이미지 캡션 영역 확보",why_font:"본문은 고딕으로 장문 가독성을 확보하고 제목과 정보 요소는 고딕으로 대비 형성",why_tracking:"장문 독서에 적합한 안정적 자간",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"전시도록",t:"국립현대미술관 연구 13집",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/mmca-studies-13-kr/",img:"030_국립현대미술관 연구 13집",kw:["아트이론·비평","전시도록","국립현대미술관","연구","13집","기본","장문","구성에","이미지","페이지","A2","인디펜던트"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:185,h:260},m:{상:9,하:36,안:17,밖:12},c:{구성:"4단",간격:2},b:{크기:9,행간:17,자간:10},ty:{이름:"A2 인디펜던트 텍스트 / 노토 산스 / 바른바탕체 / 아틀라스 그로테스크",분류:"혼합 (고딕 / 명조)"},pn:"하단-중앙-가로",pn_x_left:"84.1mm",pn_y_left:"235.2mm",pn_x_right:"86.3mm",pn_y_right:"235.2mm",pn_size:"6.5pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"6.5pt",subheading:"16pt",footnote:"6.5pt",특:"기본 1단 장문 구성에 이미지 페이지 및 2단 혼합. 캡션과 본문을 분리하여 정보 위계 명확화",summary:"MMCA 연구 총서로 전시 역사와 미술 담론을 다루는 학술 출판물. 이미지 도판과 장문 텍스트를 병치하며 전시 맥락을 분석",why_dim:"도판과 장문 텍스트를 병행하는 학술서에 적합한 중대형 판형",why_margin:"이미지와 텍스트를 안정적으로 분리하고 하단 정보 영역 확보",why_font:"학술 텍스트 가독성을 위한 명조와 정보 계층 구분을 위한 고딕 혼합",why_tracking:"장문 독서에 적합한 중립적 자간",layout_type:"본문 3단 + 소제목 2단 + 주석 1단"},
  {g:"현대미술",pub_type:"전시도록",t:"빛—영국 테이트미술관 특별전",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/light-works-from-the-tate-collection-catalog-kr/",img:"031_빛—영국 테이트미술관 특별전",kw:["현대미술","전시도록","빛","영국","테이트미술관","특별전","좌측","텍스트","우측","이미지","구성","반복.","FF","바우"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:180,h:240},m:{상:9,하:28,안:15,밖:9},c:{구성:"4단",간격:6},b:{크기:9,행간:14,자간:0},ty:{이름:"FF 바우 / SM 중고딕 / 도멘 디스플레이 / 블랑",분류:"혼합 (고딕 / 명조 / 디스플레이)"},pn:"하단-외측-가로",pn_x_left:"43.4mm",pn_y_left:"228.4mm",pn_x_right:"133.2mm",pn_y_right:"228.4mm",pn_size:"7pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"12pt",footnote:"8pt",특:"좌측 텍스트, 우측 이미지 구성 반복. 도판 중심 레이아웃과 설명 텍스트 병치",summary:"‘빛’을 주제로 한 테이트 컬렉션 전시 도록으로 역사적 작품과 현대 작품을 병치하며 빛과 시각 경험을 탐구",why_dim:"작품 이미지 재현과 텍스트 병행에 적합한 중형 판형",why_margin:"이미지와 텍스트 균형 배치 및 하단 캡션 공간 확보",why_font:"전시 타이틀 강조를 위한 디스플레이와 본문 가독성을 위한 혼합 사용",why_tracking:"작품 설명 가독성을 위한 중립 자간",layout_type:"본문 2단 + 주석 2단(1열 한글, 1열 영어 총 2열)"},
  {g:"타이포그래피",pub_type:"잡지·저널",t:"거울들 3권—교육",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/mirrors-vol-3-education-kr/",img:"032_거울들 3권—교육",kw:["타이포그래피","잡지·저널","거울들","3권","교육","다단","텍스트(흑/청)","구분","이미지","하단","배치","노토","산스"],align_title:"좌측 정렬",align_body:"양끝 정렬(한자), 좌측 정렬(영어)",align_note:"좌측 정렬",f:{w:225,h:297},m:{상:6,하:8,안:20,밖:10},c:{구성:"4단",간격:4},b:{크기:8,행간:10,자간:0},ty:{이름:"노토 산스 / 유니버스 넥스트 / 윈딩스",분류:"혼합 (고딕 / 디스플레이)"},pn:"하단-내측-가로",pn_x_left:"217.1mm",pn_y_left:"245.7mm",pn_x_right:"8.3mm",pn_y_right:"228.4mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"8pt",footnote:"7.5pt",특:"다단 텍스트(흑/청) 구분, 이미지 하단 배치, 세로 제목 요소 반복",summary:"한국 그래픽 디자인 교육 기관을 조사하고 학생 작업과 인터뷰를 병치한 연재 기사",why_dim:"잡지형 대형 판형으로 이미지와 다단 텍스트 병렬 구성",why_margin:"다단 텍스트와 이미지 병렬 정렬을 위한 균등 여백",why_font:"정보 전달용 고딕과 아이콘성 디스플레이 병용",why_tracking:"다단 가독성과 정보 밀도 유지",layout_type:"본문 4단"},
  {g:"아트이론·비평",pub_type:"전시도록",t:"M+ 탄생기",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/the-making-of-m-kr/",img:"033_M+ 탄생기",kw:["아트이론·비평","전시도록","M+","탄생기","전면","이미지","텍스트","오버레이","인용문","스트립","노토","산스"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:150,h:200},m:{상:10,하:22,안:8,밖:8},c:{구성:"2단",간격:5},b:{크기:7,행간:9,자간:0},ty:{이름:"노토 산스 / 아틀라스 그로테스크",분류:"고딕"},pn:"하단-외측-가로",pn_x_left:null,pn_y_left:null,pn_x_right:"139.3mm",pn_y_right:"192mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"9.5pt",footnote:"-",특:"전면 이미지 위 텍스트 오버레이, 인용문 스트립 반복 배치",summary:"홍콩 M+ 미술관의 형성과정을 이미지 중심으로 구성한 대형 아카이브 출판물",why_dim:"대량 이미지 수록과 연속적 내러티브 전달에 적합한 판형",why_margin:"이미지 중심 구성과 인용문 배치를 위한 여백 확보",why_font:"다국어 텍스트와 인용문 가독성을 위한 중립 고딕",why_tracking:"이미지 위 가독성 유지",layout_type:"본문 2단 + 소제목 1단"},
  {g:"아트이론·비평",pub_type:"단행본",t:"토마",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/thomas-kr/",img:"034_토마",kw:["아트이론·비평","단행본","토마","본문","흐름","하단","질문","레이어","도멘","텍스트"],align_title:"좌측 정렬, 우측 정렬, 중앙 정렬",align_body:"양끝 정렬",align_note:"-",f:{w:112,h:180},m:{상:9,하:24,안:11,밖:11},c:{구성:"1단",간격:0},b:{크기:9.5,행간:17,자간:0},ty:{이름:"도멘 텍스트 / 신세계",분류:"명조"},pn:"하단-외측-가로",pn_x_left:"11mm",pn_y_left:"167mm",pn_x_right:"96mm",pn_y_right:"167mm",pn_size:"9.5pt",pn_font:"명조",pn_style:"적색 강조 / 가로 / 숫자",running:"9.5pt",subheading:"9.5pt",footnote:"-",특:"본문 흐름 + 하단 질문 레이어",summary:"다중 화자 구조와 질문 중심의 비선형 텍스트 구성",why_dim:"읽기 밀도와 휴대성 균형",why_margin:"하단 질문 텍스트 배치를 위한 여백 활용",why_font:"비평 텍스트 가독성과 톤 유지",why_tracking:"안정적 독서 흐름",layout_type:"본문 1단"},
  {g:"그래픽디자인",pub_type:"잡지·저널",t:"거울들 2권—밀레니얼 세대 2부",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/mirrors-vol-2-millennials-part-2-kr/",img:"035_거울들 2권—밀레니얼 세대 2부",kw:["그래픽디자인","잡지·저널","거울들","2권","밀레니얼","세대","2부","이미지와","텍스트를","모듈","단위로","배열하고","세로","노토","산스"],align_title:"좌측 정렬",align_body:"양끝 정렬(한자), 좌측 정렬(영어)",align_note:"좌측 정렬",f:{w:225,h:297},m:{상:6,하:8,안:20,밖:10},c:{구성:"4단",간격:4},b:{크기:8,행간:10,자간:0},ty:{이름:"노토 산스 / 본고딕 / 유니버스 넥스트 / 윈딩스",분류:"혼합 (고딕 / 디스플레이)"},pn:"하단-내측-가로",pn_x_left:"212.3mm",pn_y_left:"245.8mm",pn_x_right:"8.07mm",pn_y_right:"245.8mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"8pt",footnote:"-",특:"이미지와 텍스트를 모듈 단위로 배열하고, 세로 제목(MIRRORS)과 기호 요소를 반복 배치해 시리즈 아이덴티티 유지. 페이지별로 단 수를 유동적으로 전환",summary:"일본인의 시점에서 한국 그래픽 디자인을 조명하는 연재 기사 ‘거울들’의 두 번째 권. 밀레니얼 세대 디자이너(MHTL, 강문식, 프레스 룸, 워크스 등)의 작업을 사례 중심으로 소개하며 세대적 특성과 시각 언어를 분석한다.",why_dim:"잡지 아이디어 내 삽입형 별책 구조로, 본지와 구분되는 독립적 읽기 단위를 확보하면서도 충분한 이미지·텍스트 병렬 구성을 위한 표준 A4 판형 선택",why_margin:"하단 여백을 확장해 쪽번호 및 캡션 영역 확보, 다단 텍스트와 이미지 혼합 시 시각적 과밀 방지",why_font:"다국어 환경과 잡지 기사 특성상 높은 가독성을 확보하기 위해 중립적 고딕 중심 구성, 아이콘·기호 및 제목에서 디스플레이 요소 보강",why_tracking:"다단 구성에서 판독성과 정보 밀도를 균형 있게 유지하기 위한 중립 자간 설정",layout_type:"본문 4단"},
  {g:"문학",pub_type:"전시도록",t:"세스 프라이스 개새끼",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/fuck-seth-price-kr/",img:"036_세스 프라이스 개새끼",kw:["문학","전시도록","세스","프라이스","개새끼","균일","텍스트","블록","소설형","본문","AG","초특태고딕"],align_title:"-",align_body:"양끝 정렬",align_note:"-",f:{w:112,h:180},m:{상:15,하:30,안:16,밖:16},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:20},ty:{이름:"AG 초특태고딕, SM 순명조, SM 신명조, Century Oldstyle, Adobe Caslon",분류:"혼합 (고딕 / 명조 / 디스플레이)"},pn:"하단-중앙-가로",pn_x_left:"54.1mm",pn_y_left:"158.8mm",pn_x_right:"53.9mm",pn_y_right:"158.8mm",pn_size:"8pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"-",footnote:"-",특:"균일 텍스트 블록, 소설형 본문",summary:"현대 미술계의 자기반영성과 모순을 자전소설 형식으로 다루며 이미지와 텍스트 관계를 실험적으로 구성",why_dim:"소형 판형으로 개인적 서사 집중 유도",why_margin:"텍스트 집중 및 안정적 읽기 흐름 확보",why_font:"서사와 개념 대비를 위한 다중 서체 사용",why_tracking:"전통적 가독성과 서사 흐름 유지",layout_type:"본문 1단"},
  {g:"그래픽디자인",pub_type:"잡지·저널",t:"거울들 2권—밀레니얼 세대 1부",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/mirrors-vol-2-millennials-part-1-kr/",img:"037_거울들 2권—밀레니얼 세대 1부",kw:["그래픽디자인","잡지·저널","거울들","2권","밀레니얼","세대","1부","이미지","블록과","텍스트","블록","교차","배열","Noto","Sans"],align_title:"좌측 정렬",align_body:"양끝 정렬(한자), 좌측 정렬(영어)",align_note:"좌측 정렬",f:{w:225,h:297},m:{상:6,하:9,안:21,밖:10},c:{구성:"4단",간격:4},b:{크기:6.5,행간:9,자간:0},ty:{이름:"Noto Sans, 본고딕, Wingdings, Univers Next",분류:"고딕"},pn:"하단-내측-가로",pn_x_left:"212.6mm",pn_y_left:"246mm",pn_x_right:"8mm",pn_y_right:"246mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"-",특:"이미지 블록과 텍스트 블록 교차 배열",summary:"일본 시각에서 한국 그래픽 디자인을 조명하는 연재 기사로 밀레니얼 디자이너 작업을 사례 중심으로 소개",why_dim:"A4 기반 판형으로 이미지와 텍스트 병렬 구성 최적화",why_margin:"이미지와 텍스트 균형 배치",why_font:"현대적 정보 전달과 실험적 그래픽 병치",why_tracking:"이미지 대비 가독성 확보",layout_type:"본문 4단"},
  {g:"아트이론·비평",pub_type:"실험출판",t:"갱생 200116~210115",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/rehab-200116-210115/",img:"038_갱생 200116~210115",kw:["아트이론·비평","실험출판","갱생","200116~210115","시간","순서","세로","흐름","반복","구조","Letter","Gothic"],align_title:"좌측 정렬, 우측 정렬, 중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:152,h:210},m:{상:10,하:14,안:6,밖:6},c:{구성:"3단",간격:4},b:{크기:8,행간:11,자간:0},ty:{이름:"Letter Gothic, 인문고딕",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"74.2mm",pn_y_left:"200.9mm",pn_x_right:"74.2mm",pn_y_right:"200.9mm",pn_size:"-",pn_font:"디스플레이",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"-",특:"시간 순서 세로 흐름 반복 구조",summary:"1년간 식단 기록을 시간 순서로 배열한 다이어리형 출판물, 텍스트 기반 데이터 아카이브",why_dim:"휴대 가능한 소형 판형으로 일기 형식 기록 적합",why_margin:"촘촘한 텍스트 기록 밀도 유지",why_font:"데이터 기록성과 가독성 확보",why_tracking:"정확한 시간 기록 가독성",layout_type:"본문 3단 "},
  {g:"전시·큐레이션",pub_type:"전시도록",t:"교차 확인—Sasa[44]/홍승혜",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/cross-check-sasa44-hong-seung-hye-catalog-kr/",img:"039_교차 확인—Sasa[44]-홍승혜",kw:["전시·큐레이션","전시도록","교차","확인","Sasa[44]/홍승혜","단어","단위","재배열","순열","구조","Letter","Gothic"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"중앙 정렬",f:{w:152,h:210},m:{상:6,하:9,안:6,밖:6},c:{구성:"4단",간격:4},b:{크기:9,행간:14,자간:0},ty:{이름:"Letter Gothic, 인문고딕",분류:"혼합 (고딕)"},pn:"하단-중앙-가로",pn_x_left:"74.5mm",pn_y_left:"203.4mm",pn_x_right:"74.5mm",pn_y_right:"203.4mm",pn_size:"7pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"13pt",footnote:"7pt",특:"단어 단위 재배열 및 순열 구조",summary:"두 작가의 방법론을 교차 적용한 전시를 기록한 도록으로 텍스트 재배열 구조가 특징",why_dim:"소형 도록으로 텍스트 실험과 이미지 병치에 적합",why_margin:"내지 정보 밀도 대비 여백 확보",why_font:"정보 재조합과 중립적 톤 유지",why_tracking:"재배열 텍스트 가독성 유지",layout_type:"본문 2단 + 기타요소 중앙 2열 활용"},
  {g:"그래픽디자인",pub_type:"단행본",t:"리처드 홀리스, 화이트채플을 디자인하다",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/richard-hollis-designs-for-the-whitechapel-kr/",img:"040_리처드 홀리스, 화이트채플을 디자인하다",kw:["그래픽디자인","단행본","리처드","홀리스","화이트채플을","디자인하다","본문은","장문","조판을","기본으로","하고","MT","그로테스크"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:180,h:240},m:{상:7,하:10,안:10,밖:10},c:{구성:"33열 그리드",간격:0},b:{크기:8.5,행간:15.5,자간:0},ty:{이름:"MT 그로테스크 / 을유1945 / 지백 / 파운더스 그로테스크",분류:"혼합 (고딕 / 명조)"},pn:"하단-중앙-세로",pn_x_left:"3.7mm",pn_y_left:"115.581mm",pn_x_right:"173.7mm",pn_y_right:"115.581mm",pn_size:"6pt",pn_font:"고딕",pn_style:"흑색 / 세로 / 숫자",running:"8pt",subheading:"13.5pt",footnote:"8pt",특:"본문은 1단 장문 조판을 기본으로 하고, 전시 인쇄물·포스터·리플릿 도판 면에서는 이미지 군집 배열과 2단 텍스트 설명이 병행된다. 여백 안에 작은 캡션, 세로 면주, 자료 크기 정보가 반복되어 문서적 질서를 강화한다.",summary:"리처드 홀리스와 런던 화이트채플 아트 갤러리의 협업을 다룬 크리스토퍼 윌슨의 연구서를 한국어로 옮긴 번역서. 원서의 내지 구조를 충실히 유지하되, 표지는 1982년 포스터 세부를 실물 크기에 가깝게 제시해 아카이브성과 그래픽 물성을 강조한다.",why_dim:"포스터, 리플릿, 도록, 자료 이미지와 장문 해설을 함께 수용하는 중형 판형으로 아카이브 연구서의 도판 밀도와 독서 안정성을 동시에 확보",why_margin:"하단 여백을 확장해 쪽번호와 캡션, 주석성 정보를 안정적으로 수용하고, 넓은 여백 안에서 도판의 종이 물성과 접힘 흔적을 오브젝트처럼 드러냄",why_font:"역사 자료의 문서성과 장문 독서 가독성을 확보하기 위해 본문에는 명조 계열을, 면주·캡션·보조 정보와 일부 제목에는 중립적 고딕을 혼용해 아카이브 연구서의 공적 톤과 현대적 정보성을 함께 유지",why_tracking:"장문 본문과 캡션, 자료 설명이 혼합되는 지면에서 판독성을 유지하고, 제목과 면주 정보의 위계를 미세하게 조정하기 위한 설정",layout_type:"33열 여백 기준 / 본문 24열 + 주석 6열, 8열 가변"},
  {g:"문학",pub_type:"단행본",t:"한국문학번역원 지원 해외출간도서 1527",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/1527-overseas-publications-supported-by-lti-korea-kr/",img:"041_한국문학번역원 지원 해외출간도서 1527",kw:["문학","단행본","한국문학번역원","지원","해외출간도서","1527","도서","1권이","1페이지를","온전히","차지하며","노토","산스"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"중앙 정렬",f:{w:150,h:210},m:{상:15,하:24,안:25,밖:25},c:{구성:"1단",간격:0},b:{크기:12,행간:14,자간:0},ty:{이름:"노토 산스 / 본고딕 / 더 퓨처 모노 / 미니언 / 산돌 명조네오",분류:"혼합 (고딕 / 명조 / 디스플레이)"},pn:"하단-중앙-가로",pn_x_left:"71.4mm",pn_y_left:"191.9mm",pn_x_right:"71.4mm",pn_y_right:"191.9mm",pn_size:"10pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"7pt",subheading:"15pt",footnote:"-",특:"지원 도서 1권이 1페이지를 온전히 차지하며, 상단에는 큰 일련번호와 서지 정보, 하단에는 표지 이미지가 배치된다. 페이지 외곽의 색상 프레임은 출간 연도를 표시하고, 앞뒤 면지의 연도별·언어별 도표와 도입부 에세이 페이지가 전체 기록물의 구조를 형성한다.",summary:"한국문학번역원 창립 25주년을 기념해 제작된 해외 번역 출간 도서 총목록. 번역원의 지원으로 국외에서 출간된 한국문학 도서 1,527권을 망라하고, 에세이와 표지 디자인 분석 글을 함께 수록한 1,592쪽의 대형 기록물이다. 연도별 색상 테두리와 연도·언어별 면지 도표를 통해 축적의 시간성을 시각화한다.",why_dim:"1,527권의 표지 이미지를 한 권당 한 페이지로 안정적으로 수용하고, 1,592쪽 분량의 장대한 기록물을 휴대 가능한 범위 안에서 유지하기 위한 표준적 중형 판형",why_margin:"한 페이지에 표지 1권과 메타데이터를 명확히 분리해 보여 주기 위해 넉넉한 주변 여백을 유지하고, 하단 여백을 확장해 쪽번호와 판면 호흡을 안정화",why_font:"대량의 서지 정보와 색인에는 중립적 고딕과 모노를 사용해 시스템성과 검색성을 확보하고, 에세이 본문에는 명조를 사용해 장문 독서의 안정성을 높였다. 큰 번호와 표지 캡션에는 굵은 고딕을 사용해 아카이브의 계수성과 리듬을 강조",why_tracking:"장문 에세이와 대량의 서지 정보가 공존하는 구성에서 본문 가독성을 유지하고, 언어 코드·번호·색인 정보의 구조적 위계를 미세하게 정리하기 위한 설정",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"잡지·저널",t:"옵.신 9호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/ob-scene-9-kr/",img:"042_옵.신 9호",kw:["인문·사회","잡지·저널","옵.신","9호","본문은","장문","조판을","기본으로","하고","문체부","바탕"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:112,h:180},m:{상:18,하:14,안:11,밖:11},c:{구성:"2단",간격:8},b:{크기:9,행간:17,자간:0},ty:{이름:"문체부 바탕 / 아키타이프 레너",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-중앙-가로",pn_x_left:"54.4mm",pn_y_left:"9mm",pn_x_right:"54.4mm",pn_y_right:"9mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"14pt",footnote:"6pt",특:"본문은 1단 장문 조판을 기본으로 하고, 목차·도판 설명·인덱스 면에서는 2단 및 분산 배치가 나타난다. 문체부 바탕의 본문과 아키타이프 레너의 숫자·영문·제목이 강하게 대비하며, 원형 확대 크롭과 수평 규칙선, 대형 추상 패턴 이미지가 반복되어 이론서와 저널의 긴장을 형성한다.",summary:"무대(scene) 바깥의 예술·정치·역사를 다루는 다원 공연 예술 저널. 9호는 20세기 정치·미학 프로젝트의 실패 이후 확산한 국가주의를 재고하며, 한글 바탕체와 실험적 기하학 고딕의 강한 이질적 병치를 통해 민족성과 보편성의 긴장을 시각화한다.",why_dim:"소형 저널 판형으로 480쪽의 장문 비평 텍스트를 압축해 휴대성과 집중도를 확보하고, 촘촘한 활자 실험과 긴 호흡의 독서를 동시에 수용",why_margin:"좁은 판형 안에서 본문 밀도를 유지하면서 하단 여백과 바깥 여백을 통해 쪽번호·주석·면 전환의 호흡을 확보하고, 대비 강한 흑백 이미지와 기하학 패턴을 오브젝트처럼 드러냄",why_font:"한글 본문에는 한국어 장문 독서에 적합한 명조 계열을 사용해 사유의 밀도를 유지하고, 숫자·로마자·보조 정보에는 실험적 푸투라 계열을 적용해 20세기 보편주의 형식 언어를 호출함으로써 민족성과 국제주의의 긴장을 시각적으로 부각",why_tracking:"장문 비평 텍스트의 판독성을 유지하면서, 대형 숫자·영문 제목과 각주·보조 정보의 위계를 분리하기 위한 중립 자간 설정",layout_type:"본문 1단 + 목차 2단"},
  {g:"문학",pub_type:"단행본",t:"햄릿이냐 헤쿠바냐—극 속으로 침투한 시대",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/hamlet-oder-hekuba-kr/",img:"043_햄릿이냐 헤쿠바냐—극 속으로 침투한 시대",kw:["문학","단행본","햄릿이냐","헤쿠바냐","극","속으로","침투한","시대","안정적인","장문","조판과","각주","신신명조"],align_title:"-",align_body:"양끝 정렬",align_note:"-",f:{w:138,h:222},m:{상:20,하:36,안:21,밖:24},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:-60},ty:{이름:"SM 신신명조 / 베르톨트 블록 / 벤턴 산스 / 산돌 고딕네오 / 어도비 캐즐런 / 윤명조 / 캐즐런 540",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-외측-가로",pn_x_left:"42mm",pn_y_left:"11.4mm",pn_x_right:"91.7mm",pn_y_right:"11.4mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"-",특:"내지는 안정적인 1단 장문 조판과 각주 구조를 유지하고, 표지는 큰 사선 면과 비대칭 덧표지가 본체 표지를 부분적으로 가린다. 제목은 기울어진 축을 따라 배치되어 두 이름의 중첩과 침투를 시각화하며, 검정·적색·베이지의 제한된 색면 대비가 강한 상징성을 형성한다.",summary:"문학동네 인문 라이브러리 시리즈의 한 권으로, 카를 슈미트의 텍스트를 담은 인문서. 표지 일부를 드러내는 비대칭 덧표지와 ‘햄릿’과 ‘헤쿠바’가 서로 침투하듯 중첩되는 타이포그래피를 통해 극과 역사, 인물과 개념의 중첩 관계를 시각화한다.",why_dim:"장문 인문 텍스트의 안정적 독서를 유지하면서도 시리즈의 비대칭 덧표지 구조와 세로로 긴 비율을 수용하기 위한 변형 판형",why_margin:"하단 여백을 확장해 쪽번호와 본문 리듬을 안정화하고, 넓은 판면 위에 비스듬히 개입하는 덧표지와 사선 타이포그래피가 오브젝트처럼 읽히도록 여백을 확보",why_font:"장문 본문에는 인문서의 고전적 가독성을 위한 명조 계열을 사용하고, 표지와 보조 정보에는 고딕 및 디스플레이 요소를 혼용해 시리즈의 개념적 긴장과 상징적 대비를 강화",why_tracking:"장문 독서의 안정성을 유지하면서 표지·면주·각주 정보와의 위계를 자연스럽게 분리하기 위한 중립 자간 설정",layout_type:"본문 1단"},
  {g:"그래픽디자인",pub_type:"잡지·저널",t:"거울들 1권—슬기와 민 2부",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/mirrors-part-2-kr/",img:"044_거울들 1권—슬기와 민 2부",kw:["그래픽디자인","잡지·저널","거울들","1권","슬기와","민","2부","페이지에서는","영어와","일본어에","불균등한","폭의","3단을","노토","산스"],align_title:"좌측 정렬",align_body:"양끝 정렬(한자), 좌측 정렬(영어)",align_note:"좌측 정렬",f:{w:225,h:297},m:{상:6,하:8,안:20,밖:8},c:{구성:"3단",간격:6},b:{크기:9,행간:11,자간:0},ty:{이름:"노토 산스 / 본고딕 / 윈딩스 / 유니버스 넥스트",분류:"혼합 (고딕 / 디스플레이)"},pn:"하단-내측-가로",pn_x_left:"212.7mm",pn_y_left:"245.4mm",pn_x_right:"7.6mm",pn_y_right:"245.4mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"8pt",특:"한 페이지에서는 영어와 일본어에 불균등한 폭의 3단을 배분하고, 다음 페이지에서 비중을 역전해 균형을 회복한다. 전시 사진이 큰 폭으로 삽입되어 텍스트 흐름을 끊고, 그림활자 면주와 작은 아이콘 열이 객관적 인터뷰 지면에 장난스러운 균열을 낸다.",summary:"한국 그래픽 디자인 문화를 다루는 아이디어 특집 연재 ‘거울들’의 첫 회 2부. 고토 데쓰야와 슬기와 민의 인터뷰를 중심으로 전시와 출판 작업을 다루며, DDD 갤러리 전경 사진과 고팅엄이 촬영한 출판물 사진이 중간중간 삽입된다. 비대칭 다국어 3단 구성과 그림활자 면주가 객관적 인터뷰 지면에 미묘한 불규칙 리듬을 만든다.",why_dim:"잡지 아이디어의 대형 판형 안에서 전시 전경 사진, 인터뷰 텍스트, 다국어 병렬 구성을 충분히 수용하고 시각적 호흡을 확보하기 위한 A4 계열 판형",why_margin:"넓은 바깥 여백과 중앙 여백을 통해 전시 사진과 3단 인터뷰 텍스트를 분리하고, 면주·쪽번호·그림활자 열을 위한 독립된 정보 영역을 확보",why_font:"다국어 인터뷰와 캡션의 명확한 전달을 위해 중립적 고딕을 중심으로 구성하고, 윈딩스 기반 그림활자를 면주에 사용해 시리즈의 가벼운 유희성과 비규칙적 리듬을 부여",why_tracking:"3단 다국어 구성에서 판독성을 유지하고, 면주·캡션·보조 정보와 인터뷰 본문 사이의 위계를 안정적으로 구분하기 위한 설정",layout_type:"본문 3단 "},
  {g:"인문·사회",pub_type:"실험출판",t:"그들은 야생에 있었다",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/they-were-in-the-wild-kr/",img:"045_그들은 야생에 있었다",kw:["인문·사회","실험출판","그들은","야생에","있었다","장문","본문은","단일","컬럼으로","안정적으로","배치되고","LT","디도"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:112,h:180},m:{상:18,하:15,안:11,밖:11},c:{구성:"1단",간격:0},b:{크기:11,행간:17,자간:-10},ty:{이름:"LT 디도 / MT 그로테스크 / 안삼열체 / 지백",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-외측-가로",pn_x_left:"11.3mm",pn_y_left:"9.4mm",pn_x_right:"97.6mm",pn_y_right:"9.4mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"-",footnote:"6.5pt",특:"장문 본문은 단일 컬럼으로 안정적으로 배치되고, 차례와 발문 면에서도 동일한 질서를 유지한다. 세리프 본문과 산세리프 보조 정보가 절제된 대비를 이루며, 여백이 넓은 빈 페이지와 간단한 크레딧 면이 삽입되어 연재글의 호흡을 조절한다.",summary:"옵/신 페스티벌 2020에서 마텐 스팽베르크가 진행한 수행적 글쓰기 프로젝트를 묶은 책. 축제 기간 동안 온라인에 연재한 20편의 한국어 텍스트를 수록하며, 춤과 예술의 생태계, 기술 매개 현상, 국제 무용계의 언어 정치에 대한 개인적 성찰을 담는다. 비매품으로 페스티벌 프로그램과 함께 배포되었다.",why_dim:"소형 판형으로 개인적 에세이와 일기형 연재 텍스트의 친밀한 읽기 경험을 유지하고, 페스티벌 세트 배포용 소책자로서 휴대성과 제작 효율을 확보",why_margin:"균일한 좌우 여백 위에 하단 여백을 조금 더 확보해 쪽번호와 호흡을 안정시키고, 느슨한 에세이 리듬과 작은 판형의 집중도를 함께 유지",why_font:"본문에는 에세이와 성찰적 산문의 밀도를 살리는 명조 계열을 사용하고, 차례·보조 정보·제목에는 고딕과 디스플레이 성격의 서체를 혼용해 작은 판형 안에서도 위계를 또렷하게 분리하고 실험적 저널의 인상을 유지",why_tracking:"장문 산문의 가독성을 우선하면서도 차례와 크레딧, 보조 정보의 정보 위계를 미세하게 조정하기 위한 보수적 자간 설정",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"실험출판",t:"옵/신 페스티벌 2020",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/ob-scene-festival-2020-kr/",img:"046_옵-신 페스티벌 2020",kw:["아트이론·비평","실험출판","옵/신","페스티벌","2020","기본은","단일","컬럼","텍스트","구조이며","상단에","LT","디도"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:112,h:180},m:{상:18,하:15,안:11,밖:12},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"LT 디도 / MT 그로테스크 / 아르시스 / 안삼열체 / 지백",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-외측-가로",pn_x_left:"11.3mm",pn_y_left:"9.4mm",pn_x_right:"97.5mm",pn_y_right:"9.4mm",pn_size:"8pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"12pt",footnote:"7pt",특:"기본은 단일 컬럼 텍스트 구조이며, 상단에 러닝헤드와 쪽번호가 배치된다. 일부 면에는 작은 공연 사진과 캡션이 들어가고, 평문은 세리프, 작가별 글과 보조 정보는 산세리프로 구분되어 레지스터가 달라진다. 표지와 덧표지에서는 대형 디도 계열 제목이 강한 수직 리듬을 형성한다.",summary:"2020년 가을 열린 신생 다원 예술제 ‘옵/신 페스티벌’ 1회를 기록하고 성찰하는 출판물. 작은 판형 안에서 신고전주의 타이포그래피로 조판된 평문과 산세리프 기반 작가 원고를 대비시키고, 덧표지와 일부 면에 작은 작품 이미지를 삽입해 진지한 비평성과 소탈한 태도를 함께 드러낸다.",why_dim:"페스티벌 기록물을 손에 잡히는 소형 책으로 만들어 배포성과 친밀한 독서 경험을 확보하고, 짧은 에세이·작가 글·기록 사진을 응축된 밀도로 수용하기 위한 판형",why_margin:"작은 판형 안에서 본문과 사진 캡션, 쪽번호를 안정적으로 분리하기 위해 하단 여백을 약간 넓히고, 좌우 여백을 균등하게 유지해 기록물의 차분한 리듬을 형성",why_font:"평문에는 신고전주의 명조 계열을 적용해 기록물에 역사성과 비평적 밀도를 부여하고, 작가 글·러닝헤드·보조 정보에는 고딕을 사용해 정보 전달을 명확히 한다. 표지의 대형 디스플레이 타이포는 신생 페스티벌의 선언적 정체성을 강조",why_tracking:"장문 평문의 판독성을 우선하면서도 러닝헤드와 작가 글, 캡션의 정보 위계를 분리하기 위한 보수적 자간 설정",layout_type:"본문 1단"},
  {g:"전시·큐레이션",pub_type:"전시도록",t:"작품 설명 일본어판",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/explained-japanese-kr/",img:"047_작품 설명 일본어판",kw:["전시·큐레이션","전시도록","작품","설명","일본어판","기본은","단일","컬럼","텍스트","구조이며","프로젝트","노토","산스"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:105,h:150},m:{상:12,하:15,안:10,밖:10},c:{구성:"2단",간격:4},b:{크기:10,행간:17,자간:0},ty:{이름:"노토 산스 / 본고딕 / 유니버스 넥스트 타이프라이터",분류:"고딕"},pn:"하단-외측-가로",pn_x_left:"17.4mm",pn_y_left:"140.6mm",pn_x_right:"83.3mm",pn_y_right:"140.6mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"10pt",footnote:"7pt",특:"기본은 단일 컬럼 텍스트 구조이며, 프로젝트 목록 면에서는 다열 인덱스처럼 보이는 조밀한 배열이 나타난다. 제목, 크레딧, 인용문, 본문이 넓은 빈 면과 함께 배치되어 설명 자체를 전시하는 듯한 리듬을 만들고, 검은 표지 위 흰 기호형 이미지가 개념적 표지 역할을 수행한다.",summary:"슬기와 민의 약 200개 프로젝트 이면의 과정과 의도를 말로만 설명한 책의 일본어판. ‘예술은 설명보다 경험되어야 한다’는 통념을 뒤집어, 작품 없이 설명만 감상하는 독서 경험을 제안한다. 2021년 교토 DDD 갤러리 전시에 맞춰 출간되었고, 고토 데쓰야가 번역했다.",why_dim:"소형 판형으로 텍스트만으로 구성된 개념 출판물의 밀도와 휴대성을 확보하고, 전시 연계 소책자로서 친밀한 독서 경험을 만들기 위한 선택",why_margin:"작품 이미지 없이 텍스트만으로 의미를 구성하는 책이므로 균일한 여백을 유지해 문장과 목록, 인용문의 존재감을 오브젝트처럼 드러내고 작은 판형 안에서도 압박감 없는 독서를 유도",why_font:"설명문과 목록, 색인 중심의 구조를 명확하고 중립적으로 전달하기 위해 산세리프 계열을 사용하고, 타자기풍 서체를 일부 정보 요소에 섞어 문서성과 번역 출판물의 건조한 톤을 강화",why_tracking:"장문 설명문과 목록 면에서 개입을 최소화하고, 균질한 정보 톤과 중립적 가독성을 유지하기 위한 설정",layout_type:"본문 1단 + 캡션 2단"},
  {g:"현대미술",pub_type:"전시도록",t:"팀랩—라이프",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/teamlab-kr/",img:"048_팀랩—라이프",kw:["현대미술","전시도록","팀랩","라이프","작품은","여백","없이","펼쳐지는","전면","사진으로","노이에","헬베티카"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:225,h:300},m:{상:67,하:10,안:16,밖:18},c:{구성:"4단",간격:8},b:{크기:9,행간:14,자간:0},ty:{이름:"노이에 헬베티카 / 파보리트 한글",분류:"고딕"},pn:"상단-외측-가로",pn_x_left:"7.9mm",pn_y_left:"66.8mm",pn_x_right:"212.3mm",pn_y_right:"66.8mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"13pt",footnote:"7.5pt",특:"각 작품은 여백 없이 펼쳐지는 전면 사진으로 제시되고, 양면 게이트폴드를 열수록 세부 이미지에 점점 가까워지는 단계적 확대 구조를 만든다. 표지는 노이에 헬베티카의 반복된 대형 활자를 흑백 반전으로 잘라 배치해 속장의 과잉 이미지를 대비적인 무이미지 표면으로 응축한다.",summary:"일본 미디어 아트 집단 팀랩의 대형 몰입형 전시에 맞춰 제작된 도록. 초대형 인터랙티브 비디오 설치의 경험을 게이트폴드 중심의 전면 사진 시퀀스로 재구성하며, 날개를 펼칠수록 이미지 세부에 더 가까이 접근하도록 설계했다. 표지는 반복된 대형 타이포그래피로 몰입의 압도감을 흑백으로 번역한다.",why_dim:"대형 몰입형 설치의 스케일과 전면 사진 시퀀스를 손실 없이 수용하고, 게이트폴드 확장을 통해 작품 내부로 빨려 들어가는 감각을 재현하기 위한 대형 판형",why_margin:"도판이 페이지 끝까지 확장되는 구성을 유지하면서 최소 여백만 남겨 이미지의 몰입감을 극대화하고, 하단 바깥쪽에만 최소한의 정보 영역을 확보해 시퀀스 흐름을 방해하지 않도록 설계",why_font:"표지의 대형 영문 타이포에는 중립적이면서도 강한 밀도를 가진 네오그로테스크를 사용해 전시의 압도적 스케일을 전달하고, 국문 정보에는 파보리트 한글을 사용해 명확한 정보 전달과 현대적 전시 도록의 톤을 유지",why_tracking:"짧은 캡션과 작품 정보가 이미지 중심 지면에서 느슨해 보이지 않도록 약간 좁힌 자간으로 응축도를 유지",layout_type:"본문 2단 + 캡션 2단(2열 각각 사용)"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"국립현대미술관 연구 12집",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/mmca-studies-12-kr/",img:"049_국립현대미술관 연구 12집",kw:["아트이론·비평","잡지·저널","국립현대미술관","연구","12집","좌우","페이지를","영문과","국문으로","대응시키며","표지와","A2","인디펜던트"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:185,h:260},m:{상:9,하:37,안:15,밖:15},c:{구성:"4단",간격:5},b:{크기:9,행간:17,자간:0},ty:{이름:"A2 인디펜던트 텍스트 / 노토 산스 / 본고딕 / 바른바탕체 / 아틀라스 그로테스크",분류:"혼합 (명조 / 고딕)"},pn:"하단-중앙-가로",pn_x_left:"83.7mm",pn_y_left:"234.7mm",pn_x_right:"85.9mm",pn_y_right:"234.7mm",pn_size:"7pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7pt",subheading:"16pt",footnote:"6.5pt",특:"좌우 페이지를 영문과 국문으로 대응시키며, 표지와 섹션 오프너에는 모서리형 규칙선 프레임이 반복된다. 본문은 단일 컬럼 장문 조판, 도판 페이지는 이미지와 캡션, 필자명을 하단에 분리 배치해 학술 저널과 전시 도록의 성격을 동시에 유지한다.",summary:"국립현대미술관의 연구 총서 12집. 동시대 미술과 미술관 담론을 다루는 이론·연구 글을 한영 병렬로 수록하며, 특집 ‘위기를 생각하는 미술’과 일반 논문, 도판, 각주를 함께 엮은 학술 출판물이다. 선형 규칙선과 모서리 프레임 모티프를 반복해 공공 기관 저널의 체계성과 현대적 긴장을 동시에 형성한다.",why_dim:"한영 병렬 장문 텍스트, 특집 섹션, 도판, 각주를 안정적으로 수용하면서도 기관 연구 총서에 적합한 단정한 비례를 확보하는 중대형 판형",why_margin:"하단 여백을 확장해 쪽번호·필자명·캡션을 안정적으로 배치하고, 본문 주위의 넓은 여백과 규칙선을 통해 학술지의 질서와 도판 페이지의 호흡을 함께 유지",why_font:"장문 본문에는 안정적인 명조 계열을 사용해 학술적 가독성을 확보하고, 표지·러닝헤드·섹션 제목과 보조 정보에는 중립적 고딕을 적용해 기관 저널의 공공성, 현대성, 정보 위계를 명확히 드러냄",why_tracking:"이중언어 장문 독서에서 판독성을 우선하면서, 섹션 제목과 러닝헤드, 캡션 정보의 구조를 미세하게 정리하기 위한 설정",layout_type:"본문 3단 + 주석 1단"},
  {g:"그래픽디자인",pub_type:"잡지·저널",t:"거울들 1권—슬기와 민 1부",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/mirrors-part-1-kr/",img:"050_거울들 1권—슬기와 민 1부",kw:["그래픽디자인","잡지·저널","거울들","1권","슬기와","민","1부","페이지에서는","영어와","일본어에","불균등한","폭의","3단을","노토","산스"],align_title:"좌측 정렬",align_body:"양끝 정렬(한자), 좌측 정렬(영어)",align_note:"좌측 정렬",f:{w:225,h:297},m:{상:6,하:8,안:20,밖:8},c:{구성:"3단",간격:6},b:{크기:9,행간:11,자간:0},ty:{이름:"노토 산스 / 본고딕 / 윈딩스 / 유니버스 넥스트",분류:"혼합 (고딕 / 디스플레이)"},pn:"하단-내측-가로",pn_x_left:"212.6mm",pn_y_left:"245.5mm",pn_x_right:"7.5mm",pn_y_right:"245.5mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"82pt",footnote:"7.5pt",특:"한 페이지에서는 영어와 일본어에 불균등한 폭의 3단을 배분하고, 다음 페이지에서 비중을 반전시켜 리듬을 만든다. 사진 페이지와 인터뷰 페이지가 교차하며, 그림활자 면주와 세로 기호 열이 기사 레이아웃에 장난스러운 균열을 부여한다.",summary:"한국 그래픽 디자인 문화를 다루는 아이디어 특집 연재 ‘거울들’의 첫 회 1부. 고토 데쓰야와 슬기와 민의 인터뷰를 중심으로 작업 배경과 주요 프로젝트를 소개하며, 김경태가 촬영한 작품 사진을 중간중간 삽입해 출판·전시 작업의 물성과 문맥을 병치한다. 비대칭적 3단 배분과 그림활자 면주가 객관적 기사 지면 안에 미묘한 불규칙 리듬을 만든다.",why_dim:"잡지 기사형 대형 판형으로 인터뷰 텍스트, 다국어 병렬 조판, 작품 사진과 캡션을 함께 수용하고 아이디어 본지 속 독립된 특집 섹션의 존재감을 확보하기 위한 A4 계열 판형",why_margin:"비대칭 3단 구성과 대형 작품 사진, 면주 기호 열을 안정적으로 분리하기 위해 바깥 여백과 중앙 여백을 확보하고, 하단 여백으로 쪽번호·캡션의 호흡을 조절",why_font:"다국어 인터뷰와 기사 본문의 명확한 전달을 위해 중립적 고딕을 중심으로 구성하고, 윈딩스 기반 그림활자를 면주에 사용해 연재 시리즈의 유희성과 리듬을 강화",why_tracking:"3단 기사 구성에서 판독성을 유지하고, 본문·캡션·면주 기호와 보조 정보 사이의 위계를 정리하기 위한 설정",layout_type:"본문 3단 + 주석 4단"},
  {g:"문학",pub_type:"실험출판",t:"로쿠스 솔루스",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/locus-solus/",img:"051_로쿠스 솔루스",kw:["문학","실험출판","로쿠스","솔루스","양끝정렬","본문","대칭적","표지","구성","기반","신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"양끝 정렬",f:{w:150,h:210},m:{상:21,하:29,안:18,밖:42},c:{구성:"1단",간격:0},b:{크기:9.5,행간:17,자간:0},ty:{이름:"SM 신명조 / 옵티크 디스플레이 / 모노타이프 푸르니에",분류:"명조"},pn:"상단-외측-가로",pn_x_left:"41.9mm",pn_y_left:"9.4mm",pn_x_right:"103.6mm",pn_y_right:"9.4mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"7pt, 8pt",subheading:"-",footnote:"7pt",특:"양끝정렬 본문, 대칭적 표지 구성, 점 기반 그래픽과 텍스트 대비",summary:"레몽 루셀의 실험적 소설을 담은 번역서로, 알파벳 조합 원리를 시각화한 표지와 고전적 조판의 대비를 통해 텍스트의 급진성을 드러냄",why_dim:"장문 소설 독서와 타이포그래피 실험을 병행하기 위한 표준 판형",why_margin:"고전적 조판 안정성과 하단 여백을 통한 독서 리듬 확보",why_font:"고전적 명조 기반 본문과 실험적 디스플레이 대비로 내용의 이중성 강조",why_tracking:"약간 넓은 자간으로 고전적 활자 질감과 안정된 독서감 형성",layout_type:"본문 1단 + 주석 면주 부분에 세로로 배치"},
  {g:"그래픽디자인",pub_type:"전시도록",t:"시프리앙 가이야르",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/cyprien-gaillard-brochure-kr/",img:"052_시프리앙 가이야르",kw:["그래픽디자인","전시도록","시프리앙","가이야르","표지는","갈색","바탕","위에","청색","제목을","신명조"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:185,h:245},m:{상:8,하:15,안:10,밖:10},c:{구성:"2단",간격:5},b:{크기:8.5,행간:12,자간:0},ty:{이름:"SM 신명조 / 코르모란트 / 파보리트 한글",분류:"혼합 (명조 / 디스플레이 / 고딕)"},pn:"하단-외측-가로",pn_x_left:"15mm",pn_y_left:"234.4mm",pn_x_right:"168.3mm",pn_y_right:"234.4mm",pn_size:"8.5pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"8.5pt",footnote:"9pt",특:"표지는 갈색 바탕 위에 청색 제목을 블록처럼 분절 배치하고, 내지에서는 작은 도판과 장문 해설, 작품 목록, 선형 다이어그램을 넓은 빈 공간 안에 흩어 배치한다. 세로 캡션과 최소한의 규칙선이 반복되어 시리즈 전체를 묶는 브랜딩 장치로 작동한다.",summary:"아뜰리에 에르메스 전시를 위해 제작된 소형 도록 겸 브로슈어. 개별 전시를 강조하기보다 간단한 시각 제스처로 여러 프로젝트를 느슨하게 연결하며, 미술 기관 그래픽 디자인의 과잉에 대한 절제된 대안을 제시한다. 갈색 바탕, 청색 제목, 선형 다이어그램과 작은 도판 배치가 전시 안내물과 도록의 성격을 동시에 만든다.",why_dim:"전시 도록과 브로슈어의 중간 규모로, 짧은 비평 텍스트와 작품 정보, 도판, 다이어그램형 안내 페이지를 함께 수용하면서도 가벼운 배포물의 성격을 유지하기 위한 판형",why_margin:"넓은 여백과 드문드문 배치된 텍스트·도판을 통해 기관 그래픽의 과잉을 누그러뜨리고, 선형 규칙선과 색면이 페이지의 구조만 남기도록 하여 절제된 긴장감을 형성",why_font:"본문과 해설에는 명조 계열을 사용해 전시 텍스트의 품위를 유지하고, 표지와 제목의 분절된 조형에는 디스플레이 성격의 서체를 적용해 절제된 브랜딩 효과를 만든다. 국문 보조 정보에는 고딕을 섞어 정보 전달을 명확히 한다.",why_tracking:"여백이 큰 지면에서 텍스트가 지나치게 흩어지지 않도록 기본 자간은 중립적으로 유지하고, 표지 제목과 짧은 정보 블록에서는 약한 확장으로 개별 덩어리감을 형성",layout_type:"본문 2단 "},
  {g:"아트이론·비평",pub_type:"실험출판",t:"불가능한 춤",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/impossible-dance-kr/",img:"053_불가능한 춤",kw:["아트이론·비평","실험출판","불가능한","춤","본문은","단일","컬럼","장문","조판을","유지하지만","AG","안상수체"],align_title:"좌측 정렬, 우측 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:112,h:180},m:{상:18,하:33,안:11,밖:11},c:{구성:"1단",간격:0},b:{크기:9.5,행간:17,자간:0},ty:{이름:"AG 안상수체 / SM 신신명조 / 파나마",분류:"혼합 (명조 / 디스플레이)"},pn:"상단-외측-가로(상하반전)",pn_x_left:"16.3mm",pn_y_left:"11.6mm",pn_x_right:"100.3mm",pn_y_right:"11.6mm",pn_size:"7pt",pn_font:"디스플레이",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"9.5pt (상하반전)",footnote:"7pt",특:"본문은 단일 컬럼 장문 조판을 유지하지만, 표제·면주·쪽번호가 상하 반전되어 배치된다. 페이지를 거꾸로 돌려 읽게 하는 장치가 반복되며, 조용한 본문 구조 안에 개념적 불안정성을 삽입한다.",summary:"노련한 공연예술 기획자가 무용의 새로운 방향을 상상하는 글을 엮은 책. 위아래로 뒤집힌 표제, 면주, 쪽번호를 통해 근본을 다시 숙고한다는 개념을 물리적으로 시연하며, 독자에게 책을 뒤집어 보게 만드는 읽기 행위를 설계한다.",why_dim:"소형 판형으로 이론적 에세이와 사유 중심의 장문 독서를 집중도 높게 유지하고, 손에 쥐고 실제로 뒤집어 보는 물리적 행위를 유도하기 위한 선택",why_margin:"균일한 좌우 여백 위에 하단 여백을 약간 넓혀 쪽번호와 본문의 호흡을 안정시키고, 뒤집힌 면주와 표제가 빈 공간 속에서 개념적 장치로 선명하게 드러나도록 설계",why_font:"본문에는 장문 가독성을 위한 명조 계열을 사용하고, 뒤집힌 제목과 면주에는 안상수체의 강한 조형성을 적용해 책의 개념적 전환과 안무적 사고를 시각적으로 강조",why_tracking:"장문 이론 텍스트의 안정적 가독성을 유지하면서, 반전 배치된 제목과 면주가 별도의 시각적 층위로 읽히도록 과도한 자간 조정을 피한 설정",layout_type:"본문 1단 + 주석 하단에 1단"},
  {g:"문학",pub_type:"단행본",t:"재료: 언어—김뉘연과 전용완의 문학과 비문학",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/material-language-kr/",img:"054_재료- 언어—김뉘연과 전용완의 문학과 비문학",kw:["문학","단행본","재료:","언어","김뉘연과","전용완의","문학과","비문학","본문은","단일","컬럼","인터뷰","조판을","기본으로","MT","그로테스크"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:120,h:180},m:{상:17,하:35,안:18,밖:22},c:{구성:"1단",간격:0},b:{크기:9.5,행간:15,자간:0},ty:{이름:"MT 그로테스크 / 지백",분류:"고딕"},pn:"하단-외측-가로",pn_x_left:"8mm",pn_y_left:"167mm",pn_x_right:"109.6mm",pn_y_right:"167mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"9.5pt",subheading:"9.5pt",footnote:"8pt",특:"본문은 단일 컬럼 인터뷰 조판을 기본으로 하고, 세로 면주와 상단 정보 블록이 반복된다. 형광 주황 표지와 절제된 흑색 타이포그래피가 시리즈 정체성을 형성하며, 내지에서는 도판과 캡션이 넓은 여백 안에 배치되어 텍스트와 사물의 관계를 드러낸다.",summary:"작업실유령의 비평 시리즈 ‘유령작업실’ 첫 책. 편집자 김뉘연과 디자이너 전용완의 협업을 통해 문학, 디자인, 다원 예술이 만나는 지점을 인터뷰와 비평으로 탐구하며, 언어가 지면을 넘어 시간·공간·신체로 확장되는 과정을 다룬다.",why_dim:"소형 판형으로 인터뷰와 비평 텍스트를 친밀하고 응축된 밀도로 전달하고, 비평 시리즈의 휴대성과 독립 출판물의 물성을 함께 확보하기 위한 선택",why_margin:"균일한 좌우 여백과 다소 넓은 하단 여백을 통해 인터뷰 본문, 세로 면주, 도판 페이지의 호흡을 분리하고, 비평 시리즈 특유의 정제된 긴장감을 유지",why_font:"인터뷰 본문과 보조 정보에는 중립적 고딕을 사용해 대화의 선명도와 편집적 구조를 확보하고, 장문 읽기와 비평적 밀도를 위해 명조 계열을 병용해 문학과 디자인 사이의 긴장을 조절",why_tracking:"인터뷰 중심의 장문 독서 가독성을 우선하면서, 세로 면주와 상단 정보 블록, 도판 캡션의 위계를 미세하게 정리하기 위한 설정",layout_type:"본문 1단"},
  {g:"그래픽디자인",pub_type:"전시도록",t:"다른 곳",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/elsewhere-brochure-kr/",img:"055_다른 곳",kw:["그래픽디자인","전시도록","다른","곳","표지는","청록색","바탕","위에","자주색","그림자와","신명조"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:185,h:245},m:{상:7,하:15,안:10,밖:10},c:{구성:"2단",간격:5},b:{크기:9,행간:14,자간:0},ty:{이름:"SM 신명조 / 코르모란트 / 파보리트 한글",분류:"고딕"},pn:"하단-외측-가로",pn_x_left:"15mm",pn_y_left:"234.6mm",pn_x_right:"168.4mm",pn_y_right:"234.6mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"9pt",footnote:"9pt",특:"표지는 청록색 바탕 위에 자주색 그림자와 함께 제목과 작가명을 블록처럼 분절 배치하고, 내지에서는 장문 해설, 전시장 전경 사진, 작품 목록, 선형 다이어그램을 넓은 빈 공간 안에 흩어 놓는다. 세로 캡션과 최소한의 규칙선이 반복되어 시리즈 전체를 묶는 브랜딩 장치로 작동한다.",summary:"아뜰리에 에르메스 전시를 위해 제작된 소형 도록 겸 브로슈어. 개별 전시를 강조하기보다 간단한 시각 제스처로 서로 다른 프로젝트를 느슨하게 연결하며, 미술 기관 그래픽 디자인의 과잉에 대한 절제된 대안을 제시한다. 청록색 바탕과 분절된 제목 블록, 선형 다이어그램과 도판 배치가 전시 안내와 도록 기능을 함께 수행한다.",why_dim:"전시 도록과 브로슈어의 중간 규모로, 짧은 해설 텍스트와 작품 목록, 도판, 다이어그램형 안내 페이지를 함께 수용하면서도 가벼운 배포물의 성격을 유지하기 위한 판형",why_margin:"넓은 여백과 절제된 규칙선, 드문드문 배치된 도판과 텍스트를 통해 기관 그래픽의 과잉을 누그러뜨리고, 강한 색면이 페이지 구조를 하나의 브랜딩 장치로 작동하게 함",why_font:"본문과 해설에는 명조 계열을 사용해 전시 텍스트의 품위를 유지하고, 표지와 제목의 분절된 조형에는 디스플레이 성격의 서체를 적용해 절제된 브랜딩 효과를 만든다. 국문 보조 정보에는 고딕을 섞어 정보 전달을 명확히 한다.",why_tracking:"여백이 큰 지면에서 텍스트가 지나치게 흩어지지 않도록 기본 자간은 중립적으로 유지하고, 표지 제목과 짧은 정보 블록에서는 약한 확장으로 개별 덩어리감을 형성",layout_type:"본문 2단 "},
  {g:"문학",pub_type:"전시도록",t:"부재자, 참석자, 초청자",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/absentee-attendee-invitee-kr/",img:"056_부재자, 참석자, 초청자",kw:["문학","전시도록","부재자","참석자","초청자","본문은","단일","컬럼을","기본으로","하되","들여짜기와","게르스트너","프로그람"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:170,h:240},m:{상:7,하:10,안:8,밖:8},c:{구성:"8단",간격:4},b:{크기:9,행간:14,자간:0},ty:{이름:"게르스트너 프로그람 / 산돌 고딕네오",분류:"고딕"},pn:"하단-우측-가로",pn_x_left:"156mm",pn_y_left:"226.9mm",pn_x_right:"156mm",pn_y_right:"226.9mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"9pt",footnote:"7pt",특:"본문은 단일 컬럼을 기본으로 하되, 들여짜기와 위치 이동으로 화자·정보 층위를 나눈다. 악보와 다이어그램, 조명·동선 도표, 비디오 스틸이 별도의 판면 규칙으로 삽입되며, 쪽번호는 고정 위치를 벗어나 요소 배열에 따라 가변적으로 이동한다. 덧표지는 작품 구조를 설명하는 다이어그램 자체를 전면에 제시한다.",summary:"‘듣기 어려운 소리, 혹은 나지 않는 소리로 음악을 만들 수 있을까?’라는 질문에서 출발한 오민의 책. 에세이, 악보, 도표, 협업자들과의 대담, 전시에 제시된 비디오·퍼포먼스 기록을 함께 수록하며, 소리와 음악, 연주와 청취, 시간과 공간의 관계를 탐구한다. 퍼포머들이 공간 요소를 재배열하는 작업 방식이 쪽번호와 요소 배치에 반영된다.",why_dim:"에세이, 악보, 도표, 대담, 전시 기록 사진을 함께 수용하면서도 공연예술 기록물 특유의 구조적 복잡성을 충분히 전개하기 위한 중형 판형",why_margin:"복잡한 정보 층위를 담기 위해 넉넉한 여백을 확보하고, 쪽번호와 캡션, 도표 요소가 페이지마다 다른 위치로 이동할 수 있는 유연한 공간을 마련",why_font:"도표·악보·대담·에세이가 공존하는 복합 구조를 명확하게 구분하기 위해 시스템적이고 중립적인 고딕 계열을 사용해 정보성과 공연예술 기록물의 구조적 성격을 강조",why_tracking:"장문 텍스트의 판독성을 유지하면서도 들여짜기와 가변 요소, 악보·도표 페이지의 정보 밀도를 무리 없이 수용하기 위한 보수적 설정",layout_type:"본문 4단 + 주석 2단 + 실험적 1단"},
  {g:"현대미술",pub_type:"전시도록",t:"남화연—마음의 흐름",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/mind-stream-catalog-kr/",img:"057_남화연—마음의 흐름",kw:["현대미술","전시도록","남화연","마음의","흐름","표지는","서로","다른","높이로","재단된","덧표지","LTR","베어울프"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:150,h:215},m:{상:5,하:7,안:13,밖:8},c:{구성:"2단",간격:5},b:{크기:8.5,행간:14,자간:0},ty:{이름:"LTR 베어울프 / 베누스 / 산돌 고딕네오 / 평균",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"중앙-우측-세로",pn_x_left:"139.6mm",pn_y_left:"105.2mm",pn_x_right:"144.3mm",pn_y_right:"105.2mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 세로 / 숫자",running:"-",subheading:"13pt",footnote:"6.5pt",특:"표지는 서로 다른 높이로 재단된 덧표지·띠지·본표지가 겹쳐져 각기 다른 시간층의 이미지를 부분적으로 노출한다. 본문은 단일 컬럼 장문 조판을 기본으로 하되, 최승희 관련 텍스트 구획은 상하 반전되어 별도의 시간축처럼 읽히며, 도판과 영상 스틸, 캡션이 차분한 여백 속에 배치된다.",summary:"남화연의 동명 개인전을 기록하는 도록. 최승희의 생애와 작업을 매개로 시간과 역사 관념을 탐구하는 전시의 구조를 반영해, 서로 다른 시간층을 세 겹의 표지 요소와 반전된 본문 구획으로 시각화한다. 최승희 관련 텍스트는 판면을 상하 반전해 다른 시간축으로 읽히도록 설계되었다.",why_dim:"개인전 도록으로서 텍스트, 전시 전경, 역사 자료, 다이어그램을 함께 수용하면서도 세 겹의 표지 구조와 반전된 본문 실험을 물리적으로 구현하기 위한 중형 판형",why_margin:"여러 겹의 표지와 반전된 본문 구획이 숨 쉴 수 있도록 넉넉한 여백을 유지하고, 하단 여백을 통해 쪽번호와 캡션, 반전 지면의 회전 축을 안정적으로 확보",why_font:"본문과 역사 텍스트에는 시간의 층위와 전시 해설의 밀도를 담아낼 수 있는 명조 계열을 사용하고, 표지의 구조적 요소와 보조 정보에는 고딕 및 디스플레이 성격의 서체를 혼용해 시간축의 분리와 전시 도록의 현대적 감각을 함께 드러냄",why_tracking:"장문 독서의 안정성을 유지하면서 반전된 지면과 표지 구조, 캡션과 보조 정보의 위계를 무리 없이 조절하기 위한 보수적 설정",layout_type:"본문 2단 "},
  {g:"건축·공간",pub_type:"잡지·저널",t:"계간 시청각 4호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/avp-quarterly-4-kr/",img:"058_계간 시청각 4호",kw:["건축·공간","잡지·저널","계간","시청각","4호","표지와","차례에서","제목","일부를","삼각형","로고로","태고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"-",f:{w:126,h:204},m:{상:9,하:24,안:14,밖:11},c:{구성:"1단",간격:0},b:{크기:11,행간:17,자간:0},ty:{이름:"SM 태고딕 / 메종 노이에",분류:"고딕"},pn:"하단-우측-가로",pn_x_left:"104mm",pn_y_left:"191.5mm",pn_x_right:"110.8mm",pn_y_right:"191.5mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"-",footnote:"-",특:"표지와 차례에서 제목 일부를 삼각형 로고로 대체하고, 본문과 목록에도 아이콘이 반복 삽입된다. 기본은 단일 컬럼 장문 조판이지만, 특정 글에서는 기울임을 회전 활자로 번역해 판면의 방향 감각을 흔든다.",summary:"미술 공간 시청각에서 창간하고 출간한 미술 평론지 4호. 공간의 로고인 삼각형 세 개로 표제의 핵심 부분 ‘시청각’을 대체하고, 목록과 본문 곳곳에서도 텍스트 대신 아이콘을 사용해 저널의 시각 언어를 구축한다. 김희천의 글에서는 기계적으로 기울어진 사체를 회전된 활자로 번역해 지면의 읽기 방식을 교란한다.",why_dim:"비평지의 장문 독서와 실험적 타이포그래피를 병행하면서도 휴대 가능한 저널 판형을 유지하기 위한 선택",why_margin:"단순한 저널 구조 안에서 아이콘 대체, 회전 활자, 목록 구조를 수용하기 위해 균일한 여백을 유지하고, 하단 여백으로 쪽번호와 판면 리듬을 안정화",why_font:"비평지의 중립적이고 명확한 정보 전달을 위해 고딕 계열을 사용하고, 로고형 삼각 아이콘과 기호 시스템이 저널의 시각적 정체성을 형성하도록 절제된 산세리프 조합을 유지",why_tracking:"장문 비평 텍스트의 안정적 가독성을 우선하면서, 아이콘 대체와 회전 활자 같은 국소적 실험이 과도한 시각 개입으로 보이지 않도록 중립 자간 유지",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"단행본",t:"현대 타이포그래피—비판적 역사 에세이, 개정판",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/modern-typography-2-kr/",img:"059_현대 타이포그래피—비판적 역사 에세이, 개정판",kw:["인문·사회","단행본","현대","타이포그래피","비판적","역사","에세이","개정판","본문은","단일","컬럼","장문","조판을","기본으로","AG","최정호체"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:135,h:216},m:{상:17,하:33,안:15,밖:18},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:20},ty:{이름:"AG 최정호체 / 프로포르마",분류:"명조"},pn:"좌하단, 우상단-외측-가로",pn_x_left:"22.8mm",pn_y_left:"198mm",pn_x_right:"107.15mm",pn_y_right:"9.1mm",pn_size:"8pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"14pt",footnote:"8pt",특:"본문은 단일 컬럼 장문 조판을 기본으로 하고, 도판과 캡션, 참고 문헌이 넓은 여백 속에 삽입된다. 표지는 노란 색면 위에 18세기 동판 도판을 강하게 크롭해 배치하고, 내지에서는 드문 사료 이미지와 회전 캡션, 주석이 차분하게 정리된다.",summary:"로빈 킨로스의 타이포그래피 역사서를 한국어로 개정 출간한 번역서. 1700년 이후 서구 타이포그래피 역사를 기술·사회·물질 조건과 함께 비판적으로 읽어내며, 드물게 접하는 사료 도판과 촘촘한 주석·참고 자료로 논지를 보강한다. 2판에서는 영어 개정판 구조를 느슨히 따르되, 노란 표지와 사체 동판 도판을 통해 초판의 반항적 에너지를 새로 호출한다.",why_dim:"장문 역사 서술과 도판, 주석, 참고 자료를 안정적으로 수용하면서도 연구서와 번역서의 밀도 높은 독서를 지속할 수 있는 중형 판형",why_margin:"본문과 도판, 주석이 공존하는 학술적 지면 구조를 안정화하기 위해 하단 여백을 넓히고, 좌우 여백을 균형 있게 유지해 장문 읽기와 도판 감상을 동시에 지지",why_font:"본문에는 장문 읽기와 역사 서술의 안정성을 위한 명조 계열을 사용하고, 보조 정보와 일부 구조 요소에는 고딕 계열을 사용해 연구서의 공적 톤과 현대적 비평 감각을 균형 있게 유지",why_tracking:"장문 번역 텍스트의 판독성을 우선하면서, 주석·캡션·도판 설명의 구조를 본문과 무리 없이 분리하기 위한 보수적 설정",layout_type:"본문 1단"},
  {g:"현대미술",pub_type:"전시도록",t:"연대의 홀씨",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/solidarity-spores-catalog-kr/",img:"060_연대의 홀씨",kw:["현대미술","전시도록","연대의","홀씨","장문","해설은","1단으로","안정적으로","조판되고","전시","된고딕","고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:185,h:245},m:{상:8,하:13,안:7,밖:18},c:{구성:"4단",간격:4},b:{크기:9,행간:14,자간:0},ty:{이름:"된고딕 / 벨 고딕 / 인문고딕 / 장뤼크",분류:"고딕"},pn:"중앙-좌측-세로",pn_x_left:"6.7mm",pn_y_left:"124mm",pn_x_right:"6.7mm",pn_y_right:"124mm",pn_size:"17pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"18pt",footnote:"7.5pt",특:"장문 해설은 1단으로 안정적으로 조판되고, 전시 전경과 작품 도판은 큰 이미지 블록으로 배치된다. 표지와 섹션 오프너에는 선화 처리된 역사 사진과 이중 색상 제목이 결합되며, 작가 소개 면에서는 좌측 텍스트·우측 전면 이미지 구성이 반복된다.",summary:"비동맹 운동의 역사를 되돌아보며 아시아 동시대 예술 맥락에서 독립과 연대의 정신을 다시 성찰한 전시 도록. 표지와 섹션 표제지는 반둥 회의 사진을 중간 계조를 삭제한 선화 이미지로 변환해 사용하고, 대비되는 색 덩어리와 이중 색상 타이포그래피를 통해 역사 이미지의 재독해를 유도한다.",why_dim:"대형 역사 자료와 전시 전경, 작품 도판, 장문 해설을 함께 수용하면서도 기관 전시 도록으로서 안정적 비례와 공공적 위계를 유지하기 위한 중형 판형",why_margin:"도판과 장문 해설, 작가 정보가 공존하는 구조를 안정화하기 위해 균형 여백을 유지하고, 하단 여백으로 쪽번호·캡션·도판 설명의 리듬을 정리",why_font:"역사 자료, 작품 설명, 작가 소개를 명확하게 조직하기 위해 다양한 고딕 계열을 사용하고, 이중 색상 제목과 선화 이미지의 대비를 통해 전시의 정치적·역사적 긴장을 시각적으로 강화",why_tracking:"장문 해설의 판독성을 유지하면서도 역사 자료 캡션과 작가 정보, 표제 타이포의 위계를 무리 없이 분리하기 위한 중립 자간 설정",layout_type:"본문 2단 + 주석 4단"},
  {g:"그래픽디자인",pub_type:"전시도록",t:"전소정—새로운 상점",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/au-magasin-de-nouveautes-brochure-kr/",img:"061_전소정—새로운 상점",kw:["그래픽디자인","전시도록","전소정","새로운","상점","표지는","청색","바탕","위에","형광","적색","신명조"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:185,h:245},m:{상:7,하:15,안:8,밖:10},c:{구성:"4단",간격:3},b:{크기:9,행간:14,자간:0},ty:{이름:"SM 신명조 / 코르모란트 / 파보리트 한글",분류:"고딕"},pn:"하단-외측-가로",pn_x_left:"19.8mm",pn_y_left:"237.4mm",pn_x_right:"166.5mm",pn_y_right:"237.4mm",pn_size:"12pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"14pt",footnote:"7pt",특:"표지는 청색 바탕 위에 형광 적색 제목과 영문을 블록처럼 분절 배치하고, 내지에서는 인터뷰, 장문 해설, 전시장 전경 사진, 작품 목록, 선형 다이어그램을 넓은 빈 공간 안에 흩어 놓는다. 세로 캡션과 최소한의 규칙선이 반복되어 시리즈 전체를 묶는 브랜딩 장치로 작동한다.",summary:"아뜰리에 에르메스 전시를 위해 제작된 소형 도록 겸 브로슈어. 개별 전시를 강조하기보다 간단한 시각 제스처로 서로 다른 프로젝트를 느슨하게 연결하며, 미술 기관 그래픽 디자인의 과잉에 대한 절제된 대안을 제시한다. 강한 청색 바탕과 형광 적색 제목 블록, 선형 다이어그램과 도판 배치가 전시 안내와 도록 기능을 함께 수행한다.",why_dim:"전시 도록과 브로슈어의 중간 규모로, 짧은 해설 텍스트와 작품 목록, 도판, 다이어그램형 안내 페이지를 함께 수용하면서도 가벼운 배포물의 성격을 유지하기 위한 판형",why_margin:"넓은 여백과 절제된 규칙선, 드문드문 배치된 도판과 텍스트를 통해 기관 그래픽의 과잉을 누그러뜨리고, 강한 색면 대비가 페이지 구조 전체를 하나의 브랜딩 장치로 작동하게 함",why_font:"본문과 해설에는 고딕 계열을 사용해 전시 텍스트의 품위를 유지하고, 표지와 제목의 분절된 조형에는 디스플레이 성격의 서체를 적용해 절제된 브랜딩 효과를 만든다. 국문 보조 정보에는 고딕을 섞어 정보 전달을 명확히 한다.",why_tracking:"여백이 큰 지면에서 텍스트가 지나치게 흩어지지 않도록 기본 자간은 중립적으로 유지하고, 표지 제목과 짧은 정보 블록에서는 약한 확장으로 개별 덩어리감을 형성",layout_type:"본문 2단 + 주석 4단"},
  {g:"문학",pub_type:"단행본",t:"디자이너란 무엇인가 3판",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/what-is-a-designer-3rd-edition-kr/",img:"062_디자이너란 무엇인가 3판",kw:["문학","단행본","디자이너란","무엇인가","3판","본문은","단일","컬럼","장문","조판을","기본으로","AG","최정호체"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:130,h:207},m:{상:11,하:24,안:17,밖:15},c:{구성:"1단",간격:0},b:{크기:9.5,행간:17,자간:0},ty:{이름:"AG 최정호체 / 어도비 캐즐런",분류:"명조"},pn:"하단-외측-가로",pn_x_left:"20.8mm",pn_y_left:"189mm",pn_x_right:"105.6mm",pn_y_right:"189mm",pn_size:"8pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"14pt",footnote:"7.5pt",특:"본문은 단일 컬럼 장문 조판을 기본으로 하고, 일부 면에서는 판면 전체를 회전하거나 상하 반전시켜 사고의 전환을 시각화한다. 표지는 첫 한국어판의 흰색 바탕을 복원해 고전의 지속성을 강조하고, 별도 책갈피는 본책과 다른 색면과 조판 규칙으로 독립된 부속물처럼 작동한다.",summary:"노먼 포터의 1969년 고전을 세 번째로 개정한 한국어판. 2008년 첫 한국어판의 흰색 표지 디자인을 되살리면서, 디자인의 범위와 태도를 비판적으로 묻는 장문 에세이를 다시 현재화한다. 원서 20주년을 기념해 번역한 ‘직설주의 운동 수칙’ 책갈피를 별도로 삽입해 출판물의 역사성을 물리적으로 확장한다.",why_dim:"장문 이론 텍스트와 삽입 책갈피를 함께 수용하면서도 고전 번역서의 단정한 비례와 지속적 독서감을 유지하기 위한 중형 판형",why_margin:"단정한 좌우 여백과 다소 넓은 하단 여백을 유지해 장문 비평 텍스트의 독서 안정성을 확보하고, 별도 삽입된 책갈피와 판면 변주가 과잉 없이 드러나도록 조절",why_font:"장문 고전 번역 텍스트의 안정적 독서를 위해 명조 계열을 중심으로 사용하고, 구조적 보조 정보와 판면 변주에는 절제된 고딕적 성격을 보완적으로 활용해 역사성과 현대적 비평 감각을 함께 유지",why_tracking:"장문 독서의 판독성을 우선하면서도 회전·반전된 판면과 부속 책갈피의 구조를 본문과 무리 없이 구분하기 위한 보수적 설정",layout_type:"본문 1단"},
  {g:"문학",pub_type:"단행본",t:"그래프, 지도, 나무—문학사를 위한 추상적 모델",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/graphs-maps-trees-kr/",img:"063_그래프, 지도, 나무—문학사를 위한 추상적 모델",kw:["문학","단행본","그래프","지도","나무","문학사를","위한","추상적","모델","본문은","단일","컬럼","장문","조판을","기본으로","신신명조"],align_title:"-",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:138,h:222},m:{상:21,하:36,안:21,밖:24},c:{구성:"1단",간격:0},b:{크기:9.5,행간:16,자간:0},ty:{이름:"SM 신신명조 / 벤턴 산스 / 산돌 고딕네오 / 어도비 캐즐런 / 윤명조 / 캐즐런 540",분류:"혼합 (명조 / 고딕)"},pn:"상단-우측-가로",pn_x_left:null,pn_y_left:null,pn_x_right:"227.8mm",pn_y_right:"11.8mm",pn_size:"9.5pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"7pt",특:"본문은 단일 컬럼 장문 조판을 기본으로 하고, 그래프·계보도·지도형 도판이 삽입된다. 표지는 큰 비대칭 덧표지가 일부 표면을 덮고 노출하며, 접힌 각도에 따라 책마다 다른 실루엣을 만든다. 타이포그래피와 도형은 주제에 맞춰 구조적으로 변형되며 시리즈 정체성을 유지한다.",summary:"프랑코 모레티의 문학 이론서를 번역한 인문 라이브러리 시리즈 도서. 문학사를 그래프, 지도, 나무 같은 추상적 모델로 읽어내는 책의 주제를 반영해, 표지 일부를 드러내는 비대칭 덧표지와 구조적 도형, 계보도형 도판을 통해 시리즈 정체성과 개별 책의 개념을 함께 시각화한다.",why_dim:"장문 이론 텍스트와 도표, 계보도, 도판을 안정적으로 수용하면서도 인문 라이브러리 시리즈의 통일된 물성과 덧표지 구조를 구현하기 위한 중형 판형",why_margin:"도표와 장문 본문, 접힌 덧표지의 비대칭 구조가 함께 호흡할 수 있도록 하단 여백을 넓히고, 좌우 여백을 균형 있게 유지해 이론서의 안정성과 오브젝트성을 동시에 확보",why_font:"장문 이론 본문에는 명조 계열을 사용해 읽기의 안정성과 학술적 톤을 확보하고, 구조적 보조 정보와 시리즈 요소에는 고딕 계열을 병용해 도표·표지·오버레이 구조의 현대적 질서를 분명하게 드러냄",why_tracking:"장문 번역 텍스트의 판독성을 우선하면서도 도표·캡션·구조적 요소와 본문을 무리 없이 분리하기 위한 보수적 설정",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"국립현대미술관 연구 11집",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/mmca-studies-11-kr/",img:"064_국립현대미술관 연구 11집",kw:["아트이론·비평","잡지·저널","국립현대미술관","연구","11집","좌우","페이지를","영문과","국문으로","대응시키며","표지와","A2","인디펜던트"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:185,h:260},m:{상:10,하:30,안:13,밖:15},c:{구성:"4단",간격:3},b:{크기:10,행간:17,자간:0},ty:{이름:"A2 인디펜던트 텍스트 / 노토 산스 / 본고딕 / 바른바탕체 / 아틀라스 그로테스크",분류:"혼합 (명조 / 고딕)"},pn:"하단-중앙-가로",pn_x_left:"84.1mm",pn_y_left:"234mm",pn_x_right:"86.3mm",pn_y_right:"234mm",pn_size:"7.5pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"16pt",footnote:"7.5pt",특:"좌우 페이지를 영문과 국문으로 대응시키며, 표지와 섹션 오프너에는 십자형 규칙선 프레임이 반복된다. 본문은 단일 컬럼 장문 조판을 기본으로 하고, 도판 페이지는 이미지와 캡션, 필자명을 하단에 분리 배치해 학술 저널과 전시 도록의 성격을 동시에 유지한다.",summary:"국립현대미술관의 연구 총서 11집. ‘초국가적 미술관’을 주제로 동시대 미술관의 탈식민주의, 코스모폴리터니즘, 수장고와 제도적 전환 등을 다루는 한영 병렬 학술 출판물이다. 표지의 균열 난 벽면 사진과 확대경 이미지, 내부의 십자형 규칙선 구조가 제도 비판과 연구의 긴장을 시각화한다.",why_dim:"한영 병렬 장문 텍스트와 도판, 각주, 기관 정보 페이지를 안정적으로 수용하면서도 공공 기관 연구 총서의 단정한 비례를 확보하는 중대형 판형",why_margin:"하단 여백을 확장해 쪽번호·필자명·캡션을 안정적으로 배치하고, 본문 주위의 넓은 여백과 규칙선을 통해 학술지의 질서와 제도 비판적 긴장을 동시에 유지",why_font:"장문 본문에는 안정적인 명조 계열을 사용해 학술적 가독성을 확보하고, 표지·러닝헤드·섹션 제목과 보조 정보에는 중립적 고딕을 적용해 기관 저널의 공공성, 현대성, 정보 위계를 명확히 드러냄",why_tracking:"이중언어 장문 독서에서 판독성을 우선하면서, 섹션 제목과 러닝헤드, 캡션 정보의 구조를 미세하게 정리하기 위한 설정",layout_type:"본문 3단 + 주석 1단 + 정보 4단"},
  {g:"인문·사회",pub_type:"전시도록",t:"그녀의 이름은",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/her-name-is-catalog-kr/",img:"065_그녀의 이름은",kw:["인문·사회","전시도록","그녀의","이름은","표지와","섹션","면에서는","칸과","찢긴","모서리","AG","초특태고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:125,h:180},m:{상:9,하:17,안:11,밖:13},c:{구성:"2단",간격:7},b:{크기:10,행간:15,자간:0},ty:{이름:"AG 초특태고딕 / HY 타자전각 / 모노타이프 타이프라이터 / 파운더스 그로테스크 모노",분류:"혼합 (고딕 / 디스플레이)"},pn:"하단-중앙-가로",pn_x_left:"60.5mm",pn_y_left:"167.3mm",pn_x_right:"60.5mm",pn_y_right:"167.3mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"10pt",footnote:"7.5pt",특:"표지와 섹션 면에서는 빈 칸과 찢긴 모서리, 지도 이미지가 강한 아이덴티티를 형성하고, 내지에서는 단일 컬럼 장문 조판 위에 사진·일기·신문 스크랩·문서 자료가 차분하게 배치된다. 타자기 계열 서체와 모노 활자가 문서적 분위기를 강화하며, 일부 도판은 자료의 물성을 살리기 위해 넓은 여백 속에 독립적으로 배치된다.",summary:"방글라데시 근현대사에서 민주주의, 인권, 평화를 위해 여성들이 벌인 투쟁을 조명한 전시 도록. 제목 뒤의 말줄임표를 빈 칸으로 치환한 그래픽 아이덴티티와, 찢어진 종이처럼 처리된 사각형 모서리, 동아시아 지도 이미지를 통해 아카이브 자료의 성격과 전시의 지리적·정치적 맥락을 시각화한다. 표지에서는 이 빈 칸이 문서처럼 반전되어 보이며, 내지의 타자기체가 그 인상을 강화한다.",why_dim:"아카이브 자료, 장문 해설, 사진·문서 도판을 응축해 수용하면서도 역사 기록물 특유의 친밀한 독서감과 휴대성을 유지하기 위한 소형 판형",why_margin:"문서 자료와 장문 본문, 캡션을 작은 판형 안에서 명확히 분리하기 위해 균일한 여백을 유지하고, 하단 여백을 통해 쪽번호와 도판 출처 정보의 리듬을 안정화",why_font:"제목과 섹션 표지에는 강한 고딕 계열을 사용해 전시의 정치적 긴장과 명확한 위계를 확보하고, 내지의 자료 설명과 문서 재현에는 타자기·모노 계열을 사용해 아카이브의 문서성과 기록 매체의 물성을 시각적으로 강화",why_tracking:"장문 해설의 판독성을 유지하면서도 문서 도판 캡션과 자료 출처, 모노 계열 보조 정보의 구조를 무리 없이 분리하기 위한 보수적 설정",layout_type:"본문 1단 + 주석2단"},
  {g:"시각문화·매체",pub_type:"잡지·저널",t:"레인보 셔벗",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/rainbow-sherbet-kr/",img:"066_레인보 셔벗",kw:["시각문화·매체","잡지·저널","레인보","셔벗","기본은","장문","조판이며","리뷰","인터뷰","신신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:120,h:189},m:{상:17,하:18,안:15,밖:15},c:{구성:"1단",간격:0},b:{크기:9.5,행간:17,자간:0},ty:{이름:"SM 신신명조 / 시몬치니 개러몬드 / 타임스 블랭크",분류:"명조"},pn:"상단-외측-가로 / 하단-중앙-가로",pn_x_left:"14.9mm",pn_y_left:"8.8mm",pn_x_right:"58mm",pn_y_right:"173.9mm",pn_size:"9pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"13pt",footnote:"8pt",특:"기본은 1단 장문 조판이며, 리뷰·인터뷰·에세이 면은 안정적인 단일 컬럼을 유지한다. 1장과 후반부에는 썸네일 이미지가 격자 패턴과 확대 이미지 시퀀스로 반복되고, 일부 면에서는 좌우 페이지 역할을 비대칭적으로 분리한다. 각주는 다층 번호 구조로 삽입되고, 전시 전경과 제품 프리뷰 이미지가 본문 중간에 독립 블록으로 개입한다.",summary:"민구홍 매뉴팩처링을 다층적으로 소개하는 전시 연계 출판물. 사용자 리뷰, 제품 프리뷰, 전시 전경, 인터뷰, 참고 도판, 다층 각주를 교차 배치하며, 자기반영적 기업 서사를 책의 구조 자체로 확장한다.",why_dim:"페이퍼백 소설을 연상시키는 소형 판형으로, 전시 연계 출판물이면서도 픽션처럼 휴대·독서되도록 유도하고, 표지 인물 이미지를 평균 얼굴 크기에 맞춰 배치해 책을 가면처럼 읽히게 한다.",why_margin:"상단 정보와 하단 쪽번호·각주를 분리하면서도 작은 판형 안에서 텍스트 밀도와 이미지 삽입을 안정적으로 수용하기 위한 여백. 하단 여백을 약간 넓혀 본문 리듬과 각주 구조를 지지한다.",why_font:"본문과 장문 리뷰, 인터뷰에는 문학적이고 비평적인 독서감을 유지하는 명조 계열을 사용하고, 표지 제목과 문구에는 모든 글리프가 공백으로 처리된 타임스 블랭크를 적용해 민구홍 매뉴팩처링의 자기반영성과 부재의 개념을 시각화한다.",why_tracking:"장문 서사와 인터뷰, 각주가 혼합된 작은 판형에서 판독성을 우선하면서도, 제목과 표지 문구에는 약한 확장을 통해 기묘한 여백감과 개념적 거리감을 부여한다.",layout_type:"본문 1단"},
  {g:"건축·공간",pub_type:"전시도록",t:"세트 피스",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/set-piece-catalog-kr/",img:"067_세트 피스",kw:["건축·공간","전시도록","세트","피스","본문은","병렬에","가까운","텍스트","블록으로","노이에","하스"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:210,h:297},m:{상:5,하:14,안:5,밖:5},c:{구성:"2단",간격:5},b:{크기:9,행간:14,자간:0},ty:{이름:"노이에 하스 그로테스크 / 산돌 고딕네오",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"103mm",pn_y_left:"286.9mm",pn_x_right:"103mm",pn_y_right:"286.9mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"9pt",footnote:"9pt",특:"본문은 한·영 병렬에 가까운 1단 텍스트 블록으로 안정적으로 조판되고, 설치 전경 사진은 두 페이지 단위로 크게 배치된다. 특정 도판은 페이지 순서상 떨어져 있어도 같은 인쇄 면에 연결되도록 설계되어 접지 구조가 이미지 배열의 규칙이 된다. 표지와 내지 사이의 종이 질감 차이가 물성 대비를 만든다.",summary:"정현의 전시를 기록한 도록. 설치 전경 사진과 텍스트를 책의 접지 구조에 맞춰 배치해, 페이지 순서와 물리적 인쇄 면의 관계 자체가 전시 동선과 조형 원리를 반영한다. 비도공 본문지와 질감 있는 표지가 전시 공간의 물성과 조응한다.",why_dim:"설치 전경 사진이 한 점당 두 페이지에 걸쳐 전개되는 구조를 수용하고, 접지 구조에 따른 이미지 배열 원리를 명확히 드러내기 위한 대형 판형. 전시 도록의 문서성과 사진 재현성을 동시에 확보한다.",why_margin:"전면 사진과 장문 텍스트가 공존하는 A4 판형에서 이미지의 확장성과 본문 안정성을 동시에 확보하기 위한 여백. 하단 여백을 약간 넓혀 쪽번호와 판면 호흡을 정리한다.",why_font:"전시 제목과 필자 정보, 본문 텍스트를 모두 중립적이고 구조적인 고딕 계열로 통일해 건축적 스케일감과 전시 도록의 문서성을 강화한다. 과장된 서체 개입 없이 사진과 접지 구조가 중심이 되도록 한다.",why_tracking:"장문 해설과 영문 병행 텍스트의 판독성을 우선하면서, 대형 표지 타이포와 본문 사이의 위계를 안정적으로 분리하기 위한 보수적 자간 설정.",layout_type:"본문 2단"},
  {g:"전시·큐레이션",pub_type:"전시도록",t:"SMSM10 / Sasa[44] 연차 보고서 2018",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/smsm10-poster-kr/",img:"068_SMSM10 - Sasa[44] 연차 보고서 2018",kw:["전시·큐레이션","전시도록","SMSM10","/","Sasa[44]","연차","보고서","2018","앞면은","초대형","제목과","로고","낙서형","드로잉만으로","AG","초특태고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:594,h:841},m:{상:18,하:18,안:17,밖:17},c:{구성:"6단",간격:7},b:{크기:12,행간:18,자간:0},ty:{이름:"AG 초특태고딕 / SM 견출고딕 / SM 신신명조 / 드루크 컨덴스드 / 류민 / 센추리 익스팬디드 / 악치덴츠 그로테스크",분류:"혼합 (고딕 / 명조 / 디스플레이)"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"11pt",subheading:"12pt",footnote:"12pt",특:"앞면은 초대형 제목과 로고, 낙서형 드로잉만으로 구성된 포스터형 단면이고, 후면은 4~5단에 가까운 조밀한 텍스트 컬럼과 작품 목록, 도식, 세로 회전 캡션이 결합된 브로슈어형 구조다. 세로 방향 제목과 뒤집힌 텍스트, 가장자리 면주, 작은 꺾은선 도해가 반복되어 포스터 뒷면을 하나의 독립 출판물처럼 작동하게 한다.",summary:"시청각에서 열린 전시 SMSM10의 포스터이자 브로슈어. 전면은 커다란 시청각 로고와 디지털 낙서형 캐리커처를 결합한 전시 포스터이고, 후면 사방 여백에는 독립 ISBN을 가진 출판물 『Sasa[44] 연차 보고서 2018』이 기생하듯 배치되어 하나의 양면 인쇄물이 전단과 출판물의 기능을 동시에 수행한다.",why_dim:"전시 포스터로서 공공 공간에서의 가시성을 확보하면서, 뒷면 가장자리와 여백에 연차 보고서 텍스트를 함께 수용하기 위한 대형 단면 확장 구조. 접지되지 않은 큰 판형 안에서 포스터와 브로슈어의 이중 기능을 동시에 수행한다.",why_margin:"앞면은 대형 타이포와 이미지가 지면을 장악하도록 여백 개입을 최소화하고, 뒷면은 사방 여백을 적극 활용해 본문, 세로 면주, 도식, 회전 텍스트를 병치한다. 큰 판형 안에서 포스터의 즉시성과 읽기용 인쇄물의 정보 밀도를 동시에 조절하기 위한 여백.",why_font:"전면 포스터의 초대형 제목에는 강한 압축감과 기념비적 스케일을 가진 고딕·디스플레이 계열을 사용하고, 후면 브로슈어 본문과 회전 텍스트, 면주에는 명조와 고딕, 확장형 로만을 혼용해 전시 그래픽의 즉시성과 출판물의 읽기 구조, 연차 보고서의 문서성을 동시에 구축한다.",why_tracking:"전면의 초대형 타이포는 압축된 자간으로 덩어리감을 극대화하고, 후면의 장문 설명과 작품 목록은 중립 자간으로 판독성을 유지한다. 세로 면주와 회전 텍스트는 약간 넓힌 자간으로 방향 전환 시 식별성을 확보한다.",layout_type:"본문 6단"},
  {g:"타이포그래피",pub_type:"단행본",t:"다이어그램처럼 글쓰기",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/diagrammatic-writing-kr/",img:"069_다이어그램처럼 글쓰기",kw:["타이포그래피","단행본","다이어그램처럼","글쓰기","기본은","텍스트를","바탕으로","하지만","문장과","AG","초특태고딕"],align_title:"좌측 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:138,h:213},m:{상:30,하:30,안:15,밖:15},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:0},ty:{이름:"AG 초특태고딕 / AG 최정호 민부리 / AG 최정호체",분류:"혼합 (고딕 / 명조 / 디스플레이)"},pn:"하단-중앙-가로",pn_x_left:"67.3mm",pn_y_left:"192mm",pn_x_right:"67.3mm",pn_y_right:"192mm",pn_size:"8pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"8.5pt",subheading:"10pt",footnote:"6pt",특:"기본은 1단 텍스트를 바탕으로 하지만, 문장과 단락이 도해처럼 분산·정렬·충돌하며 의미 관계를 시각적으로 드러낸다. 텍스트의 위치, 간격, 줄 길이, 위계 변화가 내용 해석의 일부가 되고, 노출 제본이 책의 구조적 개방성을 강조한다.",summary:"조해나 드러커의 책을 번역·디자인한 한국어판. 형식이 의미를 생산하는 방식을 본문 내용과 타이포그래피 배열 자체로 설명하며, 글과 시각적 표현이 상호 의존적으로 작동하는 구조를 통해 ‘책의 형태를 번역한다’는 개념을 실천한다.",why_dim:"이론서와 실험적 번역서의 중간 크기로, 장문 텍스트 독서에 적합하면서도 원작의 시각 배열과 타이포그래피 구조를 세밀하게 재현·변용하기 위한 판형.",why_margin:"시각적 배열이 곧 의미 생산 구조가 되므로, 여백은 단순한 빈 공간이 아니라 텍스트 블록의 관계와 긴장을 드러내는 활성 영역으로 작동한다. 하단 여백을 약간 넓혀 노출 제본 구조와 쪽번호, 판면 호흡을 정리한다.",why_font:"구조를 선명하게 드러내는 고딕과 장문 독서에 적합한 명조를 병용해, 형식과 의미의 상호 작용을 또렷하게 보여 준다. 제목과 구조 강조에는 초특태고딕의 조형성을, 본문과 해설에는 최정호 계열의 안정적 리듬을 사용해 번역과 배열의 관계를 시각화한다.",why_tracking:"장문 이론 텍스트의 판독성을 유지하면서, 다이어그램형 배열과 구조적 제목에서는 자간 확장을 통해 관계와 거리, 위계 차이를 시각적으로 드러내기 위한 설정.",layout_type:"본문 1단"},
  {g:"현대미술",pub_type:"전시도록",t:"공작인—현대 조각과 공예 사이",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/homo-faber-catalog-kr/",img:"070_공작인—현대 조각과 공예 사이",kw:["현대미술","전시도록","공작인","현대","조각과","공예","사이","1권은","작가","소개와","작가론","중심의","LT","디도"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:225,h:300},m:{상:11,하:15,안:6,밖:9},c:{구성:"4단",간격:6},b:{크기:12,행간:16,자간:0},ty:{이름:"LT 디도 / 공간 / 셉티마 / 안삼열체",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-중앙-가로",pn_x_left:"109.5mm",pn_y_left:"12mm",pn_x_right:"109.5mm",pn_y_right:"12mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"11pt",subheading:"35pt",footnote:"8pt",특:"1권은 작가 소개와 작가론 중심의 1단 텍스트 구조와 도판 병치를 유지하고, 2권은 전시 전경과 작품 컷이 전면 혹은 큰 이미지 블록으로 배치된다. 상단에는 한글/영문 면주와 쪽번호가 대칭적으로 놓이고, 표지는 재료·기법 목록을 쌓아 올린 듯한 문자 배열로 구성된다. 노출 제본이 수공예적 인상을 강화한다.",summary:"현대 조각과 공예의 경계를 다룬 전시 도록. 두 권으로 분권해 1권은 작가론, 2권은 전시 작품 중심으로 구성되며, 재료와 기법 목록으로 만든 한자 표제와 좌우 대칭 배열, 노출 제본을 통해 전시의 물성과 구축 방식을 책의 구조로 번역한다.",why_dim:"대형 판형과 분권 구조를 통해 전시 전경, 작품 도판, 작가론을 충분한 스케일로 분리·수용하고, 공예·조각의 물성과 전시장의 공간감을 넓은 이미지 면과 여백 안에서 드러내기 위한 선택.",why_margin:"대형 도판과 장문 해설, 작품 캡션을 안정적으로 분리하고, 좌우 대칭과 상단 면주 체계를 유지하기 위한 여백. 하단 여백을 약간 넓혀 쪽번호와 캡션, 노출 제본의 물성을 함께 지지한다.",why_font:"신고전주의 표제에는 디도의 조형성과 권위를 사용하고, 본문과 면주에는 구조적이고 조각적인 인상의 고딕·명조 계열을 혼용해 공예와 조각, 고전성과 구축성의 대비를 만든다. 한자 표제와 본문 활자 사이의 성격 차이가 전시 개념을 강조한다.",why_tracking:"작가론과 작품 설명의 장문 판독성을 유지하면서, 표제와 면주에서는 약한 자간 확장으로 구축적 질서와 고전적 긴장을 드러내기 위한 설정.",layout_type:"본문 2단 + 주석 4단"},
  {g:"문학",pub_type:"단행본",t:"공간의 종류들",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/especes-despaces-kr/",img:"071_공간의 종류들",kw:["문학","단행본","공간의","종류들","기본은","안정적인","조판이지만","일부","신신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:144,h:216},m:{상:21,하:35,안:24,밖:24},c:{구성:"1단",간격:0},b:{크기:9,행간:18,자간:20},ty:{이름:"SM 신신명조 / 산돌 고딕네오 / 아브니르 / 어도비 개러몬드",분류:"혼합 (명조 / 고딕)"},pn:"하단-외측-가로",pn_x_left:"12mm",pn_y_left:"134.7mm",pn_x_right:"128.4mm",pn_y_right:"134.7mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"9pt",footnote:"7pt",특:"기본은 안정적인 1단 문학 조판이지만, 일부 면에서는 단어와 문장이 위·아래·좌·우로 이동하거나 대각선처럼 흩어져 페이지 안의 공간 감각을 드러낸다. 표지는 격자·패턴·지형도 같은 구획으로 초상을 분절해 시리즈 표지 시스템 안에서 개별 책의 개념을 강조한다.",summary:"조르주 페렉이 작은 지면에서 방, 건물, 도시, 나라, 대륙까지 자신을 둘러싼 공간을 단계적으로 음미하는 산문집. 표지의 초상은 지도를 연상시키는 구획 패턴으로 분절되어 내용의 공간 분류 방식을 시각화하고, 내지는 장문 산문 조판 안에 위치 이동과 분산 배열을 삽입해 공간 감각을 텍스트 구조로 번역한다.",why_dim:"문학동네 조르주 페렉 시리즈의 통일된 중형 판형으로, 장문 산문 독서의 안정성을 유지하면서도 페이지 안에서 공간적 이동과 배열 변주를 수용하기 위한 선택.",why_margin:"장문 산문과 페이지 내 위치 이동이 공존하는 구조를 안정적으로 수용하기 위한 균형 여백. 하단 여백을 넓혀 쪽번호와 본문 리듬을 정리하고, 여백 자체가 공간적 사유의 빈 장으로 작동하도록 한다.",why_font:"본문에는 장문 독서에 적합한 명조 계열을 사용해 문학적 리듬과 안정성을 확보하고, 표지와 보조 정보에는 고딕을 섞어 시리즈의 현대적 구조감과 지도 같은 분절 이미지를 또렷하게 만든다.",why_tracking:"기본 산문 조판의 판독성을 유지하면서, 페이지 내 분산 배열 면에서는 낱말 간의 간격과 위치 차이를 선명하게 드러내기 위해 약한 자간 확장을 병용한다.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"전시도록",t:"구동희—딜리버리",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/delivery-catalog-kr/",img:"072_구동희—딜리버리",kw:["인문·사회","전시도록","구동희","딜리버리","전시","전경","사진이","펼침면을","크게","차지하고","검은고딕","노이에"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:222,h:297},m:{상:9,하:14,안:15,밖:9},c:{구성:"4단",간격:6},b:{크기:11,행간:17,자간:0},ty:{이름:"검은고딕 / 노이에 헬베티카 / 산돌 고딕네오 / 임팩트",분류:"고딕"},pn:"하단-우측-가로",pn_x_left:"202.4mm",pn_y_left:"284.4mm",pn_x_right:"202.4mm",pn_y_right:"284.4mm",pn_size:"11pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"17pt",footnote:"7.5pt",특:"전시 전경 사진이 펼침면을 크게 차지하고, 글은 그 사이에 삽입된다. 책의 앞뒤는 작가가 수집한 배달 인증 사진으로 열고 닫히며, 작은 비디오 스틸이 페이지 곳곳을 무작위로 가로질러 배치되어 빠르게 움직이는 시점을 시각화한다. 표지는 F형 안구 이동 경로를 연상시키는 비대칭 정보 배치로 구성된다.",summary:"구동희의 특정 장소 설치와 비디오를 기록한 전시 도록. 즉시 배달의 사회적·물리적 네트워크와 왜곡된 시간 감각을 다루며, 전경 사진 사이를 텍스트가 관통하고 배달 기사 시점의 비디오 스틸이 페이지 안을 무작위로 이동해 시각적 운동과 속도를 지면에 번역한다.",why_dim:"전시 전경 사진의 스케일과 비디오 스틸의 이동감을 충분히 수용하면서도, A4에 가까운 세로 판형으로 도록의 문서성과 전시 공간의 확장성을 동시에 확보하기 위한 선택.",why_margin:"전경 사진, 이동하는 비디오 스틸, 텍스트 블록이 충돌하지 않도록 넉넉한 주변 여백을 유지하고, 하단 여백을 통해 쪽번호와 이미지 호흡을 정리한다. 여백 자체가 스틸 이미지의 이동 경로를 드러내는 빈 필드로 작동한다.",why_font:"즉시성과 속도, 도시적 물성, 웹 인터페이스 같은 감각을 강조하기 위해 압축감 있고 강한 고딕 계열을 사용한다. 표지와 제목에는 시선 유도력이 강한 디스플레이 성격의 고딕을, 본문과 보조 정보에는 중립적인 산세리프를 써서 전경 사진과 텍스트의 정보 구조를 정리한다.",why_tracking:"제목과 표지 정보는 압축된 자간으로 속도감과 시각적 밀도를 높이고, 본문과 캡션은 중립 자간으로 전경 사진·삽입 스틸과의 관계 속에서도 판독성을 유지하기 위한 설정.",layout_type:"본문 2단 + 주석 4단"},
  {g:"문학",pub_type:"전시도록",t:"강서경—검은 자리 꾀꼬리",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/suki-seokyeong-kang-kr/",img:"073_강서경—검은 자리 꾀꼬리",kw:["문학","전시도록","강서경","검은","자리","꾀꼬리","에세이는","그리드를","바탕으로","오른쪽","2단에","레터","고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:202.5,h:270},m:{상:11,하:16,안:17,밖:12},c:{구성:"4단",간격:7},b:{크기:9.5,행간:17,자간:0},ty:{이름:"레터 고딕 / 인문고딕",분류:"고딕"},pn:"하단-좌측-가로",pn_x_left:"12mm",pn_y_left:"250mm",pn_x_right:"12mm",pn_y_right:"250mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"16pt",footnote:"7pt",특:"에세이는 4단 그리드를 바탕으로 오른쪽 2단에 본문을 두고 나머지 단에 주석과 캡션을 배치한다. 인터뷰는 2단으로 단순화되고, 전경 사진은 3부로 나뉘어 전체-개별 요소-클로즈업 순으로 전개된다. 첫 면의 모눈 도표와 속장 모서리의 반복 눈금이 책 전체에 화문석 같은 질감을 부여한다.",summary:"강서경의 설치, 비디오, 퍼포먼스를 다룬 개인전 도록이자 작품 연구서. 정간보와 화문석, 춘앵무에서 비롯한 작가의 모듈·대칭 개념을 책 전체 구조와 타이포그래피로 번역하며, 스튜디오의 유닛 사진과 3부 전시 전경, 에세이·인터뷰를 모듈형 배열로 엮는다.",why_dim:"전시 전경, 작품 디테일, 스튜디오 유닛 사진과 장문 연구 텍스트를 함께 수용하면서도, 정간보와 화문석에서 온 모듈·대칭 개념을 지면 전체에 펼치기 위한 중대형 판형.",why_margin:"4단 모듈 그리드를 안정적으로 유지하면서 본문, 주석, 캡션, 인터뷰의 층위를 분리하기 위한 여백. 페이지 가장자리까지 확장되는 모서리 패턴과 하단 쪽번호가 화문석의 결을 연상시키도록 여백을 구조적 필드로 사용한다.",why_font:"유사 고정 폭의 레터 고딕과 구조적인 인문고딕을 사용해 모듈과 대칭, 반복의 질서를 드러내면서도 지나치게 기계적이지 않은 리듬을 만든다. 작품 연구서의 문서성과 작가 작업의 수행적 감각을 동시에 지지한다.",why_tracking:"모듈형 본문과 주석, 캡션의 구조를 명확히 유지하면서도 고정폭 계열의 기계성을 완화하기 위해 중립 자간에 약한 확장을 병용한다.",layout_type:"본문 1-2단 + 주석 4단(2열 사용)"},
  {g:"건축·공간",pub_type:"단행본",t:"의심이 힘이다—배형민과 최문규의 건축 대화",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/doubt-is-power-kr/",img:"074_의심이 힘이다—배형민과 최문규의 건축 대화",kw:["건축·공간","단행본","의심이","힘이다","배형민과","최문규의","건축","대화","기본은","단순한","조판이며","공간","윤슬바탕"],align_title:"우측 정렬",align_body:"좌측 정렬",align_note:"-",f:{w:126,h:183},m:{상:15,하:32,안:15,밖:16},c:{구성:"1단",간격:0},b:{크기:9.5,행간:17,자간:0},ty:{이름:"공간 / 윤슬바탕",분류:"혼합 (고딕 / 명조)"},pn:"하단-외측-가로",pn_x_left:"6.15mm",pn_y_left:"174.1mm",pn_x_right:"114.7mm",pn_y_right:"174.1mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"20pt",footnote:"-",특:"기본은 단순한 1단 대화 조판이며, 최문규의 드로잉이 텍스트 사이에 동등한 비중의 시각 요소로 삽입된다. 꾸밈을 최소화한 평면 구조와 안정적인 문단 배열이 대화의 구어적 흐름을 살리고, 드로잉이 텍스트의 간격과 호흡을 조절한다.",summary:"건축 평론가 배형민과 건축가 최문규의 대화, 그리고 최문규의 자유로운 드로잉을 동등한 비중으로 엮은 건축 대담집. 과장 없는 단순한 편집과 바람이 통하는 인상의 활자를 통해 격의 없는 대화의 리듬과 건축적 사유의 유연함을 드러낸다.",why_dim:"손에 잡히는 소형 판형으로 대화집의 친밀한 독서감을 확보하고, 장문 대화와 드로잉을 부담 없이 오가게 하며 건축 담론을 지나치게 권위적으로 보이지 않게 하기 위한 선택.",why_margin:"대화 본문과 드로잉이 편안하게 공존하도록 균형 여백을 유지하고, 하단 여백을 약간 넓혀 쪽번호와 문단 호흡을 안정화한다. 과도한 그래픽 개입을 줄여 텍스트의 격의 없는 톤을 지지하는 여백.",why_font:"공간과 윤슬바탕은 각각 개념이 분명하면서도 경직되지 않은 인상을 지녀, 건축 담론의 구조감과 대화의 유연함을 동시에 전달한다. 글자 안팎으로 숨이 통하는 듯한 활자 리듬이 책의 주제와 잘 맞물린다.",why_tracking:"장문 대화의 판독성을 우선하면서도, 활자 내부의 여유로운 인상과 문장 사이 호흡을 유지하기 위해 과도한 압축 없이 중립 자간에 약한 확장을 더한 설정.",layout_type:"본문 1단"},
  {g:"타이포그래피",pub_type:"전시도록",t:"데이비드 호크니",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/david-hockney-kr/",img:"075_데이비드 호크니",kw:["타이포그래피","전시도록","데이비드","호크니","전시는","7개","섹션으로","나뉘고","제목","역시","ITC","아방"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:240,h:255},m:{상:15,하:27,안:18,밖:15},c:{구성:"31열",간격:0},b:{크기:9.5,행간:17,자간:0},ty:{이름:"ITC 아방 가르드 고딕 / SM 신신명조 / 꼬딕씨 / 맞춤 서체 / 북마니아",분류:"혼합 (고딕 / 명조 / 디스플레이)"},pn:"하단-외측-가로 / 하단-중앙-가로",pn_x_left:"15mm",pn_y_left:"237mm",pn_x_right:"118.7mm",pn_y_right:"237mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"15pt",footnote:"7pt",특:"전시는 7개 섹션으로 나뉘고, 제목 역시 7층 반복 배열로 표지에 제시된다. 내지는 장문 해설과 작품 목록, 연표, 전면 도판, 게이트폴드가 교차하며, 본문은 안정적인 컬럼 구조를 유지하고 섹션 오프너에서는 큰 디스플레이 타이포가 개입한다. 전체적으로 고전적이면서도 시대가 불분명한 우아한 인상을 만든다.",summary:"서울시립미술관에서 열린 데이비드 호크니 회고전 도록. 변화무쌍한 작품 세계를 시기별 7개 섹션으로 나누어 소개하며, 일곱 층으로 반복되는 전시 제목과 게이트폴드, 정사각형에 가까운 판형, 1960–70년대 서체 조합을 통해 호크니 작업의 시대감과 다채로운 매체성을 시각화한다.",why_dim:"정사각형에 가까운 대형 판형으로 회화, 판화, 사진, 드로잉, 무대 디자인 등 다양한 작품 이미지를 안정적으로 수용하고, 회고전의 시대별 섹션 구조와 게이트폴드 전개를 우아하게 펼치기 위한 선택.",why_margin:"정사각형에 가까운 판면에서 장문 해설, 대형 도판, 연표, 작품 목록을 균형 있게 수용하기 위한 여백. 하단 여백을 약간 넓혀 쪽번호와 섹션 정보를 정리하고, 큰 이미지와 게이트폴드가 답답하지 않게 호흡하도록 한다.",why_font:"표제에는 1970년대 감각의 아방가르드 고딕을 사용해 호크니의 대표작과 동시대 시각 문화를 환기하고, 본문에는 전통적 명조와 북맨 계열을 사용해 회고전 도록의 품위와 연속성을 확보한다. 디스플레이와 본문의 시대 차이가 호크니 작업의 시간성을 은근히 암시한다.",why_tracking:"본문과 연표, 작품 목록의 판독성을 유지하기 위해 중립 자간을 사용하고, 섹션 오프너와 표제에서는 약한 확장을 통해 1970년대식 우아한 디스플레이 리듬과 층위감을 강조한다.",layout_type:"본문 10열(3단 레이어) + 주석 7열(4단 레이어)"},
  {g:"현대미술",pub_type:"실험출판",t:"강진안, 공연화, 김민정, 김성완, 배기태, 슬기와 민, 신예슬, 신진영, 심우섭, 오민, 옥상훈, 이민성, 이신실, 이양희, 이영우, 이태훈, 이혜원, 장태순, 정광준, 조세프 풍상, 한문경, 허윤경, 홍성진, 홍초선, 57스튜디오",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/jinan-kang-yeonwha-kong-minjung-kim-kr/",img:"076_강진안, 공연화, 김민정, 김성완, 배기태, 슬기와 민, 신예슬, 신진영, 심우섭, 오민, 옥상훈, 이민성, 이신실, 이양희, 이영우, 이태훈, 이혜원, 장태순, 정광준, 조세프",kw:["현대미술","실험출판","강진안","공연화","김민정","김성완","배기태","슬기와","민","신예슬","신진영","심우섭","오민","옥상훈","앞표지는","간기","페이지처럼","설계되어","제목","작가","게르스트너","프로그람"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:125,h:180},m:{상:5,하:15,안:4,밖:5},c:{구성:"2단",간격:4},b:{크기:9,행간:12,자간:0},ty:{이름:"게르스트너 프로그람 / 산돌 고딕네오",분류:"고딕"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"8.5pt",subheading:"-",footnote:"-",특:"앞표지는 간기 페이지처럼 설계되어 제목·작가·제작 정보가 구분 없이 등장하고, 제목에 포함된 이름의 머리글자에 대응하는 이응과 미음(o, m)에 방점을 찍어 우연한 그래픽 패턴을 만든다. 검정 덧표지에는 이 부호만 추출되어 남고, 내지는 한영 병기 텍스트와 대화, 도식, 공연 사진이 절제된 1단 구조 안에서 전개된다.",summary:"오민의 퍼포먼스 작품을 바탕으로, 제작에 참여한 모든 사람의 이름을 제목으로 내세운 얇고 조밀한 한영 병기 출판물. 원작의 즉흥 연주 개념을 설명하고 음악인 김성완, 음악 평론가 신예슬과의 대화를 통해 즉흥 연주, 음악 형식, 연주장의 신체성 같은 핵심 주제를 확장한다.",why_dim:"얇고 조밀한 대담집의 밀도와 즉흥 연주의 긴장감을 손에 잡히는 소형 판형 안에 압축하고, 앞표지·간기·덧표지의 개념적 전환을 한 손 안에서 인지하게 하기 위한 선택.",why_margin:"작은 판형 안에서 한영 병기 본문과 대화, 간기성 정보, 그래픽 부호가 공존하도록 균형 여백을 유지하고, 하단 여백으로 쪽번호와 문단 호흡을 안정화한다. 여백은 방점 패턴과 제목의 비정형 인지를 돕는 빈 필드로 작동한다.",why_font:"기계적이면서도 지나치게 차갑지 않은 구조적 고딕을 사용해 즉흥 연주와 개념적 편집의 질서를 드러낸다. 게르스트너 프로그람의 시스템적 성격과 산돌 고딕네오의 높은 판독성이 제목의 나열, 간기 정보, 대화 본문을 하나의 편집 논리 안에 묶는다.",why_tracking:"조밀한 한영 병기 본문과 이름 나열 구조의 판독성을 유지하면서, 제목과 간기성 정보의 리듬을 또렷하게 하기 위해 중립 자간에 약한 확장을 병용한다.",layout_type:"본문 2단 + 이미지 1단"},
  {g:"건축·공간",pub_type:"전시도록",t:"카럴 마르턴스—스틸 무빙",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/karel-martens-catalog-kr/",img:"077_카럴 마르턴스—스틸 무빙",kw:["건축·공간","전시도록","카럴","마르턴스","스틸","무빙","전시","광경","사진은","8페이지","단위의","매끄러운","견출고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:170,h:240},m:{상:5,하:13,안:13,밖:5},c:{구성:"4단",간격:8},b:{크기:8,행간:15,자간:10},ty:{이름:"SM 견출고딕 / SM 중고딕 / 정카 / 피렐리",분류:"고딕"},pn:"하단-좌측-가로",pn_x_left:"10mm",pn_y_left:"232.2mm",pn_x_right:"17.4mm",pn_y_right:"232.2mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"12pt",footnote:"8pt",특:"전시 광경 사진은 8페이지 단위의 매끄러운 종이 접지로 인쇄되어 모조지 본문 사이에 끼워지고, 본문 지면은 네 방향을 모두 활용한다. 면주와 각주는 360도, 캡션은 90도 또는 270도로 회전 배치되어 요소를 변별하는 동시에 운동감을 만든다. 표지는 4종으로 나뉘어 각각 다른 마르턴스적 그래픽 표면을 보여 준다.",summary:"그래픽 디자이너 카럴 마르턴스의 대형 회고전 도록. 표지는 작가의 다양한 작업을 반영해 4종으로 제작되었고, 건축 학술지 『오아서』에서 가져온 판형 안에 본문 섹션과 매끄러운 전면 인쇄 도판지를 교차 삽입한다. 면주와 각주, 캡션을 90도·270도·360도로 회전 배치해 책 전체에 운동감과 방향성을 부여한다.",why_dim:"마르턴스가 디자인한 건축 학술지 『오아서』의 판형을 차용해 작가의 그래픽 언어와 출판 실천을 직접 참조하고, 회고전 도판과 본문, 회전 요소를 안정적으로 수용할 수 있는 중형 판형을 확보하기 위한 선택.",why_margin:"회전된 면주, 각주, 캡션과 삽입 도판지가 지면 사방으로 뻗어나갈 수 있도록 균형 여백을 두고, 하단 여백으로 쪽번호와 본문 리듬을 정리한다. 여백은 방향 전환과 운동감을 드러내는 활성 영역으로 작동한다.",why_font:"표제의 피렐리와 본문의 정카는 마르턴스와 이정명이 함께 디자인한 서체로, 작가의 그래픽 시스템과 직접 연결된다. 구조적이고 단단한 고딕 계열을 사용해 방향 전환, 반복, 모듈성을 명확하게 드러내면서도 본문 판독성을 유지한다.",why_tracking:"회전 배치와 삽입 도판, 다방향 정보 구조 속에서도 본문과 캡션의 판독성을 유지하기 위해 중립 자간을 기본으로 하고, 제목과 일부 보조 정보에는 약한 확장을 더해 구조와 방향성을 선명하게 한다.",layout_type:"본문 2단 + 주석 4단"},
  {g:"문학",pub_type:"실험출판",t:"아프리카의 인상",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/impressions-dafrique-kr/",img:"078_아프리카의 인상",kw:["문학","실험출판","아프리카의","인상","덧표지는","가운데","맞춘","세리프","제목과","박으로","신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"양끝 정렬",f:{w:150,h:210},m:{상:21,하:30,안:17,밖:42},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:0},ty:{이름:"SM 신명조 / 옵티크 디스플레이 / 푸르니에",분류:"명조"},pn:"상단-외측-가로",pn_x_left:"42mm",pn_y_left:"9.2mm",pn_x_right:"105mm",pn_y_right:"9.2mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"7pt",특:"덧표지는 가운데 맞춘 세리프 제목과 박으로 찍힌 점 배열이 만든 두 개의 R 형상이 대비를 이루고, 속장에서는 양끝 맞춤의 장문 본문과 대칭적 표제, 세로 보조 텍스트가 반복된다. 차분한 명조 조판과 정제된 규칙선, 절제된 장식이 전위적 텍스트를 오히려 더 낯설게 드러낸다.",summary:"레몽 루셀의 전위 문학 작품을 담은 번역 소설. 덧표지의 점으로 형상화된 두 개의 R과 A-Z 알파벳 배열, 속장의 보수적 명조 조판과 대칭적 배열을 통해 급진적 텍스트와 차분한 외형 사이의 긴장을 만든다. 정장처럼 갖춰 입은 타이포그래피가 오히려 텍스트의 실험성을 더 선명하게 드러낸다.",why_dim:"장편 전위 소설의 장문 독서를 안정적으로 수용하면서도, 문학동네 시리즈의 단정한 물성과 덧표지·박·도판 요소를 함께 다루기 위한 표준적 중형 판형.",why_margin:"장문 본문과 세로 보조 정보, 대칭 배열, 덧표지의 박 요소를 안정적으로 수용하기 위한 균형 여백. 하단 여백을 넓혀 쪽번호와 본문 리듬을 정돈하고, 정제된 백색 공간을 통해 보수적 외형과 급진적 텍스트의 대비를 강화한다.",why_font:"본문에는 구식 명조체와 푸르니에를 사용해 차분하고 안정된 고전적 인상을 만들고, 덧표지 제목에는 옵티크 디스플레이를 적용해 인위적이고 약간 예스러운 우아함을 더한다. 이러한 보수적 활자 선택이 루셀 텍스트의 급진성과 오히려 강하게 충돌한다.",why_tracking:"고전적 문학 조판의 차분함과 안정감을 만들기 위해 약간 넓은 자간을 사용하고, 대칭 배열과 정제된 제목 구조가 지나치게 답답해 보이지 않도록 글자 사이 공기를 확보한다.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"잡지·저널",t:"옵.신 8호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/ob-scene-8-kr/",img:"079_옵.신 8호",kw:["인문·사회","잡지·저널","옵.신","8호","기본은","검은","바탕","위의","장문","PDU","PKS"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"양끝 정렬",f:{w:90,h:125},m:{상:7,하:15,안:10,밖:10},c:{구성:"1단",간격:0},b:{크기:8.5,행간:15,자간:0},ty:{이름:"PDU / PKS 흘림체 / SM 태명조 / 플랑탱",분류:"명조"},pn:"하단-중앙-가로",pn_x_left:"43mm",pn_y_left:"112.3mm",pn_x_right:"43mm",pn_y_right:"112.3mm",pn_size:"7pt",pn_font:"명조",pn_style:"백색 / 가로 / 숫자",running:"8.5pt",subheading:"13pt",footnote:"7pt",특:"기본은 검은 바탕 위의 1단 장문 조판이며, 일부 펼침에서는 손글씨형 슬로건과 프랑스어 구호를 큰 박스 안에 배치해 포스터처럼 작동한다. 책등의 사진, 빈 앞표지, 흑백 아카이브 이미지, 흰 규칙선과 여백 대비가 강한 정치적 긴장을 형성한다.",summary:"무대(scene)로부터 벗어난 것들을 다루는 다원 예술 저널. 8호의 이슈는 ‘1968년 5월’이며, 작은 붉은 책을 연상시키는 소형 판형, 유고슬라비아 블랙 웨이브를 참조한 검은 지면, 그리고 연대의 이미지를 책등 사진으로 전치해 정치적·예술적 기억을 응축한다.",why_dim:"1968년 중국 문화 혁명과 파리 학생 운동에서 상징적 물신이었던 ‘작은 붉은 책’을 전유한 소형 판형으로, 496쪽의 방대한 텍스트를 압축해 정치적 팸플릿 같은 응집감과 휴대성을 확보하기 위한 선택.",why_margin:"검은 바탕 위에 흰 본문과 사진, 인용문 박스를 안정적으로 수용하기 위한 최소 여백. 작은 판형 안에서 판면 밀도를 높이되 하단 여백을 약간 남겨 쪽번호와 텍스트 호흡을 확보하고, 검은 바탕의 압박감을 조절한다.",why_font:"본문에는 고전적 명조 계열을 사용해 장문 독서를 유지하고, 구호와 슬로건에는 손글씨성 디스플레이를 적용해 1968년의 거리 정치와 즉흥적 제스처를 호출한다. 명조와 흘림체의 충돌이 저널의 정치적 온도를 높인다.",why_tracking:"좁은 판형과 검은 바탕에서 본문 판독성을 유지하기 위해 중립 자간을 유지하고, 구호성 제목과 슬로건에는 약간의 확장을 주어 포스터형 제스처와 시각적 울림을 강화한다.",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"에피 6호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/epi-6-kr/",img:"080_에피 6호",kw:["아트이론·비평","잡지·저널","에피","6호","기본은","단행본","같은","안정적인","비평","노토","세리프"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"-",f:{w:120,h:186},m:{상:9,하:24,안:18,밖:15},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:0},ty:{이름:"노토 세리프 / 본명조 / 맞춤 서체 / 산돌 고딕네오 / 코페르니쿠스 / 프루티거",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-외측-세로",pn_x_left:"4.8mm",pn_y_left:"40mm",pn_x_right:"110.7mm",pn_y_right:"40mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"15pt",footnote:"-",특:"기본은 단행본 같은 안정적인 1단 비평 조판이며, 로고의 하이픈과 일정한 두께의 선이 표지, 속장 모서리, 섹션 제목, 표제 페이지를 관통하며 책 전체를 하나의 연속된 그래픽 장치로 묶는다. 큰 제목 타이포와 검은 막대, 점 요소가 페이지마다 규칙적으로 반복된다.",summary:"과학 비평 잡지 『에피』 6호. 작은 판형과 단행본 같은 타이포그래피를 통해 진지하면서도 격의 없는 과학 비평의 독서 경험을 만들고, 앞표지 로고의 하이픈이 속장 모서리와 책등, 뒤표지를 거쳐 다시 앞표지로 연결되는 선형 시스템이 책 전체를 하나의 도식처럼 묶는다.",why_dim:"과학 비평 잡지에 단행본 같은 친밀한 독서감을 부여하고, 작은 판형 안에서 장문 리뷰와 에세이를 밀도 있게 수용하면서도 휴대성을 확보하기 위한 선택.",why_margin:"작은 판형 안에서 장문 비평과 섹션 제목, 도식적 선 요소가 공존하도록 균형 여백을 유지하고, 하단 여백으로 쪽번호와 본문 리듬을 안정화한다. 여백은 3mm 두께 선과 하이픈 시스템이 지나가는 구조적 공간으로도 작동한다.",why_font:"본문에는 진지하고 안정적인 독서감을 주는 세리프 계열을 사용하고, 로고와 섹션 제목, 보조 정보에는 구조적이고 명료한 산세리프 및 맞춤 서체를 사용해 과학 비평의 제도성과 친밀함을 동시에 전달한다.",why_tracking:"작은 판형의 장문 독서에서 판독성을 유지하면서, 제목과 선형 그래픽 요소의 구조감을 또렷하게 하기 위해 중립 자간에 약한 확장을 병용한다.",layout_type:"본문 1단"},
  {g:"문학",pub_type:"단행본",t:"자유의 발명 1700~1789 / 1789 이성의 상징",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/linvention-de-la-liberte-1700-1789-1789-les-emblemes-de-la-raison-kr/",img:"081_자유의 발명 1700~1789 - 1789 이성의 상징",kw:["문학","단행본","자유의","발명","1700~1789","/","1789","이성의","상징","474×270mm","크기의","덧표지를","매번","다른","각도로","신신명조"],align_title:"좌측 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:138,h:220},m:{상:21,하:60,안:21,밖:24},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:-40},ty:{이름:"SM 신신명조 / 벤턴 산스 / 산돌 고딕네오 / 어도비 캐즐런 / 유니버스 / 윤명조 / 캐즐런 540",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-외측-가로 / 하단-외측-가로",pn_x_left:"42.1mm",pn_y_left:"11.3mm",pn_x_right:"91.8mm",pn_y_right:"11.3mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"7pt",특:"474×270mm 크기의 덧표지를 매번 다른 각도로 접어 표지 일부를 비대칭으로 가리고, 속장에서는 장문 1단 조판과 도판, 세로 면주가 안정적으로 배치된다. 중첩된 표제와 흑백·회색 망점의 계조, 비스듬한 덧표지의 그림자가 두 개의 에세이가 맞물린 구조와 이항 관계를 시각적으로 암시한다.",summary:"인문 라이브러리 시리즈의 한 권으로, 두 편의 에세이를 한 권에 묶은 구조를 중첩 표제와 흑백 대비, 망점 계조로 시각화한 교양서. 큰 덧표지를 비대칭 각도로 접어 표지 일부만 드러내는 방식과 서로 다른 활자 조합을 통해 이항 관계와 지적 긴장을 형상화한다.",why_dim:"장문 인문 비평 텍스트를 안정적으로 수용하는 중형 판형으로, 큰 덧표지 접기 구조와 양장 제본의 물성을 살리면서도 시리즈의 통일성을 유지하기 위한 선택.",why_margin:"장문 본문과 도판, 세로 보조 정보, 접힌 덧표지의 비대칭 개입을 안정적으로 수용하기 위한 균형 여백. 하단 여백을 넓혀 쪽번호와 캡션, 본문 리듬을 정리하고, 흑백 대비와 망점 계조가 호흡할 수 있는 빈 공간을 확보한다.",why_font:"본문에는 고전적이고 차분한 명조 계열을 사용해 인문 비평의 무게와 안정감을 유지하고, 표제와 보조 정보에는 산스 및 캐즐런 계열을 혼용해 두 텍스트의 관계와 시리즈의 개별성을 드러낸다. 서로 다른 활자의 공존이 이항 구조와 사유의 긴장을 강화한다.",why_tracking:"장문 인문 텍스트의 판독성을 유지하면서, 중첩 표제와 보조 정보의 위계를 또렷하게 하기 위해 중립 자간을 기본으로 하고 일부 제목에는 약한 확장을 더해 구조적 긴장을 확보한다.",layout_type:"본문 1단"},
  {g:"건축·공간",pub_type:"잡지·저널",t:"계간 시청각 2호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/avp-quarterly-2-kr/",img:"082_계간 시청각 2호",kw:["건축·공간","잡지·저널","계간","시청각","2호","표지와","표제에서","‘시청각’을","삼각형","개의","로고로","태고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:126,h:204},m:{상:8,하:30,안:17,밖:8},c:{구성:"1단",간격:0},b:{크기:12,행간:17,자간:0},ty:{이름:"SM 태고딕 / 메종 노이에",분류:"고딕"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"-",subheading:"-",footnote:"8pt",특:"표지와 표제에서 ‘시청각’을 삼각형 세 개의 로고로 치환하고, 목록과 본문 일부에는 텍스트 대신 아이콘이 사용된다. 기본은 안정적인 1단 평론 조판이지만, 제목·목차·섹션 표지에서 로고와 아이콘이 언어의 일부처럼 개입해 기관 정체성을 강하게 드러낸다.",summary:"미술 공간 시청각에서 창간한 미술 평론지. 표제의 핵심 요소인 ‘시청각’을 공간 로고인 삼각형 세 개로 치환하고, 목록과 본문에서도 텍스트 대신 아이콘을 간헐적으로 사용해 공간 아이덴티티와 저널 구조를 결합한다.",why_dim:"장문 평론 텍스트를 안정적으로 수용하면서도 기관 저널의 휴대성과 연속성을 확보하기 위한 중형 판형. 로고와 아이콘 시스템이 표지와 내지에 자연스럽게 개입할 수 있는 세로 비례를 가진다.",why_margin:"장문 평론과 목록형 정보, 로고 치환 표제, 아이콘 시스템이 충돌하지 않도록 균형 여백을 유지하고, 하단 여백으로 쪽번호와 본문 리듬을 안정화한다. 여백은 삼각형 로고와 규칙선, 아이콘이 구조적으로 배치되는 필드 역할을 한다.",why_font:"기관 저널의 명료성과 현대성을 유지하기 위해 구조적이고 또렷한 고딕 계열을 사용한다. 텍스트와 로고, 아이콘이 같은 문장 체계 안에서 작동해야 하므로, 중립적이면서도 개성 있는 산세리프가 적합하다.",why_tracking:"장문 평론의 판독성을 유지하면서, 로고 치환 표제와 아이콘 정보가 텍스트와 자연스럽게 공존하도록 중립 자간에 약한 확장을 더한 설정.",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"전시도록",t:"엉망",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/ungmang-kr/",img:"083_엉망",kw:["아트이론·비평","전시도록","엉망","기본은","보수적인","문예지","시사","월간지","같은","AG","최정호체"],align_title:"좌측 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬, 우측 정렬",f:{w:150,h:210},m:{상:9,하:18,안:12,밖:12},c:{구성:"2단",간격:6},b:{크기:9,행간:14,자간:-10},ty:{이름:"AG 최정호체 / MT 그로테스크 / 맞춤 서체 / 어도비 캐즐런",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"하단-중앙-가로",pn_x_left:"72.7mm",pn_y_left:"200.9mm",pn_x_right:"72.7mm",pn_y_right:"200.9mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"14pt",footnote:"6.5pt",특:"기본은 보수적인 문예지·시사 월간지 같은 본문 구조를 따르지만, 프로젝트별로 운동화, 음료수 병, 음식, 길거리 사진이 카탈로그 그리드, 전면 도판, 대형 표제 면으로 변주된다. 표지 없이 노출된 사철 제본과 책등의 추상적 형상이 제목과 작가 이름의 헝클어진 상태를 암시하며, 전시와 책이 서로 경쟁하는 구조를 만든다.",summary:"일민미술관에서 열린 Sasa[44] 개인전을 기록하면서도 전시를 다른 형식으로 확장하는 대형 도록. 작가가 소비·배출한 물건의 아카이브를 샘플링, 리믹스, 전유의 방식으로 재구성하고, 전시장과 경쟁하는 지면 구성과 해설 텍스트를 통해 현대 문화의 속성과 주체의 자율성을 탐구한다.",why_dim:"구식 시사 월간지를 연상시키는 판형으로, 방대한 아카이브 이미지와 장문 비평을 동등하게 수용하면서도 대중문화적 인상과 보수적 편집 문법을 불러와 전시의 혼성적 성격과 대비시키기 위한 선택.",why_margin:"768쪽의 대용량 이미지·텍스트 아카이브를 안정적으로 수용하고, 운동화·음료수 병·음식 사진과 장문 해설, 대형 타이포가 공존하도록 하기 위한 여백. 하단 여백을 조금 넓혀 쪽번호와 긴 리듬을 정리하고, 판면의 과밀함을 조절한다.",why_font:"본문에는 보수적이고 안정적인 명조 계열을 사용해 구식 시사 월간지의 인상을 만들고, 제목과 프로젝트 표기, 보조 정보에는 고딕과 맞춤 서체를 섞어 아카이브의 활달함과 현대적 리믹스 감각을 드러낸다. 고전성과 난삽함의 충돌이 책의 핵심 개념이다.",why_tracking:"방대한 장문 해설과 카탈로그식 도판 설명의 판독성을 유지하기 위해 중립 자간을 기본으로 하고, 대형 표제와 프로젝트명에는 약한 확장을 더해 아카이브의 분절과 구조를 또렷하게 드러낸다.",layout_type:"본문 2단 (사진 도록 4단)"},
  {g:"건축·공간",pub_type:"실험출판",t:"에튀드",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/etudes-kr/",img:"084_에튀드",kw:["건축·공간","실험출판","에튀드","기본은","안정적인","조판이지만","표지와","뒤표지에는","게르스트너","프로그람"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:125,h:180},m:{상:15,하:10,안:15,밖:14},c:{구성:"1단",간격:0},b:{크기:9,행간:14,자간:0},ty:{이름:"게르스트너 프로그람 / 산돌 고딕네오",분류:"고딕"},pn:"상단-외측-세로",pn_x_left:"4.2mm",pn_y_left:"47.1mm",pn_x_right:"116.6mm",pn_y_right:"47.1mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 세로 / 숫자",running:"9pt",subheading:"-",footnote:"-",특:"기본은 안정적인 1단 조판이지만, 표지와 뒤표지에는 연습의 궤적처럼 보이는 사선들이 배치되어 책의 개념을 추상적으로 드러낸다. 내지는 한영 병기 텍스트와 스틸 이미지가 절제된 구조 안에서 병치되고, 작은 판형이 실험 노트 같은 밀도를 만든다.",summary:"미술가 오민의 영상·퍼포먼스 시리즈를 기록하고 확장하는 소형 출판물. 연습과 숙련을 출발점으로 통제, 감각, 계획과 실행, 공간과 시간, 생각과 행동의 관계를 탐구하며, 얇은 책 안에서 텍스트와 스틸 이미지, 선형 표지가 개념적 긴장을 이룬다.",why_dim:"소형 판형과 표지 중철 구조를 통해 퍼포먼스 개념을 응축된 연구 노트처럼 읽히게 하고, 한국어·영어 병기와 스틸 이미지, 짧은 해설을 부담 없이 오가게 하기 위한 선택.",why_margin:"작은 판형 안에서 한영 병기 본문과 스틸 이미지, 캡션, 선형 그래픽이 공존하도록 균형 여백을 유지하고, 하단 여백으로 쪽번호와 문단 호흡을 정리한다. 여백은 표지와 뒤표지의 사선 구조가 연장되는 개념적 필드로도 작동한다.",why_font:"기계적 질서와 개념적 구조를 드러내는 고딕 계열을 사용해 연습, 반복, 수행의 개념을 또렷하게 시각화한다. 게르스트너 프로그람의 시스템적 성격과 산돌 고딕네오의 높은 판독성이 한영 병기와 이미지 캡션 구조를 안정적으로 묶는다.",why_tracking:"작은 판형의 장문 해설과 한영 병기 구조에서 판독성을 유지하면서, 제목과 보조 정보의 구조감을 선명하게 하기 위해 중립 자간에 약한 확장을 더한 설정.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"잡지·저널",t:"옐로 페이지스—동아시아 그래픽 디자인 프로젝트 지도 그리기",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/yellow-pages-mapping-graphic-design-projects-in-east-asia-kr/",img:"085_옐로 페이지스—동아시아 그래픽 디자인 프로젝트 지도 그리기",kw:["인문·사회","잡지·저널","옐로","페이지스","동아시아","그래픽","디자인","프로젝트","지도","그리기","기본은","잡지","기사에","가까운","멀티컬럼","구조지만","TB","고딕"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:225,h:297},m:{상:7,하:7,안:15,밖:7},c:{구성:"4단",간격:7},b:{크기:11,행간:12,자간:0},ty:{이름:"TB 고딕 / 아틀라스 타이프라이터 / 플라크 컨덴스드",분류:"혼합 (고딕 / 디스플레이)"},pn:"하단-중앙-가로",pn_x_left:"92.6mm",pn_y_left:"260mm",pn_x_right:"108.6mm",pn_y_right:"260mm",pn_size:"100pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"11pt",footnote:"8pt",특:"기본은 잡지 기사에 가까운 멀티컬럼 구조지만, 페이지 색이 섹션마다 크게 바뀌며 전시 홍보물 속 가공의 지면을 현실화한다. 지도, 포스터, 도록, 인터뷰, 전시 전경 사진, 대형 숫자 페이지네이션이 병치되고, 각 색면이 별도의 매체 단위처럼 읽히면서도 전체적으로 네트워크를 이룬다.",summary:"『아이디어』 383호에 실린 특집 기사로, 2014–2016년 연재된 동아시아 현대 그래픽 디자인 기사를 바탕으로 교토 DDD 갤러리 전시 『그래픽 웨스트 7—옐로 페이지스』를 재독해하고 확장한다. 전시 참여자들의 작업, 사유, 사회 관계망을 다루며 전시 자체를 하나의 지면 네트워크로 다시 구성한다.",why_dim:"잡지 특집 기사이면서 전시를 확장하는 시각 아카이브를 충분한 스케일로 담기 위한 A4에 가까운 대형 판형. 다양한 색면 지면, 인터뷰, 도판, 지도형 정보 구조를 한 권 안에 유연하게 수용한다.",why_margin:"원래 잡지 기사 구조를 유지하면서도 노랑, 분홍, 하양, 초록, 파랑 등 지면 색 변주와 대형 이미지, 장문 인터뷰, 캡션, 페이지 숫자가 충돌하지 않도록 여백을 안정적으로 확보한다. 여백은 각 색면이 하나의 독립 지면처럼 작동하도록 프레임 역할을 한다.",why_font:"잡지형 본문과 인터뷰에는 중립적이고 밀도 높은 고딕을 사용해 정보 구조를 안정화하고, 타이프라이터와 컨덴스드 계열을 보조적으로 섞어 기록물, 지도, 포스터, 전시 그래픽의 서로 다른 목소리를 드러낸다. 다양한 서체의 병용이 동아시아 그래픽 디자인의 다성성을 반영한다.",why_tracking:"다언어·다형식 정보가 많은 잡지형 지면에서 판독성을 유지하기 위해 본문은 중립 자간을 사용하고, 큰 숫자 페이지네이션과 일부 섹션 제목에는 약간 확장된 자간을 적용해 색면과 구조 변화를 분명하게 드러낸다.",layout_type:"본문 2단 + 기타 4단"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"에피 4호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/epi-4-kr/",img:"086_에피 4호",kw:["아트이론·비평","잡지·저널","에피","4호","기본은","단행본","같은","안정적인","비평","노토","세리프"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"-",f:{w:120,h:186},m:{상:9,하:24,안:18,밖:15},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:0},ty:{이름:"노토 세리프 / 본명조 / 맞춤 서체 / 산돌 고딕네오 / 코페르니쿠스 / 프루티거",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-외측-세로",pn_x_left:"4.8mm",pn_y_left:"40mm",pn_x_right:"110.7mm",pn_y_right:"40mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"15pt",footnote:"-",특:"기본은 단행본 같은 안정적인 1단 비평 조판이며, 앞표지 로고의 하이픈과 일정한 두께의 검은 선이 속장 모서리, 섹션 제목, 표제 페이지를 관통하며 책 전체를 하나의 연속된 그래픽 장치로 묶는다. 큰 키워드 타이포와 검은 막대, 점 요소가 페이지마다 규칙적으로 반복된다.",summary:"과학 비평 잡지 『에피』 4호. 작은 판형과 단행본 같은 타이포그래피를 통해 진지하면서도 격의 없는 독서 경험을 만들고, 앞표지 로고의 하이픈과 3mm 두께 선이 속장 모서리, 책등, 뒤표지를 순환하며 책 전체를 하나의 구조적 도식으로 묶는다. 4호의 키워드는 ‘프랑켄슈타인’이다.",why_dim:"과학 비평 잡지에 단행본 같은 친밀한 독서감을 부여하고, 작은 판형 안에서 장문 비평과 키워드 중심의 주제 전개를 밀도 있게 수용하면서도 휴대성을 확보하기 위한 선택.",why_margin:"작은 판형 안에서 장문 비평과 키워드 섹션, 3mm 선형 그래픽, 표제 페이지 요소가 공존하도록 균형 여백을 유지하고, 하단 여백으로 쪽번호와 본문 리듬을 안정화한다. 여백은 하이픈과 선이 순환하는 구조적 필드로 작동한다.",why_font:"본문에는 진지하고 안정적인 독서감을 주는 세리프 계열을 사용하고, 로고와 섹션 제목, 키워드 표제, 보조 정보에는 구조적이고 명료한 산세리프 및 맞춤 서체를 사용해 과학 비평의 제도성과 친밀함을 동시에 전달한다.",why_tracking:"작은 판형의 장문 독서에서 판독성을 유지하면서, 키워드 표제와 선형 그래픽 요소의 구조감을 또렷하게 하기 위해 중립 자간에 약한 확장을 병용한다.",layout_type:"본문 1단"},
  {g:"건축·공간",pub_type:"실험출판",t:"연습곡 1번",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/etude-no-1-kr/",img:"087_연습곡 1번",kw:["건축·공간","실험출판","연습곡","1번","앞표지와","뒤표지는","상하","반전과","중첩","타이포를","노이에","헬베티카"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:234,h:309},m:{상:12,하:11,안:12,밖:12},c:{구성:"2단",간격:6},b:{크기:10,행간:17,자간:0},ty:{이름:"노이에 헬베티카 / 산돌 고딕네오",분류:"고딕"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"-",subheading:"15pt",footnote:"9pt",특:"앞표지와 뒤표지는 상하 반전과 중첩 타이포를 사용해 1부와 2부의 관계를 시각화한다. 내지는 한영 병기 해설과 각주, 지시문을 안정적으로 배치하고, 일부 면에서는 실제 악보가 크게 삽입되어 출판물이 해설서이자 연주용 스코어처럼 작동한다.",summary:"오민과 작곡가 유혜림이 협업한 출판물로, 동시대 공연자가 연마해야 하는 기법을 질문하며 소리와 연주자의 몸 사이 거리, 시간감과 공간감을 실험한다. 1부는 피아노와 퍼커션을 위한 악보, 2부는 같은 악보를 텍스트 지시문과 의성어로 전환해 연주 감각 자체를 다시 훈련하게 한다.",why_dim:"악보와 장문 해설, 한영 병기 텍스트, 지시문을 충분한 스케일로 읽히게 하기 위한 대형 판형. 연습곡의 개념과 실제 악보의 판독성을 동시에 확보하고, 출판물이 연주를 위한 도구처럼 기능하도록 한다.",why_margin:"악보, 한영 병기 본문, 지시문과 여백의 관계를 명확히 드러내기 위한 넉넉한 여백. 큰 판형 안에서 빈 공간 자체가 시간과 공간의 감각을 환기하며, 연주자가 소리와 몸 사이 거리를 상상하는 필드로 작동한다.",why_font:"기계적이면서도 과도하게 장식적이지 않은 고딕 계열을 사용해 연습, 지시, 악보, 수행의 구조를 명확히 드러낸다. 노이에 헬베티카의 중립성과 산돌 고딕네오의 높은 가독성이 한영 병기와 스코어 정보, 개념적 제목 구조를 안정적으로 묶는다.",why_tracking:"한영 병기 해설과 악보 캡션, 지시문이 공존하는 지면에서 판독성을 유지하면서, 제목과 개념적 표제 구조를 선명하게 하기 위해 중립 자간에 약한 확장을 병용한다.",layout_type:"본문 2단 + 기타 1단"},
  {g:"그래픽디자인",pub_type:"잡지·저널",t:"옐로 페이지스",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/yellow-pages-e-book-kr/",img:"088_옐로 페이지스",kw:["그래픽디자인","잡지·저널","옐로","페이지스","원본","연재","기사들의","페이지","구조와","타이포그래피","TB","고딕"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:217,h:297},m:{상:7,하:35,안:7,밖:6},c:{구성:"2단",간격:6},b:{크기:10,행간:12,자간:0},ty:{이름:"TB 고딕 / 아틀라스 타이프라이터 / 플라크 컨덴스드",분류:"혼합 (고딕 / 디스플레이)"},pn:"하단-중앙-가로",pn_x_left:"92mm",pn_y_left:"263.1mm",pn_x_right:"92mm",pn_y_right:"263.1mm",pn_size:"90pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"10pt",footnote:"8pt",특:"원본 연재 기사들의 페이지 구조와 타이포그래피, 색면 지면, 지도·인터뷰·전시 기록의 멀티컬럼 배열을 그대로 유지한다. 표지와 장 표제지만 새로 추가되고, 새 페이지 번호가 기존 번호 위에 중첩되어 전자책의 후편집 개입을 드러낸다.",summary:"2014년부터 2016년까지 『아이디어』에 연재된 동아시아 현대 그래픽 디자인 시리즈 기사 8편을 한데 묶은 전자책. 원본 페이지를 그대로 유지한 채 새 페이지 번호를 기존 번호 위에 덧씌우고, 표지와 장 표제지를 새로 더해 아카이브를 하나의 디지털 문서로 재구성한다.",why_dim:"기존 잡지 지면을 변형 없이 보존하면서 8편의 연재물을 하나의 연속된 아카이브로 묶기 위한 전자책 형식. 인쇄물의 페이지 구조와 색면 체계를 그대로 유지한 채 디지털 접근성과 재배포 가능성을 확보한다.",why_margin:"원본 인쇄 지면을 그대로 보존하는 것이 핵심이므로 추가 여백 설계보다는 기존 잡지 페이지의 프레임과 색면 구조를 유지한다. 새 표지와 장 표제지만 별도 개입하고, 나머지 페이지는 기존 지면 위에 새 페이지 번호만 덧씌운다.",why_font:"원본 『옐로 페이지스』 시리즈의 서체 체계를 그대로 유지해 기사별 정체성과 동아시아 그래픽 디자인의 다성적 기록성을 보존한다. 고딕, 타이프라이터, 컨덴스드 계열의 병용은 기록물·지도·포스터·인터뷰의 서로 다른 목소리를 유지하는 데 적합하다.",why_tracking:"원본 잡지 지면의 자간 체계를 유지한다. 전자책에서는 새 페이지 번호를 기존 번호 위에 덧씌우는 최소 개입만 이루어지며, 원래의 컬럼 구조와 색면 전환 리듬을 훼손하지 않는 것이 핵심이다.",layout_type:"본문 2단 + 주석 4단"},
  {g:"문학",pub_type:"단행본",t:"인간성 수업",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/cultivating-humanity-kr/",img:"089_인간성 수업",kw:["문학","단행본","인간성","수업","474×270mm","크기의","덧표지를","비스듬히","접어","표지","신신명조"],align_title:"-",align_body:"양끝 정렬",align_note:"-",f:{w:138,h:222},m:{상:21,하:36,안:21,밖:24},c:{구성:"1단",간격:0},b:{크기:9.5,행간:16,자간:0},ty:{이름:"SM 신신명조 / 벤턴 산스 / 산돌 고딕네오 / 어도비 캐즐런 / 윤명조 / 캐즐런 540 / 히스토리",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-외측-가로",pn_x_left:"42.1mm",pn_y_left:"11.3mm",pn_x_right:"89.6mm",pn_y_right:"11.3mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"-",특:"474×270mm 크기의 덧표지를 비스듬히 접어 표지 일부를 비대칭으로 가리고, 속장에서는 장문 1단 조판과 절제된 본문 구성이 유지된다. 표지에는 ‘CULTIVATING HUMANITY’를 기하학, 점선, 장식 패턴, 선형 구조로 해체·재조합해 주제어를 시각적 장치로 확장하고, 뒤표지 역시 같은 비스듬한 절단 구조를 반복한다.",summary:"문학동네 인문 라이브러리 시리즈의 한 권으로, 새 인문교육을 위한 고전의 분투를 다룬 마사 C. 누스바움의 저서를 비대칭 덧표지와 개념형 타이포그래피로 시각화한다. 474×270mm 종이를 비스듬히 접은 덧표지와 기하학·장식·선형 모티프가 ‘인간성 수업’이라는 주제를 하나의 도식적 장처럼 펼친다.",why_dim:"장문 인문 비평 텍스트를 안정적으로 수용하는 중형 판형으로, 큰 덧표지 접기 구조와 양장 제본의 물성을 살리면서도 문학동네 인문 라이브러리 시리즈의 통일성을 유지하기 위한 선택.",why_margin:"장문 본문과 도판, 세로 보조 정보, 접힌 덧표지의 비대칭 개입을 안정적으로 수용하기 위한 균형 여백. 하단 여백을 넓혀 쪽번호와 캡션, 본문 리듬을 정리하고, 비대칭 면 분할과 강한 색면 대비가 호흡할 수 있는 빈 공간을 확보한다.",why_font:"본문에는 고전적이고 차분한 명조 계열을 사용해 인문 교양서의 무게와 안정감을 유지하고, 표지와 보조 정보에는 산스 및 장식적 디스플레이 요소를 섞어 교육, 세계시민성, 젠더, 타자성 같은 주제를 개념적으로 펼쳐 보인다. 서로 다른 활자의 공존이 시리즈의 일관성과 개별 권의 성격을 동시에 드러낸다.",why_tracking:"장문 인문 텍스트의 판독성을 유지하면서, 표지와 보조 정보의 도식적 조형성을 또렷하게 하기 위해 중립 자간을 기본으로 하고 일부 제목에는 약한 확장을 더해 구조적 긴장을 확보한다.",layout_type:"본문 1단"},
  {g:"건축·공간",pub_type:"단행본",t:"아모레퍼시픽의 건축",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/architecture-of-amorepacific-kr/",img:"090_아모레퍼시픽의 건축",kw:["건축·공간","단행본","아모레퍼시픽의","건축","덧표지와","표제지의","세로","줄무늬","패턴은","치퍼필드가","APHQ","GT"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:207,h:261},m:{상:9,하:9,안:9,밖:9},c:{구성:"21열",간격:0},b:{크기:11,행간:14,자간:0},ty:{이름:"APHQ / GT 발스하임 / 맞춤 서체 / 아리따 돋움",분류:"고딕"},pn:"상단-외측-가로",pn_x_left:"8.8mm",pn_y_left:"8mm",pn_x_right:"186mm",pn_y_right:"8mm",pn_size:"21pt",pn_font:"디스플레이",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"19pt",footnote:"7.5pt",특:"덧표지와 장 표제지의 세로 줄무늬 패턴은 치퍼필드가 디자인한 용산 사옥의 표면 처리에서 영감을 받았고, 본문은 한국어와 영어가 두 번씩 번갈아 등장하는 리듬을 따른다. 펼침면의 대칭, 건축 사진과 도면 병치, 세로 면주와 쪽번호, 절제된 제목 구조가 정육면체 건축의 질서를 책에 옮긴다.",summary:"아모레퍼시픽 용산 사옥 개관을 기념해 출간된 책. 알바루 시자, 네리·후, 김종규, 매스스터디스, 데이비드 치퍼필드 등 세계적 건축가들이 아모레퍼시픽과 함께한 건축 작업을 논한다. 학술 도서와 포트폴리오 사이의 균형 위에서, 건축물의 대칭 구조와 외피 리듬, 한영 본문의 교차 리듬을 책의 구조로 번역한다.",why_dim:"학술 도서의 밀도와 건축 포트폴리오의 이미지 비중을 동시에 수용하기 위한 중대형 판형. 용산 사옥의 정육면체에 가까운 비례와 안정감을 연상시키며, 도판·도면·장문 비평을 균형 있게 담는다.",why_margin:"대칭적 건축 구조와 한영 교차 편집의 리듬을 안정적으로 지지하기 위한 균형 여백. 줄무늬 표지, 장 표제지, 세로 면주와 쪽번호가 호흡할 수 있도록 판면 가장자리의 빈 공간을 구조적 프레임처럼 사용한다.",why_font:"기업 아이덴티티와 직접 연결되는 APHQ와 구조적이고 절제된 GT 발스하임, 맞춤 서체, 아리따 돋움을 사용해 브랜드 건축의 제도성과 현대성을 명확하게 드러낸다. 중립적이면서도 단단한 고딕 체계가 학술 정보와 포트폴리오 이미지를 안정적으로 묶는다.",why_tracking:"장문 학술 텍스트와 한영 교차 편집의 판독성을 유지하기 위해 중립 자간을 기본으로 하고, 장 표제와 일부 보조 정보에는 약한 확장을 더해 건축적 질서와 외피의 반복 리듬을 강조한다.",layout_type:"본문 12열 + 주석 5열 + 이미지 가변"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"에피 3호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/epi-3-kr/",img:"091_에피 3호",kw:["아트이론·비평","잡지·저널","에피","3호","기본은","단행본","같은","안정적인","비평","노토","세리프"],align_title:"좌측 정렬",align_body:"-",align_note:"-",f:{w:120,h:186},m:{상:9,하:24,안:18,밖:15},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:0},ty:{이름:"노토 세리프 / 본명조 / 맞춤 서체 / 산돌 고딕네오 / 코페르니쿠스 / 프루티거",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-외측-세로",pn_x_left:"4.8mm",pn_y_left:"40mm",pn_x_right:"110.7mm",pn_y_right:"40mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"15pt",footnote:"-",특:"기본은 단행본 같은 안정적인 1단 비평 조판이며, 앞표지 로고의 하이픈과 일정한 두께의 검은 선이 속장 모서리, 섹션 제목, 표제 페이지를 관통하며 책 전체를 하나의 연속된 그래픽 장치로 묶는다. 큰 키워드 타이포와 검은 막대, 점 요소가 페이지마다 규칙적으로 반복된다.",summary:"과학 비평 잡지 『에피』 3호. 작은 판형과 단행본 같은 타이포그래피를 통해 진지하면서도 격의 없는 독서 경험을 만들고, 앞표지 로고의 하이픈과 3mm 두께 선이 속장 모서리, 책등, 뒤표지를 순환하며 책 전체를 하나의 구조적 도식으로 묶는다. 3호의 키워드는 ‘지진’이다.",why_dim:"과학 비평 잡지에 단행본 같은 친밀한 독서감을 부여하고, 작은 판형 안에서 장문 비평과 키워드 중심의 주제 전개를 밀도 있게 수용하면서도 휴대성을 확보하기 위한 선택.",why_margin:"작은 판형 안에서 장문 비평과 키워드 섹션, 3mm 선형 그래픽, 표제 페이지 요소가 공존하도록 균형 여백을 유지하고, 하단 여백으로 쪽번호와 본문 리듬을 안정화한다. 여백은 하이픈과 선이 순환하는 구조적 필드로 작동한다.",why_font:"본문에는 진지하고 안정적인 독서감을 주는 세리프 계열을 사용하고, 로고와 섹션 제목, 키워드 표제, 보조 정보에는 구조적이고 명료한 산세리프 및 맞춤 서체를 사용해 과학 비평의 제도성과 친밀함을 동시에 전달한다.",why_tracking:"작은 판형의 장문 독서에서 판독성을 유지하면서, 키워드 표제와 선형 그래픽 요소의 구조감을 또렷하게 하기 위해 중립 자간에 약한 확장을 병용한다.",layout_type:"본문 1단"},
  {g:"타이포그래피",pub_type:"단행본",t:"왼끝 맞춘 글—타이포그래피를 보는 관점",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/unjustified-texts-kr/",img:"092_왼끝 맞춘 글—타이포그래피를 보는 관점",kw:["타이포그래피","단행본","왼끝","맞춘","글","타이포그래피를","보는","관점","표지는","맞추기","조판","원리를","직접","AG","안상수체"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:135,h:210},m:{상:15,하:30,안:18,밖:18},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:0},ty:{이름:"AG 안상수체 / AG 최정호체",분류:"혼합 (고딕 / 명조)"},pn:"하단-좌측-가로",pn_x_left:"25.3mm",pn_y_left:"188.7mm",pn_x_right:"25mm",pn_y_right:"188.7mm",pn_size:"9pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"13pt",footnote:"7.5pt",특:"표지는 왼끝 맞추기 조판 원리를 직접 시각화하며, 안상수체와 짧은 선형 요소를 통해 제목을 구조적으로 배열한다. 내지는 절제된 1단 본문을 기본으로 사례 도판, 세로 캡션, 장 제목을 병치하고, 일부 페이지에서는 제목·본문·사례가 조용한 긴장 속에 배치된다.",summary:"로빈 킨로스의 타이포그래피 이론서를 번역한 책. 표지는 ‘왼끝 맞추기’ 조판 원리를 직접 예시하고, 안상수체의 형태를 통해 탈네모틀 한글과 왼끝 맞추기 정신을 연결한다. 본문은 원서를 본받아 절제된 조판을 유지하며, 책 전체가 타이포그래피에 대한 관점을 실물 형식으로 설명한다.",why_dim:"장문 이론 텍스트를 안정적으로 수용하면서도 손에 잡히는 단행본 비례를 유지하는 판형. 타이포그래피 논의를 위한 본문 판독성과 사례 도판의 재현, 표지의 개념적 조형을 함께 수용하기에 적합하다.",why_margin:"절제된 본문 조판과 사례 도판, 세로 캡션을 안정적으로 수용하는 균형 여백. 하단 여백을 약간 넓혀 쪽번호와 본문 리듬을 정리하고, 왼끝 맞추기 원리와 조판의 구조적 긴장이 또렷하게 드러나도록 판면을 정돈한다.",why_font:"표제에는 왼끝 맞추기의 개념과 탈네모틀 한글의 실험성을 동시에 환기하는 안상수체를 사용하고, 본문에는 차분하고 높은 판독성을 지닌 최정호체를 사용해 이론서로서의 안정감을 확보한다. 표지의 실험성과 본문의 절제가 대비를 이루며 책의 논지를 형식으로 보여 준다.",why_tracking:"절제된 본문 판독성을 유지하기 위해 중립 자간을 기본으로 하고, 표지와 일부 제목에는 형태적 구조를 드러내기 위해 약간 확장된 자간을 사용한다. 자간 변화가 왼끝 맞추기의 구조적 성격을 강조한다.",layout_type:"본문 1단"},
  {g:"현대미술",pub_type:"전시도록",t:"박미나 1995~2016",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/meena-park-1995-2016-kr/",img:"093_박미나 1995~2016",kw:["현대미술","전시도록","박미나","1995~2016","표지","없는","노출","제본과","별책","한국어","노이차이트","윤고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:188,h:256},m:{상:32,하:14,안:14,밖:14},c:{구성:"25열",간격:0},b:{크기:9.5,행간:10,자간:0},ty:{이름:"노이차이트 S / 윤고딕",분류:"고딕"},pn:"상단-우측-가로",pn_x_left:"154.3mm",pn_y_left:"7.8mm",pn_x_right:"154.4mm",pn_y_right:"7.8mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"13pt",footnote:"7pt",특:"표지 없는 노출 제본과 별책 한국어 소책자라는 형식을 유지하면서, 본문은 대형 도판, 작품 목록, 장문 평문, 비평 에세이를 교차 배치한다. 연대기적 개괄과 작품 재현에 초점을 두되, 이미지 비중이 매우 크고, 작품군마다 밀도와 리듬이 달라지는 도록형 편집이 특징이다.",summary:"박미나가 1995년 이후 20여 년에 걸쳐 발표한 회화, 드로잉, 설치 작업을 망라한 작가 모노그래프. 색상 수집, ‘비명’ 연작, ‘딩뱃 그림’, ‘색칠 공부’ 드로잉과 벽화·바닥 사진 등 폭넓은 작업을 수록하며, 2006년판 『박미나 1995~2005』를 대폭 증보해 판형과 제책 형식은 유지하고 내용 밀도만 크게 확장했다.",why_dim:"작가 20여 년의 작업을 연대기적으로 집적하는 도록이자 모노그래프의 기능을 수행하기 위한 중대형 판형. 도판 재현과 작품 목록, 장문 비평을 함께 담고, 원작 2006년판의 물리적 형식을 계승해 증보판의 연속성을 드러낸다.",why_margin:"도판 중심의 넓은 시야와 작품 캡션, 장문 비평, 작품 목록을 함께 수용하기 위한 중립적 여백. 표지 없는 노출 제본과 별책 부록의 구조를 강조하면서, 펼침면에서 이미지 군집과 텍스트 블록이 또렷이 분리되도록 판면을 정돈한다.",why_font:"작품 정보와 비평 텍스트를 차분하고 중립적으로 전달하기 위해 현대적이고 절제된 본문용 서체를 사용하고, 도록의 제도적 성격과 작가 작업의 분석적 태도를 반영하는 단단한 활자 체계를 구축한다. 대규모 도판을 방해하지 않으면서 정보 구조를 명확히 드러내는 선택이다.",why_tracking:"작품 도판과 비평 텍스트의 공존을 위해 과장 없는 중립 자간을 유지해 정보 구조를 안정화하고, 표지 없는 제책과 증보판의 아카이브적 성격이 과도한 조형 없이 드러나도록 한다.",layout_type:"본문 12열 + 주석 7열 + 이미지 가변"},
  {g:"인문·사회",pub_type:"기관출판",t:"부족의 시대",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/le-temps-des-tribus-kr/",img:"094_부족의 시대",kw:["인문·사회","기관출판","부족의","시대","474×270mm","종이를","비스듬히","접어","만든","덧표지가","신신명조"],align_title:"-",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:138,h:222},m:{상:21,하:60,안:21,밖:24},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:-40},ty:{이름:"SM 신신명조 / 벤턴 산스 / 산돌 고딕네오 / 어도비 캐즐런 / 윤명조 / 캐즐런 540",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-외측-가로 / 하단-외측-가로",pn_x_left:"42.1mm",pn_y_left:"11.3mm",pn_x_right:"91.8mm",pn_y_right:"11.3mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"7pt",특:"474×270mm 종이를 비스듬히 접어 만든 덧표지가 표지 일부만 드러내는 시리즈 형식을 따른다. 본문은 차분한 1단 구성으로 유지되지만, 표지와 면지에서 군집처럼 흩어진 타이포그래피와 입자 패턴이 주제 의식을 선행 제시한다.",summary:"미셸 마페졸리의 저서를 위한 인문 라이브러리 시리즈. 포스트모던 사회에서 개인주의의 퇴조와 집단적 감응의 귀환을 논하는 내용을 담으며, 고정된 표지 대신 비대칭 덧표지 구조와 입자처럼 흩어진 표제 타이포그래피로 ‘부족’과 군집의 이미지를 시각화한다.",why_dim:"인문 라이브러리 시리즈의 통일 판형을 유지하며 장문의 철학·사회학 텍스트를 안정적으로 수용하는 크기. 손에 쥐기 쉬운 세로형 양장으로서 독서용 매체의 친밀함을 살리면서도 덧표지의 비대칭 접힘과 표제 조형을 충분히 드러낼 수 있다.",why_margin:"시리즈 전체의 통일성을 유지하는 절제된 판면. 장문의 본문을 안정적으로 읽히게 하면서 덧표지와 표제지의 비대칭 구성이 강조되도록 안쪽은 단정하게 비워 두고, 여백을 통해 철학 텍스트의 밀도를 조절한다.",why_font:"인문 라이브러리 시리즈의 보수적이고 안정된 독서성을 유지하기 위해 명조 중심의 본문 체계를 두고, 표지와 부속 정보에서는 산세리프와 디스플레이 성격의 활자를 병치해 주제별 조형 차이를 만든다. 사유의 무게와 현대 사회 이론의 동시대성을 함께 드러내는 조합이다.",why_tracking:"장문 인문 텍스트의 안정적인 독서를 위해 중립 자간을 유지하고, 덧표지와 표제의 입자적 조형이 본문 판면까지 과도하게 침투하지 않도록 본문은 절제된 문자 간격으로 통제한다.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"전시도록",t:"공유 도시—현장 서울",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/imminent-commons-live-from-seoul-en-kr/",img:"095_공유 도시—현장 서울",kw:["인문·사회","전시도록","공유","도시","현장","서울","덧표지는","가벼운","선형","그래픽","레이어와","무거운","AG","초특태고딕"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:170,h:240},m:{상:7,하:10,안:17,밖:7},c:{구성:"6단",간격:5},b:{크기:9,행간:11,자간:0},ty:{이름:"AG 초특태고딕 / FB 타이틀링 고딕 / 노토 산스 / 본고딕 / 맞춤 서체",분류:"고딕"},pn:"상단-내측-세로 / 하단-내측-세로",pn_x_left:"151.5mm",pn_y_left:"6mm",pn_x_right:"18.1mm",pn_y_right:"231.1mm",pn_size:"36pt",pn_font:"고딕",pn_style:"흑색 / 세로 / 숫자 회전",running:"36pt",subheading:"36pt",footnote:"8pt",특:"덧표지는 가벼운 선형 그래픽 레이어와 무거운 응축형 제목 레이어를 중첩한 표지 구조를 가진다. 속장에서는 대형 전경 사진 위에 굵은 제목을 직접 얹거나, 세로 제목과 회전된 페이지 숫자, 다단 본문을 병치해 도시 생산과 공공성의 긴장을 반영한다.",summary:"2017 서울도시건축비엔날레 연계 전시 도록의 영어판. 덧표지에는 가벼운 선 구조가 만들고 해체하는 기하학적 글자와, 그 아래 무겁고 압축된 대문자 타이포그래피를 겹쳐 도시의 개방성과 긴박함이라는 이중 감각을 시각화한다. 속장은 한국어판과 상당 부분 구조를 공유하되, 검정 색판만 별도로 운용해 언어판을 경제적으로 구분하도록 설계됐다.",why_dim:"도시·건축 전시 도록에 적합한 중간 판형으로, 넓은 사진과 설명 텍스트를 함께 수용하면서도 과도하게 크지 않아 전시 기록물의 실용성과 이동성을 모두 확보한다.",why_margin:"전시 사진의 개방감과 굵은 제목 타이포그래피의 압박감을 병치하기 위해 비교적 넉넉한 판면을 사용하되, 제목과 본문, 이미지 설명이 서로 다른 밀도로 충돌하도록 구성한다. 한국어판과 영어판이 동일 구조를 공유할 수 있도록 모듈화된 그리드가 전제된다.",why_font:"굵고 압축적인 디스플레이용 산세리프와 중립적인 본문용 산세리프를 병행해 전시 주제의 공공성·산업성·긴급성을 드러낸다. 선형 맞춤 서체는 도시 네트워크처럼 유연하고 가변적인 그래픽 층을 만들고, 초특태고딕 계열은 전시 타이틀의 즉물적 힘을 담당한다.",why_tracking:"굵은 영문 표제는 응축된 밀도와 강한 시각적 압력을 위해 약간 타이트한 자간을 사용하고, 본문은 전시 해설의 가독성을 위해 중립 자간을 유지한다. 한국어판과 영어판의 공용 구조를 전제로 텍스트 블록 간 리듬이 중요하다.",layout_type:"본문 2단 (3열) + 주석 3단(2열)"},
  {g:"건축·공간",pub_type:"잡지·저널",t:"계간 시청각 1호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/avp-quarterly-1-kr/",img:"096_계간 시청각 1호",kw:["건축·공간","잡지·저널","계간","시청각","1호","표지와","목차에서는","삼각형","로고와","선형","구분선이","태고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:126,h:204},m:{상:9,하:24,안:15,밖:11},c:{구성:"1단",간격:0},b:{크기:11,행간:17,자간:0},ty:{이름:"SM 태고딕 / 메종 노이에",분류:"고딕"},pn:"하단-우측-가로",pn_x_left:"104mm",pn_y_left:"191.3mm",pn_x_right:"111.1mm",pn_y_right:"191.3mm",pn_size:"11pt",pn_font:"고딕",pn_style:"흑색 / 가로 /숫자, 기호",running:"11pt",subheading:"17pt",footnote:"8pt",특:"표지와 목차에서는 삼각형 로고와 선형 구분선이 핵심 질서를 만든다. 본문은 비교적 절제된 2단 텍스트 중심 구성이며, 기사 제목과 섹션명에 아이콘이 삽입된다. 시각 기호가 단순 장식이 아니라 편집 체계 일부로 기능한다.",summary:"미술 공간 시청각에서 창간한 평론지 1호. 표제의 핵심어 ‘시청각’을 공간 로고인 삼각형 세 개로 치환해 저널 아이덴티티를 구축했고, 목차와 내지에서도 텍스트 일부를 아이콘으로 대체해 시각 언어를 일관되게 확장한다.",why_dim:"휴대 가능한 비평지 판형으로, 잡지이면서도 단행본처럼 읽히는 밀도를 만든다. 비교적 좁고 긴 비율이 제목, 목차, 본문, 아이콘 요소를 또렷하게 세우는 데 유리하다.",why_margin:"단행본에 가까운 차분한 판면 위에 굵은 제목과 기호를 배치하는 구조다. 상단 로고 영역과 본문 영역이 분리되어 있고, 목차와 기사 첫머리에서 수직·수평 정렬이 강하게 드러난다. 아이콘이 텍스트의 문법에 개입하므로 제목줄의 시각 리듬이 중요하다.",why_font:"공간의 로고와 결합하는 제목 체계에는 구조적이고 선명한 산세리프가 적합하다. 메종 노이에 계열의 현대적 인상과 태고딕의 단단한 조형감이 결합해, 평론지의 공공성과 미술 공간의 또렷한 아이덴티티를 동시에 전달한다.",why_tracking:"굵은 제목은 약간 조여서 밀도를 확보하고, 본문은 단행본형 가독성을 위해 안정적인 자간을 유지한다. 아이콘이 단어 사이에 끼어들기 때문에 행 리듬이 흐트러지지 않도록 중립 자간이 중요하다.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"잡지·저널",t:"옵.신 7호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/ob-scene-7-kr/",img:"097_옵.신 7호",kw:["인문·사회","잡지·저널","옵.신","7호","기본적으로는","텍스트와","이미지","중심의","저널","HY","엽서"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"양끝 정렬",f:{w:138,h:204},m:{상:18,하:27,안:18,밖:18},c:{구성:"1단",간격:0},b:{크기:10,행간:16,자간:0},ty:{이름:"HY 엽서 / 스키아",분류:"혼합 (장식적 필기체 / 세리프)"},pn:"상단-외측-가로",pn_x_left:"18.2mm",pn_y_left:"9.1mm",pn_x_right:"115.8mm",pn_y_right:"9.1mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 /숫자, 기호",running:"9.5pt",subheading:"15pt",footnote:"10pt",특:"기본적으로는 1단 텍스트와 이미지 중심의 저널 구조이지만, 기사 중간중간 전면 색지, 흑백 전유 이미지, 인용문 페이지가 삽입되며 몽타주 편집의 리듬을 만든다. 표지에는 문자 정보가 거의 없고, 내지의 헤더 ‘Ob.Scene / Other.Scenes’ 구분이 섹션 구조를 잡아준다.",summary:"무대(scene)로부터 벗어난(ob-) 것들을 다루는 다원 예술 저널 7호. 카를 마르크스의 『자본』 출간 150주년, 레닌의 볼셰비키 혁명 100주년, 기 드보르의 『스펙터클의 사회』 발표 50주년을 기념하며, 역사적 변환에 연루된 글·영상·노래를 몽타주처럼 엮는다. 앞표지는 비워 두고, 내지에서는 대중적이고 감상적인 ‘엽서체’를 과감히 끌어와 상황주의적 전유의 태도를 편집 디자인으로 번역한다.",why_dim:"비평지로 읽기 적당한 중간 크기 판형으로, 이미지와 텍스트가 번갈아 등장하는 몽타주 구조를 담기에 무난하면서도, 강한 색면과 전유 이미지가 들어왔을 때 포스터 같은 긴장감을 만든다.",why_margin:"지면 운용은 비교적 단순한 단일 판면과 넉넉한 여백을 기초로 하지만, 검정·백색·적색 같은 강한 색면 페이지와 전유 이미지를 삽입해 리듬을 크게 흔든다. 본문은 왼쪽 상단 러닝헤더와 하단 캡션·출처 라인, 긴 문단의 좌정렬 텍스트로 구성되어 신문·전단 같은 인상을 만든다.",why_font:"본문에 쓰인 HY 엽서는 ‘역사·투쟁·혁명’ 같은 거대한 주제와 일부러 어긋나는 감상적이고 우스꽝스러운 정서를 만든다. 이는 상황주의적 전유와 재전유라는 책의 태도와 직접 연결된다. 스키아는 보조적 구조나 대비를 위해 쓰이며, 엽서체의 과장된 감정성과 다른 결의 질서를 제공한다.",why_tracking:"엽서체는 자형 자체가 강하므로 지나친 자간 조절 없이 자연스러운 흐름을 살리는 편이 맞다. 긴 문단에서는 행간을 넉넉히 확보해 감상적 서체의 답답함을 줄이고, 전면 인용문이나 색면 페이지에서는 더 큰 크기와 강한 대비를 통해 포스터적 밀도를 만든다.",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"에피 2호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/epi-2-kr/",img:"098_에피 2호",kw:["아트이론·비평","잡지·저널","에피","2호","잡지이지만","전반적인","페이지","운용은","단행본에","가깝다.","노토","세리프"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"-",f:{w:120,h:186},m:{상:9,하:24,안:18,밖:15},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:0},ty:{이름:"노토 세리프 / 본명조 / 산돌 고딕네오 / 코페르니쿠스 / 프루티거 / 맞춤 서체",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-외측-세로",pn_x_left:"4.8mm",pn_y_left:"40mm",pn_x_right:"110.7mm",pn_y_right:"40mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"15pt",footnote:"-",특:"잡지이지만 전반적인 페이지 운용은 단행본에 가깝다. 한 호 전체를 관통하는 키워드를 두고, 표제 페이지-본문-이미지/도해 페이지가 반복되는 구조다. 표지와 내지 모서리를 따라 이어지는 하이픈 선 요소가 권 전체를 하나의 시스템처럼 묶는다.",summary:"과학 비평 잡지 『에피』 2호. 작은 판형과 단행본 같은 차분한 타이포그래피를 바탕으로, ‘모델 생물’이라는 키워드를 중심에 둔 과학적 사유를 담는다. 앞표지의 로고 하이픈은 속장 모서리까지 이어져 책 전체를 둘러싸는 호를 만들고, 3밀리미터 두께의 선이 로고·섹션 제목·표제 페이지 전반을 관통하며 일관된 구조적 인상을 만든다.",why_dim:"문고본에 가까운 소형 판형으로, 과학 비평을 친숙하고 밀도 있게 읽히게 한다. 한 손에 잡히는 크기가 단행본적 인상을 강화하고, 추상적 키워드와 과학 이미지를 다루는 편집에서 과장보다 집중을 택하게 만든다.",why_margin:"기본적으로는 여백이 살아 있는 단행본형 텍스트 판면이 중심이지만, 표제 페이지와 섹션 오프너에서는 굵은 선과 큰 제목이 구조를 강하게 잡는다. 본문은 텍스트 중심으로 안정적으로 흐르고, 과학 개념을 설명하는 도상이나 삽화가 들어오며 리듬을 만든다.",why_font:"본문에는 세리프 계열이 중심이 되어 읽기의 안정감과 비평지다운 진지함을 확보하고, 제목과 구조 요소에는 산세리프 및 맞춤 서체가 들어가 명료한 위계를 만든다. 과학이라는 주제를 다루지만 지나치게 기술문서처럼 보이지 않도록, 서체 대비는 절제되어 있다.",why_tracking:"작은 판형 안에서 답답하지 않게 읽히도록 본문 행간은 비교적 넉넉한 편이 적절하다. 제목은 굵은 선 요소와 함께 작동하므로 크기 대비가 중요하고, 자간은 과도하게 벌리지 않은 채 단단하게 유지하는 편이 시리즈 정체성과 맞다.",layout_type:"본문 1단"},
  {g:"타이포그래피",pub_type:"전시도록",t:"블라스트 시어리—당신이 시작하라",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/blast-theory-catalog-kr/",img:"099_블라스트 시어리—당신이 시작하라",kw:["타이포그래피","전시도록","블라스트","시어리","당신이","시작하라","작가","소개와","전시","개념을","설명하는","본문","노이에","헬베티카"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:225,h:228},m:{상:6,하:9,안:18,밖:6},c:{구성:"17단",간격:4},b:{크기:11,행간:17,자간:0},ty:{이름:"노이에 헬베티카 / 산돌 고딕네오 / 맞춤 서체",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"105.1mm",pn_y_left:"215.7mm",pn_x_right:"116.8mm",pn_y_right:"215.7mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"11pt",footnote:"7.5pt",특:"작가 소개와 전시 개념을 설명하는 본문, 전시 전경 및 작품 이미지, 작품 정보 캡션이 교차하는 도록 구조다. 표지와 장면 전환부에서는 맞춤 변형 활자가 주제적 장치로 쓰이고, 내지에서는 전시 기록물로서의 기능을 유지하기 위해 비교적 명료한 정보 구조를 따른다.",summary:"백남준아트센터에서 열린 블라스트 시어리 개인전 도록. 가상과 실제의 병존이라는 주제를 상투적으로 설명하지 않고, 블라스트 시어리의 기울어진 로고를 역가공한 맞춤 타이포그래피로 구현했다. 정체 활자를 가로로 잘게 나눈 뒤 일정 간격으로 이동시켜 전체가 기울어 보이게 만들고, 같은 원리로 이탤릭체 같은 정체를 구성해 전시의 혼종적 감각을 시각화했다.",why_dim:"정사각형에 가까운 판형이 전시 도록의 중립적이면서도 약간 비정형적인 인상을 만든다. 화면 기반 미디어 작업과 설치 사진을 균형 있게 담기 좋고, 표지의 대형 타이포그래피 실험도 안정적으로 수용한다.",why_margin:"텍스트와 이미지가 명확히 분리되면서도, 제목·캡션·본문·도판이 강한 타이포그래피 축 아래 재조직된다. 표지와 섹션 오프닝에서는 대형 맞춤 활자가 화면을 장악하고, 내지에서는 비교적 절제된 본문 판면과 전시 설치 사진, 작품 캡션이 리듬을 만든다.",why_font:"기본적으로는 헬베티카 계열의 현대적 산세리프를 바탕으로 하지만, 핵심 인상은 로고를 해체·재구성한 맞춤 서체가 만든다. 활자를 수평 분절해 이동시키는 방식 때문에 정적 활자이면서도 기울고 흔들리는 듯한 긴장감이 생긴다. 실제와 가상, 고정과 운동의 이중성이 서체 자체에 새겨져 있다.",why_tracking:"본문은 전시 도록답게 정보 전달이 우선이므로 자간과 행간은 비교적 안정적으로 유지하되, 표지와 제목부는 압축적이고 강한 덩어리감이 중요하다. 대형 제목에서는 행간을 타이트하게, 본문은 설치 사진과 함께 읽히도록 다소 여유 있게 잡는 편이 적절하다.",layout_type:"본문 2단(8열) + 주석 3단(6열) + 캡션 8단(2열)"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"에피 1호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/epi-1-kr/",img:"100_에피 1호",kw:["아트이론·비평","잡지·저널","에피","1호","평문","중심의","비평지","따르되","글과","노토","세리프"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"-",f:{w:120,h:186},m:{상:9,하:24,안:15,밖:15},c:{구성:"1단",간격:0},b:{크기:10,행간:16,자간:0},ty:{이름:"노토 세리프 / 본명조 / 맞춤 서체 / 산돌 고딕네오 / 코페르니쿠스 / 프루티거",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-외측-세로",pn_x_left:"4.8mm",pn_y_left:"40mm",pn_x_right:"110.7mm",pn_y_right:"40mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"15pt",footnote:"-",특:"평문 중심의 비평지 구조를 따르되, 각 글과 섹션의 시작점에서 제목과 구분선이 시각적 리듬을 만든다. 커버와 속장 모두 로고의 하이픈 모티프를 확장해 하나의 시스템처럼 작동하고, 본문보다 구조 요소가 먼저 보이는 편집 방식으로 정체성을 강화한다.",summary:"과학 비평 잡지의 창간호로, 작은 판형과 단행본 같은 차분한 타이포그래피를 바탕으로 진지하면서도 격의 없는 인상을 만든다. 앞표지 로고의 하이픈은 속장 모서리로 연장되어 뒤표지와 책등을 지나 다시 앞표지로 이어지며 책 전체를 둘러싸는 시각 장치가 된다. 굵기가 일정한 3밀리미터 선이 로고, 섹션 제목, 표제 페이지 전반에 반복되며 일관된 구조를 형성한다.",why_dim:"포켓북에 가까운 작은 판형이 잡지를 지나치게 권위적으로 보이지 않게 하면서도, 과학 비평이라는 주제에 맞는 밀도 있는 읽기 경험을 가능하게 한다. 작은 책 크기와 단행본형 조판이 결합해 친밀하고 지속적인 독서 리듬을 만든다.",why_margin:"전체 구조는 작은 판형의 본문 페이지, 대형 섹션 타이포그래피, 그리고 3밀리미터 두께의 검은 선 요소들이 만드는 프레임으로 요약된다. 본문은 차분하고 읽기 쉽게 정리되지만, 섹션 도입부에서는 잘린 대형 영문과 선 구조가 강하게 등장해 잡지 전체의 아이덴티티를 유지한다.",why_font:"본문은 노토 세리프 계열을 중심으로 단행본 같은 안정감을 주고, 섹션 및 구조 요소는 산세리프와 맞춤 서체가 담당한다. 이 조합은 과학 비평이라는 주제에 필요한 신뢰감과 현대적 편집 감각을 동시에 확보한다. 특히 크게 잘린 영문 타이포그래피는 매호의 키워드 없이도 시리즈 전체 정체성을 단단하게 묶는다.",why_tracking:"작은 판형에서 가독성을 유지하려면 행간은 다소 여유 있게 두고, 자간은 지나치게 벌리지 않는 것이 중요하다. 본문은 단행본처럼 안정적으로, 섹션 타이포그래피는 프레임과 충돌하듯 타이트하게 처리해 대비를 만드는 방식이 적절하다.",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"실험출판",t:"스코어 스코어",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/score-by-score-kr/",img:"101_스코어 스코어",kw:["아트이론·비평","실험출판","스코어","예술가","인터뷰","사례","악보","도판이","신신명조"],align_title:"-",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:138,h:213},m:{상:9,하:20,안:15,밖:15},c:{구성:"2단",간격:6},b:{크기:10,행간:17,자간:0},ty:{이름:"SM 신신명조 / 파나마",분류:"명조"},pn:"하단-중앙-가로 / 상단-중앙-가로",pn_x_left:"67mm",pn_y_left:"9mm",pn_x_right:"67mm",pn_y_right:"9mm",pn_size:"9pt",pn_font:"명조",pn_style:"흑색, 녹색 / 가로 / 숫자",running:"-",subheading:"-",footnote:"7pt",특:"예술가 인터뷰, 스코어 사례, 악보, 도판이 하나의 책 안에서 공존하는 구조다. 단순한 인터뷰집이 아니라 서로 다른 매체 언어를 병치하는 편집이며, 검정과 초록의 색 구분을 통해 독자가 현재 읽는 층위가 발화인지 사례인지 즉시 인식하도록 설계되었다.",summary:"오민이 영상과 퍼포먼스 작업과 병행해 온 스코어 연구를 확장한 책으로, 일곱 명의 예술가와의 대화를 통해 스코어의 개념과 형식, 내용, 확장 가능성을 탐구한다. 한국어와 영어가 병치된 본문에서 대화는 검정, 스코어 사례는 진한 초록으로 구분되어 읽기의 층위를 명확히 나눈다. 책, 전시, 공연 등 서로 다른 유형의 작품 제목은 특별히 디자인한 문장부호로 분류된다.",why_dim:"중간 크기의 양장 판형은 연구서이면서도 작품집 같은 긴장감을 유지한다. 텍스트와 이미지, 악보가 균형 있게 배치될 수 있는 안정된 비율이며, 한국어와 영어를 병기하면서도 과도한 답답함 없이 호흡을 확보한다.",why_margin:"본문은 대화와 스코어 사례를 명확히 구분하는 이중 구조를 가진다. 대화 페이지는 상대적으로 전통적인 읽기 리듬을 따르지만, 스코어와 악보, 도판이 들어가는 페이지에서는 이미지와 텍스트가 느슨한 그리드 안에서 관계를 맺는다. 색채와 문장부호 체계가 사실상의 내비게이션 역할을 수행한다.",why_font:"본문은 모노스페이스처럼 보일 정도로 규칙성과 불규칙성이 공존하는 질감을 지닌 세리프 활자체를 사용해, 스코어라는 개념의 체계성과 수행성을 함께 암시한다. 제목과 구분 요소에는 파나마가 더해져 단단하고 지적인 인상을 보강한다. 특별히 디자인된 문장부호는 텍스트 분류 체계를 시각적으로 가시화한다.",why_tracking:"한국어·영어 병기, 대화와 사례의 색상 분리, 이미지와 악보 혼합 편집을 감안하면 본문은 충분한 행간과 약간의 자간 여유가 필요하다. 반면 제목 및 분류 부호는 보다 응축된 간격으로 처리해 구조적 긴장을 유지하는 편이 적절하다.",layout_type:"본문 1단 + 기타 2단"},
  {g:"인문·사회",pub_type:"단행본",t:"2017 서울도시건축비엔날레",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/seoul-biennale-2017-guidebook-kr/",img:"102_2017 서울도시건축비엔날레",kw:["인문·사회","단행본","2017","서울도시건축비엔날레","관람용","가이드북으로서","빠른","탐색성과","명확한","정보","AG","초특태고딕"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:120,h:180},m:{상:13,하:14,안:15,밖:7},c:{구성:"2단",간격:7},b:{크기:9,행간:15,자간:0},ty:{이름:"AG 초특태고딕 / FB 타이틀링 고딕 / 맞춤 서체",분류:"고딕"},pn:"상단-중앙-가로",pn_x_left:"54.5mm",pn_y_left:"5mm",pn_x_right:"61.8mm",pn_y_right:"5mm",pn_size:"7pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7pt",subheading:"17pt",footnote:"9pt",특:"관람용 가이드북으로서 빠른 탐색성과 명확한 정보 전달이 핵심이다. 전시 섹션 소개, 도시전·주제전 정보, 프로젝트 목록 등이 체계적으로 정리되며, 한국어와 영어가 병치되어 국제 관람 환경을 고려한 편집 구조를 보여 준다.",summary:"대조적인 두 그래픽 레이어를 겹쳐 전시의 핵심 주제인 ‘공유 도시’의 개방성과 긴박함을 동시에 전달한 전시 안내서다. 가벼운 선들이 구성과 해체를 반복하는 기하학적 글자층 위에, 무겁고 압축된 타이포그래피가 놓이며 미래 도시에 대한 기대와 현실적 도전이 충돌하는 감각을 만든다. 한국어와 영어가 병기된 내부는 전시 섹션과 주제를 또렷하게 구획하면서도 역동적 리듬을 유지한다.",why_dim:"휴대 가능한 소형 안내서 판형으로, 비엔날레 관람 중 손에 쥐고 이동하며 보기 적합하다. 작지만 충분한 정보량을 담을 수 있는 비율이며, 굵은 제목 체계와 이중언어 정보 구조를 효율적으로 수용한다.",why_margin:"안내서의 내부는 전시 섹션, 주제어, 도판, 설명 텍스트가 명확한 위계로 배치되는 정보 중심 레이아웃이다. 제목과 섹션 표시는 강하게, 본문은 상대적으로 차분하게 두어 관람 동선 속에서도 빠르게 스캔할 수 있게 만들었다. 전시 정체성을 형성한 선형 기하 요소는 표지뿐 아니라 내지의 분류 체계에도 리듬을 부여한다.",why_font:"AG 초특태고딕의 강한 질량감과 FB 타이틀링 고딕의 정제된 구조가 병치되며, 도시와 건축을 다루는 전시의 성격에 맞는 단단한 공공적 인상을 만든다. 맞춤 서체로 구현된 가벼운 선형 기하 문자들은 무거운 제목 활자와 대조를 이루며, 안내서 전체에 개방성과 실험성을 부여한다.",why_tracking:"무거운 제목 활자는 약간 조여서 밀도와 긴박감을 확보하고, 본문은 관람 중 빠르게 읽히도록 중립 자간과 비교적 안정된 행간을 유지하는 편이 적절하다.",layout_type:"본문 1단 + 기타 2단"},
  {g:"인문·사회",pub_type:"기관출판",t:"비판 철학의 비판",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/critique-of-the-critical-philosophy-kr/",img:"103_비판 철학의 비판",kw:["인문·사회","기관출판","비판","철학의","장문의","철학","텍스트를","안정적으로","읽게","하는","신신명조"],align_title:"-",align_body:"양끝 정렬",align_note:"-",f:{w:138,h:222},m:{상:21,하:36,안:21,밖:24},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조 / 벤턴 산스 / 산돌 고딕네오 / 어도비 캐즐런 / 윤명조 / 캐즐런 540",분류:"혼합 (명조 / 고딕)"},pn:"하단-외측-가로",pn_x_left:"42.1mm",pn_y_left:"11.7mm",pn_x_right:"91.7mm",pn_y_right:"11.7mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"-",특:"장문의 철학 텍스트를 안정적으로 읽게 하는 독서 중심 편집이다. 학술적 내용에 맞는 단정한 본문 구조를 유지하면서도, 시리즈물로서의 통일성과 각 권의 개별 주제를 덧표지 그래픽으로 차별화한다.",summary:"인문 라이브러리 시리즈의 형식을 따르는 양장본으로, 표지 일부를 드러내는 비대칭 덧표지가 핵심이다. 붉은색과 푸른색의 사선, 회색의 짧은 선, 한자와 한글이 흩뿌려진 듯 교차하는 그래픽은 책의 제목처럼 ‘비판’과 ‘철학’의 긴장 관계를 시각화한다. 차분한 내지와 대비되는 덧표지의 추상적 구성 덕분에 고전 철학서의 무게와 현대적 해석의 활력이 동시에 느껴진다.",why_dim:"인문 라이브러리 시리즈의 공통 규격으로 보이는 중간 판형이다. 긴 세로비가 제목과 저자 정보, 덧표지의 사선 구조를 안정적으로 수용하고, 분량이 많은 철학서를 단단한 학술서처럼 인식하게 한다.",why_margin:"내지는 넉넉한 여백과 안정된 활자 배치로 구성된 전형적인 인문서 레이아웃이다. 덧표지의 역동성과 달리 본문은 차분한 장서적 인상을 주며, 복잡한 철학 텍스트를 긴 호흡으로 읽게 한다. 앞뒤표지와 면지에 가까운 부분에서는 덧표지 그래픽이 다시 등장해 외부의 시각적 에너지가 내부의 정제된 독서 경험과 연결된다.",why_font:"본문은 명조 계열 서체를 중심으로 구성되어 고전 철학 번역서에 어울리는 차분하고 권위 있는 인상을 준다. 제목과 보조 정보에서는 산세리프가 보조적으로 쓰이며, 덧표지의 기하학적 선 구조와 만나 전통과 현대가 교차하는 시각적 긴장을 만든다.",why_tracking:"장문 인문 텍스트의 안정적인 독서를 위해 중립 자간을 유지하고, 덧표지와 표제의 사선 구조가 본문 판면까지 과도하게 침투하지 않도록 본문은 절제된 문자 간격으로 통제한다.",layout_type:"본문 1단"},
  {g:"전시·큐레이션",pub_type:"전시도록",t:"시간의 기술—남화연",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/nam-hwayeon-catalog-kr/",img:"104_시간의 기술—남화연",kw:["전시·큐레이션","전시도록","시간의","기술","남화연","비디오","스틸이","페이지","안에서","시간값에","따라","산돌","고딕네오"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:150,h:215},m:{상:12,하:20,안:10,밖:15},c:{구성:"25열 ",간격:0},b:{크기:9,행간:14,자간:30},ty:{이름:"산돌 고딕네오 / 아틀라스 그로테스크 / 파운더스 그로테스크 컨덴스드",분류:"고딕"},pn:"하단-외측-가로",pn_x_left:"5.3mm",pn_y_left:"206.8mm",pn_x_right:"139.6mm",pn_y_right:"206.8mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"7pt",특:"비디오 스틸이 페이지 안에서 시간값에 따라 위치를 부여받는 독특한 구조를 갖는다. 본문과 대담은 비교적 차분한 1단 기반으로 배치되지만, 이미지와 타임코드, 캡션은 고정 그리드보다 시간 흐름에 따라 배열된다. 전통 접지 덕분에 이미지가 페이지 경계를 넘더라도 흐름이 끊기지 않는다.",summary:"남화연의 비디오 작업을 기록한 전시 도록. 페이지로 규정되는 책의 물리적 박자와 비디오 작품의 타임라인이라는 두 시간 축이 만나 마찰을 일으키도록 설계되었고, 스틸 이미지는 페이지 내부의 시간 위치에 따라 비균등하게 배열된다. 이미지가 페이지 모서리를 넘어가기도 하지만 전통 접지 방식이 지속적인 흐름을 유지하게 하며, 표지는 마지막 작품과 첫 장의 이미지가 이어지는 구조로 책 전체를 하나의 순환적 시간 장치처럼 만든다.",why_dim:"비디오 작업의 시간성과 페이지의 물리적 리듬을 함께 담기 위한 중간 판형. 이미지와 타임코드, 대화, 캡션을 유연하게 배치하면서도 전통 접지 구조가 만드는 연속성을 살리기에 적합하다.",why_margin:"타임코드, 스틸 이미지, 대화 본문, 캡션이 함께 작동할 수 있도록 비교적 열린 여백 구조를 사용한다. 이미지가 페이지 모서리를 넘나들거나 비균등하게 배치되더라도 전체 판면이 흐트러지지 않도록 바깥 여백과 하단 여백이 리듬을 정리한다.",why_font:"중립적이면서도 구조감이 강한 산세리프 조합을 사용해 비디오 작업의 기록성과 현대적 감각을 함께 드러낸다. 아틀라스 그로테스크와 파운더스 그로테스크 컨덴스드는 시간 정보와 제목의 리듬을 또렷하게 만들고, 산돌 고딕네오는 한국어 본문과 캡션을 안정적으로 지지한다.",why_tracking:"타임코드와 캡션, 대화문, 이미지가 병존하므로 본문은 중립 자간과 충분한 행간으로 안정성을 확보하고, 제목과 시간 표시는 약간 응축된 간격으로 구조감을 강화한다. 이미지 위치의 불규칙성이 활자 리듬과 충돌하지 않도록 문자 쪽은 비교적 절제되어 있다.",layout_type:"본문 19열 + 기타 10열"},
  {g:"인문·사회",pub_type:"전시도록",t:"크지슈토프 보디츠코—기구, 기념비, 프로젝션",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/krzysztof-wodiczko-catalog/",img:"105_크지슈토프 보디츠코—기구, 기념비, 프로젝션",kw:["인문·사회","전시도록","크지슈토프","보디츠코","기구","기념비","프로젝션","표지와","섹션","도입부에서는","한글과","영문","제목이","FF","바우"],align_title:"좌측 정렬",align_body:"좌측 정렬(영어), 양끝 정렬(한국어)",align_note:"좌측 정렬",f:{w:210,h:264},m:{상:6,하:14,안:24,밖:9},c:{구성:"12단",간격:3},b:{크기:12,행간:17,자간:-10},ty:{이름:"FF 바우 / HY 타자전각 / 모노타이프 타이프라이터 / 산돌 고딕네오",분류:"고딕"},pn:"하단-외측-가로",pn_x_left:"9.4mm",pn_y_left:"255.1mm",pn_x_right:"196.9mm",pn_y_right:"255.1mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"19pt",footnote:"8pt",특:"표지와 섹션 도입부에서는 한글과 영문 제목이 겹치고 어긋나는 강한 타이포그래피 구조가 전면에 등장한다. 내지는 작품 이미지, 도면, 캡션, 대담, 주석이 공존하는 도록 구조로, 일부 페이지에서는 이미지가 펼침면을 크게 점유하고 다른 페이지에서는 텍스트와 자료가 2단 체계 안에서 정리된다.",summary:"국립현대미술관에서 열린 크지슈토프 보디츠코 전시 도록. 보디츠코 작업에서 느껴지는 투박함과 긴장감, 서로 다른 의미와 맥락이 중첩하고 충돌하는 인상을 타이포그래피와 인쇄 방식으로 번역했다. 표지에는 회색 재생지를 쓰고 흰색 바탕을 UV 인쇄해 물성과 인쇄층의 충돌을 드러내며, 한글과 영문 제목은 어긋나고 겹치는 방식으로 배치되어 작가 작업의 정치적·공공적 긴장을 시각화한다.",why_dim:"전시 도록으로서 대형 도판, 작품 기록, 도면과 설명 텍스트를 함께 수용하기 위한 중대형 판형. 공공 공간과 기념비, 프로젝션을 다루는 보디츠코 작업의 스케일감과 문서적 성격을 동시에 담기에 적합하다.",why_margin:"대형 도판과 긴 캡션, 작품 연도·제목·도면 정보, 대담 본문이 함께 작동할 수 있도록 여백을 비교적 넉넉하게 두고, 바깥 여백과 하단 여백이 캡션과 보조 정보를 안정적으로 지지한다. 표지와 장 제목에서는 겹침과 어긋남이 강조되지만 내지는 정보 구조가 흔들리지 않도록 판면을 차분하게 정리한다.",why_font:"FF 바우 계열의 구조적이고 현대적인 산세리프를 중심으로, 타자기 계열 서체와 한글 고딕을 병치해 공공성, 선언성, 임시성, 기록성의 감각을 동시에 환기한다. 활자들이 정확히 합치지 않고 비껴 나가며 겹치는 방식은 서로 다른 언어와 맥락, 제도와 발화가 중첩되는 보디츠코 작업의 성격과 맞닿아 있다.",why_tracking:"표지와 제목부는 겹침과 충돌, 어긋남의 효과를 분명히 드러내기 위해 타이트한 자간과 큰 크기 대비가 필요하고, 본문과 캡션은 전시 기록물로서의 판독성을 위해 중립 자간을 유지한다. 한글·영문 병치에서 일부러 정렬을 어긋나게 두는 방식이 핵심 시각 장치로 작동한다.",layout_type:"본문 ２단 ＋ 기타 ３단 ＋ 주석 ４단"},
  {g:"인문·사회",pub_type:"단행본",t:"이제껏 배운 그래픽 디자인 규칙은 다 잊어라. 이 책에 실린 것까지",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/forget-all-the-rules-you-ever-learned-about-graphic-design-kr/",img:"106_이제껏 배운 그래픽 디자인 규칙은 다 잊어라. 이 책에 실린 것까지",kw:["인문·사회","단행본","이제껏","배운","그래픽","디자인","규칙은","다","잊어라.","이","책에","실린","것까지","문제를","어떻게","다시","정의할","것인가를","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:210,h:280},m:{상:8,하:10,안:22,밖:8},c:{구성:"2단",간격:4},b:{크기:11.5,행간:17,자간:0},ty:{이름:"미상",분류:"명조"},pn:"하단-외측-가로",pn_x_left:"7.8mm",pn_y_left:"266.1mm",pn_x_right:"198mm",pn_y_right:"266.1mm",pn_size:"10pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"-",footnote:"11pt",특:"디자인 문제를 어떻게 다시 정의할 것인가를 사례를 통해 설명하는 구조다. 본문은 비교적 차분한 1단 독서 흐름을 유지하지만, 사례 도판과 포스터, 북커버, 사진이 크게 삽입되며 책 전체가 강의 노트와 포트폴리오, 선언문이 뒤섞인 듯한 편집 리듬을 갖는다.",summary:"밥 길이 30여 년 동안 여러 직업을 거치며 터득한 디자인 방법론을 관련 작품과 함께 정리한 책. 단호하지만 격의 없는 어조의 원서를 바탕으로, 한국어판 역시 규칙을 설파하기보다 기존 규범을 의심하고 문제를 다시 정의하는 밥 길의 태도를 책의 물성으로 번역한다. 대형 타이포그래피와 작품 이미지, 사례 설명이 교차하며 디자인 교재이자 작가론처럼 읽히는 구조를 만든다.",why_dim:"사례 이미지와 장문 텍스트, 대형 타이포그래피를 함께 수용할 수 있는 넉넉한 판형. 디자인 교재의 실용성과 포트폴리오 북 같은 시각적 개방감을 동시에 확보하기 위한 선택이다.",why_margin:"대형 이미지와 장문 본문, 캡션, 사례 설명이 한 권 안에서 리듬감 있게 교차하도록 비교적 넓은 판면을 사용한다. 여백은 이미지의 시원한 호흡을 살리면서도 본문 페이지에서 긴 문장을 안정적으로 받아내고, 큰 제목과 바코드, 세로 정보가 들어가는 페이지에서는 구성 요소를 또렷하게 분리하는 필드로 작동한다.",why_font:"표지와 큰 제목에서는 밥 길 특유의 직설성과 유머를 살릴 수 있는 강한 디스플레이 활자 감각이 전면에 드러나고, 본문은 사례 설명과 서술을 안정적으로 전달하는 보다 절제된 텍스트용 서체로 구성된다. 책 전체는 특정 서체의 개성보다 문제 해결 방식과 시각적 재치가 먼저 보이도록 설계된 인상을 준다.",why_tracking:"본문은 긴 호흡의 설명과 사례 서술을 위해 중립적인 자간과 넉넉한 행간을 유지하고, 제목과 표지 카피는 보다 단단하고 응축된 간격으로 처리해 선언적 어조를 강화한다. 큰 판형 안에서 이미지와 활자의 비중 차가 크므로 간격 조절이 리듬 형성의 핵심이다.",layout_type:"본문 2단 + 주석 1단(2열)"},
  {g:"현대미술",pub_type:"실험출판",t:"작품 설명 영어판",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/explained-en-kr/",img:"107_작품 설명 영어판",kw:["현대미술","실험출판","작품","설명","영어판","프로젝트별","설명을","하나씩","이어","붙이는","목록형","미상"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:105,h:150},m:{상:12,하:14,안:10,밖:10},c:{구성:"2단",간격:3},b:{크기:11,행간:13,자간:0},ty:{이름:"미상",분류:"명조"},pn:"하단-외측-가로",pn_x_left:"15.9mm",pn_y_left:"139.5mm",pn_x_right:"86.6mm",pn_y_right:"139.5mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"10pt",footnote:"8.5pt",특:"프로젝트별 설명을 하나씩 이어 붙이는 목록형 구조다. 본문은 비교적 짧은 설명문이 연속되는 1단 배열을 기본으로 하고, 항목 번호와 프로젝트명이 사전식·색인식 리듬을 만든다. 간헐적으로 삽입되는 추상적 이미지나 흑백 전면 이미지는 설명을 보완하기보다 설명 자체를 감상 대상으로 전환시키는 쉼표처럼 기능한다.",summary:"슬기와 민이 진행한 프로젝트 200여 개의 이면의 과정과 의도를 말로만 밝힌 책의 영어판. 예술 작품은 설명보다 경험되어야 한다는 통념을 뒤집어, 설명 없이 작품을 감상할 수 있다면 작품 없는 설명 역시 감상의 대상이 될 수 있지 않겠느냐는 역설적 제안을 책의 형식으로 구현한다. 작은 판형, 절제된 타이포그래피, 흑백 대비가 설명 자체를 하나의 독립된 작업처럼 읽히게 만든다.",why_dim:"작고 응축된 포켓북형 판형으로, 200여 개의 짧은 설명을 사전이나 메모집처럼 차례로 읽게 하면서도 ‘작품 없는 감상’이라는 개념적 전환을 친밀한 독서 경험으로 바꾸기에 적합하다.",why_margin:"작은 판형 안에서 설명문이 사전식 목록처럼 차례로 이어지도록 단정한 여백 구조를 사용한다. 흑백의 강한 대비와 도판 없는 페이지, 또는 추상적 이미지가 들어간 페이지가 교차해 여백이 텍스트의 존재감을 부각하는 장치로 작동한다. 하단 여백은 쪽번호와 항목 번호의 리듬을 안정적으로 정리한다.",why_font:"영어판 본문은 작은 판형에서도 높은 판독성을 유지하는 절제된 텍스트용 서체를 중심으로 구성되고, 항목 번호나 제목은 보다 중립적이고 기능적인 활자 감각을 따른다. 특정한 서체 개성을 과시하기보다 ‘설명만으로 이루어진 책’이라는 개념이 먼저 드러나도록 활자 사용을 자제한 인상이 강하다.",why_tracking:"작은 판형에서 긴 설명이 답답해지지 않도록 본문은 중립 자간에 약한 확장을 두고, 행간 역시 다소 여유 있게 잡아 항목별 설명이 독립된 단위로 읽히게 한다. 제목과 항목 번호는 더 응축된 간격으로 처리해 목록성과 정보 구조를 선명하게 만든다.",layout_type:"본문 1단 + 주석 2단"},
  {g:"현대미술",pub_type:"실험출판",t:"작품 설명 한국어판",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/explained-kr/",img:"108_작품 설명 한국어판",kw:["현대미술","실험출판","작품","설명","한국어판","프로젝트별","설명을","하나씩","이어","붙이는","목록형","미상"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:105,h:150},m:{상:12,하:14,안:10,밖:10},c:{구성:"2단",간격:3},b:{크기:11,행간:13,자간:0},ty:{이름:"미상",분류:"명조"},pn:"하단-외측-가로",pn_x_left:"15.9mm",pn_y_left:"139.5mm",pn_x_right:"86.6mm",pn_y_right:"139.5mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"10pt",footnote:"8.5pt",특:"프로젝트별 설명을 하나씩 이어 붙이는 목록형 구조다. 본문은 짧은 설명문이 연속되는 1단 배열을 기본으로 하고, 항목 번호와 프로젝트명이 사전식·색인식 리듬을 만든다. 간헐적으로 삽입되는 추상적 이미지나 면 전체를 점유하는 그래픽은 설명을 보충하기보다 설명 자체를 감상 대상으로 전환시키는 장치로 기능한다.",summary:"슬기와 민이 진행한 프로젝트 200여 개 이면의 과정과 의도를 하나씩 말로만 밝힌 책의 한국어판. 예술 작품은 설명보다 경험되어야 한다는 금언을 뒤집어, 설명 없이도 작품을 감상할 수 있다면 작품 없는 설명 감상도 가능하지 않을까라는 역설적 제안을 책의 형식으로 밀어붙인다. 작은 판형, 절제된 조판, 간헐적으로 삽입되는 추상적 이미지가 설명 자체를 하나의 독립된 감상 대상으로 전환한다.",why_dim:"작고 응축된 포켓북형 판형으로, 200여 개 설명을 사전이나 메모집처럼 연속해서 읽게 하면서도 ‘작품 없는 감상’이라는 개념적 전환을 친밀하고 사적인 독서 경험으로 바꾸기에 적합하다.",why_margin:"작은 판형 안에서 설명문이 조용히 이어지도록 단정한 여백 구조를 사용한다. 흑백 또는 제한된 색의 추상적 이미지가 들어가는 페이지와 텍스트 위주의 페이지가 교차하며, 여백은 설명의 밀도와 호흡을 조절하는 장치로 작동한다. 하단 여백은 쪽번호와 항목 리듬을 안정적으로 정리한다.",why_font:"본문은 작은 판형에서도 높은 판독성을 유지하는 절제된 텍스트용 서체를 중심으로 구성되고, 항목 번호나 제목은 보다 중립적이고 기능적인 활자 감각을 따른다. 특정 서체 개성을 과시하기보다 ‘설명만으로 이루어진 책’이라는 개념이 먼저 드러나도록 활자 사용을 자제한 인상이 강하다.",why_tracking:"작은 판형에서 긴 설명이 답답해지지 않도록 본문은 중립 자간에 약한 확장을 두고, 행간 역시 다소 여유 있게 잡아 항목별 설명이 독립된 단위로 읽히게 한다. 제목과 항목 번호는 더 응축된 간격으로 처리해 목록성과 정보 구조를 선명하게 만든다.",layout_type:"본문 1단 + 주석 2단"},
  {g:"건축·공간",pub_type:"전시도록",t:"7½ 2014~2016",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/seven-and-a-half-2014-2016-kr/",img:"109_7½ 2014~2016",kw:["건축·공간","전시도록","7½","2014~2016","진행","중인","프로젝트의","잠정적","보고서라는","성격에","아리따","돋움"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:150,h:210},m:{상:9,하:21,안:22,밖:12},c:{구성:"4단",간격:4},b:{크기:10.5,행간:17,자간:0},ty:{이름:"아리따 돋움, 프루티거",분류:"고딕"},pn:"양끝 모서리 세로 한 줄 / 외측 / 세로",pn_x_left:"0mm",pn_y_left:"0mm",pn_x_right:"145mm",pn_y_right:"0mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"10.5pt",footnote:"7.5pt",특:"진행 중인 프로젝트의 잠정적 보고서라는 성격에 맞춰 본문, 인터뷰, 프로젝트 기록, 전시 사진, 참고 이미지가 혼합 배치된다. 전통 접지와 스테이플 제본은 완결된 책보다 작업 중인 묶음에 가까운 인상을 주며, 표지와 속장의 물성을 동일하게 맞춰 손상과 마모까지 디자인 일부로 끌어들인다.",summary:"큐레이터 오선영이 기획한 ‘7½’ 프로젝트의 첫 두 해 활동을 기록한 책. 디지털 오프셋 인쇄, 전통 접지, 스테이플 제본을 사용해 완결된 결과물보다 진행 중인 작업의 잠정적 보고서라는 성격을 드러낸다. 속장과 같은 종이로 만든 표지는 쉽게 닳고 손상되며, 접힌 지면 모서리에 배치된 페이지 번호는 프로젝트 이름 7½에 착안한 장치로서 두 페이지 사이의 좁은 공간 자체를 강조한다.",why_dim:"프로젝트의 잠정성과 실험성을 드러내면서도 텍스트와 도판을 안정적으로 수용할 수 있는 중간 크기 판형. 전통 접지 구조와 접힌 모서리의 페이지 번호 장치를 구현하기에 적절한 비율이다.",why_margin:"접지 구조와 모서리의 페이지 번호가 판면 인지에 적극 개입하므로, 여백은 단순한 비워진 공간이 아니라 접힘과 읽기 흐름을 드러내는 구조 장치로 작동한다. 본문과 도판이 안정적으로 놓이되, 접힌 가장자리의 좁은 영역이 지속적으로 시선을 환기한다.",why_font:"본문에는 비교적 중립적이고 명료한 고딕 계열을 사용해 프로젝트 기록물로서의 정보 전달력을 확보하고, 제목과 보조 정보는 프루티거 계열의 현대적 산세리프와 결합해 제도성과 실험성 사이의 긴장을 만든다. 조형적 과장보다 구조적 명료성이 우선되는 서체 선택이다.",why_tracking:"접지 구조와 모서리 번호 장치가 읽기 리듬에 개입하므로 본문은 비교적 안정된 자간과 행간을 유지해 판독성을 확보하고, 제목과 섹션 정보는 약간 압축하거나 확장해 구조적 전환점을 명확히 한다.",layout_type:"본문 3단 + 주석 4단(1열)"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"K-컨템퍼러리 3호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/k3-kr/",img:"110_K-컨템퍼러리 3호",kw:["아트이론·비평","잡지·저널","K-컨템퍼러리","3호","표지에서는","초대형","영문","이니셜을","통해","시리즈성을","미기재"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:170,h:240},m:{상:12,하:12,안:21,밖:11},c:{구성:"3단",간격:4},b:{크기:9,행간:17,자간:0},ty:{이름:"미기재",분류:"명조"},pn:"중앙-내측-세로",pn_x_left:"154.3mm",pn_y_left:"112mm",pn_x_right:"5.2mm",pn_y_right:"112mm",pn_size:"25pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"13pt",footnote:"6.5pt",특:"표지에서는 초대형 영문 이니셜을 통해 시리즈성을 강조하고, 목차와 내지에서는 비교적 절제된 본문 조판 위에 공연 사진과 대담, 에세이, 비평을 섞어 배치한다. 가장자리의 수평 줄무늬 패턴은 무대의 막, 커튼, 혹은 리듬 단위를 연상시키며 책 전체를 관통하는 시각 시스템이 된다.",summary:"국립현대무용단이 발행한 『K-컨템퍼러리』 3호. 영문 제목의 거대한 ‘K3’를 표지 전면에 배치해 시리즈 아이덴티티를 강하게 각인하고, 내지에서는 검은 막대형 가장자리 패턴과 흑백 공연 사진, 장문 비평 텍스트를 병치해 한국 동시대 무용 담론의 제도성과 현장성을 함께 드러낸다.",why_dim:"기관 발행 저널로서 장문 비평, 대담, 기록 사진을 안정적으로 담으면서도 공연 사진과 표제 타이포그래피가 충분히 호흡할 수 있도록 한 중간 크기 판형.",why_margin:"넉넉한 여백 위에 긴 비평문과 공연 사진, 장 제목, 목록이 또렷이 분리되도록 설계된 판면. 가장자리의 반복 패턴과 외곽 여백이 저널의 리듬을 만들고, 중앙 판면은 비교적 고전적인 읽기 안정성을 유지한다.",why_font:"제공된 정보에 서체명이 별도로 적혀 있지 않지만, 표지의 압도적인 산세리프형 대문자와 내지의 보다 절제된 본문 활자 사이의 대비가 핵심이다. 표지 활자는 기관 저널의 공공성과 시리즈 정체성을, 내지 활자는 비평지의 안정된 독서성을 담당하는 방식으로 보인다.",why_tracking:"기관 저널답게 본문은 가독성을 우선해 중립 자간과 여유 있는 행간을 유지하고, 표지와 섹션 표제는 강한 응축감으로 시각적 위계를 세운다. 정보성과 현장성의 균형을 위해 과장보다 안정이 우선되는 간격 설계다.",layout_type:"본문 2단 + 주석 1단"},
  {g:"아트이론·비평",pub_type:"기관출판",t:"미래 예술",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/future-art-kr/",img:"111_미래 예술",kw:["아트이론·비평","기관출판","미래","예술","기본은","장문","읽기를","위한","정공법","FF","밸런스"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:112,h:180},m:{상:9,하:18,안:11,밖:11},c:{구성:"2단",간격:6},b:{크기:10,행간:17,자간:0},ty:{이름:"FF 밸런스, SM 견출고딕, SM 중고딕",분류:"고딕"},pn:"하단-외측-가로",pn_x_left:"10.7mm",pn_y_left:"167mm",pn_x_right:"206.8mm",pn_y_right:"167mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"-",footnote:"8pt",특:"기본은 장문 읽기를 위한 정공법 1단 조판이지만, 제목과 장 도입부에서는 굵고 대담한 활자가 강한 존재감을 갖는다. 작은 판형 안에 두꺼운 분량을 밀도 높게 압축하고, 흑백 또는 저채도 공연 사진과 참고 목록, 작가 목록을 끼워 넣으며 하나의 아카이브형 비평서를 구성한다.",summary:"연극과 춤, 몸, 언어, 극장, 실재, 관객 같은 개념을 가로지르며 동시대 공연예술의 흐름과 앞으로의 가능성을 묻는 총서형 단행본. 표지는 내지와 거의 구별되지 않을 정도로 얇고 연약한 물성을 취하고, 제목 없는 앞표지에 휴머노이드 로봇 이미지를 배치해 미래성과 불안, 정서적 거리감을 압축적으로 제시한다. 반면 내지는 굵고 대담한 본문 타이포그래피로 이 연약함을 역으로 지탱한다.",why_dim:"장문의 공연예술 비평과 참고 목록을 밀도 있게 담으면서도 손에 잡히는 문고형에 가까운 긴 세로 비례를 유지하기 위한 판형. 이론서이지만 선언문집이나 총서처럼 읽히는 응축감을 만들고, 작은 책 크기와 두꺼운 분량의 긴장을 통해 책 자체의 물성을 강조한다.",why_margin:"좁고 긴 판형 안에서 장문 본문, 이미지 도판, 작가 목록, 참고 주석을 안정적으로 수용하는 조밀한 판면. 비교적 절제된 여백을 유지하되 하단과 외측 여백을 이용해 쪽수와 섹션 정보를 또렷하게 정리하고, 본문 덩어리의 압박감을 통해 책 전체의 이론적 밀도를 시각화한다.",why_font:"본문은 견고하고 중립적인 산세리프 계열을 중심으로 조판해 공연예술 비평서의 현대적이고 비제도적인 톤을 만든다. 제목과 강조 요소에는 보다 두껍고 압력이 강한 고딕 계열을 사용해 얇은 표지의 연약한 물성과 대비를 이루며, 작은 책 안에서도 담론의 밀도와 선언성을 확보한다.",why_tracking:"작은 판형과 두꺼운 분량에서 가독성을 유지하기 위해 본문은 중립 자간과 비교적 여유 있는 행간을 사용하고, 제목과 장 표제는 더 조밀하고 강한 덩어리감으로 처리한다. 텍스트의 압축감은 유지하되 독서 피로를 막기 위한 최소한의 호흡을 확보하는 방식이다.",layout_type:"본문 1단 + 주석 2단"},
  {g:"건축·공간",pub_type:"잡지·저널",t:"계간 시청각 창간 준비호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/avp-quarterly-kr/",img:"112_계간 시청각 창간 준비호",kw:["건축·공간","잡지·저널","계간","시청각","창간","준비호","표지에서는","공간","로고인","삼각형","개와","최소한의","태고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"-",f:{w:126,h:204},m:{상:17,하:22,안:14,밖:14},c:{구성:"1단",간격:0},b:{크기:11,행간:17,자간:0},ty:{이름:"SM 태고딕, 메종 노이에",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"58.8mm",pn_y_left:"188.2mm",pn_x_right:"58.7mm",pn_y_right:"188.2mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자, 양쪽 소괄호 쳐짐",running:"11pt",subheading:"17pt",footnote:"-",특:"표지에서는 공간 로고인 삼각형 세 개와 최소한의 문자 정보만으로 정체성을 구성하고, 내지에서는 장문 텍스트를 중심으로 한 차분한 1단 조판을 사용한다. 정식 창간호에 비해 구조는 훨씬 단순하지만, 로고 대체 방식과 제목 체계에서 이후 시리즈의 기본 문법이 이미 드러난다.",summary:"미술 공간 시청각의 창간 준비호로, 표제의 핵심인 ‘시청각’을 공간 로고인 삼각형 세 개로 대체해 저널의 정체성을 간결하게 제시한 소책자. 창간호 이전의 예비 단계라는 성격에 맞게 장식적 요소를 최소화하고, 로고와 활자만으로 공간의 시각 언어와 출판 방향을 시험한다.",why_dim:"정식 계간지 이전의 얇은 소책자 형식에 적합한 세로형 판형으로, 저널의 정체성을 또렷하게 보여 주면서도 제작 부담을 낮추기 위한 선택. 전시 공간에서 배포하거나 소개용으로 읽히기 좋은 크기다.",why_margin:"비교적 얇은 분량의 소책자이므로 여백은 넉넉하고 단정하게 유지된다. 표지에서는 상단 로고와 제목부가 큰 빈 공간 위에 놓여 창간 준비호 특유의 시험적이고 선언적인 인상을 만들고, 내지에서는 본문 주변의 여백이 글의 밀도를 안정화한다.",why_font:"공간의 로고와 직접 맞물리는 제목 체계에는 단정하고 구조적인 산세리프가 적합하다. 태고딕의 단단한 형태와 메종 노이에의 현대적 명료함이 결합해, 미술 공간의 출판물이자 평론지의 출발점이라는 성격을 간결하고 또렷하게 전달한다.",why_tracking:"창간 준비호답게 본문은 과도한 개성을 드러내지 않고 안정적인 자간과 행간을 유지한다. 대신 표지의 로고와 제목은 약간 조인 간격으로 묶어 상징성을 강화하고, 넓은 여백과 대비되게 처리해 선언적 인상을 만든다.",layout_type:"본문 1단"},
  {g:"시각문화·매체",pub_type:"잡지·저널",t:"옵.신 6호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/ob-scene-6-kr/",img:"113_옵.신 6호",kw:["시각문화·매체","잡지·저널","옵.신","6호","면에는","일정","두께의","검은","프레임이","반복되고","별도","명시"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"-",f:{w:297,h:420},m:{상:35,하:308,안:36,밖:36},c:{구성:"2단",간격:8},b:{크기:11.5,행간:17,자간:0},ty:{이름:"별도 명시 없음",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"135.1mm",pn_y_left:"340.8mm",pn_x_right:"135.1mm",pn_y_right:"340.8mm",pn_size:"122pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"11.5pt",subheading:"11.5pt",footnote:"11.5pt",특:"각 면에는 일정 두께의 검은 선 프레임이 반복되고, 그 안쪽에서 본문은 좌상단에 몰리거나 세로·사선으로 배치되며, 이미지도 하단이나 측면에 고립되어 나타난다. 큰 쪽번호와 소수의 색상(적·청·흑)이 강한 방향성을 만들고, 일반적인 기사형 조판 대신 인용 파편들을 공간적으로 배열하는 방식이 핵심이다.",summary:"다원 예술 저널 『옵.신』 6호. A3 대형 판형과 중철 제본을 사용해 포스터와 잡지의 중간 같은 물성을 만들고, 다양한 인용 텍스트와 이미지로 ‘허공’의 의미와 불가능한 형태를 더듬는다. 5호가 설치 겸 퍼포먼스 형태였다면 6호는 그것에 대한 인쇄물 형식의 응답으로서, 국립현대미술관 서울관 전시 『보이드』와 연계해 출간되었다.",why_dim:"일반 잡지보다 훨씬 큰 A3 판형을 택해 읽는 매체이면서 동시에 벽면 포스터처럼 작동하게 하려는 선택. 텍스트와 이미지가 페이지 안에서 흩어지거나 부유하는 감각을 극대화하고, 허공·보이드·설치라는 전시 맥락을 물리적 크기로 직접 번역한다.",why_margin:"네 변을 따라 검은 선 프레임을 두고 내부를 거의 비워 둔 레이아웃이 기본이다. 여백은 단순한 빈 공간이 아니라 텍스트와 이미지가 떠다니는 장(field)으로 작동하며, A3 크기 안에서 작은 활자와 큰 쪽번호, 기울어진 문장, 고립된 이미지가 서로 멀리 떨어진 채 긴장 관계를 만든다.",why_font:"이 호의 핵심은 특정 서체의 브랜드감보다 배치와 방향성에 있다. 작은 본문은 담담하게 정보를 전달하지만, 회전·사선·세로 조판과 숫자 확대, 적청색 대비를 통해 활자가 공간적 오브제로 바뀐다. 전유와 몽타주, 파편적 인용이라는 편집 전략이 서체 선택보다 조판 행위에서 더 강하게 드러난다.",why_tracking:"넓은 판형 안에서 활자가 고립되어 보여야 하므로 자간은 중립 또는 약간 확장 쪽이 어울리고, 사선·세로 배치에서는 문자 간격이 형태를 더 분명하게 드러내는 역할을 한다. 본문은 압축되지 않지만, 공간 전체는 비어 있음으로 인해 오히려 더 큰 긴장감을 갖는다.",layout_type:"본문 1-2단 가변"},
  {g:"시각문화·매체",pub_type:"잡지·저널",t:"1990년대",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/heren-kr/",img:"114_1990년대",kw:["시각문화·매체","잡지·저널","1990년대","페이지마다","패션","사진이","크게","놓이고","위에","별도","명시"],align_title:"-",align_body:"-",align_note:"-",f:{w:240,h:335},m:{상:0,하:0,안:0,밖:0},c:{구성:"-",간격:0},b:{크기:0,행간:0,자간:0},ty:{이름:"별도 명시 없음",분류:"혼합 / 비명시"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"-",subheading:"-",footnote:"-",특:"페이지마다 패션 사진이 크게 놓이고, 그 위에 과거 패션 매거진 디자인에서 유도한 흐릿한 검은 실루엣, 얼룩, 타이포 잔상 같은 요소가 덧씌워진다. 일반적인 캡션 중심 화보 편집이 아니라 이미지와 그림자 레퍼런스가 한 화면 안에서 충돌하도록 구성되어, ‘직접적이면서도 은밀한’ 차용 방식을 시각적으로 드러낸다.",summary:"헤렌 2016년 11월 호를 위해 만든 패션 에디토리얼. 1990년대 초중반 파비앵 바롱이 이탈리아 보그, 인터뷰, 하퍼스 바자 등에서 만든 이미지를 직접 복제하지 않고, 그 형식 언어만 불러내 흐릿한 그림자 같은 형상으로 변환해 사진 위에 겹쳤다. 결과적으로 페이지는 패션 화보이면서도 유령처럼 과거 디자인의 잔상을 끌어안은 이미지 장이 된다.",why_dim:"패션지 화보의 시원한 이미지 전개와 전면 도판 중심 구성을 수용하기 위한 대형 잡지 판형. 사진의 힘을 충분히 살리면서도, 참조된 1990년대 패션 매거진 디자인의 과장된 여백과 오버레이 효과를 재현하기에 적합하다.",why_margin:"전면 이미지 중심 구성 위에, 흐릿한 검은 형상과 일부 색 번짐이 별도의 레이어처럼 덮인다. 여백은 거의 배경으로 소거되고, 사진 프레임과 오버레이된 그림자 형태가 판면의 긴장을 만든다. 작은 텍스트보다 이미지 간 충돌과 위치 관계가 우선하는 편집이다.",why_font:"이 작업의 핵심은 서체보다 이미지 위에 얹힌 흐릿한 형상이다. 파비앵 바롱식 1990년대 패션 에디토리얼의 인상적인 타이포그래피와 도형 언어를 직접 재현하지 않고, 디테일을 증발시킨 유령 같은 흔적으로 치환함으로써 과거의 스타일을 기억처럼 호출한다. 활자 역시 읽기보다 분위기와 잔상의 일부로 작동했을 가능성이 크다.",why_tracking:"텍스트 비중은 낮고 이미지가 주도하므로 자간·행간은 기능적 수준에서만 조정되었을 가능성이 높다. 대신 중요한 것은 오버레이된 검은 형상이 사진과 맺는 간격, 가장자리의 흐림 정도, 화면 내부의 밀도 차이이며, 이것이 1990년대 패션 이미지의 직접적이면서도 몽환적인 긴장을 만든다.",layout_type:"-"},
  {g:"문학",pub_type:"단행본",t:"사람들이 가득한 트렁크",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/un-baule-pieno-di-gente-kr/",img:"115_사람들이 가득한 트렁크",kw:["문학","단행본","사람들이","가득한","트렁크","전체적으로는","매우","절제된","문학서","레이아웃이지만","본문과","신신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬, 좌측 정렬(일부)",align_note:"양끝 정렬",f:{w:120,h:192},m:{상:15,하:48,안:18,밖:18},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:-60},ty:{이름:"SM 신신명조, 시몬치니 개러몬드, 아리따 돋움, 애퍼수",분류:"명조"},pn:"하단-외측-대각선",pn_x_left:"7.2mm",pn_y_left:"176.4mm",pn_x_right:"109.2mm",pn_y_right:"176.4mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 가로 / 대각선",running:"9pt",subheading:"12pt",footnote:"7pt",특:"전체적으로는 매우 절제된 문학서 레이아웃이지만, 본문과 각주의 관계, 문장 길이와 줄 길이, 서체의 대비를 통해 판면 자체에 은근한 조형성이 생긴다. 표지에서는 녹색 타이포그래피와 흑백 일러스트가 비교적 강한 인상을 주지만, 내지에서는 모든 요소가 무리 없이 정돈되어 자연스러운 읽기 흐름을 만든다.",summary:"안토니오 타부키 선집의 한 권으로, 슬기와 민이 본문 조판 영역에서 자신의 조형적 입장을 가장 선명하게 드러낸 사례 중 하나다. 본문과 각주, 글줄의 리듬과 타이포그래피가 기능적으로 매우 안정적이면서도 현대적인 북 디자인 감각을 자연스럽게 보여 준다. 김광철이 말했듯 우리 시대의 가장 아름답고 급진적인 북 디자인 가운데 하나로 평가될 만한 책이다.",why_dim:"장편 산문과 각주, 문학 텍스트의 호흡을 안정적으로 수용하면서도 손에 잡히는 소설 판형의 친밀함을 유지하기 위한 크기. 문학동네 양장본 계열의 읽기 경험에 맞추어 조형 실험이 과하지 않게 스며들 수 있는 비율이다.",why_margin:"본문과 각주가 한 판면 안에서 자연스럽게 공존하도록 설계된 균형 여백. 장문의 문학 텍스트가 안정적으로 흐르도록 상하 여백을 충분히 두고, 하단에서는 쪽수와 각주, 본문 블록의 위계를 정리한다. 기능적으로 보이지만 실제로는 글줄의 조형감을 세심하게 통제하는 판면이다.",why_font:"본문은 문학 텍스트에 어울리는 명조와 세리프 계열을 중심으로 안정적인 독서감을 확보하고, 보조 정보와 표지 타이포그래피에는 보다 현대적인 산세리프를 병용해 고전성과 동시대성을 함께 드러낸다. 겉으로는 무리 없는 전통적 북 디자인처럼 보이지만, 실제로는 글줄과 자간, 본문-각주 관계에서 조형적 긴장이 매우 정교하게 다듬어져 있다.",why_tracking:"문학 텍스트의 자연스러운 호흡을 위해 과장되지 않은 자간과 넉넉한 행간을 유지하되, 지나치게 느슨하지 않게 글줄의 밀도를 정제하는 방향이다. 이 책의 미덕은 실험성이 전면으로 드러나는 것이 아니라, 읽다 보면 본문 판면 자체가 얼마나 섬세하게 조율되어 있는지 천천히 감지된다는 데 있다.",layout_type:"본문 1단"},
  {g:"타이포그래피",pub_type:"단행본",t:"소문에 맞서는 진실",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/truth-against-rumour-kr/",img:"116_소문에 맞서는 진실",kw:["타이포그래피","단행본","소문에","맞서는","진실","처음에는","조용한","본문처럼","시작하지만","같은","문장이","견출명조"],align_title:"우측 정렬",align_body:"우측 정렬",align_note:"우측 정렬",f:{w:218,h:266},m:{상:15,하:22,안:15,밖:52},c:{구성:"1단",간격:0},b:{크기:9.5,행간:15,자간:0},ty:{이름:"SM 견출명조",분류:"명조"},pn:"하단-외측-가로",pn_x_left:"15mm",pn_y_left:"251.6mm",pn_x_right:"198.7mm",pn_y_right:"251.6mm",pn_size:"7pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자(000)",running:"7pt",subheading:"8.5pt",footnote:"-",특:"처음에는 조용한 본문처럼 시작하지만, 같은 문장이 페이지를 거듭하며 점점 커지고, 결국 활자 획이 미세한 기사 텍스트 덩어리로 드러나며 판면 전체를 덮는다. 활자 크기 스펙을 상단에 표기하고, 하단에는 종이 정보와 쪽번호를 두어, 읽기와 서체 해부가 동시에 일어나게 하는 구성이다.",summary:"페드리고니의 시리즈 간행물 16/3의 세 번째 책. 디자이너에게 주어진 16면과 종이 조건 안에서 활자체 하나를 만드는 일로 시작했고, 길 산스를 연상시키지만 모든 획이 실제로는 증권 시장 관련 신문 기사 텍스트로 이루어진 서체를 제작했다. 그 서체로 비어트리스 워드의 「This Is a Printing Office」를 조판하며, 탈진실 시대의 인쇄와 진실의 물리적 토대라는 문제를 다시 묻는다.",why_dim:"16면짜리 짧은 시리즈 간행물 안에서 활자 크기 변화 자체를 내용으로 삼고, 한 서체가 점진적으로 확대·해체되는 과정을 충분히 보여 주기 위한 판형. 포스터처럼 넓지는 않지만 실험적 타이포그래피 전개를 단계적으로 체험하기에 적절한 크기다.",why_margin:"매 페이지마다 동일한 문장이 다른 크기와 밀도로 반복되며, 작은 본문에서 시작해 활자 전체가 판면을 점유할 정도로 확대된다. 하단과 상단의 작은 정보 요소는 고정되어 있고, 중앙의 텍스트 덩어리가 점차 구조를 바꾸며 커진다. 여백은 활자의 성장과 해체를 관찰하는 실험실 같은 역할을 한다.",why_font:"겉보기에는 고전적인 명조의 골격을 가진 서체처럼 보이지만, 실제로는 모든 획이 신문 기사 문장으로 이루어진 구조다. 즉 읽히는 텍스트가 다시 큰 글자의 재료가 되면서, 인쇄가 진실을 고정하고 전달하는 매체라는 믿음 자체를 형식적으로 되묻는다. 명조의 전통성과 정보의 소음이 한 몸에 포개진 셈이다.",why_tracking:"활자 자체가 기사 텍스트로 이루어져 있으므로 자간과 행간은 일반 본문보다 구조 인식에 더 중요하다. 초기 페이지는 비교적 읽기 가능한 밀도를 유지하지만, 크기가 커질수록 문자 간격보다 획 내부의 미세 텍스트와 전체 형상이 우선되며, 자간은 형태를 무너뜨리지 않는 선에서 중립적으로 유지된다.",layout_type:"본문 1단"},
  {g:"시각문화·매체",pub_type:"잡지·저널",t:"국립아시아문화전당 예술극장—2015~2016 리뷰",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/asia-culture-center-theater-2015-2016-review-kr/",img:"117_국립아시아문화전당 예술극장—2015~2016 리뷰",kw:["시각문화·매체","잡지·저널","국립아시아문화전당","예술극장","2015~2016","리뷰","권은","세로형으로","조직된","기관","리뷰와","사업","노이에","하스"],align_title:"좌측 정렬",align_body:"양끝 정렬, 좌측 정렬(일부)",align_note:"좌측 정렬",f:{w:210,h:300},m:{상:12,하:12,안:18,밖:12},c:{구성:"2단",간격:7},b:{크기:10,행간:16,자간:0},ty:{이름:"노이에 하스 그로테스크",분류:"고딕"},pn:"하단-우측-가로",pn_x_left:"146mm",pn_y_left:"292.3mm",pn_x_right:"152mm",pn_y_right:"292.3mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자(000)",running:"-",subheading:"10pt",footnote:"6pt",특:"한 권은 세로형으로 조직된 기관 리뷰와 사업 보고의 흐름을 따르고, 다른 한 권은 가로형으로 브로슈어와 행사 자료를 묶어 아카이브 열람에 가깝게 작동한다. 두 책의 방향 차이가 곧 내용 차이를 설명하며, 케이스와 새 표지가 전체를 하나의 시스템으로 정리한다.",summary:"국립아시아문화전당 예술극장에서 김성희가 첫 예술감독으로 재직하던 시기의 사업을 정리한 두 권짜리 간행물. 1권은 내부 보고서 성격의 세로형 문서, 2권은 행사별 브로슈어를 모은 가로형 책으로 구성되며, 같은 판형 안에서 방향만 달리해 복잡한 기관 활동을 병렬적으로 묶었다. 이를 통합하기 위해 새 표지와 단순한 판지 케이스를 더해 전체를 하나의 세트로 정리했다.",why_dim:"기관의 방대한 사업 기록과 브로슈어 아카이브를 충분히 수용하기 위한 대형 판형. 같은 크기에서 세로형과 가로형을 병치해 성격이 다른 두 권을 한 세트 안에 통합하면서도, 보고서와 자료집이라는 이중 구조를 물리적으로 분명히 드러내기 위한 선택이다.",why_margin:"큰 판형 안에 장문 본문, 사진, 연보, 브로슈어 이미지, 목록을 안정적으로 수용하는 기관 간행물형 판면이다. 1권은 리뷰와 해설, 사업 정리를 위한 문서적 구조가 중심이고, 2권은 가로 방향의 아카이브 열람성을 살린 이미지 중심 구조로 짜였다. 동일한 크기와 여백 체계가 두 권의 차이를 과도하게 벌리지 않고 묶어 준다.",why_font:"노이에 하스 그로테스크의 중립적이고 제도적인 성격이 기관 간행물의 공공성과 잘 맞는다. 과장 없는 고딕 계열을 사용해 공연예술의 다층적 내용을 감정적으로 포장하기보다, 리뷰·기록·자료라는 서로 다른 정보 층위를 차분하게 정리하는 쪽에 무게를 둔다.",why_tracking:"기관 간행물답게 본문은 안정적인 판독성을 우선해 중립 자간과 넉넉한 행간을 유지하고, 큰 제목이나 세로 면주에서는 방향성과 위계를 위해 다소 응축된 밀도를 취했을 가능성이 높다. 두 권의 방향 전환에도 동일한 리듬을 유지하는 것이 핵심이다.",layout_type:"본문 2단"},
  {g:"그래픽디자인",pub_type:"전시도록",t:"그래픽 디자인, 2005~2015, 서울—299개 어휘",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/299-terms-kr/",img:"118_그래픽 디자인, 2005~2015, 서울—299개 어휘",kw:["그래픽디자인","전시도록","그래픽","디자인","2005~2015","서울","299개","어휘","펼침은","좌우에","서로","다른","표제어","항목이","바른바탕체","프레스코"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:128,h:188},m:{상:26,하:27,안:15,밖:19},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:0},ty:{이름:"바른바탕체, 프레스코",분류:"명조"},pn:"하단-외측-가로",pn_x_left:"25.7mm",pn_y_left:"169.8mm",pn_x_right:"96.3mm",pn_y_right:"169.8mm",pn_size:"9pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"10pt",footnote:"8.5pt",특:"각 펼침은 좌우에 서로 다른 표제어 항목이 배치되는 사전형 구조를 기본으로 한다. 표제어와 영문 번역, 설명문이 정갈하게 정렬되고, 상호 참조 항목은 하이라이트 처리되어 항목 간 네트워크를 시각적으로 드러낸다. 표지는 최소한의 정보만 두고, 내용부의 반복 구조가 책 전체의 정체성을 만든다.",summary:"일민미술관에서 열린 전시 『그래픽 디자인, 2005~2015, 서울』과 연계된 사전 형식의 간행물. 2005~2015년 서울 그래픽 디자인 장면을 299개의 어휘로 정리하며, 단순한 타이포그래피와 편리한 판형, 실용적인 합성 수지 표지를 통해 참고서이자 동시대 디자인 담론서의 성격을 함께 갖춘다. 상호 참조 항목은 하이라이트 효과로 표시되어 사전적 탐색 구조를 강화한다.",why_dim:"사전처럼 손에 잡히고 반복 열람하기 쉬운 휴대성 있는 판형. 장문의 이론서보다 가볍고, 전시 연계 참고서로서 빠르게 넘겨보거나 특정 항목을 찾아보기에 적합한 비율이다.",why_margin:"사전형 읽기 구조에 맞춰 본문과 표제어, 영문 병기, 쪽번호가 안정적으로 들어가는 균형 여백을 유지한다. 과장 없는 판면 안에서 표제어와 설명문이 규칙적으로 반복되며, 하단 여백은 페이지 탐색과 참조 리듬을 정돈한다.",why_font:"본문과 표제어에는 차분하고 읽기 쉬운 바른바탕체가 중심을 이루고, 보조적인 영문이나 대비 요소에는 프레스코가 사용되어 사전 특유의 정돈된 지식 체계와 약간의 개성을 함께 만든다. 전반적으로는 과시적이지 않고, 참고서처럼 오래 읽혀도 피로하지 않는 활자 선택이다.",why_tracking:"사전식 짧은 항목 설명과 반복되는 표제어 구조를 안정적으로 읽히게 하기 위해 자간은 중립적으로 유지하고, 행간은 약간 넉넉하게 두어 항목 간 구분과 탐색성을 높인다. 하이라이트된 상호 참조 항목이 본문 안에서 자연스럽게 떠오르도록 전체 간격은 과도하게 조이지 않는다.",layout_type:"본문 1단"},
  {g:"현대미술",pub_type:"단행본",t:"갱생 150116~160115",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/rehab-kr/",img:"119_갱생 150116~160115",kw:["현대미술","단행본","갱생","150116~160115","날짜별","식단","기록을","중심으로","한국어와","영어가","노토","산스"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"-",f:{w:105,h:150},m:{상:5,하:71,안:10,밖:10},c:{구성:"1단",간격:0},b:{크기:10,행간:13,자간:20},ty:{이름:"노토 산스 / 본고딕, 아틀라스 그로테스크",분류:"혼합 (고딕 / 그로테스크)"},pn:"상단-우측-가로",pn_x_left:"89mm",pn_y_left:"4.5mm",pn_x_right:"89mm",pn_y_right:"4.5mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"-",footnote:"-",특:"날짜별 식단 기록을 중심으로 한국어와 영어가 병기되고, 시간표처럼 정리된 텍스트와 작은 사진이 반복되는 편집이다. 한 해 동안의 기록을 달력, 일기, 데이터 로그의 중간 형식처럼 구성하며, 파스텔 별색 인쇄가 전반적인 톤을 부드럽게 묶는다.",summary:"Sasa[44]가 술을 끊고 스스로 갱생한 12개월 동안 매일 섭취한 식단을 기록한 책. 작가가 요청한 러블리즈 「안녕」 뮤직비디오의 색감을 반영하기 위해 일반 원색 잉크 대신 파스텔 계열 별색 잉크를 사용했고, 한국어와 영어가 함께 배치된 일기적 데이터가 차분한 리듬으로 누적된다.",why_dim:"하루하루의 식단 기록을 손에 쥐고 읽는 일기나 수첩처럼 경험하게 하는 소형 판형. 긴 기간의 축적을 부담 없이 넘겨 볼 수 있고, 데이터성 기록물을 친밀하고 사적인 독서 경험으로 전환하기에 적합하다.",why_margin:"작은 판형 안에 날짜, 시간, 음식명, 인명, 사진이 규칙적으로 반복되는 구조다. 상단과 하단의 정보는 작고 담담하게 정리되고, 중간에는 하루를 대표하는 사진이나 목록이 놓인다. 넓은 여백 덕분에 기록의 누적이 과잉 데이터가 아니라 차분한 생활 리듬처럼 읽힌다.",why_font:"노토 산스 계열의 중립적이고 안정적인 본문 서체와 아틀라스 그로테스크의 세련된 현대성이 결합해, 사적인 기록과 동시대적 디자인 감각을 함께 만든다. 음식명과 시간표, 사람 이름이 반복적으로 등장하는 데이터형 텍스트를 과장 없이 정돈하면서도, 별색 인쇄와 어울리는 부드러운 인상을 유지한다.",why_tracking:"작은 판형에서 빽빽한 일정표처럼 보이지 않게 하려면 본문은 중립 자간에 약간 여유 있는 행간이 적절하다. 기록물의 반복성을 살리면서도 파스텔 색면과 부드럽게 어울리도록 문자 간격은 과도하게 조이지 않는 편이 맞다.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"잡지·저널",t:"옐로 페이지스—리뷰",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/yellow-pages-review-kr/",img:"120_옐로 페이지스—리뷰",kw:["인문·사회","잡지·저널","옐로","페이지스","리뷰","기본은","인터뷰","또는","대담","기사","편집이지만","TB","고딕"],align_title:"좌측 정렬",align_body:"양끝 정렬(한자), 좌측 정렬(영어)",align_note:"좌측 정렬",f:{w:225,h:297},m:{상:7,하:35,안:15,밖:7},c:{구성:"2단",간격:6},b:{크기:10,행간:11,자간:0},ty:{이름:"TB 고딕, 아틀라스 타이프라이터, 플라크 컨덴스드",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"87.7mm",pn_y_left:"263.5mm",pn_x_right:"96.48mm",pn_y_right:"263.5mm",pn_size:"82pt",pn_font:"고딕",pn_style:"흑색(윤곽선만) / 가로 / 숫자",running:"-",subheading:"10pt",footnote:"7pt",특:"기본은 인터뷰 또는 대담 기사 편집이지만, 일반 잡지처럼 텍스트를 얌전히 정렬하는 대신 전면 색지를 바탕으로 큰 면주, 하단의 대형 숫자, 로고형 타이포그래피를 함께 배치해 연재의 정체성을 유지한다. 영어·일본어 병기와 각주가 동시에 들어가며, 기사와 리뷰, 프로젝트 회고의 성격이 겹친다.",summary:"국제 그래픽 디자인 전문지 『아이디어』에 연재된 동아시아 디자인 특집 ‘옐로 페이지스’를 마무리한 뒤, 기획자 고토 데쓰야와 편집진을 오사카에서 만나 프로젝트를 되돌아본 대화를 실은 잡지 기사. 기존 연재의 상징색인 노랑 대신 보색인 파랑을 배경으로 사용해 리뷰 형식을 시각적으로 구분했고, 도시별 현지 디자이너의 목소리로 동아시아 디자인 문화를 들여다본 연재의 맥락을 되짚는다.",why_dim:"잡지 기사 지면에 맞춰 설계된 편집으로 보이며, 대담과 리뷰 텍스트를 충분히 담으면서도 양언어 병기와 주석, 장식적 타이포그래피를 함께 소화할 수 있는 넓은 지면 비율을 전제로 한다. 파란 바탕 전체를 하나의 필드처럼 쓰기 위해 여백보다 면 전체의 장악력이 중요해 보인다.",why_margin:"푸른 바탕 위에 좌우 2단 또는 다단 구성의 텍스트 블록을 두고, 하단에는 크게 잘린 ‘154’, ‘155’ 같은 페이지 숫자와 ‘YELLOW PAGES’ 로고가 장식적으로 배치된다. 영문과 일본어가 병기되며, 본문·주석·질문·답변이 한 면 안에서 계층적으로 정리된다. 면 전체가 하나의 포스터 같은 인상을 주면서도 대담 기사로서의 읽기 구조를 유지한다.",why_font:"TB 고딕을 중심으로 한 본문 체계에 아틀라스 타이프라이터와 플라크 컨덴스드를 병치해, 편집 기사이면서도 디자인 저널 특유의 제도성과 개성을 동시에 만든다. 연재물의 기록성과 인터뷰의 구술성, 그리고 프로젝트 브랜드로서의 ‘Yellow Pages’ 이미지를 각기 다른 서체 층위로 분담한 것으로 보인다.",why_tracking:"푸른 바탕 위에서 장문 대담을 안정적으로 읽히게 하려면 자간은 중립 내지 약간 확장 쪽이 유리하고, 다언어 병기와 주석까지 겹치므로 행간 역시 비교적 여유 있게 두는 편이 적절하다. 반면 하단의 대형 숫자와 로고형 요소는 더 타이트한 밀도로 처리되어야 화면 장악력이 생긴다.",layout_type:"본문 2단"},
  {g:"인문·사회",pub_type:"단행본",t:"래디컬 뮤지엄",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/radical-museology-kr/",img:"121_래디컬 뮤지엄",kw:["인문·사회","단행본","래디컬","뮤지엄","본문은","단정한","중심으로","흘러가되","신신명조"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"-",f:{w:110,h:175},m:{상:10,하:21,안:10,밖:12},c:{구성:"1단",간격:0},b:{크기:11,행간:20,자간:0},ty:{이름:"SM 신신명조, 미뉘스퀼",분류:"혼합 (명조 / 초소형 디스플레이)"},pn:"하단-외측-가로",pn_x_left:"17.5mm",pn_y_left:"160.7mm",pn_x_right:"88mm",pn_y_right:"160.7mm",pn_size:"11pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"11pt",footnote:"6pt",특:"본문은 단정한 1단 구조를 중심으로 흘러가되, 원어 병기가 특수한 방식으로 개입하고, 일러스트레이션과 확대된 활자 이미지가 장과 장 사이의 시각적 휴지를 만든다. 작은 판형과 덧표지, 강한 표지 색채 덕분에 학술 번역서이면서도 이론 핸드북이나 비평 팸플릿 같은 감각이 살아난다.",summary:"클레어 비숍의 미술관 비평서를 번역한 책. 핸드북 같은 느낌을 주기 위해 원작보다 작은 판형을 택했고, 양장본에 덧표지를 더해 소책자처럼 손에 잡히는 비평서를 만들었다. 원어 병기에는 극도로 작은 크기를 염두에 두고 개발된 미뉘스퀼을 사용해 본문 사이에 이례적인 병치 체계를 만들고, 일러스트레이션과 확대된 텍스트 이미지를 통해 현대 미술관 담론의 문제의식을 압축적으로 드러낸다.",why_dim:"미술관 제도 비평을 다루는 이론서를 일반 학술서보다 더 손에 잡히는 핸드북처럼 느끼게 하려는 선택. 작고 단단한 판형이 기동성과 밀도를 동시에 만들고, 짧지만 집약적인 논의를 동시대 미술관 현장에 대한 실천적 메모처럼 읽히게 한다.",why_margin:"작은 판형 안에 장문 본문, 원어 병기, 삽화, 확대된 텍스트 이미지가 공존한다. 기본은 안정된 1단 본문이지만, 덧표지와 표지 일러스트가 강한 인상을 만들고, 내지에서는 여백 속에 삽화나 큰 텍스트 조각이 삽입되어 읽기의 밀도에 리듬 변화를 준다. 원어 병기용 활자는 작지만 분명한 보조 층위를 형성한다.",why_font:"본문에는 안정적인 독서감을 주는 SM 신신명조를 사용하고, 원어 병기에는 극도로 작은 크기에서도 기능하도록 설계된 미뉘스퀼을 사용해 정보 위계를 섬세하게 나눈다. 이 조합은 학술 번역서의 차분함을 유지하면서도, 원어를 단순 괄호 처리하지 않고 별도의 시각 층위로 드러내려는 편집 의도를 분명히 보여 준다.",why_tracking:"작은 판형의 장문 독서에서 판독성을 유지해야 하므로 본문은 중립 자간과 넉넉한 행간이 적절하다. 반면 미뉘스퀼이 쓰이는 원어 병기 부분은 극소 크기에서도 뭉개지지 않아야 하므로 더 엄격한 간격 조정이 필요하고, 이 미세한 대비가 책 전체의 학술적 긴장을 만든다.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"잡지·저널",t:"옐로 페이지스—싱가포르",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/yellow-pages-singapore-kr/",img:"122_옐로 페이지스—싱가포르",kw:["인문·사회","잡지·저널","옐로","페이지스","싱가포르","인터뷰","본문과","프로젝트","사례","이미지","캡션","TB","고딕"],align_title:"중앙 정렬",align_body:"양끝 정렬(한자), 좌측 정렬(영어)",align_note:"양끝 정렬(한자), 좌측 정렬(영어)",f:{w:225,h:297},m:{상:7,하:6,안:15,밖:7},c:{구성:"4단",간격:7},b:{크기:10,행간:12,자간:0},ty:{이름:"TB 고딕, 아틀라스 타이프라이터, 플라크 컨덴스드",분류:"혼합 (고딕 / 타자기체)"},pn:"하단-중앙-가로",pn_x_left:"91mm",pn_y_left:"261.3mm",pn_x_right:"100.7mm",pn_y_right:"261.3mm",pn_size:"95pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"12pt",footnote:"7pt",특:"인터뷰 본문과 프로젝트 사례 이미지, 캡션, 주석이 강한 색면 위에 층층이 쌓인다. 페이지 하단의 대형 숫자와 고정 폭 제목은 연재의 시각적 정체성을 유지하고, 영문·일문 병기가 좌우 분할과 맞물리며 국제 디자인 저널로서의 문맥을 형성한다. 과밀한 정보량 자체가 도시의 속도와 에너지를 재현하는 방식이다.",summary:"국제 그래픽 디자인 전문지 『아이디어』에 연재된 동아시아 디자인 특집 ‘옐로 페이지스’의 마지막 회. 싱가포르의 디자인 그룹 포린 폴리시 디자인 그룹을 중심으로 현지 디자인 문화와 작업 환경을 다루며, 시리즈 제목을 직설적으로 반영한 노란 바탕 위에 빽빽한 텍스트와 굵은 고정 폭 활자 질감을 겹쳐 현대 아시아 도시의 밀도와 에너지를 시각화했다.",why_dim:"국제 디자인 저널의 특집 기사로서 인터뷰, 스튜디오 소개, 프로젝트 이미지, 캡션과 주석을 한 지면 안에 밀도 높게 수용하기 위한 중형 판형. 잡지 지면의 개방감은 유지하면서도 도시 리포트 특유의 과밀한 정보량을 담아내기에 적절하다.",why_margin:"강한 노란 바탕 전체를 하나의 필드로 삼고, 상단 인터뷰 텍스트, 중앙과 하단의 대형 이미지, 굵은 제목 타이포, 양언어 병기, 캡션, 각주, 대형 쪽번호가 촘촘하게 공존한다. 일반적인 기사 레이아웃보다 훨씬 밀도가 높으며, 정보가 쌓여 도시 풍경처럼 보이도록 설계된 지면이다.",why_font:"TB 고딕을 중심으로 한 본문 체계에 아틀라스 타이프라이터와 플라크 컨덴스드를 병치해, 기사 읽기 구조와 도시 특집의 거친 에너지를 동시에 만든다. 빽빽한 지면과 굵은 고정 폭 활자 질감은 현대 아시아 도시 풍경을 연상시키며, 인터뷰의 기록성과 디자인 저널의 시각적 아이덴티티를 함께 떠받친다.",why_tracking:"빽빽한 정보량을 소화해야 하므로 본문은 중립 자간에 비교적 여유 있는 행간을 유지해 판독성을 확보하고, 대형 제목과 숫자는 더 응축된 밀도로 처리해 화면 장악력을 높인다. 작은 활자와 큰 활자가 공존하는 대비가 도시적 과밀감과 리듬을 만든다.",layout_type:"본문 2단 + 주석 4단"},
  {g:"문학",pub_type:"잡지·저널",t:"K-컨템퍼러리 2호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/k-contemporary-2-kr/",img:"123_K-컨템퍼러리 2호",kw:["문학","잡지·저널","K-컨템퍼러리","2호","기본적으로는","장문","비평","텍스트와","공연","기록","별도","명시"],align_title:"-",align_body:"좌측 정렬",align_note:"-",f:{w:171,h:240},m:{상:12,하:15,안:21,밖:12},c:{구성:"3단",간격:6},b:{크기:10,행간:17,자간:-70},ty:{이름:"별도 명시 없음",분류:"혼합"},pn:"중앙-내측-세로",pn_x_left:"156.2mm",pn_y_left:"112mm",pn_x_right:"5.8mm",pn_y_right:"112mm",pn_size:"28pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7pt",subheading:"14pt",footnote:"10pt",특:"기본적으로는 장문 비평 텍스트와 공연 기록 사진을 병치하는 기관 간행물 구조이지만, 실제 지면에서는 과감한 색면과 잘린 대형 영문 타이포, 세로로 놓인 면주와 캡션, 흑백 사진의 대비가 더 강한 인상을 만든다. 제도적 기록물과 동시대 무용의 실험성이 한 판면 안에서 공존하도록 짜여 있다.",summary:"국립현대무용단의 기관 간행물 시리즈 『K-컨템퍼러리』 2호. 공연 사진과 비평 텍스트, 기획 기사와 기록 이미지를 한 권 안에 묶으면서도, 네온 그린과 핑크의 강한 색면, 대형 잘림 영문 타이포그래피, 흑백 무대 사진을 병치해 동시대 무용의 제도성과 실험성을 동시에 드러낸다. 기관지이지만 홍보물보다 시각적 에세이에 가까운 인상을 만든다.",why_dim:"공연예술 기관지로서 텍스트와 무대 사진, 비평과 기록을 함께 싣기에 적절한 중형 판형. 잡지처럼 펼쳐 보기 좋으면서도, 대형 타이포그래피와 전면 이미지, 세로 면주를 수용할 만큼 충분한 화면감을 확보한다.",why_margin:"강한 형광색 계열 바탕 위에 대형 영문 타이포그래피가 재단면까지 잘려 들어오고, 중앙에는 비교적 좁은 본문 칼럼이 놓이며, 무대 사진과 캡션이 여백 속에 분산된다. 기관지이지만 정보를 촘촘히 채우기보다 텍스트와 이미지, 색면의 대비로 호흡을 만드는 편집이다.",why_font:"서체가 별도로 명시되지는 않았지만, 지면 인상은 중립적이고 단단한 산세리프 계열의 본문과 극단적으로 확대된 디스플레이 타이포그래피의 대비에 의해 형성된다. 거대한 영문 활자는 기관지의 공공적 틀을 깨고, 무용의 신체성과 동시대성을 시각적으로 전면화하는 장치로 작동한다.",why_tracking:"본문은 공연 비평과 기록을 안정적으로 읽히게 해야 하므로 중립 자간과 비교적 여유 있는 행간이 적절하고, 대형 제목 활자는 색면 위에서 강한 압박감을 만들기 위해 더 응축된 밀도를 취했을 가능성이 높다. 여백을 넓게 쓰기 때문에 문자 간격의 작은 차이도 화면 리듬에 큰 영향을 준다.",layout_type:"본문 2단 + 주석 2단"},
  {g:"인문·사회",pub_type:"기관출판",t:"기록 시스템 1800·1900",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/aufschreibesysteme-1800-1900-kr/",img:"124_기록 시스템 1800·1900",kw:["인문·사회","기관출판","기록","시스템","1800","1900","474×270mm","종이를","비스듬히","접어","일부","표지만","신신명조"],align_title:"-",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:138,h:222},m:{상:21,하:36,안:21,밖:24},c:{구성:"2단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조, 맞춤 서체, 벤턴 산스, 산돌 고딕네오, 어도비 캐즐런, 윤명조, 캐즐런 540, 페테 프락투어",분류:"혼합 (명조 / 각주 고딕)"},pn:"상단-중앙외측-가로",pn_x_left:"42mm",pn_y_left:"11.5mm",pn_x_right:"89.5mm",pn_y_right:"11.5mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"8pt",특:"474×270mm 종이를 비스듬히 접어 일부 표지만 드러내는 비대칭 덧표지 구조를 사용한다. 표지에서는 그린 격자와 오렌지색 대형 맞춤 타이포그래피가 시각적 긴장을 만들고, 내지는 장문 본문을 중심으로 하되 도판, 글자 배열 예시, 세로 캡션이 간헐적으로 삽입된다. 이론서의 안정성과 문자 체계의 역사성을 동시에 드러내는 편집이다.",summary:"프리드리히 키틀러의 미디어 이론서를 위한 인문 라이브러리 시리즈. 비대칭 덧표지와 격자 패턴, 그리고 본문에서 논의되는 글자체 모델을 반영한 제목 타이포그래피를 통해 ‘기록 시스템’이라는 개념을 책의 표면에서부터 시각화한다. 저자명은 프락투어로, 원제는 악치덴츠 그로테스크 볼드를 슈테판 게오르게 슈리프트 형태로 개량한 맞춤 조판으로 처리해, 1800년과 1900년의 문자 체계를 형식적으로 충돌시킨다.",why_dim:"인문 라이브러리 시리즈의 공통 판형을 유지하면서 장문의 미디어 이론 텍스트를 안정적으로 수용하기 위한 세로형 양장 판형. 비대칭 덧표지와 대형 타이포그래피, 본문 속 기호적 글자 배열 사례를 함께 담아낼 수 있는 균형 잡힌 비율이다.",why_margin:"시리즈 공통의 절제된 본문 판면 위에, 표지와 덧표지에서는 격자 패턴과 기울어진 절단선, 대형 맞춤 제목 타이포그래피가 강한 조형을 만든다. 내지는 안정적인 장문 독서를 위한 1단 구성이 중심이지만, 중간중간 글자 배열 실험 예시와 도판이 들어가며, 하단 여백과 바깥 여백을 통해 학술서적의 차분한 리듬을 유지한다.",why_font:"본문은 명조 계열을 중심으로 안정적인 학술 독서감을 유지하지만, 표지와 제목에서는 본문 내용에서 논의되는 문자 체계를 직접 끌어와 시각화한다. 저자명은 프락투어, 원제는 악치덴츠 그로테스크 볼드를 변형한 맞춤 서체로 조판되어, 19세기와 20세기 초의 기록 체계와 미디어 전환을 서체 차원에서 압축적으로 드러낸다.",why_tracking:"장문의 이론 텍스트를 안정적으로 읽히게 하기 위해 본문은 중립 자간과 넉넉한 행간을 유지하고, 표지의 맞춤 제목과 프락투어 계열 타이포그래피는 구조적 대비를 위해 보다 응축된 밀도를 취한다. 덧표지의 격자와 사선 구조가 강하므로 내지의 문자 간격은 과잉 개입 없이 차분하게 통제되는 편이 적절하다.",layout_type:"본문 1단 + 기타 2단(종종)"},
  {g:"인문·사회",pub_type:"잡지·저널",t:"옵.신 4호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/ob-scene-4-kr/",img:"125_옵.신 4호",kw:["인문·사회","잡지·저널","옵.신","4호","본문은","인용구만으로","이어지는","구성이지만","페이지의","별도","명시"],align_title:"중앙 정렬",align_body:"양끝 정렬, 좌측 정렬(일부)",align_note:"-",f:{w:120,h:180},m:{상:0,하:0,안:0,밖:0},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:0},ty:{이름:"별도 명시 없음",분류:"혼합 / 비명시"},pn:"하단-중앙-가로 (지면 내 랜덤 대각선으로 배치)",pn_x_left:"가변",pn_y_left:"가변",pn_x_right:"가변",pn_y_right:"가변",pn_size:"10pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"10pt",footnote:"-",특:"본문은 인용구만으로 이어지는 1단 구성이지만, 각 페이지의 텍스트 블록이 서로 조금씩 다른 각도로 돌아가 있어 일반적인 문학서나 비평지의 안정감을 의도적으로 무너뜨린다. 작은 이미지와 기사 스크랩이 간헐적으로 삽입되고, 표지 날개의 지도는 책 전체를 도시 산책의 장치로 확장한다. 읽기와 걷기가 서로 침범하는 편집이다.",summary:"넓은 의미의 공연예술 전문지 『옵.신』 4호. ‘도시 걷기’를 화두로 필진 없이 인용구만으로 구성되었으며, 발터 베냐민과 케이팝, 이상과 웹툰이 거리의 행인처럼 스쳐 가고 충돌하도록 편집되었다. 본문 전체를 일정하지 않은 각도로 비틀어 조판해, 독자가 나침반이나 지도 앱에 의존해 도시를 걷는 듯한 감각을 책 읽기와 겹치게 만든다. 앞표지 날개를 펼치면 우루과이 몬테비데오 지도가 나타난다.",why_dim:"작고 가벼운 포켓북형 판형을 택해 도시를 들고 걷는 감각과 가까운 읽기 경험을 만들기 위한 선택. 장문의 필진 글이 아니라 인용 파편들이 연속적으로 스쳐 지나가므로, 손에 쥐고 방향을 바꿔 가며 읽기 좋은 작은 크기가 개념과 잘 맞는다.",why_margin:"기본적으로는 작은 판형의 1단 본문 구조지만, 모든 텍스트가 서로 다른 각도로 비틀려 있어 판면이 안정된 독서 공간이 아니라 이동 중 방향 감각이 흐트러지는 지도 같은 장으로 작동한다. 이미지와 인용문, 쪽번호가 넓은 여백 안에 고립되어 놓이며, 펼친 날개 속 지도 이미지가 외부 도시와 내부 텍스트를 연결한다.",why_font:"이 호의 핵심은 특정 서체의 성격보다 텍스트 블록 전체를 회전시키는 조판 방식에 있다. 활자는 비교적 담담하고 중립적으로 읽히지만, 일정하지 않은 각도로 놓임으로써 문장이 지면 위에서 걷고 미끄러지는 듯한 인상을 준다. 즉 서체보다 방향과 배치가 독서 감각을 지배한다.",why_tracking:"작은 판형의 장문 독서를 고려하면 본문 자체는 중립 자간과 넉넉한 행간이 필요하지만, 각도 변화가 계속 일어나므로 실제 체감 리듬은 훨씬 불안정하게 느껴진다. 자간을 과하게 조이지 않고 여유를 두어야 회전된 텍스트도 읽을 수 있고, 이 느슨한 안정감 위에 방향 교란이 얹히는 방식이다.",layout_type:"본문 1단(대각선)"},
  {g:"인문·사회",pub_type:"기관출판",t:"어리석음",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/stupidity-kr/",img:"126_어리석음",kw:["인문·사회","기관출판","어리석음","474×270mm","종이를","비스듬히","접어","일부","표지만","신신명조"],align_title:"중앙 정렬, 좌측 정렬",align_body:"양끝 정렬, 좌측 정렬(일부)",align_note:"-",f:{w:138,h:222},m:{상:21,하:36,안:21,밖:24},c:{구성:"21열",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조, 벤턴 산스, 산돌 고딕네오, 어도비 캐즐런, 윤명조, 캐즐런 540",분류:"혼합 (명조 / 면주 고딕)"},pn:"상단-중앙외측-가로",pn_x_left:"42mm",pn_y_left:"11.3mm",pn_x_right:"89.5mm",pn_y_right:"11.3mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"-",footnote:"-",특:"474×270mm 종이를 비스듬히 접어 일부 표지만 드러내는 비대칭 덧표지 구조를 따른다. 표지에서는 거대한 세리프 영문 제목이 반복 확대되고, 검은 구체 이미지가 행성처럼 흩어져 배치되며, 상단의 검은 띠와 파란색 면이 표제 정보와 맞물린다. 내지는 장문의 철학 텍스트를 안정적으로 읽히게 하는 절제된 1단 구성으로 유지되어, 외부의 시각적 과잉과 내부의 독서 리듬이 선명하게 대비된다.",summary:"아비탈 로넬의 철학 이론서를 위한 인문 라이브러리 시리즈. 비대칭 덧표지 구조 위에 거대한 세리프 영문 제목을 반복 배치하고, 검은 구체 이미지와 강한 색면 대비를 더해 ‘어리석음’이라는 추상 개념을 우주적이면서도 불안정한 시각 언어로 번역한다. 시리즈의 통일 형식을 유지하면서도, 주제에 맞춰 가장 과감한 표제 타이포그래피 실험을 수행한 사례다.",why_dim:"인문 라이브러리 시리즈의 공통 세로형 판형을 유지해 장문의 철학 텍스트를 안정적으로 수용하면서, 덧표지의 비대칭 절개와 거대한 제목 타이포그래피를 충분히 드러내기 위한 크기. 이론서의 무게와 조형적 실험을 함께 담기 적절하다.",why_margin:"내지는 시리즈 공통의 차분한 1단 판면 위에 장문 본문이 놓이고, 여백 속에 쪽번호와 작은 장치들이 정리된다. 반면 표지와 덧표지에서는 대형 세리프 제목, 검은 구체 이미지, 파랑·검정·빨강의 강한 색면이 부딪치며 시각적 밀도를 극대화한다. 즉 외부는 개념적 충돌, 내부는 독서의 안정으로 대비된다.",why_font:"본문은 명조 중심으로 안정적인 철학서의 독서감을 유지하지만, 표지의 핵심 인상은 대형 세리프 제목과 산세리프 보조 정보의 대비에서 온다. 반복되는 ‘Stupidity’의 거대한 활자는 추상 개념을 감각적 이미지로 바꾸고, 검은 구체와 만나 의미가 미끄러지는 상태를 만든다. 시리즈의 보수적 독서성과 표지의 과감한 개념 조형이 공존한다.",why_tracking:"장문의 철학 텍스트를 위한 본문은 중립 자간과 넉넉한 행간으로 안정성을 유지하고, 표지의 거대한 세리프 활자는 더 응축된 밀도로 배치되어 덩어리감을 강조했을 가능성이 높다. 내지에서는 과잉 조형이 억제되고, 표지에서만 문자 간격과 반복을 통해 개념적 긴장을 전면화하는 방식이다.",layout_type:"본문 1단(각 장별 레이아웃 상이)"},
  {g:"문학",pub_type:"단행본",t:"생각하기/분류하기",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/penser-classer-kr/",img:"127_생각하기-분류하기",kw:["문학","단행본","생각하기/분류하기","장문","본문과","목록성","배열을","담는","신신명조"],align_title:"-",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:144,h:216},m:{상:21,하:42,안:24,밖:24},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조, 산돌 고딕네오, 아브니르, 어도비 개러몬드",분류:"혼합 (명조 / 면주, 각주 고딕)"},pn:"중앙-외측상단-세로",pn_x_left:"12mm",pn_y_left:"75mm",pn_x_right:"128.2mm",pn_y_right:"75mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"7.5pt",특:"내지는 장문 본문과 목록성 배열을 담는 차분한 1단 레이아웃이 중심이다. 반면 표지와 부속 면에서는 조르주 페렉의 초상이 반복 점과 반원, 블록형 도형으로 모자이크 처리되어, 하나의 도형 체계가 다른 체계로 이행하는 과정을 보여 준다. 텍스트의 주제인 분류와 배열의 행위가 외부 표면에서 먼저 수행되는 구조다.",summary:"문학동네 조르주 페렉 시리즈의 한 권으로, 페렉의 초상을 반복적 도형 시스템으로 변환한 표지가 핵심이다. 모자이크 초상을 이루는 도형이 어떤 ‘필터’를 거치며 다른 도형으로 바뀌어 가는 과정을 드러내며, 제목 그대로 ‘생각하기/분류하기’의 행위를 표면에서 시각화한다. 시리즈물의 통일성을 유지하면서도 각 권마다 다른 이미지 처리 방식을 취하는 방식이 분명하게 드러난다.",why_dim:"문학 선집으로서 장문 산문과 목록적·사전적 배열, 이미지와 표지 패턴을 함께 담아내기 좋은 중간 판형. 문학동네 시리즈물 특유의 단단한 장서감을 유지하면서도, 표지의 모자이크 이미지 실험을 충분히 보여 줄 수 있는 비율이다.",why_margin:"내지는 비교적 절제된 1단 구성으로 장문 텍스트와 목록, 짧은 단락을 안정적으로 수용한다. 표지와 면지에서는 점, 반원, 사각형 같은 기본 도형이 반복 배열되며 초상이 서서히 드러나거나 해체되는 패턴을 만든다. 판면 자체는 차분하지만, 표면의 패턴 시스템이 책의 개념적 인상을 강하게 규정한다.",why_font:"본문은 명조 계열을 중심으로 문학 선집다운 안정적인 독서감을 유지하고, 제목과 보조 정보에는 산세리프와 세리프 계열이 병용된다. 그러나 이 책의 가장 큰 특징은 서체보다 도형적 이미지 처리다. 페렉 초상을 구성하는 기본 기호들이 서로 다른 패턴 체계로 이동하는 과정이 표지 전체를 하나의 시각적 분류표처럼 만든다.",why_tracking:"문학 텍스트의 자연스러운 호흡을 위해 본문은 중립 자간과 넉넉한 행간을 유지하고, 표지의 패턴 시스템은 문자보다 도형 반복의 리듬으로 인식된다. 따라서 내지의 문자 간격은 과장 없이 안정적으로 유지되며, 외부 표면의 시각적 복잡성과 내부 판독성이 분리되는 구조다.",layout_type:"본문 1단 + 각주 그리드 외 2단"},
  {g:"인문·사회",pub_type:"잡지·저널",t:"옐로 페이지스—호찌민",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/yellow-pages-ho-chi-minh-city-kr/",img:"128_옐로 페이지스—호찌민",kw:["인문·사회","잡지·저널","옐로","페이지스","호찌민","지면은","영문과","일본어","본문이","좌우","혹은","TB","고딕"],align_title:"중앙 정렬",align_body:"양끝 정렬(한자), 좌측 정렬(영어)",align_note:"양끝 정렬(한자), 좌측 정렬(영어)",f:{w:225,h:297},m:{상:7,하:6,안:15,밖:7},c:{구성:"4단",간격:7},b:{크기:10,행간:12,자간:0},ty:{이름:"TB 고딕, 아틀라스 타이프라이터, 플라크 컨덴스드",분류:"혼합 (고딕 / 타자기체)"},pn:"하단-중앙-가로",pn_x_left:"91mm",pn_y_left:"261.3mm",pn_x_right:"100.7mm",pn_y_right:"261.3mm",pn_size:"95pt",pn_font:"고딕",pn_style:"흑색(윤곽선만) / 가로 / 숫자",running:"-",subheading:"12pt",footnote:"7pt",특:"각 지면은 영문과 일본어 본문이 좌우 혹은 상하로 병치되고, 큰 제목, 지도, 인터뷰 텍스트, 작업 이미지, 캡션, 페이지 번호가 서로 다른 크기로 촘촘히 들어선다. 첫 페이지는 도시 소개문과 지도, 대형 타이틀을 결합한 포스터형 구성이며, 이후 지면은 상단 기사 텍스트와 하단 대형 사진, 또는 작업 이미지와 설명문을 교차 배치하는 방식으로 리듬을 만든다. 전체적으로 정돈된 그리드 위에 정보 밀도를 극대화한 잡지형 편집 구조다.",summary:"국제 그래픽 디자인 전문지 아이디어 371호에 실린 동아시아 디자인 특집 ‘옐로 페이지스’의 여섯 번째 기사로, 고토 데쓰야가 기획·편집하고 제이빈 모와 함께 취재한 호찌민 편이다. 선명한 노란 바탕 위에 영문·일문 텍스트를 병치하고 지도, 인터뷰, 작업 이미지, 거리 사진을 빽빽하게 배열해 도시의 시각 문화와 젊은 디자이너 네트워크를 현장감 있게 전달한다. 굵은 고정폭 계열 제목과 높은 정보 밀도, 아시아 도시의 인쇄물 감각을 연상시키는 거친 편집 리듬이 핵심이다.",why_dim:"잡지 판형에 가까운 크기로, 장문의 기사 텍스트와 다수의 이미지, 지도, 캡션을 한 지면 안에 고밀도로 수용하기 적합하다. 국제 디자인 잡지의 편집물답게 휴대성과 보관성을 유지하면서도, 시각 자료와 인터뷰 텍스트를 동시에 강하게 보여 줄 수 있는 넉넉한 면적을 제공한다.",why_margin:"전면을 노란 배경으로 채운 뒤, 사방 여백을 크게 드러내기보다 정보 블록과 이미지가 판면 전체에 가까이 밀착되도록 구성해 잡지 특유의 밀도와 긴장감을 만든다. 균일한 여백 체계는 다국어 텍스트와 복수 이미지가 얽힌 복잡한 지면을 안정적으로 붙들어 주는 기본 프레임으로 작동한다.",why_font:"기사 본문에는 높은 가독성과 중립성을 갖춘 산세리프 및 타자기 계열 서체를 사용해 다국어 정보를 명확히 정리하고, 대형 제목에는 폭이 좁고 강하게 압축된 디스플레이 서체를 써 도시의 간판·신문·전화번호부 같은 인쇄 문화의 인상을 끌어온다. 제목의 거친 존재감과 본문의 정보성이 뚜렷하게 대비된다.",why_tracking:"고밀도 기사 편집물이라 본문은 과도하게 조이지 않은 중립 자간으로 판독성을 확보하고, 대형 제목은 응축된 폭과 촘촘한 배열로 강한 덩어리감을 만든다. 일본어·영문 병기 구조를 고려해 행간은 비교적 넉넉하게 두되, 자간은 전반적으로 절제해 정보가 흩어지지 않게 묶는 방식이다.",layout_type:"본문 2단 + 주석 4단"},
  {g:"문학",pub_type:"잡지·저널",t:"책고래 3권 영어판",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/the-book-whale-3-2-kr/",img:"129_책고래 3권 영어판",kw:["문학","잡지·저널","책고래","3권","영어판","기본적으로","사용해","영문","캐즐런","계열"],align_title:"중앙 정렬",align_body:"양끝 정렬, 좌측 정렬",align_note:"양끝 정렬, 좌측 정렬",f:{w:280,h:420},m:{상:44,하:90,안:10,밖:9},c:{구성:"2단",간격:10},b:{크기:16,행간:23,자간:-10},ty:{이름:"캐즐런 계열 명조, 이탤릭 명조",분류:"명조"},pn:"상단 또는 하단-중앙-가로",pn_x_left:"54.8mm",pn_y_left:"24.6mm",pn_x_right:"138.3mm",pn_y_right:"345mm",pn_size:"15pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"17pt",subheading:"24pt",footnote:"10pt",특:"내지는 기본적으로 2단 구조를 사용해 긴 영문 텍스트를 안정적으로 소화한다. 각 면 상단에는 저자명과 제목, 쪽수가 절제된 방식으로 배치되고, 본문은 비교적 큰 세리프 활자로 넉넉한 행간을 유지한다. 사진과 캡션은 한쪽 면의 하단 또는 전체 면의 일부를 크게 점유하며, 페이지를 가로지르는 얇은 사선이 지면 사이의 관계를 느슨하게 연결한다. 목차 페이지는 진한 청색 바탕 위에 중앙 정렬된 흰색 세리프 활자를 두어 본문과 강한 대비를 형성한다.",summary:"국립아시아문화전당 예술극장 개관 페스티벌과 연계해 출간된 영문판 잡지형 출판물로, 현대 예술 에세이와 공연 리뷰, 작가 인터뷰를 담고 있다. 280×420mm의 대형 판형 위에 책처럼 읽히는 넉넉한 타이포그래피를 사용해 타블로이드보다 ‘확대된 책’ 같은 인상을 만든다. 미색 바탕의 내지에는 단행본을 연상시키는 세리프 본문과 큰 사진, 얇은 사선 규칙이 공존하고, 파란 목차 페이지는 강한 색면과 절제된 활자 배열로 시리즈의 정체성을 선명히 드러낸다.",why_dim:"페스티벌 관련 에세이, 리뷰, 인터뷰를 신문처럼 크게 펼쳐 읽게 하면서도, 단행본 같은 몰입감과 위엄을 주기 위한 대형 판형이다. 넓은 면적 덕분에 본문 활자를 비교적 크게 쓰고도 충분한 여백과 이미지, 캡션을 함께 배치할 수 있어 ‘페이지 속으로 들어가는’ 독서 경험을 강화한다.",why_margin:"큰 판형 안에서 본문 블록이 고립되지 않도록 충분한 안쪽 여백을 확보하면서도, 텍스트가 지면 중앙에 안정적으로 떠 있도록 상하 여백을 넉넉히 둔다. 하단 여백은 페이지 번호와 캡션, 흰 공간의 호흡을 담당하고, 전체 여백 체계는 신문의 확장판이 아니라 ‘읽는 책’처럼 느껴지게 하는 핵심 장치다.",why_font:"대형 판형에서도 책처럼 차분하게 읽히는 인상을 만들기 위해 고전적 세리프 계열을 사용한 것으로 보인다. 본문과 제목, 러닝헤드, 캡션이 모두 같은 계열 안에서 크기와 스타일만 달리해 구성되어 일관된 문학적·비평적 톤을 유지하며, 목차 페이지의 흰색 세리프와 이탤릭 문구는 출판물 전체를 하나의 단행본적 세계로 묶는다.",why_tracking:"대형 판형과 비교적 큰 본문 활자에 맞춰 행간을 넉넉히 두어 독자가 활자 덩어리 안으로 들어가는 듯한 몰입감을 만든다. 자간은 거의 중립적으로 유지해 세리프 활자의 자연스러운 리듬을 살리고, 제목과 목차의 중앙 정렬 텍스트도 과도한 압축 없이 품위 있게 호흡하도록 설정된 것으로 보인다.",layout_type:"본문 1, 2단 가변 + 주석 3단"},
  {g:"문학",pub_type:"잡지·저널",t:"책고래 3권 한국어판",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/the-book-whale-3-kr/",img:"130_책고래 3권 한국어판",kw:["문학","잡지·저널","책고래","3권","한국어판","기본적으로","사용하지만","캐즐런","계열"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"양끝 정렬, 좌측 정렬",f:{w:280,h:420},m:{상:90,하:44,안:55,밖:55},c:{구성:"1단",간격:0},b:{크기:17,행간:29,자간:0},ty:{이름:"캐즐런 계열 명조, 이탤릭 명조",분류:"명조"},pn:"상단 또는 하단-중앙-가로",pn_x_left:"137.6mm",pn_y_left:"69.8mm",pn_x_right:"219.3mm",pn_y_right:"389.8mm",pn_size:"15pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"16pt",subheading:"24pt",footnote:"10pt",특:"내지는 기본적으로 1단 구조를 사용하지만, 한국어판 특성상 오른쪽 면에 넓은 본문 블록을 두고 왼쪽 면에는 큰 이미지와 캡션, 제목을 배치하는 식의 비대칭 운용이 자주 보인다. 제목과 필자명, 쪽수는 페이지 상단이나 하단에 절제되게 놓이고, 본문은 큰 세리프 활자와 넉넉한 행간으로 책처럼 읽힌다. ‘페스티벌의 알파벳’ 같은 페이지에서는 단어 목록과 인덱스성 정보가 넓은 지면 위에 흩어져 배치되어, 큰 종이 위에 사고의 지도를 펼치는 듯한 편집 리듬을 만든다.",summary:"국립아시아문화전당 예술극장 개관 페스티벌과 연계해 출간된 한국어판 잡지형 출판물로, 현대 예술 에세이와 공연 리뷰, 작가 인터뷰를 담고 있다. 280×420mm의 대형 판형 위에 단행본 같은 세리프 타이포그래피를 확대 적용해, 신문보다 ‘커다란 책’처럼 읽히는 감각을 만든다. 미색 바탕의 내지는 큰 본문 활자와 넉넉한 여백, 이미지와 캡션의 절제된 배치로 독서 몰입을 유도하고, 청색 목차 페이지는 흰색 활자와 사선 규칙을 통해 시리즈의 시각적 정체성을 또렷하게 강조한다.",why_dim:"영문판과 동일한 대형 판형으로, 공연 리뷰와 인터뷰, 에세이 등 긴 텍스트를 시원하게 펼쳐 보이면서도 책처럼 집중해서 읽히게 하기 위한 크기다. 한국어 본문을 비교적 크게 설정해도 지면의 호흡을 유지할 수 있고, 사진·캡션·목차까지 한 호흡 안에 담아 ‘페이지 안에 들어가는’ 경험을 강화한다.",why_margin:"대형 판형의 압도감을 텍스트가 안정적으로 지탱하도록 상하 여백을 넉넉히 두고, 한국어 본문 블록이 지나치게 퍼져 보이지 않도록 좌우 여백으로 판면의 중심을 잡는다. 하단 여백은 쪽번호와 러닝 요소, 이미지 아래 숨 쉴 공간을 제공해, 큰 지면 안에서도 신문이 아니라 읽는 책처럼 느껴지게 한다.",why_font:"대형 판형과 한국어 텍스트의 결을 동시에 살리기 위해 문학적이고 안정적인 세리프 계열을 쓴 것으로 보인다. 본문, 제목, 러닝헤드, 목차가 모두 같은 계열 안에서 통일되어 단행본 같은 품위를 유지하고, 청색 목차 면의 흰색 세리프 활자는 출판물 전체를 하나의 독립적인 책 세계로 묶어 준다.",why_tracking:"한국어 본문의 큰 활자와 대형 지면을 고려해 행간을 넉넉하게 확보하여 문장 덩어리가 답답해지지 않게 한다. 자간은 전반적으로 중립에 가깝게 유지해 세리프 본문의 자연스러운 리듬을 살리고, 목차와 제목의 중앙 정렬 텍스트도 과도한 조임 없이 품위 있는 호흡을 갖도록 조절된 것으로 보인다.",layout_type:"본문 1단 + 각주 3단"},
  {g:"문학",pub_type:"잡지·저널",t:"책고래 2권 영어판",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/the-book-whale-2-2-kr/",img:"131_책고래 2권 영어판",kw:["문학","잡지·저널","책고래","2권","영어판","기본적으로","사용해","영문","캐즐런","계열"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"양끝 정렬, 좌측 정렬",f:{w:280,h:420},m:{상:45,하:17,안:10,밖:10},c:{구성:"6단",간격:10},b:{크기:16,행간:23,자간:-10},ty:{이름:"캐즐런 계열 명조, 이탤릭 명조",분류:"명조"},pn:"상단 또는 하단-중앙-가로",pn_x_left:"136.7mm",pn_y_left:"344.8mm",pn_x_right:"221.8mm",pn_y_right:"24.7mm",pn_size:"15pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"17pt",subheading:"24pt",footnote:"10pt",특:"내지는 기본적으로 2단 구조를 사용해 긴 영문 텍스트를 안정적으로 소화한다. 각 면에는 저자명, 제목, 페이지 번호가 절제된 방식으로 배치되고, 큰 공연 사진이나 설치 장면 사진이 한쪽 면 하단을 크게 점유한다. 인터뷰와 비평 텍스트는 비교적 큰 세리프 활자와 넉넉한 행간으로 구성되어, 넓은 지면에서도 문장 흐름이 끊기지 않는다. 목차 페이지는 강한 청색 바탕 위에 중앙 정렬된 흰색 세리프 활자를 두어 본문과 뚜렷한 대비를 이룬다.",summary:"국립아시아문화전당 예술극장 개관 페스티벌과 연계해 출간된 영문판 잡지형 출판물로, 현대 예술 관련 에세이와 공연 리뷰, 작가 인터뷰를 담고 있다. 280×420mm의 큰 판형 위에 고전적인 세리프 중심 편집을 적용해 타블로이드라기보다 ‘확대된 책’ 같은 독서 경험을 만든다. 미색 바탕의 내지는 2단 본문과 절제된 러닝헤드, 큰 사진, 캡션으로 구성되고, 파란 목차 페이지는 중앙 정렬된 흰색 세리프 활자와 사선 규칙으로 시리즈의 정체성을 강하게 드러낸다.",why_dim:"에세이와 인터뷰, 작품 리뷰 등 장문의 영문 텍스트를 시원하게 펼쳐 보여 주면서도 책처럼 차분히 읽히게 하기 위한 대형 판형이다. 넓은 면적 덕분에 본문 활자를 크게 설정하고도 여백과 사진, 캡션을 충분히 둘 수 있어 ‘페이지 속으로 들어가는’ 몰입감을 강화한다.",why_margin:"대형 판형 안에서 본문이 신문처럼 흩어지지 않고 하나의 책 블록처럼 느껴지도록 상하 여백과 좌우 여백을 안정적으로 확보한다. 하단 여백은 쪽번호와 캡션, 이미지 주변의 호흡을 담당하고, 전체 여백은 큰 지면 속에서도 독서의 집중도를 유지하게 한다.",why_font:"대형 판형에서도 책처럼 차분하고 비평적인 톤을 유지하기 위해 고전적인 세리프 계열을 사용한 것으로 보인다. 본문과 제목, 러닝헤드, 캡션이 동일 계열 안에서 크기와 스타일만 달리하며 구성되어 출판물 전체의 품위를 유지하고, 목차 페이지의 흰색 세리프는 시리즈 정체성을 응축한다.",why_tracking:"큰 판형과 비교적 큰 본문 활자에 맞춰 행간을 넉넉하게 두어 독자가 활자 덩어리 속으로 들어가는 듯한 몰입감을 만든다. 자간은 거의 중립적으로 유지해 세리프 활자의 자연스러운 리듬을 살리고, 제목과 목차의 중앙 정렬 텍스트도 과도하게 조이지 않은 균형을 보인다.",layout_type:"본문 1-2단 가변, 각주 6단"},
  {g:"문학",pub_type:"잡지·저널",t:"책고래 2권 한국어판",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/the-book-whale-2-kr/",img:"132_책고래 2권 한국어판",kw:["문학","잡지·저널","책고래","2권","한국어판","기본적으로","사용하지만","캐즐런","계열"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"양끝 정렬, 좌측 정렬",f:{w:280,h:420},m:{상:90.1,하:44.44,안:55.1,밖:55.1},c:{구성:"6단",간격:8},b:{크기:17,행간:29,자간:0},ty:{이름:"캐즐런 계열 명조, 이탤릭 명조",분류:"명조"},pn:"하단-외측-가로",pn_x_left:"54.8mm",pn_y_left:"390mm",pn_x_right:"218.9mm",pn_y_right:"390mm",pn_size:"15pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"16pt",subheading:"24pt",footnote:"10pt",특:"내지는 기본적으로 1단 구조를 사용하지만, 한국어판 특성상 오른쪽 면에 넓은 본문 블록을 두고 왼쪽 면에는 큰 이미지와 캡션, 제목을 배치하는 식의 비대칭 운용이 자주 보인다. 제목과 필자명, 쪽수는 페이지 상단이나 하단에 절제되게 놓이고, 본문은 큰 세리프 활자와 넉넉한 행간으로 책처럼 읽힌다. ‘페스티벌의 알파벳’ 같은 페이지에서는 단어 목록과 인덱스성 정보가 넓은 지면 위에 흩어져 배치되어, 큰 종이 위에 사고의 지도를 펼치는 듯한 편집 리듬을 만든다. 2단 3단 레이아웃도 가변 사용",summary:"국립아시아문화전당 예술극장 개관 페스티벌과 연계해 출간된 한국어판 잡지형 출판물로, 현대 예술에 관한 에세이와 공연 리뷰, 작가 인터뷰를 담고 있다. 280×420mm의 큰 판형 위에 단행본 같은 세리프 중심 타이포그래피를 적용해, 타블로이드보다는 ‘커다란 책’처럼 읽히는 경험을 만든다. 미색 바탕의 내지는 한국어 본문을 큰 활자와 넉넉한 행간으로 배치하고, 한쪽 면에 이미지나 캡션을 크게 두거나 인터뷰 텍스트를 비대칭적으로 운용한다. 청색 목차 페이지는 흰색 세리프 활자와 사선 규칙으로 시리즈의 정체성을 선명하게 드러낸다.",why_dim:"영문판과 동일한 대형 판형으로, 공연 리뷰와 인터뷰, 비평 텍스트를 시원하게 펼치면서도 책처럼 집중해서 읽히게 하기 위한 크기다. 한국어 본문을 비교적 크게 설정하고도 충분한 여백과 이미지, 캡션을 함께 유지할 수 있어 ‘페이지 안으로 들어가는’ 몰입감을 강화한다.",why_margin:"대형 판형 안에서 본문이 신문처럼 흩어지지 않고 하나의 책 블록처럼 느껴지도록 상하 여백과 좌우 여백을 안정적으로 확보한다. 하단 여백은 쪽번호와 캡션, 이미지 주변의 호흡을 담당하고, 전체 여백은 큰 지면 속에서도 독서의 집중도를 유지하게 한다.",why_font:"대형 판형과 한국어 텍스트의 결을 동시에 살리기 위해 문학적이고 안정적인 세리프 계열을 사용한 것으로 보인다. 본문, 제목, 러닝헤드, 목차가 모두 같은 계열 안에서 통일되어 단행본 같은 품위를 유지하고, 청색 목차 면의 흰색 세리프 활자는 출판물 전체를 하나의 독립적인 책 세계로 묶어 준다.",why_tracking:"한국어 본문의 큰 활자와 대형 지면을 고려해 행간을 넉넉하게 확보하여 문장 덩어리가 답답해지지 않게 한다. 자간은 전반적으로 중립에 가깝게 유지해 세리프 본문의 자연스러운 리듬을 살리고, 목차와 제목의 중앙 정렬 텍스트도 과도하게 조이지 않은 품위 있는 호흡을 갖도록 조절된 것으로 보인다.",layout_type:"본문 1, 2, 3단 가변 + 주석 3단"},
  {g:"문학",pub_type:"잡지·저널",t:"책고래 1권 영어판",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/the-book-whale-1-2-kr/",img:"133_책고래 1권 영어판",kw:["문학","잡지·저널","책고래","1권","영어판","기본적으로","사용해","영문","캐즐런","계열"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"양끝 정렬, 좌측 정렬",f:{w:280,h:420},m:{상:90.1,하:44.44,안:55.1,밖:55.1},c:{구성:"6단",간격:10},b:{크기:16,행간:23,자간:-10},ty:{이름:"캐즐런 계열 명조, 이탤릭 명조",분류:"명조"},pn:"상단 또는 하단-중앙-가로",pn_x_left:"136.7mm",pn_y_left:"344.8mm",pn_x_right:"221.8mm",pn_y_right:"24.7mm",pn_size:"15pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"17pt",subheading:"24pt",footnote:"10pt",특:"내지는 기본적으로 2단 구조를 사용해 긴 영문 텍스트를 안정적으로 소화한다. 각 면에는 저자명, 제목, 페이지 번호가 절제된 방식으로 배치되고, 큰 공연 사진이나 설치 장면 사진이 한쪽 면 하단을 크게 점유한다. 인터뷰 지면에서는 질문과 응답이 넓은 지면 속에서 분리되어 배치되고, 이미지 캡션과 작가 약력이 하단 또는 측면에 작게 붙는다. 전체적으로 큰 판형 안에 텍스트와 이미지를 느슨하지만 정교하게 배치한 서적형 편집 구조다.",summary:"국립아시아문화전당 예술극장 개관 페스티벌과 연계해 출간된 영문판 잡지형 출판물로, 현대 예술 에세이와 공연 리뷰, 작가 인터뷰를 담고 있다. 280×420mm의 대형 판형 위에 고전적인 세리프 중심 편집을 적용해 타블로이드라기보다 ‘확대된 책’ 같은 독서 경험을 만든다. 미색 바탕의 내지는 2단 본문과 절제된 러닝헤드, 큰 사진, 캡션으로 구성되고, 인터뷰 지면에서는 질문과 응답, 이미지, 약력 정보가 넓은 여백 속에 느슨하게 조직된다. 시리즈 특유의 청색 목차 페이지는 중앙 정렬된 흰색 세리프 활자와 사선 규칙으로 강한 정체성을 형성한다.",why_dim:"에세이와 인터뷰, 공연 리뷰 등 장문의 영문 텍스트를 크게 펼쳐 보이면서도 책처럼 차분히 읽히게 하기 위한 대형 판형이다. 넓은 면적 덕분에 본문 활자를 비교적 크게 유지하고도 여백과 사진, 캡션, 약력 정보를 충분히 둘 수 있어 ‘페이지 속으로 들어가는’ 몰입감을 강화한다.",why_margin:"큰 판형 안에서 본문이 신문처럼 흩어지지 않고 하나의 책 블록처럼 느껴지도록 상하 여백과 좌우 여백을 안정적으로 확보한다. 하단 여백은 쪽번호와 캡션, 약력 정보, 이미지 주변의 호흡을 담당하고, 전체 여백은 큰 지면 속에서도 독서의 집중도를 유지하게 한다.",why_font:"대형 판형에서도 책처럼 차분하고 비평적인 톤을 유지하기 위해 고전적인 세리프 계열을 사용한 것으로 보인다. 본문과 제목, 러닝헤드, 캡션, 약력 정보가 동일 계열 안에서 크기와 스타일만 달리하며 구성되어 출판물 전체의 품위를 유지하고, 목차 페이지의 흰색 세리프는 시리즈 정체성을 응축한다.",why_tracking:"큰 판형과 비교적 큰 본문 활자에 맞춰 행간을 넉넉하게 두어 독자가 활자 덩어리 속으로 들어가는 듯한 몰입감을 만든다. 자간은 거의 중립적으로 유지해 세리프 활자의 자연스러운 리듬을 살리고, 제목과 목차의 중앙 정렬 텍스트도 과도하게 조이지 않은 균형을 보인다.",layout_type:"본문 1-2단 가변, 각주 6단"},
  {g:"문학",pub_type:"단행본",t:"페르난두 페소아의 마지막 사흘",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/gli-ultimi-tre-giorni-di-fernando-pessoa-kr/",img:"134_페르난두 페소아의 마지막 사흘",kw:["문학","단행본","페르난두","페소아의","마지막","사흘","기본적으로","구성의","신신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"-",f:{w:120,h:192},m:{상:15,하:30,안:17,밖:18},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조, 시몬치니 개러몬드, 아리따 돋움, 애퍼수",분류:"명조"},pn:"하단-외측-가로 (대각선)",pn_x_left:"7.7mm",pn_y_left:"176.9mm",pn_x_right:"109.5mm",pn_y_right:"176.9mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 가로(대각선) / 숫자",running:"-",subheading:"9pt",footnote:"-",특:"내지는 기본적으로 1단 구성의 문학 단행본 형식을 따른다. 본문은 안정적인 글줄 길이와 행간을 유지하며, 페이지 하단의 쪽번호와 중간 제목, 인명 해설이 절제되게 정리된다. 주석이나 추가 설명은 본문과 자연스럽게 구분되지만 과도하게 위계를 만들지 않고, 전체적으로 전통적인 문학서의 판면 질서를 현대적으로 다듬은 구조다. 표지는 회색 바탕 위에 검은 선묘 초상과 형광 분홍 제목, 세로 보조 타이포그래피가 비대칭적으로 배치되어 강한 시각적 긴장을 만든다.",summary:"안토니오 타부키 선집의 한 권으로, 슬기와 민이 선보인 본문 디자인의 현대적이고 기능적인 북 디자인 감각이 잘 드러나는 작품이다. 회색빛 표지 위에 검은 선묘 초상과 형광 분홍 타이포그래피를 배치해 문학 선집의 고전성과 동시대적 감각을 동시에 드러내며, 내지에서는 안정적인 본문 조판과 각주, 인명 해설이 자연스럽게 조직된다. 무리 없는 판면과 절제된 타이포그래피 속에서 조형적 입장을 분명히 드러내는, 동시대 한국 북 디자인의 대표적 사례다.",why_dim:"문학동네의 문학 단행본으로서 장편 텍스트와 주석, 해설을 안정적으로 수용하면서도 손에 잡히는 독서감을 유지하기 적절한 세로형 판형이다. 본문과 각주, 인명 해설 같은 복수 정보층을 무리 없이 담고, 표지의 초상 일러스트와 세로·가로 타이포그래피가 단정하게 공존할 수 있는 비율이다.",why_margin:"상하좌우가 비교적 균형 잡힌 여백 구조를 유지하되, 하단 여백을 조금 더 넉넉히 두어 쪽번호와 판면의 안정감을 확보하는 방식으로 보인다. 본문과 각주, 인명 해설이 한 페이지 안에서 부딪히지 않도록 여백이 완충 장치로 작동하며, 전체적으로 무리 없는 독서 리듬을 만든다.",why_font:"본문에는 안정적인 독서감을 주는 명조와 개러몬드 계열을 사용하고, 표지와 보조 정보에는 고딕 및 디스플레이 계열을 병용해 고전 문학의 품위와 현대적 긴장을 함께 만든다. 특히 형광 분홍 제목과 세로 보조 타이포그래피는 선집의 시리즈감과 동시대적 조형 감각을 강하게 드러낸다.",why_tracking:"본문은 자연스럽고 무리 없는 독서 흐름을 위해 중립 자간과 넉넉한 행간을 유지하는 것으로 보인다. 장문의 소설 텍스트와 주석, 해설이 함께 놓이기 때문에 지나친 압축이나 확장을 피하고, 전체적으로 ‘아무 일도 일어나지 않는 듯 자연스러운’ 조판을 통해 조형적 완성도를 드러내는 방식이다.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"잡지·저널",t:"옐로 페이지스—방콕",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/yellow-pages-bangkok-kr/",img:"135_옐로 페이지스—방콕",kw:["인문·사회","잡지·저널","옐로","페이지스","방콕","지면은","영문과","일본어","본문이","좌우","혹은","TB","고딕"],align_title:"중앙 정렬",align_body:"양끝 정렬(한자), 좌측 정렬(영어)",align_note:"양끝 정렬(한자), 좌측 정렬(영어)",f:{w:225,h:297},m:{상:7,하:6,안:15,밖:7},c:{구성:"4단",간격:7},b:{크기:10,행간:12,자간:0},ty:{이름:"TB 고딕, 아틀라스 타이프라이터, 플라크 컨덴스드",분류:"혼합 (고딕 / 타자기체 / 컨덴스드 디스플레이)"},pn:"하단-중앙-가로",pn_x_left:"91mm",pn_y_left:"261.3mm",pn_x_right:"100.7mm",pn_y_right:"261.3mm",pn_size:"95pt",pn_font:"고딕",pn_style:"흑색(윤곽선만) / 가로 / 숫자",running:"-",subheading:"12pt",footnote:"7pt",특:"각 지면은 영문과 일본어 본문이 좌우 혹은 상하로 병치되고, 큰 제목, 지도, 인터뷰 텍스트, 작업 이미지, 캡션, 페이지 번호가 서로 다른 크기로 촘촘히 들어선다. 첫 페이지는 도시 소개문과 지도, 대형 타이틀을 결합한 포스터형 구성이며, 이후 지면은 상단 기사 텍스트와 하단 대형 사진, 혹은 작업 이미지와 설명문을 교차 배치하는 방식으로 리듬을 만든다. 인물 인터뷰, 개인 작업사, 전시 전경, 그래픽 작업 샘플이 다단 구조 안에 혼합되어 전체적으로 정돈된 그리드 위에 정보 밀도를 극대화한 잡지형 편집 구조를 이룬다.",summary:"국제 그래픽 디자인 전문지 아이디어 370호에 실린 동아시아 디자인 특집 ‘옐로 페이지스’의 다섯 번째 기사로, 고토 데쓰야가 기획·편집하고 제이빈 모와 함께 취재한 방콕 편이다. 선명한 노란 바탕 위에 영문·일문 텍스트를 병치하고 지도, 인터뷰, 작업 이미지, 전시 사진을 빽빽하게 배열해 방콕의 시각 문화와 디자이너 산티 로라차위의 작업 세계를 현장감 있게 전달한다. 굵은 고정폭 계열 제목과 높은 정보 밀도, 아시아 도시의 간판·전화번호부·포스터를 떠올리게 하는 거친 편집 리듬이 핵심이다.",why_dim:"잡지 판형에 가까운 크기로, 장문의 기사 텍스트와 다수의 이미지, 지도, 캡션을 한 지면 안에 고밀도로 수용하기 적합하다. 국제 디자인 잡지의 편집물답게 휴대성과 보관성을 유지하면서도, 현장 사진과 인터뷰, 작업 사례를 동시에 강하게 보여 줄 수 있는 충분한 면적을 제공한다.",why_margin:"전면을 노란 배경으로 채운 뒤, 사방 여백을 크게 드러내기보다 텍스트와 이미지 블록이 판면 전체에 가깝게 밀착되도록 구성해 잡지 특유의 밀도와 긴장감을 만든다. 균일한 여백 체계는 다국어 본문과 복수 이미지, 캡션, 페이지 번호가 얽힌 복잡한 지면을 지탱하는 기본 프레임으로 작동한다.",why_font:"기사 본문에는 높은 가독성과 중립성을 갖춘 산세리프 및 타자기 계열 서체를 사용해 다국어 정보를 명확히 정리하고, 대형 제목에는 폭이 좁고 강하게 압축된 디스플레이 서체를 써 도시의 간판·신문·전화번호부 같은 인쇄 문화의 인상을 끌어온다. 제목의 거친 존재감과 본문의 정보성이 뚜렷하게 대비된다.",why_tracking:"고밀도 기사 편집물이라 본문은 과도하게 조이지 않은 중립 자간으로 판독성을 확보하고, 대형 제목은 응축된 폭과 촘촘한 배열로 강한 덩어리감을 만든다. 영문·일문 병기 구조를 고려해 행간은 비교적 넉넉하게 두되, 자간은 전반적으로 절제해 정보가 흩어지지 않게 묶는 방식이다.",layout_type:"본문 2단 + 주석 4단"},
  {g:"문학",pub_type:"단행본",t:"인도 야상곡",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/notturno-indiano-kr/",img:"136_인도 야상곡",kw:["문학","단행본","인도","야상곡","기본적으로","구성의","신신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"양끝 정렬",f:{w:120,h:192},m:{상:15,하:30,안:18,밖:18},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조, 시몬치니 개러몬드, 아리따 돋움, 애퍼수",분류:"명조"},pn:"하단-외측-가로 (대각선)",pn_x_left:"7.7mm",pn_y_left:"176.9mm",pn_x_right:"109.5mm",pn_y_right:"176.9mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 가로(대각선) / 숫자",running:"8pt",subheading:"10pt",footnote:"7pt",특:"내지는 기본적으로 1단 구성의 문학 단행본 형식을 따른다. 본문은 안정적인 글줄 길이와 행간을 유지하며, 페이지 하단의 쪽번호와 간헐적 주석이 절제되게 정리된다. 주석이나 추가 설명은 본문과 자연스럽게 구분되지만 과도하게 위계를 만들지 않고, 전체적으로 전통적인 문학서의 판면 질서를 현대적으로 다듬은 구조다. 표지는 회색 바탕 위에 다각형 선묘 초상과 절제된 제목, 세로 보조 타이포그래피가 비대칭적으로 배치되어 조용하지만 강한 시각적 긴장을 만든다.",summary:"안토니오 타부키 선집의 한 권으로, 슬기와 민이 선보인 현대적이고 기능적인 본문 디자인 감각이 잘 드러나는 작품이다. 회색빛 표지 위에 검은 선묘 초상과 절제된 타이포그래피를 배치해 문학 선집의 고전성과 동시대적 감각을 동시에 드러내며, 내지에서는 안정적인 본문 조판과 각주, 장면 전환이 자연스럽게 조직된다. 무리 없는 판면과 절제된 타이포그래피 속에서 조형적 입장을 분명히 드러내는, 안토니오 타부키 선집의 대표적 사례 중 하나다.",why_dim:"문학동네의 문학 단행본으로서 장편 텍스트와 주석, 해설적 요소를 안정적으로 수용하면서도 손에 잡히는 독서감을 유지하기 적절한 세로형 판형이다. 본문과 각주, 표지의 초상 일러스트와 세로·가로 타이포그래피가 단정하게 공존할 수 있는 비율이다.",why_margin:"상하좌우가 비교적 균형 잡힌 여백 구조를 유지하되, 하단 여백을 조금 더 넉넉히 두어 쪽번호와 판면의 안정감을 확보하는 방식으로 보인다. 본문과 각주가 한 페이지 안에서 부딪히지 않도록 여백이 완충 장치로 작동하며, 전체적으로 무리 없는 독서 리듬을 만든다.",why_font:"본문에는 안정적인 독서감을 주는 명조와 개러몬드 계열을 사용하고, 표지와 보조 정보에는 고딕 및 디스플레이 계열을 병용해 고전 문학의 품위와 현대적 긴장을 함께 만든다. 표지의 선묘 초상과 절제된 타이포그래피는 선집의 시리즈감과 동시대적 조형 감각을 조용하게 드러낸다.",why_tracking:"본문은 자연스럽고 무리 없는 독서 흐름을 위해 중립 자간과 넉넉한 행간을 유지하는 것으로 보인다. 장문의 소설 텍스트와 주석이 함께 놓이기 때문에 지나친 압축이나 확장을 피하고, 전체적으로 자연스러운 조판을 통해 조형적 완성도를 드러내는 방식이다.",layout_type:"본문 1단"},
  {g:"문학",pub_type:"단행본",t:"집시와 르네상스",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/gli-zingari-e-il-rinascimento-kr/",img:"137_집시와 르네상스",kw:["문학","단행본","집시와","르네상스","기본적으로","구성의","신신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"-",f:{w:120,h:192},m:{상:15,하:30,안:18,밖:18},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조, 시몬치니 개러몬드, 아리따 돋움, 애퍼수",분류:"혼합 (명조 / 고딕)"},pn:"하단-외측-가로 (대각선)",pn_x_left:"7.7mm",pn_y_left:"176.9mm",pn_x_right:"109.5mm",pn_y_right:"176.9mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 가로(대각선) / 숫자",running:"8pt",subheading:"10pt",footnote:"7pt",특:"내지는 기본적으로 1단 구성의 문학 단행본 형식을 따른다. 본문은 비교적 짧은 글줄과 안정적인 행간을 유지하며, 장 제목과 쪽번호, 간헐적 주석이 절제되게 정리된다. 좁은 판형 덕분에 판면은 더 응축된 인상을 주지만, 정보 위계를 과도하게 강조하지 않고 자연스러운 독서 흐름을 유지한다. 표지는 회색 바탕 위에 픽셀처럼 단순화된 검은 초상과 금빛 제목, 세로 보조 타이포그래피가 비대칭적으로 놓여 조용하지만 강한 시각적 긴장을 만든다.",summary:"안토니오 타부키 선집의 한 권으로, 슬기와 민이 보여 준 현대적이고 기능적인 본문 디자인의 감각이 잘 드러나는 작품이다. 좁고 긴 판형 위에 안정적인 본문 조판과 각주, 장 제목을 자연스럽게 조직하고, 표지에서는 회색 바탕 위의 거친 픽셀화 초상과 금빛 타이포그래피를 통해 고전 문학과 동시대적 디지털 감각을 겹쳐 놓는다. 무리 없는 판면과 절제된 타이포그래피 속에서 조형적 입장을 분명히 드러내는, 안토니오 타부키 선집의 또 다른 변주다.",why_dim:"기존 136×192mm 선집보다 조금 더 폭이 좁은 판형으로, 장문의 문학 텍스트를 보다 응축된 리듬으로 읽히게 하면서도 손에 잡히는 독서감을 유지하기 적절하다. 좁은 폭 덕분에 글줄 길이가 자연스럽게 짧아져 집중력 있는 독서를 유도하고, 표지의 세로 보조 타이포그래피와 픽셀화 초상이 더욱 또렷하게 작동한다.",why_margin:"폭이 좁은 판형에 맞춰 좌우 여백을 과도하게 넓히기보다 글줄 길이를 안정적으로 유지할 만큼만 두고, 하단 여백을 조금 더 확보해 쪽번호와 판면의 무게중심을 잡는 방식으로 보인다. 본문과 각주가 한 페이지 안에서 부딪히지 않도록 여백이 완충 장치로 작동하며, 전체적으로 조용한 독서 리듬을 만든다.",why_font:"본문에는 안정적인 독서감을 주는 명조와 개러몬드 계열을 사용하고, 표지와 보조 정보에는 고딕 및 디스플레이 계열을 병용해 고전 문학의 품위와 현대적 긴장을 함께 만든다. 특히 거친 픽셀화 초상과 금빛 제목은 선집의 시리즈감을 유지하면서도 다른 권과 차별화된 디지털적 표면감을 형성한다.",why_tracking:"좁은 판형에서 장문의 텍스트가 답답해지지 않도록 중립 자간과 넉넉한 행간을 유지하는 것으로 보인다. 지나친 압축이나 확장을 피하고, 자연스러운 조판을 통해 문학서의 안정성과 조형적 완성도를 함께 확보하는 방식이다.",layout_type:"본문 1단"},
  {g:"문학",pub_type:"기관출판",t:"전사자 숭배—국가라는 종교의 희생 제물",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/fallen-soldiers-kr/",img:"138_전사자 숭배—국가라는 종교의 희생 제물",kw:["문학","기관출판","전사자","숭배","국가라는","종교의","희생","제물","기본적으로","구성의","인문서","형식을","신신명조"],align_title:"-",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:138,h:222},m:{상:21,하:36,안:21,밖:24},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조, 벤턴 산스, 산돌 고딕네오, 어도비 캐즐런, 윤명조, 캐즐런 540",분류:"혼합 (명조 / 고딕)"},pn:"상단-중앙외측-가로",pn_x_left:"42mm",pn_y_left:"11.5mm",pn_x_right:"91.7mm",pn_y_right:"11.5mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"-",footnote:"8pt",특:"내지는 기본적으로 1단 구성의 인문서 형식을 따른다. 본문은 안정적인 글줄 길이와 행간을 유지하고, 삽화와 캡션, 약력 정보가 절제된 방식으로 판면 안에 정리된다. 반면 표지와 덧표지에서는 청록·백색·갈색의 대각 색면, 윤곽선 세리프 제목, 십자가 도상이 결합해 전쟁 기념비와 제의적 상징을 연상시키는 강한 시각적 표면을 만든다. 내부는 학술적 질서, 외부는 상징적 충돌이라는 대비가 분명하다.",summary:"문학동네 인문 라이브러리 시리즈의 한 권으로, 전쟁과 기억, 국가주의를 다루는 연구서를 위해 비대칭 덧표지 구조와 엄격한 본문 체계를 결합한 디자인이다. 474×270mm 종이를 비스듬히 접은 덧표지가 청록·백색·갈색의 대각 색면을 만들고, 그 위에 윤곽선 세리프 제목과 십자가 도상이 놓여 전쟁 기념과 희생의 서사를 상징적으로 환기한다. 내지는 차분한 1단 또는 2단에 가까운 정돈된 본문 구조와 삽화, 캡션, 약력 페이지를 통해 학술적 독서 리듬을 유지하면서, 외부 표면에서는 강한 상징성과 조형적 긴장을 드러낸다.",why_dim:"인문 라이브러리 시리즈의 공통 세로형 판형으로, 장문의 인문 텍스트와 삽화, 캡션, 약력 정보를 안정적으로 수용하면서도 덧표지의 비대칭 절개와 대각 색면 구성을 충분히 드러내기 위한 크기다. 연구서의 무게감과 시리즈 특유의 조형 실험을 함께 담기 적절하다.",why_margin:"장문의 인문 텍스트와 도판, 캡션을 안정적으로 수용하기 위해 상하좌우가 비교적 균형 잡힌 여백 구조를 유지하되, 하단 여백을 조금 넉넉히 두어 쪽번호와 판면의 무게중심을 잡는다. 덧표지의 강한 대각 구성이 외부에서 긴장을 만든다면, 내지의 여백은 학술적 독서의 안정성을 보장하는 완충 장치로 작동한다.",why_font:"본문에는 안정적인 인문서 독서감을 위한 명조 계열이 중심이 되고, 보조 정보에는 산세리프가 병용되며, 표지의 핵심 인상은 윤곽선 세리프 제목에서 온다. 이 제목은 기념비적이면서도 비어 있는 윤곽 구조를 통해 전쟁 기억과 상실의 주제를 시각적으로 환기한다.",why_tracking:"장문의 인문 텍스트를 위한 본문은 중립 자간과 넉넉한 행간으로 안정성을 유지하고, 표지의 윤곽선 제목은 더 응축된 밀도로 배치되어 상징적 덩어리감을 강조했을 가능성이 높다. 내지에서는 판독성과 질서가 우선되고, 표지에서만 강한 조형성이 전면화되는 구조다.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"단행본",t:"디자이너란 무엇인가, 개정판",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/what-is-a-designer-revised-kr/",img:"139_디자이너란 무엇인가, 개정판",kw:["인문·사회","단행본","디자이너란","무엇인가","개정판","기본적으로","구성의","이론서","형식을","명조","계열"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:135,h:216},m:{상:20,하:30,안:17,밖:18},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:30},ty:{이름:"명조 계열 본문체, 산세리프 보조체",분류:"명조"},pn:"하단-외측-가로 / 상단-외측-가로",pn_x_left:"24.5mm",pn_y_left:"190.9mm",pn_x_right:"106.8mm",pn_y_right:"10.8mm",pn_size:"10pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"12pt",footnote:"8pt",특:"내지는 기본적으로 1단 구성의 이론서 형식을 따른다. 본문은 안정적인 글줄 길이와 행간을 유지하며, 장 제목과 소제목, 약력 정보가 절제된 방식으로 정리된다. 그러나 일부 장면에서는 회색 바탕 위의 넓은 여백, 검정 표지의 반전 타이포그래피, 머스터드색 면 위에 세로로 배치된 본문처럼 판면 규칙을 의도적으로 비틀어 디자인 자체를 질문하는 장면을 만든다. 전체적으로 교과서적 질서와 조형적 자기반성이 공존하는 구조다.",summary:"건축과 디자인을 공부하고 실천하는 사람을 위한 교과서로, 디자인 행위를 끊임없는 질문과 사회적 성찰의 과정으로 다루는 노먼 포터의 저작을 2008년 한국어판에서 전면 개정한 책이다. 표지는 초판의 흰 바탕 검정 글자 구성을 반전해 검은 바탕 위에 흰 타이포그래피를 배치하고, 내지에서는 회색 바탕 위에 절제된 본문과 제목, 약력 페이지가 차분하게 전개된다. 특히 일부 장면에서는 머스터드색 바탕 위에 세로로 흐르는 본문을 실험적으로 배치해 ‘디자이너란 무엇인가’라는 질문 자체를 판면 위에서 다시 사유하게 한다. 기능적인 교과서 구조와 조형적 실험이 공존하는 개정판이다.",why_dim:"교과서이자 이론서로서 장문의 본문과 장 제목, 약력, 실험적 페이지를 안정적으로 수용하면서도 휴대 가능한 독서감을 유지하기 적절한 세로형 판형이다. 일반 단행본보다 약간 큰 크기는 본문 가독성을 높이고, 회색/검정/머스터드색 등 강한 바탕색과 타이포그래피 실험을 펼치기에도 충분한 면적을 제공한다.",why_margin:"기본적으로는 본문과 제목, 쪽번호가 안정적으로 놓일 수 있도록 균형 잡힌 여백 구조를 유지한다. 여백은 교과서적 판독성을 지탱하는 프레임으로 작동하지만, 특정 페이지에서는 넓은 빈 공간이나 세로 텍스트 실험을 허용해 사유의 여백 자체를 판면의 일부로 만든다.",why_font:"본문에는 차분한 독서감을 주는 명조 계열을 사용하고, 제목과 보조 정보에는 산세리프 계열을 병용해 이론서의 명확성과 현대성을 함께 확보한 것으로 보인다. 표지의 반전된 흑백 타이포그래피와 내지의 세로 본문 실험은 서체 자체보다 배치와 구조를 통해 의미를 만든다.",why_tracking:"기본 본문은 교과서적 판독성을 위해 중립 자간과 넉넉한 행간을 유지하는 것으로 보인다. 문장을 안정적으로 읽히게 하면서도, 세로 배열이나 넓은 여백이 등장하는 실험적 페이지에서는 문자 간격보다 배치 방식 자체가 리듬을 형성하는 구조다.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"잡지·저널",t:"옐로 페이지스—서울",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/yellow-pages-seoul-kr/",img:"140_옐로 페이지스—서울",kw:["인문·사회","잡지·저널","옐로","페이지스","서울","지면은","영문과","일본어","본문이","좌우","혹은","TB","고딕"],align_title:"중앙 정렬",align_body:"양끝 정렬(한자), 좌측 정렬(영어)",align_note:"양끝 정렬(한자), 좌측 정렬(영어)",f:{w:225,h:297},m:{상:7,하:6,안:15,밖:7},c:{구성:"4단",간격:7},b:{크기:10,행간:12,자간:0},ty:{이름:"TB 고딕, 아틀라스 타이프라이터, 플라크 컨덴스드",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"91mm",pn_y_left:"261.3mm",pn_x_right:"100.7mm",pn_y_right:"261.3mm",pn_size:"95pt",pn_font:"고딕",pn_style:"흑색(윤곽선만) / 가로 / 숫자",running:"-",subheading:"12pt",footnote:"7pt",특:"각 지면은 영문과 일본어 본문이 좌우 혹은 상하로 병치되고, 큰 제목, 지도, 인터뷰 텍스트, 작업 이미지, 캡션, 페이지 번호가 서로 다른 크기로 촘촘히 들어선다. 첫 페이지는 도시 소개문과 지도, 대형 타이틀을 결합한 포스터형 구성이며, 이후 지면은 상단 기사 텍스트와 하단 대형 사진, 작업 이미지와 설명문, 출판물 표지 샘플과 전시 전경을 교차 배치하는 방식으로 리듬을 만든다. 특히 마지막 부분의 동아시아 도서 디자인 심포지엄 기사는 동일한 레이아웃 논리를 유지하면서도 배경을 흰색으로 전환해 보조 기사처럼 구획되며, 시리즈 내부에 또 하나의 편집 계층을 형성한다.",summary:"국제 그래픽 디자인 전문지 아이디어 369호에 실린 동아시아 디자인 특집 ‘옐로 페이지스’의 네 번째 기사로, 고토 데쓰야가 기획·편집하고 제이빈 모와 함께 취재한 서울 편이다. 선명한 노란 바탕 위에 영문·일문 텍스트를 병치하고 지도, 인터뷰, 작업 이미지, 출판물 샘플, 전시 사진을 빽빽하게 배열해 서울의 그래픽 디자인 문화와 디자이너 김영나의 작업 세계를 현장감 있게 전달한다. 굵은 고정폭 계열 제목과 높은 정보 밀도, 아시아 도시의 간판·전화번호부·포스터를 떠올리게 하는 거친 편집 리듬이 핵심이며, 여기에 2014년 파주 동아시아 도서 디자인 심포지엄 기사만 별도의 백색 지면으로 전환해 시리즈 안에서 리듬 변화를 만든다.",why_dim:"잡지 판형에 가까운 크기로, 장문의 기사 텍스트와 다수의 이미지, 지도, 캡션, 부가 기사까지 한 지면 안에 고밀도로 수용하기 적합하다. 국제 디자인 잡지의 편집물답게 휴대성과 보관성을 유지하면서도, 인터뷰와 작업 사례, 심포지엄 기사까지 동시에 강하게 보여 줄 수 있는 충분한 면적을 제공한다.",why_margin:"전면을 노란 배경으로 채운 뒤, 사방 여백을 크게 드러내기보다 텍스트와 이미지 블록이 판면 전체에 가깝게 밀착되도록 구성해 잡지 특유의 밀도와 긴장감을 만든다. 균일한 여백 체계는 다국어 본문과 복수 이미지, 캡션, 페이지 번호가 얽힌 복잡한 지면을 지탱하는 기본 프레임으로 작동한다. 다만 심포지엄 기사에서는 백색 배경으로 바뀌며 같은 체계를 유지한 채 정보의 층위를 분리한다.",why_font:"기사 본문에는 높은 가독성과 중립성을 갖춘 산세리프 및 타자기 계열 서체를 사용해 다국어 정보를 명확히 정리하고, 대형 제목에는 폭이 좁고 강하게 압축된 디스플레이 서체를 써 도시의 간판·신문·전화번호부 같은 인쇄 문화의 인상을 끌어온다. 제목의 거친 존재감과 본문의 정보성이 뚜렷하게 대비되며, 심포지엄 기사에서도 같은 서체 체계를 유지해 전체 시리즈의 일관성을 지킨다.",why_tracking:"고밀도 기사 편집물이라 본문은 과도하게 조이지 않은 중립 자간으로 판독성을 확보하고, 대형 제목은 응축된 폭과 촘촘한 배열로 강한 덩어리감을 만든다. 영문·일문 병기 구조를 고려해 행간은 비교적 넉넉하게 두되, 자간은 전반적으로 절제해 정보가 흩어지지 않게 묶는 방식이다.",layout_type:"본문 2단 + 주석 4단"},
  {g:"건축·공간",pub_type:"전시도록",t:"매스스터디스 건축하기 전/후",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/beforeafter-catalog-kr/",img:"141_매스스터디스 건축하기 전-후",kw:["건축·공간","전시도록","매스스터디스","건축하기","전/후","책은","전시장","입구처럼","보이는","공간","사진으로","격동고딕","드루크"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:186,h:243},m:{상:12,하:18,안:15,밖:15},c:{구성:"2단",간격:6},b:{크기:9.5,행간:14,자간:-20},ty:{이름:"격동고딕, 드루크 컨덴스드, 산돌 고딕네오, 이그제큐티브",분류:"고딕"},pn:"하단-외측-가로",pn_x_left:"25.4mm",pn_y_left:"225.8mm",pn_x_right:"147.8mm",pn_y_right:"225.8mm",pn_size:"36pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"33pt",subheading:"9.5pt",footnote:"9.5pt",특:"책은 전시장 입구처럼 보이는 빈 공간 사진으로 시작해 전시가 가득 찬 장면으로 끝나며, 자료는 현장–설계–시공–완공–사용이라는 흐름을 따라 배치된다. 목차는 원형 노드 구조로 장의 관계를 도식화하고, 본문에서는 흰 면과 검은 면, 거친 망점 질감, 대형 압축 타이포그래피, 전면 사진, 다중 이미지 배열이 교차한다. ‘BEFORE/AFTER’라는 표제는 단순한 장식이 아니라 페이지 양쪽의 색과 내용, 시간성을 동시에 구획하는 구조 장치로 작동한다. 전체적으로 책의 시작과 끝, 좌와 우, 전과 후가 서로 대응하며 순환하는 건축적 편집 시스템을 이룬다.",summary:"건축가 조민석과 매스스터디스의 성과를 중간 점검하는 전시 도록으로, 전시 공간의 핵심 개념인 ‘전/후’, ‘백/흑’, ‘보이드/솔리드’를 책 전체 구조로 번역한 작업이다. 표지와 본문은 사선 경계를 중심으로 서로 대비되는 요소들이 맞물리며, 페이지가 진행될수록 왼쪽은 밝음에서 어둠으로, 오른쪽은 어둠에서 밝음으로 이동하는 순환적 시스템을 이룬다. 흰 방과 검은 방으로 나뉜 전시 구성, 아이디어와 과정에서 실제 사용과 매체 이미지로 이동하는 서사, 시작과 끝이 서로를 반사하는 편집 구조가 책 전체에 촘촘히 스며 있다. 건축 도록이면서 동시에 대칭과 순환, 이행의 논리를 시각화한 시스템 북이다.",why_dim:"건축 도록으로서 텍스트, 전시 전경, 도면, 모형 사진, 인터뷰, 인덱스를 충분히 수용할 수 있는 중대형 판형이다. 전시장 사진의 스케일과 건축 이미지의 물성을 살리면서도, 사선 분할과 좌우 색조 변화 같은 시스템적 편집 원리를 넉넉하게 전개하기에 적절한 크기다.",why_margin:"기본적으로는 사진과 본문, 캡션, 장 제목이 안정적으로 놓일 수 있도록 비교적 균형 잡힌 여백 구조를 유지하지만, 진짜 핵심은 사방 여백보다 좌우 페이지의 상반된 바탕과 질감이 만드는 시각적 프레임이다. 왼쪽 페이지의 빗금, 오른쪽 페이지의 점 망점, 그리고 중앙을 기준으로 한 색조 이동이 여백 이상의 구조적 역할을 수행한다.",why_font:"건축 도록의 정보성과 구조성을 드러내기 위해 강한 고딕 및 컨덴스드 디스플레이 서체를 중심으로 사용한 것으로 보인다. ‘BEFORE’, ‘AFTER’, 장 제목, 인덱스는 압축된 활자로 건축적 질서와 힘을 만들고, 본문과 캡션은 보다 중립적인 서체로 읽기 흐름을 유지한다. 서로 다른 서체 계열의 병용은 책의 이분법적 구조와 매체적 층위를 명확하게 드러낸다.",why_tracking:"본문과 캡션은 건축 정보의 판독성을 위해 중립 자간과 넉넉한 행간을 유지하지만, ‘BEFORE/AFTER’나 대형 장 제목은 압축된 폭과 더 촘촘한 밀도로 사용되어 구조적 긴장과 시간적 절단을 강조한다. 즉 읽기용 텍스트와 구조용 타이포그래피의 리듬이 분리되어 있다.",layout_type:"본문 2단"},
  {g:"문학",pub_type:"단행본",t:"겨울 여행 / 어제 여행",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/le-voyage-dhiver-le-voyage-dhier-kr/",img:"142_겨울 여행 - 어제 여행",kw:["문학","단행본","겨울","여행","/","어제","기본적으로","절제된","구성으로","장문의","신신명조"],align_title:"-",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:144,h:216},m:{상:57.39,하:36.54,안:24.24,밖:36.35},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조, 산돌 고딕네오, 아브니르, 어도비 개러몬드",분류:"혼합 (명조 / 고딕)"},pn:"중앙하단-외측-가로 / 중앙상단-외측-가로",pn_x_left:"11.7mm, 11.7mm",pn_y_left:"140.6mm, 74.2mm",pn_x_right:"128.3mm, 128.3mm",pn_y_right:"140.6mm, 74.2mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"-",footnote:"7.5pt",특:"내지는 기본적으로 절제된 1단 구성으로 장문의 문학 텍스트를 안정적으로 수용한다. 본문은 비교적 차분한 글줄과 행간을 유지하며, 페이지 하단의 쪽번호와 소규모 보조 정보가 정리된다. 반면 표지에서는 두 작가의 얼굴이 겹쳐진 듯한 합성 초상이 중심이 되어, 텍스트 내부의 중층적 서사와 저자 관계를 외부 표면에서 먼저 수행한다. 시리즈 전체의 규칙 안에서 가장 개념적인 이미지 처리가 드러나는 유형이다.",summary:"문학동네 조르주 페렉 시리즈의 한 권으로, 페렉의 초상 하나가 반복적으로 등장하는 시리즈 규칙을 유지하면서도 이번에는 자크 루보의 얼굴과 합성해 표지 이미지 자체를 개념적 장치로 삼은 작업이다. 회색 바탕 위에 두 저자의 얼굴이 겹쳐진 듯한 이미지 처리가 중심이 되며, 이는 두 작가가 함께 언급하는 19세기 무명 시인 위고 베르니에를 암시하는 불확정적 초상으로도 읽힌다. 내지는 절제된 1단 문학서 구성으로 장문의 텍스트를 안정적으로 담고, 표면에서는 이미지의 합성과 문학적 중층성을 시각화하는 방식이 두드러진다.",why_dim:"문학 선집으로서 장문의 본문과 해설적 요소를 안정적으로 수용하기 좋은 중간 판형이다. 문학동네 시리즈 특유의 단단한 장서감을 유지하면서도, 표지의 합성 초상 이미지와 세로·가로 타이포그래피를 무리 없이 함께 담아낼 수 있는 비율이다.",why_margin:"본문과 주석, 쪽번호가 서로 부딪히지 않도록 상하좌우가 비교적 균형 잡힌 여백 체계를 유지하는 것으로 보인다. 하단 여백은 쪽번호와 판면의 안정감을 담당하고, 전체 여백은 표지의 개념적 강도와 달리 차분한 독서 리듬을 보장한다.",why_font:"본문에는 명조 계열을 중심으로 안정적인 문학 선집의 독서감을 유지하고, 제목과 보조 정보에는 산세리프 및 세리프 계열이 병용되는 것으로 보인다. 그러나 이 책의 가장 큰 특징은 서체보다도 표지 이미지 처리로, 합성된 초상이 문학적 불확정성과 저자 관계를 시각적으로 드러낸다.",why_tracking:"문학 텍스트의 자연스러운 호흡을 위해 본문은 중립 자간과 넉넉한 행간을 유지하는 것으로 보인다. 표지의 개념적 복잡성과 달리 내지 조판은 과장 없이 안정적으로 유지되어, 외부 표면의 개념성과 내부 판독성이 분리되는 구조다.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"잡지·저널",t:"옐로 페이지스—타이베이",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/yellow-page-taipei-kr/",img:"143_옐로 페이지스—타이베이",kw:["인문·사회","잡지·저널","옐로","페이지스","타이베이","지면은","영문과","일본어","본문이","좌우","혹은","TB","고딕"],align_title:"중앙 정렬",align_body:"양끝 정렬(한자), 좌측 정렬(영어)",align_note:"양끝 정렬(한자), 좌측 정렬(영어)",f:{w:225,h:297},m:{상:7,하:6,안:15,밖:7},c:{구성:"4단",간격:7},b:{크기:10,행간:12,자간:0},ty:{이름:"TB 고딕, 아틀라스 타이프라이터, 플라크 컨덴스드",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"91mm",pn_y_left:"261.3mm",pn_x_right:"100.7mm",pn_y_right:"261.3mm",pn_size:"95pt",pn_font:"고딕",pn_style:"흑색(윤곽선만) / 가로 / 숫자",running:"-",subheading:"12pt",footnote:"7pt",특:"각 지면은 영문과 일본어 본문이 좌우 혹은 상하로 병치되고, 큰 제목, 지도, 인터뷰 텍스트, 작업 이미지, 캡션, 페이지 번호가 서로 다른 크기로 촘촘히 들어선다. 첫 페이지는 도시 소개문과 지도, 대형 타이틀을 결합한 포스터형 구성이며, 이후 지면은 상단 기사 텍스트와 하단 대형 사진, 출판물 샘플과 설명문을 교차 배치하는 방식으로 리듬을 만든다. 인물 인터뷰, 일상 서술, 작업 아카이브가 다단 구조 안에 혼합되어 전체적으로 정돈된 그리드 위에 정보 밀도를 극대화한 잡지형 편집 구조를 이룬다.",summary:"국제 그래픽 디자인 전문지 『아이디어』 366호에 실린 동아시아 디자인 특집 ‘옐로 페이지스’의 두 번째 기사로, 고토 데쓰야가 기획·편집하고 제이빈 모와 함께 취재한 타이베이 편이다. 선명한 노란 바탕 위에 영문·일문 텍스트를 병치하고 지도, 인터뷰, 작업 이미지, 출판물 샘플을 빽빽하게 배열해 타이베이의 디자인 문화와 디자이너 아론 녜의 작업 세계를 현장감 있게 전달한다. 굵은 고정폭 계열 제목과 높은 정보 밀도, 아시아 도시의 간판·전화번호부·포스터를 떠올리게 하는 거친 편집 리듬이 핵심이다.",why_dim:"잡지 판형에 가까운 크기로, 장문의 기사 텍스트와 다수의 이미지, 지도, 캡션을 한 지면 안에 고밀도로 수용하기 적합하다. 국제 디자인 잡지의 편집물답게 휴대성과 보관성을 유지하면서도, 인터뷰와 작업 사례, 출판물 샘플을 동시에 강하게 보여 줄 수 있는 충분한 면적을 제공한다.",why_margin:"전면을 노란 배경으로 채운 뒤, 사방 여백을 크게 드러내기보다 텍스트와 이미지 블록이 판면 전체에 가깝게 밀착되도록 구성해 잡지 특유의 밀도와 긴장감을 만든다. 균일한 여백 체계는 다국어 본문과 복수 이미지, 캡션, 페이지 번호가 얽힌 복잡한 지면을 지탱하는 기본 프레임으로 작동한다.",why_font:"기사 본문에는 높은 가독성과 중립성을 갖춘 고딕 및 타자기 계열 서체를 사용해 다국어 정보를 명확히 정리하고, 대형 제목에는 폭이 좁고 강하게 압축된 디스플레이 서체를 써 도시의 간판·신문·전화번호부 같은 인쇄 문화의 인상을 끌어온다. 제목의 거친 존재감과 본문의 정보성이 뚜렷하게 대비된다.",why_tracking:"고밀도 기사 편집물이라 본문은 과도하게 조이지 않은 중립 자간으로 판독성을 확보하고, 대형 제목은 응축된 폭과 촘촘한 배열로 강한 덩어리감을 만든다. 영문·일문 병기 구조를 고려해 행간은 비교적 넉넉하게 두되, 자간은 전반적으로 절제해 정보가 흩어지지 않게 묶는 방식이다.",layout_type:"본문 2단 + 주석 4단"},
  {g:"문학",pub_type:"기관출판",t:"검은 피부, 하얀 가면",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/peau-noire-masques-blancs-kr/",img:"144_검은 피부, 하얀 가면",kw:["문학","기관출판","검은","피부","하얀","가면","기본적으로","구성의","인문서","형식을","신신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:138,h:222},m:{상:21,하:36,안:21,밖:24},c:{구성:"1단",간격:0},b:{크기:10,행간:17,자간:-50},ty:{이름:"SM 신신명조, 벤턴 산스, 산돌 고딕네오, 어도비 캐즐런, 윤명조, 캐즐런 540",분류:"혼합 (명조 / 고딕)"},pn:"상단-외측-가로(좌) / 하단-외측-가로(우)",pn_x_left:"42.1mm",pn_y_left:"11.4mm",pn_x_right:"91.8mm",pn_y_right:"191.5mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"12pt",footnote:"9pt",특:"내지는 기본적으로 1단 구성의 인문서 형식을 따른다. 본문은 안정적인 글줄 길이와 행간을 유지하고, 장 제목과 쪽번호가 절제된 방식으로 정리된다. 반면 표지와 덧표지에서는 검은 면과 흰 면의 사선 절개, 다색 망점으로 떨리는 거친 활자 이미지, 사선으로 걸쳐진 정보 블록이 결합해 제목의 의미를 표면 효과로 전환한다. 내부는 학술적 질서, 외부는 지각적 충돌이라는 대비가 선명하다.",summary:"문학동네 인문 라이브러리 시리즈의 한 권으로, 프란츠 파농의 탈식민 이론서를 위해 비대칭 덧표지 구조와 강한 망점 이미지, 흑백 대비를 결합한 디자인이다. 474×270mm 종이를 비스듬히 접은 덧표지가 검은 면과 흰 면의 날카로운 경계를 만들고, 그 아래 드러나는 표면에는 다색 망점으로 번지는 거친 활자 이미지가 놓여 ‘검은 피부, 하얀 가면’이라는 제목 자체를 인종화된 표면과 가면의 문제로 번역한다. 내지는 차분한 1단 인문서 구조와 장 제목, 본문, 쪽번호를 통해 학술적 독서 리듬을 유지하면서, 외부 표면에서는 지각적 불안과 분열의 감각을 극대화한다.",why_dim:"인문 라이브러리 시리즈의 공통 세로형 판형으로, 장문의 이론 텍스트와 장 구분, 해설적 요소를 안정적으로 수용하면서도 덧표지의 비대칭 절개와 강한 표면 이미지를 충분히 드러내기 위한 크기다. 이론서의 무게감과 시리즈 특유의 조형 실험을 함께 담기 적절하다.",why_margin:"장문의 이론 텍스트를 안정적으로 수용하기 위해 상하좌우가 비교적 균형 잡힌 여백 구조를 유지하되, 하단 여백을 조금 넉넉히 두어 쪽번호와 판면의 무게중심을 잡는다. 덧표지의 강한 흑백 대비와 망점 표면이 외부에서 긴장을 만든다면, 내지의 여백은 학술적 독서의 안정성을 보장하는 완충 장치로 작동한다.",why_font:"본문에는 안정적인 인문서 독서감을 위한 명조 계열이 중심이 되고, 보조 정보에는 고딕이 병용되며, 표지의 핵심 인상은 망점 처리된 거친 제목 이미지에서 온다. 명조와 고딕의 체계는 시리즈의 학술성과 정보성을 유지하고, 표면의 확대된 활자 이미지는 파농의 주제를 감각적으로 전환한다.",why_tracking:"장문의 인문 텍스트를 위한 본문은 중립 자간과 넉넉한 행간으로 안정성을 유지하고, 표면의 제목 이미지는 자간보다는 망점 확대와 번짐 효과를 통해 덩어리감과 불안을 만든다. 내지에서는 판독성과 질서가 우선되고, 표지에서만 강한 조형성이 전면화되는 구조다.",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"단행본",t:"레트로 마니아—과거에 중독된 대중문화",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/retromania-kr/",img:"145_레트로 마니아—과거에 중독된 대중문화",kw:["아트이론·비평","단행본","레트로","마니아","과거에","중독된","대중문화","기본적으로","중심의","이론서","구성을","고딕","계열"],align_title:"우측 정렬(대제), 좌측 정렬(소제)",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:135,h:216},m:{상:12,하:27,안:15,밖:19},c:{구성:"2단",간격:6},b:{크기:8.5,행간:17,자간:0},ty:{이름:"고딕 계열 제목체 / 명조 또는 가독성 본문체",분류:"혼합 (명조 / 고딕)"},pn:"하단-외측-가로",pn_x_left:"6.7mm",pn_y_left:"192.1mm",pn_x_right:"124.6mm",pn_y_right:"192.1mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"36pt",footnote:"6.5pt",특:"내지는 기본적으로 1단 중심의 이론서 구성을 따르며, 큰 장 번호와 장 제목이 본문 앞에서 강하게 선언된다. 본문은 비교적 안정적인 글줄과 행간을 유지하지만, 인용과 소제목, 후반부 정보성 페이지에서는 여러 텍스트 블록이 한 지면 안에서 병치되며 밀도가 높아진다. 표지와 띠지, 책등에서는 거대한 고딕 제목이 상하 혹은 세로로 분절되어 배치되어, ‘레트로’라는 단어 자체가 하나의 시각적 오브제로 작동한다. 판면 전체는 책의 내용처럼 과거의 대중문화 그래픽 언어를 현재적으로 재조합하는 인상을 준다.",summary:"사이먼 레이놀즈의 음악문화 비평서를 한국어로 옮긴 책으로, 레트로 문화와 대중음악의 과거 집착을 분석하는 긴 텍스트를 강한 표지 타이포그래피와 선명한 별색 대비로 감싼 작업이다. 회색 바탕 위에 형광에 가까운 적색 혹은 청록색의 거대한 제목이 상하로 갈라져 놓이고, 얇은 청색·적색의 보조 정보가 넓은 여백 사이에 배치되어 이론서임에도 팝 문화 특유의 강한 시각적 에너지를 만든다. 내지는 비교적 절제된 1단 중심 구성 속에서 큰 장 제목, 긴 본문, 인용과 소제목, 다단에 가까운 후반부 정보 배열을 통해 두꺼운 분량의 비평 텍스트를 소화한다. 반양장 구조와 색상 변주까지 포함해, 내용의 ‘레트로’라는 주제를 책의 표면과 읽기 리듬 양쪽에서 수행하는 작업이다.",why_dim:"장문의 음악문화 비평서를 안정적으로 수용하면서도, 대형 표지 타이포그래피와 넓은 여백, 장 제목의 시각적 리듬을 충분히 살릴 수 있는 세로형 판형이다. 일반 단행본보다 약간 큰 크기는 456쪽에 이르는 분량을 다루면서도 본문 가독성과 표지의 팝적 존재감을 동시에 확보하기에 적절하다.",why_margin:"기본적으로는 두꺼운 번역 비평서를 안정적으로 읽히게 하기 위해 균형 잡힌 여백 구조를 유지한다. 하단 여백은 쪽번호와 판면의 무게를 지탱하고, 넓은 상단·측면 여백은 큰 장 제목과 소제목, 보조 정보를 분리하는 역할을 한다. 표지에서의 극단적 타이포그래피 대비와 달리 내지의 여백은 독서의 호흡을 유지하는 장치다.",why_font:"표지와 장 제목에는 폭이 넓고 강한 존재감을 가진 고딕 계열을 사용해 대중문화와 그래픽 디자인의 에너지를 전면화하고, 본문에는 장문 독서를 위한 가독성 중심의 본문체를 사용한 것으로 보인다. 즉 표면은 팝적이고 공격적이며, 내부는 비평서답게 안정적인 이중 구조다.",why_tracking:"장문의 비평 텍스트를 안정적으로 읽히게 하기 위해 본문은 중립 자간과 넉넉한 행간을 유지하는 것으로 보인다. 반면 표지와 대형 장 제목은 응축된 색면과 큰 활자 대비가 핵심이므로, 문자 간격보다는 크기와 배치가 더 큰 조형 변수로 작동한다.",layout_type:"본문 1단 + 주석 2단"},
  {g:"인문·사회",pub_type:"단행본",t:"오프 화이트 페이퍼—브르노 비엔날레와 교육",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/off-white-paper-publication-kr/",img:"146_오프 화이트 페이퍼—브르노 비엔날레와 교육",kw:["인문·사회","단행본","오프","화이트","페이퍼","브르노","비엔날레와","교육","책은","크게","제목","설명","도표로","이루어지며","산세리프","계열"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:296,h:216},m:{상:17,하:10,안:8,밖:8},c:{구성:"6단",간격:8},b:{크기:10,행간:12,자간:0},ty:{이름:"산세리프 계열 제목체 / 중립적 정보용 본문체",분류:"고딕"},pn:"상단-외측-가로",pn_x_left:"15.8mm",pn_y_left:"7mm",pn_x_right:"276.4mm",pn_y_right:"7mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"11pt",subheading:"16pt",footnote:"8pt",특:"책은 크게 제목·설명·도표로 이루어지며, 전통적인 본문 중심 레이아웃보다 데이터 배열 자체가 중심이 된다. 각 스프레드는 왼쪽의 질문형 제목, 중앙과 우측에 펼쳐진 점 단위 그래프, 가장자리의 범례와 설명 텍스트로 구성된다. 표지 역시 옅은 배경 위에 반투명한 도트 패턴과 절제된 제목을 얹어, 책 전체가 ‘오프 화이트’라는 중간 톤의 정보 공간처럼 느껴지게 한다. 정보의 위계는 크기보다 위치와 군집, 반복 단위에 의해 형성된다.",summary:"브르노 국제 그래픽 디자인 비엔날레 2014를 위해 제작된 자료집으로, ‘교육’을 주제로 한 이론서 대신 비엔날레 자체의 역사를 정량적으로 분석해 아이소타이프 전통을 잇는 도표 중심 출판물로 재구성한 작업이다. 회백색 바탕 위에 검정 본문과 다색 점 단위 그래프가 넓은 면적에 정교하게 흩어지며, 선정 디자이너들의 국적, 교육 배경, 도시, 학교, 예산 등 보이지 않던 구조를 시각적으로 드러낸다. 표지와 내지 모두 정보의 양보다 데이터 단위의 배열 원리와 시각적 질서를 앞세우며, 책 전체가 하나의 조사 도구이자 교육 시스템 비판의 인터페이스로 기능한다.",why_dim:"가로로 넓은 판형을 택해 다수의 국가명, 도시명, 학교명과 점 단위 데이터를 한 지면에 펼쳐 놓을 수 있도록 한 것으로 보인다. 도표와 인덱스, 텍스트가 서로 간섭하지 않으면서도 하나의 정보 지형처럼 읽히게 하기 위한 선택이며, 일반 책보다 전시장 패널이나 통계 지도에 가까운 시각 경험을 제공한다.",why_margin:"여백은 단순한 비어 있는 공간이 아니라 데이터 군집과 설명 텍스트를 분리하고, 개별 점 단위가 자율적으로 인식되게 만드는 핵심 구조다. 넓은 상단과 중앙의 공백은 시각화 요소들을 숨 쉬게 하며, 가로 판형 전체를 하나의 정보 필드로 작동하게 한다.",why_font:"데이터 시각화의 명확성과 국제적 판독성을 위해 중립적이고 구조적인 고딕 계열 서체를 중심으로 사용한 것으로 보인다. 질문형 제목은 굵고 또렷하게, 설명 텍스트와 범례는 보다 작고 절제되게 설정되어, 정보의 복잡성을 시각적 명료함으로 번역한다.",why_tracking:"설명 텍스트는 데이터와 함께 읽혀야 하므로 중립 자간과 넉넉한 행간을 유지해 판독성을 확보하는 것으로 보인다. 반면 개별 점 데이터와 국가명, 학교명 등은 서로 충돌하지 않게 약간 넓은 간격 체계를 취해, 전체 지면이 하나의 지도처럼 읽히도록 조정된 것으로 보인다.",layout_type:"본문 3단(2열) + 주석 6단(2열)"},
  {g:"인문·사회",pub_type:"전시도록",t:"한반도 오감도",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/crows-eye-view-catalog-kr/",img:"147_한반도 오감도",kw:["인문·사회","전시도록","한반도","오감도","책은","검은","표지와","뒤집힌","제목에서","시작해","노이에","하스"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:180,h:240},m:{상:22,하:7,안:9,밖:7},c:{구성:"2단",간격:5},b:{크기:9,행간:11,자간:0},ty:{이름:"노이에 하스 그로테스크",분류:"고딕"},pn:"하단-중앙외측-가로(좌) / 상단-중앙외측-가로(우)",pn_x_left:"44.5mm",pn_y_left:"230.3mm",pn_x_right:"131.9mm",pn_y_right:"6.4mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"15pt",footnote:"9pt",특:"책은 검은 표지와 뒤집힌 제목에서 시작해, 본문 내내 사선 대칭과 상호 반사의 원리를 변주한다. 어떤 스프레드는 흰 배경 위에 사진과 본문이 느슨하게 놓이고, 어떤 장면에서는 검은 배경 위에 이미지와 대형 제목이 강하게 충돌한다. 장 도입부의 보라·노랑 대각 색면, 상하 반전된 제목, 좌우를 가르는 중앙축, 그리고 사진·캡션·에세이의 반복적 배치는 모두 ‘두 체제의 긴장과 반영’이라는 전시 개념을 책의 구조로 번역한다. 전체적으로 시작과 끝, 좌와 우, 흑과 백이 서로를 비추며 순환하는 편집 시스템이다.",summary:"제14회 베니스 건축 비엔날레 한국관 전시 도록으로, 남북한 현대 건축사를 탐구한 전시 개념을 ‘오감도 시제 4호’의 사선 대칭 구조로 번역한 작업이다. 검은 표지 위에 상하가 뒤집힌 백색 제목이 서로를 비추듯 배치되고, 본문에서는 사선 축을 경계로 색면, 제목, 이미지, 텍스트가 서로 대응하거나 충돌하며 남과 북, 자본주의와 사회주의, 모방과 견제의 관계를 시각화한다. 흰 바탕의 차분한 본문 스프레드와 검은 면의 강한 장 도입부, 그리고 보라·노랑의 대각 색면이 반복적으로 등장하며 책 전체가 하나의 분단 구조 모델처럼 작동한다.",why_dim:"건축 전시 도록으로서 전시 전경, 아카이브 이미지, 장문의 에세이, 장 도입부를 균형 있게 수용할 수 있는 중대형 판형이다. 좌우 대칭과 사선 분할, 전면 이미지, 여백 중심의 전시 사진 페이지를 모두 전개하기에 적절하며, 전시의 건축적·정치적 스케일을 책 안에 담기 좋은 비율이다.",why_margin:"기본적으로는 사진, 본문, 캡션, 장 제목이 안정적으로 놓일 수 있도록 비교적 균형 잡힌 여백 구조를 유지하지만, 핵심은 사방 여백보다 사선 축과 좌우 페이지의 긴장 관계다. 여백은 흰 면과 검은 면, 이미지와 텍스트, 좌와 우를 분리하면서 동시에 연결하는 구조적 장치로 작동한다.",why_font:"하나의 고딕 계열 서체를 크기, 굵기, 방향, 반전에 따라 다층적으로 운용해 책 전체의 일관성을 만든다. 본문과 캡션은 중립적이고 차분한 읽기 구조를 유지하고, 장 제목과 표지의 대형 활자는 사선 대칭과 상하 반전 속에서 강한 구조적 긴장을 형성한다. 서체 종류의 다양성보다 동일 서체의 체계적 운용이 핵심이다.",why_tracking:"본문과 캡션은 장문의 건축 담론과 설명을 안정적으로 읽히게 하기 위해 중립 자간과 넉넉한 행간을 유지하지만, 표지와 장 제목은 더 압축되고 촘촘한 밀도로 쓰여 구조적 충돌과 대칭의 힘을 강조한다. 즉 읽기용 텍스트와 구조용 타이포그래피의 리듬이 명확히 분리되어 있다.",layout_type:"본문 2단"},
  {g:"인문·사회",pub_type:"잡지·저널",t:"옐로 페이지스—홍콩",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/yellow-pages-hong-kong-kr/",img:"148_옐로 페이지스—홍콩",kw:["인문·사회","잡지·저널","옐로","페이지스","홍콩","지면은","영문과","일본어","본문이","좌우","혹은","TB","고딕"],align_title:"중앙 정렬",align_body:"양끝 정렬(한자), 좌측 정렬(영어)",align_note:"양끝 정렬(한자), 좌측 정렬(영어)",f:{w:225,h:297},m:{상:7,하:6,안:15,밖:7},c:{구성:"4단",간격:7},b:{크기:10,행간:12,자간:0},ty:{이름:"TB 고딕, 아틀라스 타이프라이터, 플라크 컨덴스드",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"91mm",pn_y_left:"261.3mm",pn_x_right:"100.7mm",pn_y_right:"261.3mm",pn_size:"95pt",pn_font:"고딕",pn_style:"흑색(윤곽선만) / 가로 / 숫자",running:"-",subheading:"12pt",footnote:"7pt",특:"각 지면은 영문과 일본어 본문이 좌우 혹은 상하로 병치되고, 큰 제목, 지도, 인터뷰 텍스트, 작업 이미지, 캡션, 페이지 번호가 서로 다른 크기로 촘촘히 들어선다. 첫 페이지는 도시 소개문과 지도, 대형 타이틀을 결합한 포스터형 구성이며, 이후 지면은 상단 기사 텍스트와 하단 대형 사진, 출판물 샘플과 설명문, 수집 자료 이미지를 교차 배치하는 방식으로 리듬을 만든다. 인물 인터뷰, 작업 아카이브, 지역 인쇄문화 자료가 다단 구조 안에 혼합되어 전체적으로 정돈된 그리드 위에 정보 밀도를 극대화한 잡지형 편집 구조를 이룬다.",summary:"국제 그래픽 디자인 전문지 『아이디어』 365호에 실린 동아시아 디자인 특집 ‘옐로 페이지스’의 첫 번째 기사로, 고토 데쓰야가 기획·편집한 홍콩 편이다. 선명한 노란 바탕 위에 영문·일문 텍스트를 병치하고 지도, 인터뷰, 작업 이미지, 출판물 샘플, 수집 자료를 빽빽하게 배열해 홍콩의 디자인 문화와 디자이너 제이빈 모의 작업 세계를 현장감 있게 전달한다. 굵은 고정폭 계열 제목과 높은 정보 밀도, 아시아 도시의 간판·전화번호부·신문을 떠올리게 하는 거친 편집 리듬이 핵심이다.",why_dim:"잡지 판형에 가까운 크기로, 장문의 기사 텍스트와 다수의 이미지, 지도, 캡션, 출판물 샘플을 한 지면 안에 고밀도로 수용하기 적합하다. 국제 디자인 잡지의 편집물답게 휴대성과 보관성을 유지하면서도, 인터뷰와 작업 사례, 아카이브 자료를 동시에 강하게 보여 줄 수 있는 충분한 면적을 제공한다.",why_margin:"전면을 노란 배경으로 채운 뒤, 사방 여백을 크게 드러내기보다 텍스트와 이미지 블록이 판면 전체에 가깝게 밀착되도록 구성해 잡지 특유의 밀도와 긴장감을 만든다. 균일한 여백 체계는 다국어 본문과 복수 이미지, 캡션, 페이지 번호가 얽힌 복잡한 지면을 지탱하는 기본 프레임으로 작동한다.",why_font:"기사 본문에는 높은 가독성과 중립성을 갖춘 고딕 및 타자기 계열 서체를 사용해 다국어 정보를 명확히 정리하고, 대형 제목에는 폭이 좁고 강하게 압축된 디스플레이 서체를 써 도시의 간판·신문·전화번호부 같은 인쇄 문화의 인상을 끌어온다. 제목의 거친 존재감과 본문의 정보성이 뚜렷하게 대비된다.",why_tracking:"고밀도 기사 편집물이라 본문은 과도하게 조이지 않은 중립 자간으로 판독성을 확보하고, 대형 제목은 응축된 폭과 촘촘한 배열로 강한 덩어리감을 만든다. 영문·일문 병기 구조를 고려해 행간은 비교적 넉넉하게 두되, 자간은 전반적으로 절제해 정보가 흩어지지 않게 묶는 방식이다.",layout_type:"본문 2단 + 주석 4단"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"옵.신 3호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/ob-scene-3-kr/",img:"149_옵.신 3호",kw:["아트이론·비평","잡지·저널","옵.신","3호","기본적으로","구성의","비평","저널","명조","계열"],align_title:"-",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:150,h:225},m:{상:18,하:35,안:21,밖:30},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"명조 계열 본문체 / 고딕 보조체",분류:"명조"},pn:"상단-외측-가로(좌) / 하단-외측-가로(우)",pn_x_left:"30mm",pn_y_left:"5.5mm",pn_x_right:"116.4mm",pn_y_right:"215.4mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"-",footnote:"-",특:"내지는 기본적으로 1단 구성의 비평 저널 형식을 따르며, 장문의 본문과 소제목, 인용문, 이미지가 절제된 방식으로 배치된다. 흑백 영화 스틸은 지면 중앙에 고립된 듯 놓여 있고, 본문은 비교적 안정적인 글줄과 행간을 유지한다. 그러나 특정 페이지에서는 검정 박스 안의 흰 인용문, 적갈색 강조문, 세로 러닝헤드가 강하게 개입해 발화의 층위를 분리하고, ‘목소리’라는 주제의 충돌과 증폭을 편집적으로 시각화한다. 즉 전체는 차분하지만, 부분적으로 급격한 억양 변화가 삽입되는 구조다.",summary:"무대(scene)로부터 벗어난 것들을 다루는 다원 예술 저널 『옵.신』 3호로, ‘목소리’라는 주제를 중심으로 시각 예술과 담론의 역사에서 배제되거나 사라지기를 강요받은 존재들을 탐구하는 특집호다. 회색에 가까운 중성 배경 위에 흑백 영화 스틸, 절제된 본문 조판, 그리고 일부 페이지의 강한 검정 박스 인용문과 적갈색 강조문이 공존해, 차분한 읽기 구조 속에서 목소리의 충돌과 증폭을 시각적으로 드러낸다. 전체적으로는 비평 저널의 안정된 판면을 유지하면서도, 특정 장면에서 발화와 억압, 인용과 개입의 관계를 그래픽적으로 강조하는 편집이 특징이다.",why_dim:"장문의 비평 텍스트와 이미지, 인용문, 편집적 개입을 함께 수용하기 좋은 세로형 저널 판형이다. 일반 단행본보다 약간 길쭉한 비율은 본문 가독성을 유지하면서도 이미지와 텍스트 블록을 느슨하게 병치하기에 적절하고, 학술지와 전시 인쇄물 사이의 중간 성격을 띠게 한다.",why_margin:"기본적으로는 비평 저널의 안정적인 독서 리듬을 위해 균형 잡힌 여백 구조를 유지한다. 넓은 여백은 본문과 이미지, 인용문 사이에 충분한 간격을 두어 사유의 호흡을 만들고, 검정 박스나 세로 러닝 요소가 들어올 때도 판면이 과밀해지지 않게 하는 완충 역할을 한다.",why_font:"본문에는 장문 비평 텍스트에 적합한 명조 계열이 중심이 되고, 세로 러닝 요소나 인용문 박스, 강조문에는 보다 중립적이고 구조적인 고딕 계열이 병용되는 것으로 보인다. 서체의 대비는 크기보다 기능에 따라 분화되며, 읽기의 안정성과 발화의 긴장을 동시에 만든다.",why_tracking:"장문의 비평 텍스트를 안정적으로 읽히게 하기 위해 본문은 중립 자간과 넉넉한 행간을 유지하는 것으로 보인다. 반면 인용문 박스와 강조문은 더 조밀하거나 강한 대비를 통해 억양을 만들며, 하나의 저널 안에서 여러 발화 층위가 다른 리듬으로 공존하게 한다.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"단행본",t:"100% 광주",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/100-gwangju-book-kr/",img:"150_100% 광주",kw:["인문·사회","단행본","100%","광주","도입부에서는","10×10","원형","매트릭스를","반복적으로","사용해","고딕","계열"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:108,h:150},m:{상:6,하:17,안:13,밖:6},c:{구성:"2단",간격:7},b:{크기:7,행간:12,자간:0},ty:{이름:"고딕 계열 정보용 본문체",분류:"고딕"},pn:"중앙-내측-세로",pn_x_left:"99.5mm",pn_y_left:"53.7mm",pn_x_right:"4.7mm",pn_y_right:"53.7mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"7pt",footnote:"-",특:"도입부에서는 10×10 원형 매트릭스를 반복적으로 사용해 성별, 국적, 토지 이용, 수송 분담 등 각종 통계 정보를 직관적으로 보여 준다. 원형 단위는 때로 숫자만 담긴 원, 때로 아이콘으로 치환된 셀로 변주되어 공연의 사회적 구성을 시각화한다. 후반부로 가면 개별 참여자의 번호, 간단한 프로필, 질문 응답, 초상이 등장해 집단적 데이터가 다시 개인의 서사로 전환된다. 전체적으로는 통계 도감과 인물 아카이브가 한 권 안에서 자연스럽게 이어지는 구조다.",summary:"리미니 프로토콜의 공연 100% 광주를 기록한 책으로, 인구 통계학적 현실을 반영해 구성된 출연자 100명의 구조를 책의 도입부와 전체 편집 원리로 번역한 작업이다. 10열 10행 매트릭스의 원형 단위 100개를 기본 모듈로 삼아 성별, 국적, 토지 이용, 교통수단, 개별 출연자 정보 등을 데이터 시각화 형식으로 전개하며, 공연의 집단성과 도시의 통계적 얼굴을 동시에 드러낸다. 작은 판형 안에 점·아이콘·도식이 반복적으로 배열되고, 후반부에서는 개별 참여자의 초상과 자기서사가 결합되어 익명의 통계가 다시 사람의 목소리로 돌아온다.",why_dim:"손에 쥐기 쉬운 작은 판형으로, 공연의 기록물인 동시에 휴대 가능한 소책자 같은 인상을 준다. 작은 크기 안에 10×10 매트릭스와 간결한 아이콘 시스템을 압축적으로 구성할 수 있어, 통계와 개인의 이야기를 친밀한 스케일로 경험하게 만든다.",why_margin:"작은 판형에서도 도표와 본문, 인물 정보가 답답해지지 않도록 비교적 균형 잡힌 여백 구조를 유지하는 것으로 보인다. 여백은 원형 모듈과 아이콘 배열을 명료하게 구분하고, 후반부 인물 사진과 자기소개 텍스트가 안정적으로 놓이도록 하는 완충 장치로 작동한다.",why_font:"데이터와 숫자, 아이콘, 인명 정보를 명확하게 전달하기 위해 중립적이고 구조적인 고딕 계열을 사용한 것으로 보인다. 작은 판형과 높은 정보 밀도 속에서 판독성을 우선하면서도, 공연의 통계적 성격과 아카이브적 차분함을 유지하는 선택이다.",why_tracking:"작은 판형 안에서 숫자와 인명, 짧은 문답을 명확히 읽히게 하기 위해 본문은 중립 자간과 비교적 넉넉한 행간을 유지하는 것으로 보인다. 반면 도표 영역에서는 원형 모듈 사이의 간격 자체가 정보 질서를 형성하므로, 문자 간격보다 모듈 간 거리와 정렬이 더 중요한 변수로 작동한다.",layout_type:"본문 2단"},
  {g:"문학",pub_type:"단행본",t:"레퀴엠",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/requiem-kr/",img:"151_레퀴엠",kw:["문학","단행본","레퀴엠","기본적으로","구성의","신신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"-",f:{w:120,h:192},m:{상:15,하:30,안:17,밖:18},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조, 시몬치니 개러몬드, 아리따 돋움, 애퍼수",분류:"명조"},pn:"하단-외측-가로 (대각선)",pn_x_left:"7.7mm",pn_y_left:"176.9mm",pn_x_right:"109.5mm",pn_y_right:"176.9mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 가로(대각선) / 숫자",running:"8pt",subheading:"-",footnote:"-",특:"내지는 기본적으로 1단 구성의 문학 단행본 형식을 따른다. 본문은 비교적 짧은 글줄과 안정적인 행간을 유지하며, 장면 전환과 간헐적 주석이 절제되게 정리된다. 좁은 판형 덕분에 판면은 더 응축된 인상을 주지만, 정보 위계를 과도하게 강조하지 않고 자연스러운 독서 흐름을 유지한다. 표지는 회색 바탕 위에 검은 선묘 초상과 절제된 제목, 세로 보조 타이포그래피가 비대칭적으로 놓여 조용하지만 강한 시각적 긴장을 만든다.",summary:"안토니오 타부키 선집의 한 권으로, 슬기와 민이 보여 준 현대적이고 기능적인 본문 디자인의 감각이 잘 드러나는 작품이다. 좁고 긴 판형 위에 안정적인 본문 조판과 각주, 장면 전환을 자연스럽게 조직하고, 표지에서는 회색 바탕 위의 검은 선묘 초상과 절제된 타이포그래피를 통해 고전 문학과 동시대적 그래픽 감각을 겹쳐 놓는다. 무리 없는 판면과 절제된 타이포그래피 속에서 조형적 입장을 분명히 드러내는, 안토니오 타부키 선집의 또 다른 변주다.",why_dim:"기존 136×192mm 선집보다 조금 더 폭이 좁은 판형으로, 장문의 문학 텍스트를 보다 응축된 리듬으로 읽히게 하면서도 손에 잡히는 독서감을 유지하기 적절하다. 좁은 폭 덕분에 글줄 길이가 자연스럽게 짧아져 집중력 있는 독서를 유도하고, 표지의 세로 보조 타이포그래피와 선묘 초상이 더욱 또렷하게 작동한다.",why_margin:"폭이 좁은 판형에 맞춰 좌우 여백을 과도하게 넓히기보다 글줄 길이를 안정적으로 유지할 만큼만 두고, 하단 여백을 조금 더 확보해 쪽번호와 판면의 무게중심을 잡는 방식으로 보인다. 본문과 각주가 한 페이지 안에서 부딪히지 않도록 여백이 완충 장치로 작동하며, 전체적으로 조용한 독서 리듬을 만든다.",why_font:"본문에는 안정적인 독서감을 주는 명조와 개러몬드 계열을 사용하고, 표지와 보조 정보에는 고딕 및 디스플레이 계열을 병용해 고전 문학의 품위와 현대적 긴장을 함께 만든다. 특히 검은 선묘 초상과 절제된 제목은 선집의 시리즈감을 유지하면서도 다른 권과 차별화된 보다 침잠한 분위기를 형성한다.",why_tracking:"좁은 판형에서 장문의 텍스트가 답답해지지 않도록 중립 자간과 넉넉한 행간을 유지하는 것으로 보인다. 지나친 압축이나 확장을 피하고, 자연스러운 조판을 통해 문학서의 안정성과 조형적 완성도를 함께 확보하는 방식이다.",layout_type:"본문 1단"},
  {g:"문학",pub_type:"기관출판",t:"저자로서의 인류학자",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/works-and-lives-kr/",img:"152_저자로서의 인류학자",kw:["문학","기관출판","저자로서의","인류학자","기본적으로","구성의","인문서","형식을","신신명조"],align_title:"-",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:138,h:222},m:{상:21,하:36,안:21,밖:24},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조, 벤턴 산스, 산돌 고딕네오, 어도비 캐즐런, 윤명조, 캐즐런 540",분류:"혼합 (명조 / 고딕)"},pn:"상단-중앙외측-가로",pn_x_left:"41.7mm",pn_y_left:"11.5mm",pn_x_right:"91.7mm",pn_y_right:"11.5mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"10pt",footnote:"7pt",특:"내지는 기본적으로 1단 구성의 인문서 형식을 따른다. 본문은 안정적인 글줄 길이와 행간을 유지하고, 장 제목과 쪽번호가 절제된 방식으로 정리된다. 반면 표지와 덧표지에서는 회색·흑색의 대각 절개, 거대한 회색 활자 파편, 빨강·파랑·초록의 보조 표기가 결합해 제목과 개념을 다층적으로 드러낸다. 내부는 학술적 질서, 외부는 저자성의 층위와 해석을 겹쳐 놓은 타이포그래피 장(field)이라는 대비가 선명하다.",summary:"문학동네 인문 라이브러리 시리즈의 한 권으로, 클리퍼드 기어츠의 인류학 이론서를 위해 비대칭 덧표지 구조와 대각 색면, 확대된 타이포그래피를 결합한 디자인이다. 474×270mm 종이를 비스듬히 접은 덧표지가 회색과 흑색의 각진 면을 만들고, 그 아래 드러나는 표면에는 ‘WORKS AND LIVES’의 거대한 회색 활자 조각과 빨강·파랑·초록의 보조 텍스트가 중첩되어 ‘저자’, ‘작품’, ‘삶’의 관계를 층위적으로 드러낸다. 내지는 차분한 1단 인문서 구조와 장 제목, 본문, 쪽번호를 통해 학술적 독서 리듬을 유지하면서, 외부 표면에서는 저자성의 구성성과 중첩성을 시각적 구조로 번역한다.",why_dim:"인문 라이브러리 시리즈의 공통 세로형 판형으로, 장문의 이론 텍스트와 장 구분, 해설적 요소를 안정적으로 수용하면서도 덧표지의 비대칭 절개와 대형 활자 조각을 충분히 드러내기 위한 크기다. 인문서의 무게감과 시리즈 특유의 조형 실험을 함께 담기 적절하다.",why_margin:"장문의 이론 텍스트를 안정적으로 수용하기 위해 상하좌우가 비교적 균형 잡힌 여백 구조를 유지하되, 하단 여백을 조금 넉넉히 두어 쪽번호와 판면의 무게중심을 잡는다. 덧표지의 강한 대각 구성이 외부에서 긴장을 만든다면, 내지의 여백은 학술적 독서의 안정성을 보장하는 완충 장치로 작동한다.",why_font:"본문에는 안정적인 인문서 독서감을 위한 명조 계열이 중심이 되고, 보조 정보에는 고딕이 병용되며, 표지의 핵심 인상은 확대된 활자 조각과 색상 대비에서 온다. 명조와 고딕의 체계는 시리즈의 학술성과 정보성을 유지하고, 표면의 거대한 타이포그래피는 기어츠의 저자성과 텍스트 생산의 문제를 감각적으로 드러낸다.",why_tracking:"장문의 인문 텍스트를 위한 본문은 중립 자간과 넉넉한 행간으로 안정성을 유지하고, 표면의 대형 활자 조각은 자간보다 확대 비율과 겹침, 절개 구조가 더 중요한 조형 변수로 작동한다. 내지에서는 판독성과 질서가 우선되고, 표지에서만 강한 조형성이 전면화되는 구조다.",layout_type:"본문 1단"},
  {g:"문학",pub_type:"단행본",t:"컨템퍼러리 댄스 속 인문학",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/contemporary-dance-and-humanities-kr/",img:"153_컨템퍼러리 댄스 속 인문학",kw:["문학","단행본","컨템퍼러리","댄스","속","인문학","표지에서는","동일한","표제를","일정","간격으로","반복하고","고딕","계열"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:210,h:297},m:{상:12,하:24,안:18,밖:18},c:{구성:"3단",간격:7},b:{크기:9,행간:17,자간:0},ty:{이름:"고딕 계열 제목체 / 명조 또는 가독성 본문체",분류:"명조"},pn:"하단-중앙외측-가로(좌) / 하단-중앙내측-가로(우)",pn_x_left:"77.8mm",pn_y_left:"284.6mm",pn_x_right:"77.8mm",pn_y_right:"284.6mm",pn_size:"10pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"9pt",footnote:"6.5pt",특:"표지에서는 동일한 표제를 일정 간격으로 반복하고 일반 인쇄와 요철 가공을 겹쳐, 보는 각도와 빛에 따라 다른 층이 드러나는 촉각적 구조를 만든다. 내지에서는 글마다 본문 블록의 위치를 조금씩 이동시켜 판면 전체에 리듬을 만들고, 인터뷰·비평·주석·이미지가 고정된 틀 없이 느슨하게 호흡한다. 어떤 스프레드는 한쪽에 긴 텍스트가 집중되고 다른 쪽은 이미지나 여백이 차지하며, 또 다른 페이지에서는 주석과 본문, 세로 러닝 요소가 병행된다. 전체적으로 무용의 시간성과 운동성을 정렬이 아닌 변주와 간격으로 번역한 책이다.",summary:"컨템퍼러리 댄스와 인문학의 접점을 다룬 인문예술 출판물로, 일반 인쇄와 요철 가공이 혼합된 표제를 일정 간격으로 반복 배치해 리듬과 촉각성을 동시에 만드는 작업이다. 표지에서는 연한 회색 바탕 위에 분홍색과 백색의 반복 제목이 세로 방향으로 나뉘어 배열되고, 속장에서는 글마다 본문 위치를 조금씩 이동시켜 표지와 비슷한 율동감을 이어 간다. 넓은 판형 안에서 텍스트 블록과 이미지, 주석, 인터뷰가 느슨하게 호흡하며 배치되어 무용의 움직임, 시간성, 비선형적 사유를 판면의 리듬으로 번역한다.",why_dim:"잡지나 프로그램북에 가까운 넓은 판형으로, 장문의 인터뷰와 비평 텍스트, 이미지, 주석, 큰 표제 변주를 한 지면 안에서 느슨하게 배치하기에 적합하다. 무용이라는 주제에 맞게 정적인 책이면서도 시선 이동과 위치 변화가 충분히 발생할 수 있는 면적을 제공한다.",why_margin:"균일한 정렬보다 리듬감 있는 이동이 중요하다. 넓은 여백은 글마다 다른 본문 위치를 허용하고, 큰 표제와 세로 러닝 요소, 이미지, 주석이 서로 충돌하지 않게 하는 유연한 장(field) 역할을 한다. 여백은 빈 공간이 아니라 움직임의 간격을 만드는 시간적 요소처럼 작동한다.",why_font:"표지의 반복 제목과 세로 표기는 구조적이고 또렷한 고딕 계열이 중심이 되는 것으로 보이며, 본문은 장문의 인문예술 텍스트를 위해 보다 안정적인 본문체가 사용된 것으로 보인다. 서체의 핵심은 종류보다도 위치와 반복, 인쇄층의 차이를 통해 리듬을 만드는 데 있다.",why_tracking:"본문은 장문의 인터뷰와 비평을 위해 중립 자간과 넉넉한 행간을 유지하지만, 중요한 것은 문자 사이 간격보다 텍스트 블록 사이의 간격과 위치 변화다. 표지의 반복 제목은 촘촘한 규칙성과 여백의 교차로 리듬을 형성하고, 내지는 블록 이동을 통해 유사한 율동감을 만든다.",layout_type:"본문 1단(2열) + 주석 3단(1열)"},
  {g:"인문·사회",pub_type:"잡지·저널",t:"DT3—더 빨리, 더 높이, 더 힘차게",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/dt3-kr/",img:"154_DT3—더 빨리, 더 높이, 더 힘차게",kw:["인문·사회","잡지·저널","DT3","더","빨리","높이","힘차게","표지는","콜라주처럼","보이는","도상과","축구공","도해","고딕","계열"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:186,h:249},m:{상:3,하:3,안:15,밖:23},c:{구성:"6단",간격:6},b:{크기:10,행간:16,자간:0},ty:{이름:"고딕 계열 중심, 일부 세리프 또는 보조체 혼합 가능",분류:"혼합 (명조 / 고딕)"},pn:"상단-외측-세로",pn_x_left:"4.3mm",pn_y_left:"2.8mm",pn_x_right:"175.2mm",pn_y_right:"2.8mm",pn_size:"9pt",pn_font:"디스플레이(고딕)",pn_style:"흑색 / 가로  / 숫자",running:"8pt",subheading:"17pt",footnote:"6.5pt",특:"표지는 콜라주처럼 보이는 도상과 선, 축구공 도해, 텍스트 조각으로 구성되며, 그 의미가 책 도입부에서 단계적으로 해설된다. 내지에서는 긴 비평 텍스트와 작은 주석, 이미지, 연표, 시험 패턴, 색상 및 회색 스케일 바가 중앙축 주변에 삽입되어 인쇄 품질과 정보 구조를 동시에 드러낸다. 본문 블록은 안정적으로 정렬되기보다 서로 압박하듯 빽빽하게 들어서고, 페이지 가장자리의 세로 러닝 요소와 하단의 이미지 캡션, 극도로 좁은 여백이 한데 결합해 실험적 인쇄물의 인상을 강화한다. 전체적으로는 ‘읽는 책’이면서 동시에 ‘인쇄를 시험하는 표면’인 이중 구조다.",summary:"저술가, 미술가, 디자이너가 공동 기획·편집하는 부정기 간행물 『DT』의 3호로, ‘체육’을 물리적·기술적 수단으로 개인과 집단의 한계를 초월하려는 사적 노력과 사회 현상으로 다룬다. 책 디자인은 극도로 좁은 여백과 지면 자체에 삽입된 시험 패턴, 중앙의 색상·회색 스케일 바, 표지 콜라주의 단계적 해설 등을 통해 출판물 자체를 인쇄 실험장이자 정보 장치로 만든다. 본문에서 언급되는 요소들이 앞표지 콜라주에 먼저 등장하고, 그 의미가 도입부에서 서서히 해석되며, 긴 글과 이미지·주석·도표가 매우 밀도 높게 결합된다. 스포츠와 기계, 속도, 경쟁의 주제를 인쇄 품질 테스트와 과밀한 편집 구조로 번역한 작업이다.",why_dim:"잡지와 도록 사이의 중대형 판형으로, 긴 비평 텍스트, 이미지, 주석, 도표, 표지 콜라주의 해설을 동시에 수용하기 적합하다. 주제가 되는 속도·체육·기술의 밀도와 충돌을 지면 안에서 강하게 전개할 수 있는 충분한 면적을 제공한다.",why_margin:"이 책의 여백은 전통적인 독서용 여백과 다르다. 사방 여백을 극도로 줄이고 텍스트와 이미지, 시험 패턴, 주석, 도표가 지면 가장자리까지 밀착되게 배치해 책 전체가 마치 인쇄소의 테스트 시트나 과밀한 연구 노트처럼 보이게 한다. 좁은 여백은 시각적 압박과 속도감을 만들며, 주제인 체육과 경쟁의 긴장을 판면 구조 자체로 체현한다.",why_font:"전반적으로 정보 밀도가 높고 도표·주석·시험 패턴이 함께 작동하므로 중립적이고 구조적인 고딕 계열이 중심이 되는 것으로 보인다. 큰 제목과 표지 도상은 기능적 정보보다 구조와 리듬을 만들고, 본문과 주석은 작은 크기로도 판독 가능하도록 조정된 체계가 중요하다.",why_tracking:"본문은 높은 밀도 속에서도 읽기를 유지해야 하므로 기본적으로 중립 자간과 비교적 넉넉한 행간을 유지하지만, 지면 자체가 매우 과밀하게 설계되어 있어 블록 간 간격과 여백은 최소화된다. 일부 요소는 응축되거나 밀착되어 시각적 압박을 만들며, 이는 책의 주제와 인쇄 테스트 성격을 강화한다.",layout_type:"본문 2단(3열+3열) + 기타 3단(2열) "},
  {g:"문학",pub_type:"기관출판",t:"루됭의 마귀들림",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/la-possession-de-loudun-kr/",img:"155_루됭의 마귀들림",kw:["문학","기관출판","루됭의","마귀들림","기본적으로","구성의","인문서","형식을","신신명조"],align_title:"좌측 정렬",align_body:"양끝 정렬, 좌측 정렬",align_note:"좌측 정렬",f:{w:138,h:222},m:{상:21,하:36,안:21,밖:24},c:{구성:"2단",간격:10},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조, 벤턴 산스, 산돌 고딕네오, 어도비 캐즐런, 윤명조, 캐즐런 540",분류:"혼합 (명조 / 고딕)"},pn:"상단-중앙외측-가로",pn_x_left:"42mm",pn_y_left:"11.6mm",pn_x_right:"89.5mm",pn_y_right:"11.6mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"10pt",footnote:"7pt",특:"내지는 기본적으로 1단 구성의 인문서 형식을 따른다. 본문은 안정적인 글줄 길이와 행간을 유지하고, 장 제목과 쪽번호, 이미지 캡션이 절제되게 정리된다. 반면 덧표지와 표면에서는 자주색 대면, 사선 절개, 파란 선묘 드로잉이 결합해 사건의 광기와 집단적 상상력을 하나의 시각 장(field)으로 압축한다. 이미지가 들어가는 면에서는 큰 그림과 넓은 여백이 대비를 이루고, 본문 면은 차분한 질서를 유지한다. 즉 외부는 광기와 얽힘, 내부는 해석과 정리라는 이중 구조다.",summary:"문학동네 인문 라이브러리 시리즈의 한 권으로, 비대칭 덧표지 구조 위에 자주색 상단 면과 파란 선묘 콜라주를 결합해 광기, 집단 히스테리, 종교적 열광이 얽힌 책의 주제를 시각적으로 번역한 디자인이다. 474×270mm 종이를 비스듬히 접은 덧표지가 사선 경계를 만들고, 그 아래 드러나는 표면에는 사건의 장면과 문자 파편이 얽힌 듯한 푸른 선묘가 폭발적으로 펼쳐진다. 내지는 차분한 1단 인문서 구조와 넉넉한 행간을 유지하면서도, 이미지가 들어가는 장면에서는 사건의 환영성과 집단적 상상력을 넓은 판면 안에 느슨하게 배치한다. 외부는 광기의 구조, 내부는 해석의 질서를 대비시키는 인문 라이브러리형 변주다.",why_dim:"인문 라이브러리 시리즈의 공통 세로형 판형으로, 장문의 문화이론 텍스트를 안정적으로 수용하면서도 덧표지의 비대칭 절개와 표면의 복잡한 선묘 구조를 충분히 드러내기 위한 크기다. 표준적인 인문서 비율 안에서 외부의 강한 개념성과 내부의 학술적 독서 리듬을 동시에 담아내기에 적절하다.",why_margin:"장문의 이론 텍스트를 안정적으로 읽히게 하기 위해 상하좌우가 비교적 균형 잡힌 여백 구조를 유지하되, 하단 여백을 약간 더 두어 판면의 무게중심을 잡는다. 내지는 시리즈 특유의 학술적 안정성을 유지하고, 외부의 강한 덧표지 조형과 대비되도록 설계된 조용한 독서용 여백 구조로 보인다.",why_font:"본문에는 안정적인 인문서 독서감을 위한 명조 계열이 중심이 되고, 표면의 강한 제목 및 보조 정보에는 고딕이 병용되는 시리즈 공통 체계를 따른다. 이 책에서는 특히 덧표지 아래의 복잡한 선묘와 사선 구조가 강하게 작동하기 때문에, 서체는 과도하게 개성을 드러내기보다 인문서의 질서를 유지하면서 표면 조형과 긴장 관계를 이루는 역할을 한다.",why_tracking:"장문의 문화이론 텍스트를 위한 본문은 중립 자간과 넉넉한 행간을 유지해 안정성을 확보한다. 표면의 선묘 콜라주와 덧표지 구조가 이미 충분히 강한 조형성을 가지므로, 내지 조판은 과도한 압축 없이 차분하고 학술적인 리듬을 유지하는 편이 적절하다.",layout_type:"본문 1단(2열) + 주석 2단(1열)"},
  {g:"인문·사회",pub_type:"전시도록",t:"참여 도시—도시 트렌드 100선",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/participatory-city-publication/",img:"156_참여 도시—도시 트렌드 100선",kw:["인문·사회","전시도록","참여","도시","트렌드","100선","번호와","키워드","정의","관련","용어를","노이에","하스"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:180,h:245},m:{상:10,하:10,안:10,밖:10},c:{구성:"3단",간격:5},b:{크기:9,행간:11,자간:0},ty:{이름:"노이에 하스 그로테스크",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"89.1mm",pn_y_left:"232mm",pn_x_right:"89.1mm",pn_y_right:"232mm",pn_size:"8.5pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8.5pt",subheading:"17pt",footnote:"9pt",특:"내지는 번호와 키워드, 정의, 관련 용어를 반복적으로 수록하는 사전형 구조를 따른다. 한 스프레드 안에 약 6열에 가까운 세로 열이 촘촘히 정렬되고, 각 열은 독립적인 항목 카드처럼 기능한다. 도시별 색상은 키워드 제목에 적용되어 뉴욕과 베를린 등 맥락을 구분하고, 하단에는 페이지 번호와 도시명이 작게 배치된다. 표지에서는 거대한 도시명 타이포가 전면을 장악하고, 그 위에 다국어 소어휘들이 다층으로 중첩되어 도시 담론의 복수성을 시각화한다. 전체적으로는 사전, 포스터, 데이터 시트의 성격이 결합된 구조다.",summary:"뉴욕 구겐하임 미술관에서 열린 BMW 구겐하임 연구소 마무리 전시와 연계해 제작된 간행물로, 뉴욕과 베를린을 중심으로 도시를 구성하는 100개의 키워드를 데이터북처럼 정리한 작업이다. 표지에서는 거대한 도시명 타이포그래피 위에 다국어 소어휘가 다층적으로 중첩되어 도시 담론의 복합성을 드러내고, 내지에서는 6열에 가까운 빽빽한 사전식 구조 안에 번호, 키워드, 정의, 관련 용어, 도시별 색상 체계를 질서 있게 배치한다. 얇은 중철 소책자이면서도 케이스 포장을 통해 아카이브적 성격을 강화하고, 전시 연구의 결과물을 한눈에 탐색할 수 있는 도시 사전이자 그래픽 실험으로 작동한다.",why_dim:"전시 연계 간행물과 데이터북의 중간 성격을 지닌 판형으로, 다수의 키워드와 정의를 사전처럼 배치하면서도 표지의 거대한 도시명 타이포그래피를 충분히 전개할 수 있는 면적을 제공한다. 얇은 중철 제본에 적합하면서도 손에 들고 탐색하기 쉬운 비율이다.",why_margin:"사전형에 가까운 정보 집약적 판형으로, 다단 구성과 작은 활자를 전제로 한 고밀도 레이아웃이다. 이 경우 여백은 시각적 여유를 제공하기보다는, 정보 블록 간의 최소한의 분리와 탐색 효율을 확보하는 역할에 집중한다. 즉, 여백은 ‘읽기 위한 공간’이 아니라 ‘검색과 스캐닝을 가능하게 하는 인터페이스적 간격’으로 작동하며, 전체적으로 극도로 절제된 상태에서 구조적 질서를 유지한다.",why_font:"단일 서체 체계 안에서 굵기와 크기, 색상을 변주해 위계를 만든다. 내지의 작은 키워드와 정의는 매우 높은 판독성을 유지해야 하므로 중립적이고 치밀한 산세리프가 적합하며, 표지의 거대한 도시명 타이포그래피 또한 같은 계열 안에서 규모만 극대화해 사전적 질서와 포스터적 강도를 동시에 확보한다.",why_tracking:"다열 사전형 구조에서 작은 키워드와 정의를 읽어야 하므로 본문은 비교적 절제된 자간과 약간 넉넉한 행간을 가진다. 열 폭이 좁기 때문에 지나친 자간 확장은 비효율적이며, 대신 일정한 행간과 정렬이 탐색성을 높인다. 표지의 대형 타이포는 자간보다 크기와 중첩 배치가 핵심 변수로 작동한다.",layout_type:"본문 3단(각 1열)"},
  {g:"문학",pub_type:"단행본",t:"잠자는 남자",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/un-homme-qui-dort-kr/",img:"157_잠자는 남자",kw:["문학","단행본","잠자는","남자","기본적으로","구성의","소설","형식을","신신명조"],align_title:"-",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:144,h:216},m:{상:21,하:36,안:24,밖:24},c:{구성:"1단",간격:0},b:{크기:9,행간:18,자간:0},ty:{이름:"SM 신신명조, 산돌 고딕네오, 아브니르, 어도비 개러몬드",분류:"혼합 (명조 / 고딕)"},pn:"중앙-외측-세로",pn_x_left:"11.7mm",pn_y_left:"74.5mm",pn_x_right:"128.2mm",pn_y_right:"74.5mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"-",footnote:"7.5pt",특:"내지는 기본적으로 1단 구성의 소설 형식을 따른다. 본문은 안정적인 글줄 길이와 행간을 유지하고, 장면 전환이나 주석 개입 없이 장문의 서사를 차분히 수용한다. 반면 표지에서는 페렉의 초상을 점묘 이미지로 처리한 뒤 얼굴 조각을 잘라내고 눈동자 내부에 또 다른 초상을 삽입해, 응시와 자기 분열의 주제를 시각화한다. 제목 박스는 구름 형태의 흰 레이블처럼 떠 있어 인물의 내면 독백과 거리감, 비현실적 집중 상태를 함께 암시한다. 즉 외부는 심리적 개념의 조작, 내부는 정숙한 독서 질서다.",summary:"문학동네 조르주 페렉 시리즈의 한 권으로, 반복되는 페렉의 초상 시스템 안에서 ‘눈’과 ‘응시’의 주제를 표지 이미지 처리 방식으로 변주한 디자인이다. 점묘에 가까운 회색 초상 위에 잘려 나간 얼굴 조각과 눈동자 내부의 작은 초상을 겹쳐, “너는 단지 하나의 눈이 되고 말았다”는 작품의 내용을 시각적으로 번역한다. 내지는 조르주 페렉 시리즈 특유의 차분한 1단 소설 조판을 유지하며, 절제된 본문 구조와 안정적인 행간을 통해 장문의 서사를 자연스럽게 읽히게 한다. 외부 표면은 인식의 분열과 자기 응시를 드러내고, 내부는 소설 읽기의 리듬을 지키는 이중 구조다.",why_dim:"문학동네 조르주 페렉 시리즈의 세로형 판형으로, 소설 본문을 안정적으로 수용하면서도 표지의 콜라주적 초상과 타이포그래피를 충분히 전개할 수 있는 비율이다. 장문의 독서를 위한 편안한 손 크기와 시리즈 공통성, 그리고 표지 이미지 실험의 균형이 맞는 판형이다.",why_margin:"전형적인 소설형 판형과 단일 컬럼 텍스트 중심 레이아웃으로, 장문 독서를 전제로 한 안정적 조판이다. 여백은 본문 블록을 페이지 중심에 고정시키면서도, 시선이 자연스럽게 아래로 흐르도록 하단에 여유를 두어 독서 리듬을 형성한다. 이는 단순한 균형이 아니라, 장시간 읽기에서 발생하는 시각적 피로를 완화하고 페이지 넘김의 타이밍까지 조율하는 ‘시간적 여백’으로 기능한다.",why_font:"본문에는 안정적인 소설 읽기를 위한 명조 계열이 중심이 되고, 표지와 시리즈 번호, 보조 정보에는 고딕과 산세리프가 병용된다. 이 책에서는 특히 표지의 이미지 조작이 강하게 작동하므로, 서체는 개성을 과도하게 드러내기보다 시리즈 체계를 유지하면서 이미지의 심리적 효과를 보조하는 역할을 한다.",why_tracking:"장문의 소설 읽기를 위해 본문은 중립 자간과 넉넉한 행간을 유지하는 것으로 보인다. 행간은 답답하지 않을 정도로 확보되어 있고, 자간은 과도한 압축이나 확장 없이 자연스러운 흐름을 만든다. 표지에서의 이미지 실험과 달리 내지 조판은 최대한 개입을 줄여 읽기의 연속성을 우선한다.",layout_type:"본문 1단 + 주석 2단(그리드 외)"},
  {g:"아트이론·비평",pub_type:"전시도록",t:"무라카미 다카시의 수퍼플랫 원더랜드",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/takashi-in-superflat-wonderland-catalog-kr/",img:"158_무라카미 다카시의 수퍼플랫 원더랜드",kw:["아트이론·비평","전시도록","무라카미","다카시의","수퍼플랫","원더랜드","도판","중심의","스프레드와","비평","텍스트","그래픽","삼성고딕"],align_title:"우측 정렬(대제), 좌측 정렬(소제)",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:186,h:243},m:{상:12,하:48,안:15,밖:15},c:{구성:"2단",간격:6},b:{크기:10,행간:14,자간:0},ty:{이름:"그래픽, 삼성고딕",분류:"고딕"},pn:"하단-중앙외측-가로",pn_x_left:"123mm",pn_y_left:"231mm",pn_x_right:"123mm",pn_y_right:"231mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"10pt",footnote:"8pt",특:"도판 중심의 스프레드와 비평 텍스트 중심의 스프레드가 교차한다. 작품 이미지는 때로 페이지를 크게 점유하고, 캡션은 가장자리나 하단에 작게 배치되며, 텍스트 면에서는 한글과 영문이 병기되거나 2단에 가까운 구조로 전개된다. 표지의 제목은 망점으로 이루어진 굵은 고딕 타이포그래피로 처리되어 작품의 팝적 표면성과 인쇄망의 물성을 동시에 드러낸다. 전체적으로는 화려한 작품 세계를 그대로 따라가기보다, 분석적 간격을 두고 정렬과 여백, 크기 대비로 제어한 도록 구조다.",summary:"플라토에서 열린 무라카미 다카시 전시와 연계해 제작된 도록으로, 작가의 수퍼플랫 세계를 반영해 이미지와 텍스트를 ‘평평한 표면’ 위에서 정밀하게 조직한 출판물이다. 표지에는 망점으로 이루어진 제목 타이포그래피와 전면 이미지가 결합되어 팝적 감각과 인쇄 표면의 물성을 동시에 드러내고, 내지에서는 대형 작품 도판과 비평 텍스트, 영문 병기, 캡션이 넓은 판형 안에서 정교하게 배열된다. 작품 이미지의 강한 색과 디테일을 수용하면서도 판면은 지나치게 장식되지 않고, 오히려 차분한 구조와 큰 여백, 작은 텍스트의 대비를 통해 수퍼플랫의 방법론 자체를 분석적 시선으로 드러낸다.",why_dim:"전시 도록으로서 대형 작품 이미지와 영문 병기 비평 텍스트를 함께 수용하기에 적합한 중대형 판형이다. 무라카미 다카시의 시각적 과잉을 충분히 펼치면서도, 텍스트와 도판이 충돌하지 않도록 구조를 유지할 수 있는 넉넉한 면적을 제공한다.",why_margin:"이미지와 텍스트가 병치되는 도록형 구조로, 다단 텍스트와 풀페이지 이미지가 혼재하는 복합 레이아웃이다. 여백은 이질적인 콘텐츠 간의 긴장을 조율하는 매개로 작동하며, 이미지에서는 시각적 프레임을 형성하고 텍스트에서는 밀도를 완충하는 이중적 역할을 수행한다. 따라서 여백은 단순한 주변 공간이 아니라, 페이지 내 요소 간 위계와 호흡을 설계하는 핵심적인 구조 장치다.",why_font:"표지의 망점 제목과 내지의 캡션, 영문 병기, 비평 텍스트 모두 산세리프 체계 안에서 운영된다. 이는 무라카미 다카시의 이미지가 가진 과잉성과 충돌하지 않으면서도, 도록 전체에 동시대적이고 분석적인 인상을 부여한다. 굵기와 크기, 망점 처리 여부가 위계를 만드는 핵심 장치다.",why_tracking:"도록의 본문과 영문 병기 텍스트는 작은 크기에서도 판독 가능해야 하므로 자간은 절제되고 행간은 약간 넉넉하게 유지된다. 텍스트가 많은 스프레드에서는 일정한 열 폭과 행간이 분석적 리듬을 만들고, 도판 중심 스프레드에서는 텍스트가 주변부로 물러나 이미지와 크기 대비를 이룬다.",layout_type:"본문 2단"},
  {g:"그래픽디자인",pub_type:"단행본",t:"트랜스포머—아이소타이프 도표를 만드는 원리",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/the-transformer/",img:"027_트랜스포머—아이소타이프 도표를 만드는 원리",kw:["그래픽디자인","단행본","트랜스포머","아이소타이프","도표를","만드는","원리","본문","중심","면은","대체로","고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:150,h:225},m:{상:27,하:15,안:12,밖:12},c:{구성:"4단",간격:6},b:{크기:9,행간:17,자간:10},ty:{이름:"고딕 중심",분류:"혼합 (명조 / 고딕)"},pn:"상단-외측-가로",pn_x_left:"100.9mm",pn_y_left:"8.6mm",pn_x_right:"133.7mm",pn_y_right:"4.4mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"-",footnote:"7.5pt",특:"본문 중심 면은 대체로 1단 구조를 유지하지만, 도판과 캡션, 주석이 함께 배치되는 면에서는 2단에 가까운 분절 구조가 나타난다. 도판은 비교적 넓은 면적을 차지하고, 본문은 그 주변에 정돈된 블록으로 배치되며, 작은 캡션과 주석 번호가 촘촘하게 작동한다. 표지에서는 원과 X, 선이라는 최소한의 요소만으로 도표적 사고를 강하게 드러내고, 내지에서는 이미지·텍스트·주석의 위계를 엄격히 통제해 정보디자인 서적다운 분석적 리듬을 만든다.",summary:"워크룸 프레스와 스펙터 프레스의 공동 임프린트 작업실유령이 펴낸 첫 책으로, 아이소타이프의 핵심 원리인 ‘변형’을 설명하는 정보디자인 연구서다. 표지는 밝은 노란색 바탕 위에 검은 원과 X, 수직선만으로 구성된 단순한 기호 배열을 전면에 배치해, 아이소타이프의 조형 원리를 책 자체의 표면에서 즉각적으로 시연한다. 내지에서는 역사적 도판, 설명 캡션, 본문, 주석이 엄격한 질서 속에 배치되며, 이미지가 들어가는 면과 텍스트 중심 면이 교차한다. 전체적으로는 정보도표의 논리, 시각 언어의 절제, 연구서의 차분함이 결합된 구조이며, 단순한 복고가 아니라 정보를 시각적으로 조직하는 방식 자체를 책의 디자인 문법으로 삼는다.",why_dim:"이론서와 연구서에 적합한 전형적인 세로형 중형 판형으로, 본문과 도판, 주석을 함께 운영하기에 안정적이다. 표준적인 독서감을 유지하면서도 정보도표의 비례와 시각적 질서를 무리 없이 재현할 수 있는 크기다.",why_margin:"이론서 또는 연구서 계열의 판형으로, 본문 텍스트를 중심으로 도표, 주석, 캡션 등이 함께 운영되는 다층적 레이아웃이다. 여백은 단순히 가독성을 확보하는 수준을 넘어, 주변 정보들이 침범하지 않도록 본문을 보호하는 완충 영역으로 기능한다. 동시에 각주나 보조 정보가 자연스럽게 배치될 수 있는 잠재적 공간으로 설계되어, 텍스트 확장의 가능성을 내포한 구조다.",why_font:"표지와 본문 모두 정보디자인 서적에 어울리는 중립적이고 기능적인 고딕 계열이 중심이 되는 것으로 보인다. 표지의 제목과 도표 요소는 기하학적 단순성과 높은 명료도를 강조하고, 내지의 본문과 캡션 역시 장식성보다 정보 전달과 구조 인식에 유리한 방향으로 정리되어 있다.",why_tracking:"이론서 본문은 과도하게 압축되지 않은 중립 자간과 충분한 행간을 유지하는 편으로 보인다. 도판과 캡션, 주석이 많기 때문에 본문 자체는 차분하고 안정적으로 읽혀야 하며, 자간과 행간은 정보의 위계를 흐리지 않는 범위에서 기능적으로 조정된다.",layout_type:"본문 1단(3열) + 주석 4단(1열)"},
  {g:"인문·사회",pub_type:"전시도록",t:"공원, 한강, 이득영",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/the-park-the-river-lee-duegyoung-kr/",img:"160_공원, 한강, 이득영",kw:["인문·사회","전시도록","공원","한강","이득영","책은","앞뒤","양쪽에서","시작할","있는","AG"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"우측 정렬, 좌측 정렬(일부)",f:{w:180,h:270},m:{상:12,하:12,안:9,밖:9},c:{구성:"21열",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"AG 북, SM 신신명조, 시몬치니 개러몬드, 윤고딕",분류:"혼합 (명조 / 고딕)"},pn:"상단-좌측-가로",pn_x_left:"8.2mm",pn_y_left:"11.3mm",pn_x_right:"8.2mm",pn_y_right:"11.3mm",pn_size:"11pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"6.5pt",subheading:"-",footnote:"6.5pt",특:"책은 앞뒤 양쪽에서 시작할 수 있는 구조를 취하고, 그에 따라 판면 위계도 방향성을 전제로 조직된다. 긴 비평 텍스트 스프레드는 대체로 2단에 가까운 세로 블록 구조를 이루고, 하단에는 뒤집힌 텍스트가 반대 방향의 독서를 예고한다. 사진 스프레드는 넓은 도판을 크게 싣고 캡션을 외곽에 작게 배치하며, 표와 위성 이미지 면에서는 작은 이미지 단위들이 산포하듯 놓인다. 전체적으로는 ‘대칭’과 ‘반전’이 그리드 수준에서 작동하며, 양방향 독서 구조가 단지 제본 방식이 아니라 실제 레이아웃 논리로 이어진다.",summary:"이득영의 한강 강변 사진 작업을 중심으로 도시, 강, 공원, 개발 풍경을 읽어내는 전시 도록으로, 책의 앞뒤 어느 쪽에서도 시작해 읽을 수 있는 양방향 구조가 핵심이다. 이는 옵티컬 레이스의 텍스트를 뒤집어 반대 방향으로 진행하게 한 편집 방식과 연결되며, 거울처럼 남북이 서로 마주 보는 한강의 이미지 구조를 책의 물리적 독서 경험으로 확장한다. 내지에서는 항공 사진과 도시 공간의 위성 이미지, 표, 긴 비평 텍스트가 서로 다른 종이 질감 위에서 교차한다. 사진은 광택 없는 종이에, 글은 코팅하지 않은 미색 종이에 인쇄되어 시각 정보와 독서 정보가 촉각적으로도 분리된다. 전체적으로는 도시 연구서, 사진집, 전시 도록의 성격이 겹치며, 양방향성·대칭성·재료 대비가 책 전체의 구조를 이룬다.",why_dim:"도시와 강변 풍경의 넓은 시각 정보를 수용하면서도 텍스트 중심 연구서의 안정감을 유지할 수 있는 비교적 큰 세로형 판형이다. 사진집에 가까운 확장성과 연구서의 읽기 구조를 동시에 감당하는 크기다.",why_margin:"대형 이미지와 텍스트가 병행되는 도록형 판형으로, 시각 자료의 비중이 높은 레이아웃이다. 여백은 이미지가 과도하게 압박받지 않도록 주변에 호흡을 제공하며, 동시에 긴 텍스트가 무너지지 않도록 시각적 경계를 설정한다. 결과적으로 여백은 이미지와 텍스트 각각의 자율성을 유지시키면서도, 전체 페이지를 하나의 안정된 프레임으로 통합하는 역할을 수행한다.",why_font:"한글 본문은 명조 계열이 중심이 되고, 영문은 세리프와 산세리프가 상황에 따라 병용되는 구조로 보인다. 긴 비평 텍스트에는 신신명조와 개러몬드 계열이 어울리고, 표나 캡션, 정보 요소에는 윤고딕이 개입하는 방식으로 보인다. 사진집적 도록이면서도 도시 연구서적 성격이 강해, 서체 운용 역시 감성적 분위기보다 정보 위계와 독서 리듬을 우선한다.",why_tracking:"긴 비평 텍스트를 안정적으로 읽히게 하기 위해 본문은 비교적 충분한 행간을 유지하고 자간은 중립적으로 제어한 것으로 보인다. 동시에 표와 캡션, 반대 방향 텍스트까지 병치되므로, 판면 전체는 복잡하지만 개별 텍스트 블록은 차분하고 정제된 조판 질서를 갖는다.",layout_type:"본문 10열 + 주석 4-5열 가변"},
  {g:"문학",pub_type:"단행본",t:"수평선 자락",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/il-filo-dellorizzonte-kr/",img:"161_수평선 자락",kw:["문학","단행본","수평선","자락","신신명조"],align_title:"-",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:120,h:192},m:{상:15,하:30,안:18,밖:18},c:{구성:"1단",간격:0},b:{크기:10,행간:16,자간:0},ty:{이름:"SM 신신명조, 시몬치니 개러몬드, 아리따 돋움, 애퍼수",분류:"명조"},pn:"하단-외측-가로 (대각선)",pn_x_left:"7.7mm",pn_y_left:"176.9mm",pn_x_right:"109.5mm",pn_y_right:"176.9mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 가로(대각선) / 숫자",running:"-",subheading:"-",footnote:"7pt",특:"내지는 전형적인 1단 문학 단행본 구조를 따른다. 본문은 페이지 중앙부에 안정적으로 놓이고, 각주나 주석은 필요 시 하단에서 조용히 작동한다. 표지에서는 수평선과 격자라는 시각적 모티프가 강하게 드러나지만, 내지에서는 그러한 조형 언어를 직접 반복하지 않고 조판의 리듬과 문장 흐름으로 통일성을 유지한다. 즉 구조의 핵심은 화려한 변주가 아니라 읽기의 안정성과 선집 전체의 일관성이다.",summary:"안토니오 타부키 선집의 한 권으로, 슬기와 민이 지속적으로 탐구한 본문 조판 중심 북디자인의 태도를 잘 보여 주는 소설책이다. 표지에는 월터 워턴의 흑백 초상을 수평선과 격자 무늬로 분절해 배치하여 제목인 ‘수평선 자락’의 개념을 시각적으로 번역한다. 그러나 내지에서는 표지의 조형적 강도와 달리 매우 차분하고 기능적인 조판이 이어지며, 본문과 각주, 페이지 구조가 자연스럽고 무리 없이 정리된다. 즉 표지는 개념적·이미지적 장치가 강하지만, 책의 본질은 오히려 읽기 경험에 대한 세심한 통제에 있다. 선집 전체가 그러하듯, 이 책에서도 슬기와 민은 문학 텍스트를 과장된 조형 실험의 장으로 삼기보다 본문 조판의 리듬과 문장 흐름을 통해 자신들의 입장을 드러낸다.",why_dim:"문고보다 넓고 일반 단행본보다 약간 아담한 세로형 판형으로, 문학 텍스트를 안정적으로 읽기에 적합하다. 작은 손책 느낌과 정제된 양장본의 밀도를 동시에 주며, 타부키 선집 특유의 집중된 독서 경험을 만든다.",why_margin:"소형 문학 단행본 판형으로, 제한된 물리적 크기 안에서 단일 텍스트 블록이 구성되는 레이아웃이다. 여백은 본문을 최대한 확장하려는 유혹을 억제하고, 작은 판형에서도 읽기의 여유를 확보하기 위한 장치로 작동한다. 특히 하단을 약간 더 열어둠으로써 페이지의 시각적 중심이 위로 치우치지 않도록 조정하고, 물리적 책의 안정감까지 고려한 설계가 드러난다.",why_font:"본문은 명조 계열이 중심이며, 한글의 경우 SM 신신명조, 영문과 숫자에는 시몬치니 개러몬드가 대응하는 구조로 보인다. 보조 정보에는 아리따 돋움이나 애퍼수 같은 산세리프가 개입할 수 있으나, 전반적인 인상은 명조 중심의 문학 조판이다. 표지에서도 개념적 그래픽은 강하지만 제목과 정보의 톤은 과도하게 장식적이지 않다.",why_tracking:"문학 단행본으로서 본문은 차분한 행간과 중립적인 자간을 유지한다. 문장 밀도는 높지만 답답하지 않고, 작은 판형에서도 독서 피로를 줄이기 위한 안정적 조판이 우선된 것으로 보인다. 각주 역시 본문과 분리되되 전체 리듬을 깨지 않도록 절제된 크기와 간격으로 처리된다.",layout_type:"본문 1단"},
  {g:"문학",pub_type:"단행본",t:"플라톤의 위염",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/la-gastrite-di-platone-kr/",img:"162_플라톤의 위염",kw:["문학","단행본","플라톤의","위염","신신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"양끝 정렬",f:{w:120,h:192},m:{상:15,하:30,안:18,밖:18},c:{구성:"1단",간격:0},b:{크기:9,행간:16,자간:0},ty:{이름:"SM 신신명조, 시몬치니 개러몬드, 아리따 돋움, 애퍼수",분류:"혼합 (명조 / 고딕)"},pn:"하단-외측-가로 (대각선)",pn_x_left:"7.7mm",pn_y_left:"176.9mm",pn_x_right:"109.5mm",pn_y_right:"176.9mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 가로(대각선) / 숫자",running:"-",subheading:"11pt",footnote:"6.5pt",특:"내지는 전형적인 1단 문학 단행본 구조다. 본문은 가운데에 안정적으로 자리하고, 각주나 참조 요소는 하단에서 조용히 분리된다. 표지는 월터 워턴의 초상을 활용해 개념적 인상을 강하게 남기지만, 내지는 이를 직접 반복하지 않고 문장의 리듬, 여백, 행간을 통해 선집 전체의 통일성을 유지한다. 즉 구조의 핵심은 표지의 이미지 실험보다 독서 흐름을 얼마나 자연스럽게 유지하느냐에 있다.",summary:"안토니오 타부키 선집의 두 번째 권으로, 작은 판형 안에 절제된 본문 조판과 표지 일러스트의 개념적 번역을 결합한 문학 단행본이다. 월터 워턴의 선묘 초상은 인물의 시선과 손의 제스처를 강조하며, 책의 제목처럼 지적 긴장과 내면의 불편함을 은근한 방식으로 시각화한다. 그러나 내지에서는 이러한 조형적 표지가 전면에 반복되지 않고, 오히려 차분하고 기능적인 문학 조판이 중심을 이룬다. 본문과 각주, 페이지 구조는 무리 없이 정리되어 있으며, 작은 판형에서도 문장이 답답하게 눌리지 않고 자연스럽게 흐른다. 선집 전체에 공통된 태도처럼, 이 책 역시 디자인의 주된 성취를 표면 장식이 아니라 본문 조판의 리듬과 문학 텍스트의 독서 경험에 둔다.",why_dim:"작고 응축된 문학 단행본 판형으로, 손에 쥐고 오래 읽기 좋은 크기다. 안토니오 타부키 선집 전체의 통일감을 유지하면서도 양장본 특유의 밀도와 정제감을 준다.",why_margin:"양장본 성격을 지닌 소형 문학 판형으로, 기본적으로는 단일 텍스트 중심이지만 물성에 대한 고려가 강하게 개입된 레이아웃이다. 여백은 단순한 시각적 균형을 넘어서, 종이의 두께와 제본 방식에서 오는 물리적 무게감을 시각적으로 지지하는 역할을 한다. 특히 하단 여백은 페이지를 ‘지탱하는 바닥’처럼 작용하며, 책 전체의 존재감을 강화한다.",why_font:"한글 본문은 SM 신신명조 중심의 명조 계열로 보이고, 영문과 숫자에는 시몬치니 개러몬드가 대응하는 구조로 읽힌다. 보조 정보에서는 아리따 돋움이나 애퍼수 같은 고딕 계열이 개입할 수 있으나, 전체 인상은 어디까지나 문학 단행본형 명조 중심 조판이다. 시트 규격에 맞춰 분류하면 ‘명조 + 고딕 혼합’이 가장 적절하다.",why_tracking:"문학 단행본으로서 행간은 충분히 열려 있고 자간은 중립적으로 유지된다. 작은 판형에서도 문장 밀도가 지나치게 높아 보이지 않으며, 긴 호흡의 서간체 문장과 비평적 문체를 안정적으로 읽히게 하는 조판이다. 각주 역시 본문과 위계가 분명하되 전체 페이지의 호흡을 해치지 않는다.",layout_type:"본문 1단"},
  {g:"문학",pub_type:"단행본",t:"꿈의 꿈",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/sogni-di-sogni-kr/",img:"163_꿈의 꿈",kw:["문학","단행본","꿈의","꿈","신신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"-",f:{w:120,h:192},m:{상:15,하:30,안:18,밖:18},c:{구성:"1단",간격:0},b:{크기:9,행간:16,자간:0},ty:{이름:"SM 신신명조, 시몬치니 개러몬드, 아리따 돋움, 애퍼수",분류:"명조"},pn:"상단-외측 또는 하단-외측-가로",pn_x_left:"7.7mm",pn_y_left:"176.9mm",pn_x_right:"109.5mm",pn_y_right:"176.9mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 가로(대각선) / 숫자",running:"-",subheading:"11pt",footnote:"6.5pt",특:"내지는 전형적인 1단 문학 단행본 구조다. 본문은 가운데에 안정적으로 배치되고, 제목과 페이지 요소는 절제된 위계 안에서 조용히 작동한다. 표지의 점묘 초상은 개념적 인상을 강하게 남기지만, 내지에서는 이를 반복하기보다 문장의 길이와 행간, 여백을 통해 읽기의 리듬을 조율한다. 즉 구조의 핵심은 조형적 표지 효과보다 작은 판형 안에서 문학 텍스트를 얼마나 편안하게 읽히게 하느냐에 있다.",summary:"안토니오 타부키 선집의 첫 권으로, 작은 양장 판형 안에서 조형적 표지 실험과 절제된 문학 조판이 긴밀하게 결합된 책이다. 표지에는 월터 워턴의 점묘 초상이 사용되는데, 선으로 구축한 다른 권들과 달리 점의 집적으로 인물의 형상을 드러내어 꿈과 기억, 환영 같은 비물질적 상태를 암시한다. 그러나 내지에서는 이러한 표지의 조형적 인상이 과장되지 않고, 안정된 본문 블록과 충분한 행간, 차분한 위계의 제목과 페이지 요소를 통해 오히려 독서 중심의 질서를 유지한다. 선집 전체의 특성처럼 이 책 역시 디자인의 성취를 표면의 강한 제스처보다 본문 조판의 자연스러운 리듬과 문장 호흡에 둔다.",why_dim:"작고 응축된 문학 단행본 판형으로, 손에 쥐고 천천히 읽기 좋은 크기다. 안토니오 타부키 선집 전체의 통일된 물성을 유지하면서도 양장본의 응집력과 정제된 독서감을 준다.",why_margin:"소형 문학 단행본의 반복적 구조로, 동일한 텍스트 중심 레이아웃을 유지한다. 여백은 일관된 독서 경험을 유지하기 위해 변주를 최소화하면서, 본문 블록이 과도하게 확장되지 않도록 제어하는 기준선으로 기능한다. 이는 여백을 통해 페이지마다 동일한 긴장과 균형을 유지하려는 편집적 의도가 반영된 결과다.",why_font:"한글 본문은 SM 신신명조 중심의 명조 계열로 보이고, 영문과 숫자에는 시몬치니 개러몬드가 대응하는 구조로 읽힌다. 보조 정보에서는 아리따 돋움이나 애퍼수 같은 고딕 계열이 보조적으로 개입할 수 있으나, 전체 인상은 문학 단행본형 명조 중심 조판이다. 시트 규격에 맞춰 분류하면 ‘명조 + 고딕 혼합’이 적절하다.",why_tracking:"문학 단행본으로서 행간은 충분히 열려 있고 자간은 중립적으로 유지된다. 작은 판형에서도 문장 밀도가 과도하게 높아 보이지 않으며, 짧은 서사와 산문적 호흡이 자연스럽게 이어지도록 설계된 조판이다.",layout_type:"본문 1단"},
  {g:"타이포그래피",pub_type:"전시도록",t:"김홍석—좋은 노동 나쁜 미술",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/good-labor-bad-art-catalog-kr/",img:"164_김홍석—좋은 노동 나쁜 미술",kw:["타이포그래피","전시도록","김홍석","좋은","노동","나쁜","미술","기본적으로는","이미지","중심의","전시","도록","구조지만","그래픽","삼성고딕"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:186,h:243},m:{상:12,하:20,안:15,밖:15},c:{구성:"2단",간격:5},b:{크기:9,행간:17,자간:0},ty:{이름:"그래픽, 삼성고딕",분류:"명조"},pn:"하단-외측-가로",pn_x_left:"14.8mm",pn_y_left:"235.2mm",pn_x_right:"168.3mm",pn_y_right:"235.2mm",pn_size:"6.5pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"6.5pt",subheading:"13pt",footnote:"6.5pt",특:"기본적으로는 이미지 중심의 전시 도록 구조지만, 스프레드마다 텍스트와 이미지 비중이 유동적으로 바뀌는 가변 편집이다. 본문 해설 페이지에서는 한글과 영문이 나란히 병치되며 2단에 가까운 읽기 구조를 형성하고, 작품 소개 페이지에서는 큰 이미지 1점과 짧은 캡션, 혹은 세로 방향의 텍스트 배치가 들어간다. 따라서 고정된 1단/2단이라기보다 ‘이미지 중심 + 한영 병치 + 캡션 변주’가 핵심 구조다.",summary:"김홍석의 작업을 다룬 이 전시 도록은 전반적으로 절제된 회색 톤의 바탕 위에 얇은 색선과 넓은 이미지 배치, 그리고 한영 병치 텍스트를 통해 작품의 태도와 도록의 해석 구조를 동시에 드러낸다. 작품 사진은 페이지를 크게 점유하며, 설명 텍스트는 이미지 가장자리나 여백 가까이에 작게 배치되어 작품 감상과 해설 독서를 느슨하게 교차시킨다. 특히 한글과 영문이 같은 위계를 갖고 병렬되는 구조, 세로로 눕혀 배치된 캡션, 그리고 얇은 시안·분홍 선의 개입은 전시 도록이 단지 기록물에 그치지 않고 전시 해석 장치로 기능하도록 만든다. 전반적으로 강한 조형 제스처보다는 고요한 구조와 정제된 타이포그래피로 작품의 개념성과 거리감을 유지하는 편집 디자인이다.",why_dim:"중형 전시 도록 판형으로, 이미지와 텍스트를 함께 다루기에 충분한 면적을 확보하면서도 과도하게 크지 않아 읽기와 보기의 균형이 좋다. 작품 사진의 재현성과 도록의 문헌성을 모두 감당하는 안정된 비례다.",why_margin:"중형 도록 판형으로, 이미지와 캡션, 텍스트가 다양한 방식으로 배치되는 가변적 레이아웃이다. 여백은 특정 요소에 종속되지 않는 중립적인 구조로 설정되어, 페이지마다 다른 구성에도 일관된 질서를 부여한다. 이는 여백을 고정된 비율이 아닌 ‘유연한 시스템’으로 운용하는 방식으로, 다양한 시각적 상황을 수용할 수 있는 기반을 형성한다.",why_font:"한글과 영문 모두 전반적으로 산세리프 계열의 인상을 강하게 주며, 시트 규격에 맞추면 ‘고딕’으로 분류하는 것이 맞다. 사용 서체 정보 역시 그래픽, 삼성고딕으로 제시되어 있어 고딕 중심 분류가 가장 일관적이다.",why_tracking:"전시 도록 본문은 비교적 차분한 행간으로 운용된다. 텍스트 밀도를 낮추고 해설문이 작품 이미지와 충돌하지 않도록 하는 방향이며, 자간은 크게 벌리기보다 중립적으로 유지되어 있다.",layout_type:"본문 2단"},
  {g:"문학",pub_type:"기관출판",t:"죽어가는 자의 고독",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/uber-die-einsamkeit-der-sterbenden-kr/",img:"165_죽어가는 자의 고독",kw:["문학","기관출판","죽어가는","자의","고독","페이지당","하나의","본문","블록이","중심이","되는","신신명조"],align_title:"-",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:138,h:222},m:{상:27,하:48,안:26,밖:28},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조, 벤턴 산스, 산돌 고딕네오, 어도비 캐즐런, 윤명조, 캐즐런 540",분류:"혼합 (명조 / 고딕)"},pn:"상단-중앙외측-가로",pn_x_left:"42.2mm",pn_y_left:"11.4mm",pn_x_right:"91.7mm",pn_y_right:"11.4mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"-",footnote:"-",특:"한 페이지당 하나의 본문 블록이 중심이 되는 전형적인 1단 구조다. 각주와 인용, 장 제목 등이 본문 리듬 안에 정돈되어 있으며, 이미지나 복합 다단 구성 없이 텍스트 독서 흐름을 우선한다. 인문 라이브러리 시리즈 공통의 본문 설계로 보는 편이 맞다.",summary:"문학동네 인문 라이브러리 시리즈의 한 권으로, 비대칭 덧표지가 표지 일부를 가리며 드러내는 구조를 통해 책의 첫인상을 만든다. 이 책에서는 강한 청색 바탕과 연두색 덧표지, 회색 삽지 면이 대비를 이루며, 시리즈 공통 구조 안에서도 비교적 차갑고 고독한 정서를 형성한다. 본문은 넉넉한 여백과 안정적인 활자 밀도로 구성되어 있으며, 장문의 인문 텍스트를 차분하게 읽도록 설계되어 있다. 표지의 사선 구조와 내부의 절제된 조판 대비가 분명하며, 외부는 개념적이고 조형적이지만 내부는 독서 친화적인 고전적 구조를 유지한다. 시리즈 특성상 덧표지 타이포는 주제에 따라 다르게 처리되지만, 본문은 명조 중심의 장문 독서를 우선하는 일관된 문학·인문 서적 문법을 따른다.",why_dim:"인문서 양장 판형으로 손에 잡히는 단행본 규모이지만, 장문 독서에 필요한 세로 깊이가 충분하다. 문학동네 인문 라이브러리 시리즈의 공통 판형으로 보이며, 본문 조판의 안정성과 표지 덧싸개의 조형성을 함께 수용하는 비례다.",why_margin:"인문 단행본 판형으로, 장문 텍스트를 안정적으로 수용하는 단일 컬럼 레이아웃이다. 여백은 본문 블록을 페이지 중앙에 정제되게 위치시키며, 좌우와 상하의 균형을 통해 읽기의 집중도를 유지한다. 이는 과도한 장식 없이 텍스트 자체에 집중하도록 유도하는 고전적인 편집 방식으로, 여백은 ‘보이지 않지만 읽기를 지탱하는 구조’로 작동한다.",why_font:"데이터 시트 규격에 맞추면 한글은 명조, 영문 표지 보조 요소나 일부 정보 요소에는 고딕이 함께 쓰인 구조다. 시리즈 본문은 명조 중심이며, 표지 및 부가 정보에서 고딕이 보조적으로 개입하는 ‘명조 + 고딕’ 분류가 가장 적절하다.",why_tracking:"본문은 장문 인문서에 맞는 차분한 행간을 유지한다. 지나치게 조이지도, 과도하게 풀지도 않은 편이며, 활자색이 안정적으로 유지된다. 자간 역시 본문 독서 흐름을 해치지 않는 범위의 미세 조정 수준으로 보인다.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"단행본",t:"도시 트렌드 100선—BMW 구겐하임 연구소 베를린 아이디어 사전",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/100-urban-trends-kr/",img:"166_도시 트렌드 100선—BMW 구겐하임 연구소 베를린 아이디어 사전",kw:["인문·사회","단행본","도시","트렌드","100선","BMW","구겐하임","연구소","베를린","아이디어","사전","화면을","여러","개의","세로","칼럼으로","나눈","헬베티카"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:315,h:470},m:{상:20,하:20,안:10,밖:10},c:{구성:"4단",간격:20},b:{크기:9,행간:12,자간:0},ty:{이름:"헬베티카",분류:"고딕"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"-",subheading:"12pt, 96pt",footnote:"-",특:"한 화면을 여러 개의 세로 칼럼으로 나눈 다단 구조다. 페이지에 따라 4단 또는 5단처럼 보이며, 사전 항목·목록·소개 글·이미지 설명이 같은 모듈 시스템 안에서 배열된다. 일반 잡지식 다단보다 훨씬 규칙적이며, 정보 사전형 전개에 최적화된 구조다.",summary:"BMW 구겐하임 연구소 베를린의 도시 어휘 100개를 정리한 디지털 간행물이다. 대형 전자책 판형을 기반으로, 화면 전체를 여러 개의 세로 칼럼으로 분할해 사전식 항목을 전개한다. 표지와 내지는 얇은 규칙선과 넓은 빈 공간, 대형 산세리프 제목, 색상으로 구분된 항목 번호를 통해 극도로 정돈된 정보 구조를 만든다. 이미지와 텍스트의 비중을 페이지마다 다르게 조절하지만, 전체 시스템은 사전/글로서리 형식의 모듈러 그리드에 기반한다. 인쇄물이 아니라 디지털 문서이기 때문에 여백과 칼럼 폭이 종이책보다 더 느슨하고 확장적으로 보이며, 315×470mm의 큰 화면 위에서 정보 블록들이 독립적으로 떠 있는 듯한 구성이다. 본문은 헬베티카 기반 산세리프 단일 체계로 읽히며, 정보 위계는 크기·색상·배치만으로 해결한다.",why_dim:"전자책 기준 매우 큰 판형으로, 일종의 포스터형 PDF 화면에 가깝다. 한 화면에 4~5개의 세로 정보 칼럼과 대형 제목, 이미지, 목록을 동시에 수용할 수 있는 크기이며, 일반 단행본과 비교할 수 없는 확장형 정보 판면이다.",why_margin:"전자책이나 디지털 문서 형식의 판형으로, 단일 텍스트 칼럼이 명확한 경계 안에 놓이는 레이아웃이다. 페이지 가장자리에 규칙선이 설정되고, 그 안쪽에서 본문이 시작되는 구조이기 때문에 여백은 단순한 주변 공간이 아니라 ‘콘텐츠 영역을 정의하는 프레임’으로 작동한다. 상·하·좌·우 여백은 전반적으로 넉넉하고 균질하게 유지되며, 특정 방향으로의 강조 없이 화면 전체에 균등한 개방감을 형성한다. 이는 인쇄 매체의 물리적 제약보다는 화면 기반 읽기를 전제로 한 설계로, 텍스트를 페이지 중앙에 고립시키기보다 주변에 충분한 여유를 두어 시선 이동과 집중을 유연하게 만든다. 특히 이 여백은 책의 물성을 드러내기보다는 인터페이스적 성격이 강해, 본문과 외부 환경(디바이스 화면) 사이에 완충 지대를 형성한다. 결과적으로 여백은 독서의 리듬을 조절하는 요소라기보다, 콘텐츠를 안정적으로 ‘디스플레이’하기 위한 중립적이고 개방적인 구조로 기능한다.",why_font:"전 항목이 헬베티카 계열 산세리프 시스템 안에서 운영되므로, 시트 규격상 분류는 고딕으로 통일하는 것이 맞다. 한글/영문 혼용 여부와 무관하게 전체 조판 성격은 명확한 고딕 기반 정보 디자인이다.",why_tracking:"항목 설명 본문은 비교적 촘촘하고 단정하다. 사전형 정보가 많은 만큼 행간은 과도하게 넓지 않고, 자간도 약간 조여진 인상을 준다. 큰 제목과 숫자는 강하게 압축된 밀도로 보이며, 본문은 중립적이되 정보량 소화를 우선하는 설정이다.",layout_type:"본문 4단"},
  {g:"문학",pub_type:"기관출판",t:"진리와 방법",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/wahrheit-und-methode-kr/",img:"167_진리와 방법",kw:["문학","기관출판","진리와","방법","기본적으로는","페이지당","하나의","본문","블록이","중심이","신신명조"],align_title:"좌측 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:138,h:222},m:{상:21,하:36,안:21,밖:24},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조, 벤턴 산스, 산돌 고딕네오, 어도비 캐즐런, 윤명조, 캐즐런 540",분류:"혼합 (명조 / 고딕)"},pn:"하단-중앙외측-가로(좌) / 상단-중앙외측-가로(우)",pn_x_left:"42.3mm",pn_y_left:"191.4mm",pn_x_right:"90.1mm",pn_y_right:"11.5mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"-",footnote:"-",특:"기본적으로는 한 페이지당 하나의 본문 블록이 중심이 되는 전형적인 1단 구조다. 장 제목, 면주, 인용문, 주석 등이 본문 리듬 안에 정돈되어 있으며, 이미지나 복합 다단 구성 없이 독서 흐름을 우선한다. 다만 한 권이 아니라 두 권으로 나뉜 분책 구조가 독서 단위를 새롭게 설정하며, 표지의 거대한 타이포그래피와 달리 내지는 극도로 절제된 안정 조판을 유지한다.",summary:"문학동네 인문 라이브러리 시리즈의 한 권으로, 2책 분책 구조와 비대칭 덧표지 시스템이 결합된 대형 인문서다. 각 권은 138×222mm 양장본 형식을 따르지만, 전체적으로는 한 권의 개념을 두 권으로 나누어 읽게 하는 구조가 강하게 인식된다. 덧표지에는 참고문헌 목록 텍스트로 채운 거대한 제목 타이포그래피가 배치되어, 책의 주제인 간주관성과 간텍스트성을 표면에서 곧바로 드러낸다. 표지의 사선 절개와 내부의 차분한 본문 조판은 문학동네 인문 라이브러리의 공통 시스템 안에 있으면서도, 분책이라는 물리적 특수성 때문에 독서 경험을 더 강하게 구조화한다. 내지는 장문의 철학 텍스트를 안정적으로 읽히도록 설계되어 있으며, 표지의 강한 개념성과 달리 본문은 과장 없이 절제된 명조 중심 조판을 유지한다.",why_dim:"각 권은 문학동네 인문 라이브러리 시리즈의 표준에 가까운 세로형 양장본 판형이며, 두 권으로 분책되어 전체 분량을 나누어 수용한다. 장문 철학 텍스트를 읽기에 적합한 깊이와 안정감을 가지면서도, 시리즈 공통의 덧표지 구조를 무리 없이 담는 비례다.",why_margin:"인문 단행본 계열의 판형으로, 장문의 철학 텍스트를 안정적으로 수용하기 위한 단일 컬럼 중심 레이아웃이다. 본문 활자 크기와 행간에 맞춰 텍스트 블록이 페이지 중앙에 단정하게 놓이며, 전체적으로 과도한 밀집을 피하면서도 읽기의 집중도를 유지하는 균형형 조판이다. 여백은 전형적인 인문서 구조를 따르되, 분책이라는 물리적 조건을 고려해 지나치게 무겁거나 답답해 보이지 않도록 조정되어 있다. 좌우와 상단은 비교적 절제된 수준에서 본문을 안정적으로 고정하고, 하단은 약간 더 여유를 두어 페이지의 시각적 중심을 잡고 독서 리듬을 부드럽게 만든다. 이 경우 여백은 단순한 공백이 아니라, 긴 문장을 지속적으로 따라가야 하는 독서 상황에서 시선의 피로를 완화하고 텍스트 덩어리를 적절히 지지하는 ‘구조적 완충 장치’로 기능한다. 동시에 분권 구조로 인한 물성의 가벼움을 시각적으로 보완하면서, 판면이 지나치게 빽빽해 보이지 않도록 조율하는 역할까지 수행한다.",why_font:"데이터 시트 규격에 맞추면 한글 본문은 명조 중심이고, 표지와 일부 보조 정보, 면주 체계에는 고딕이 함께 쓰이는 구조다. 시리즈 공통적으로 본문은 명조의 안정성을 유지하고, 덧표지나 부가 정보에서 고딕이 보조적으로 개입하므로 ‘명조 + 고딕 혼합’ 분류가 가장 적절하다.",why_tracking:"본문은 장문 철학서에 맞는 차분한 행간을 유지한다. 지나치게 조이지도, 과도하게 풀지도 않은 편이며, 활자색이 안정적으로 유지된다. 자간 역시 본문 독서 흐름을 해치지 않는 범위의 미세 조정 수준으로 보인다.",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"실험출판",t:"Sasa[44] 연차 보고서 2011",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/sasa-44-annual-report-2011-kr/",img:"168_Sasa[44] 연차 보고서 2011",kw:["아트이론·비평","실험출판","Sasa[44]","연차","보고서","2011","페이지에","동일","구조의","짧은","문단","프로포르마"],align_title:"-",align_body:"양끝 정렬",align_note:"-",f:{w:148,h:210},m:{상:80,하:99,안:46,밖:46},c:{구성:"1단",간격:0},b:{크기:8.5,행간:10,자간:0},ty:{이름:"프로포르마 (Proforma)",분류:"명조"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"-",subheading:"-",footnote:"-",특:"각 페이지에 동일 구조의 짧은 문단 1개만 배치되고, 좌우 페이지는 거의 완전한 대칭을 이룬다. 마지막 페이지에는 출처와 페이지 번호가 본문 우하단에 작게 결합된다.",summary:"Sasa[44]의 2011년 일상 데이터를 문장형 보고서로 압축한 소책자. 우물우물 10호에 삽입된 일부로 출간되었으며, 디지털 스텐실 인쇄와 극단적으로 절제된 본문 배치를 통해 기록의 단위성과 반복성을 강조한다.",why_dim:"독립 소책자이면서 잡지 삽입물로 기능하는 표준 A5 판형으로, 짧은 문장형 기록과 넓은 공백을 동시에 유지하기 적합",why_margin:"작은 텍스트 블록을 판면 중앙 상단에 고립시켜 기록 문장을 데이터 표본처럼 보이게 하고, 넓은 하단 여백으로 시간적 공백과 지연감을 강조",why_font:"문장형 데이터 기록을 문서처럼 건조하게 제시하면서도, 약한 고전성으로 연차 보고서 형식을 비튼다",why_tracking:"짧은 문장을 균일한 밀도로 유지하고, 작은 판면 안에서도 과장 없는 문서적 리듬을 확보",layout_type:"본문 1단"},
  {g:"문학",pub_type:"전시도록",t:"인생 사용법",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/life-a-users-manual-catalog-kr/",img:"169_인생 사용법",kw:["문학","전시도록","인생","사용법","제목과","언어","표기를","상단","좌우에","병렬","AG","윤고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:189,h:255},m:{상:12,하:15,안:15,밖:9},c:{구성:"2단",간격:6},b:{크기:9,행간:13,자간:10},ty:{이름:"AG 북 / 윤고딕",분류:"고딕"},pn:"하단-좌측/중앙-가로",pn_x_left:"9mm, 94.5mm",pn_y_left:"245.8mm",pn_x_right:"15mm, 101mm",pn_y_right:"245.8mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"27pt",footnote:"9pt",특:"제목과 언어 표기를 상단 좌우에 병렬 배치하고, 본문 해설은 한영 병렬 텍스트 블록으로 정리한다. 작품 사진 페이지는 큰 도판 중심으로 구성되며, 하단에 작품명과 쪽번호가 양언어로 반복된다.",summary:"디자인과 삶의 관계를 재설정하는 전시를 기록한 도록. 브루노 무나리의 포토 에세이를 재연한 표지와, 전시 작품이 실제 사용·오용되는 장면을 병치해 디자인 의도와 생활 사이의 마찰을 시각화한다.",why_dim:"전시 전경 사진과 장문 해설, 작품 소개를 함께 수용하면서도 도록의 문서성과 이미지 비중을 균형 있게 유지하는 중형 판형",why_margin:"상단 제목 정보와 하단 쪽번호를 분리하고, 전면 이미지와 텍스트 블록이 충돌하지 않도록 판면 호흡을 확보",why_font:"본문과 작품 설명에는 장문 독서에 적합한 명조를 사용하고, 제목·면주·보조 정보에는 고딕을 사용해 전시 도록의 정보 위계와 현대적 인상을 분명히 한다",why_tracking:"한영 병렬 본문과 작품 캡션의 판독성을 유지하고, 큰 제목과 본문 사이 위계를 안정적으로 분리",layout_type:"본문 2단 + 주석 2단"},
  {g:"타이포그래피",pub_type:"전시도록",t:"박미나—드로잉 A~Z",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/meena-park-drawings-a-z-kr/",img:"170_박미나—드로잉 A~Z",kw:["타이포그래피","전시도록","박미나","드로잉","A~Z","알파벳","이니셜을","전체에","크게","배치한","인덱스","LL","브라운"],align_title:"-",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:225,h:300},m:{상:8,하:22,안:15,밖:15},c:{구성:"4단",간격:5},b:{크기:7.5,행간:12,자간:0},ty:{이름:"LL 브라운 / 아리따 돋움",분류:"고딕"},pn:"하단중앙-외측-세로",pn_x_left:null,pn_y_left:null,pn_x_right:"217.3mm",pn_y_right:"218.9mm",pn_size:"6pt",pn_font:"고딕",pn_style:"흑색 / 세로 / 숫자",running:"7pt",subheading:"-",footnote:"7.5pt",특:"알파벳 이니셜을 면 전체에 크게 배치한 인덱스 페이지와, 다수의 소형 도판을 규칙적으로 배열한 목록 페이지가 교차한다. 동일 작품군이 축소율별로 반복 제시되며, 우측 가장자리에는 실제 크기 기준 눈금이 병기된다.",summary:"박미나의 드로잉 1998~2012를 제목의 알파벳 순서에 따라 기계적으로 선별·반복 제시한 전시 연계 도록. 300여 점의 작업을 서로 다른 축소 비율과 반복 구조로 배열해 아카이브, 분류, 선택 규칙 자체를 책의 구조로 드러낸다.",why_dim:"대형 판형을 통해 드로잉의 실제 크기 재현, 축소 비율 비교, 반복 배열의 구조를 한 권 안에서 명확히 보여 주기 적합",why_margin:"넓은 판면 위에 소형 도판 군집과 대형 알파벳 인덱스를 공존시켜, 아카이브의 체계성과 여백의 리듬을 동시에 확보",why_font:"대형 알파벳 인덱스와 작품명 표기에는 조형성이 강한 서체를, 세부 목록 정보와 설명에는 중립적 본문용 서체를 사용해 분류 체계와 열람 기능을 동시에 강화",why_tracking:"촘촘한 작품 목록과 캡션 정보를 작은 크기에서도 안정적으로 읽히게 하고, 대형 인덱스 문자와의 시각적 간섭을 줄임",layout_type:"본문 4단(1열) + 사진 4단(각 1열씩 3열)"},
  {g:"타이포그래피",pub_type:"잡지·저널",t:"프린트 2012년 8월 호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/print-kr/",img:"171_프린트 2012년 8월 호",kw:["타이포그래피","잡지·저널","프린트","2012년","8월","호","표지는","대형","산세리프","로고와","절단된","색면","맞춤","서체"],align_title:"좌측 정렬",align_body:"양끝 정렬, 좌측 정렬",align_note:"좌측 정렬",f:{w:216,h:276},m:{상:13,하:20,안:22,밖:13},c:{구성:"3단",간격:6},b:{크기:9,행간:11,자간:40},ty:{이름:"맞춤 서체 (Galaxy Ecosmic 계열) / 기본 잡지 서체",분류:"혼합 (디스플레이 / 고딕)"},pn:"하단-외측-가로",pn_x_left:"28.8mm",pn_y_left:"267.7mm",pn_x_right:"183.4mm",pn_y_right:"267.7mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"6.5pt",subheading:"100pt",footnote:"7.5pt",특:"표지는 대형 산세리프 로고와 절단된 색면 위에 특집 제목을 배치하고, 내지에서는 기사 본문 사이사이에 구멍 뚫린 맞춤 활자를 대형으로 삽입한다. 여백에는 매우 작은 주석·낙서·색상명이 흐르듯 배치되어 본문과 별도의 정보층을 만든다.",summary:"미국 그래픽 디자인 잡지 『Print』 2012년 8월 호의 표지와 ‘Trash’ 특집 섹션을 디자인한 작업. 맞춤 활자 ‘갤럭시 에코즈믹’과 여백의 미세한 낙서를 통해 쓰레기의 순환, 재사용, 사후 생애를 시각적·편집적으로 확장한다.",why_dim:"잡지 규격 안에서 표지, 장문 기사, 도판, 실험적 타이포그래피를 함께 수용하면서 상업 잡지의 가독성과 특집 디자인의 개별성을 동시에 확보",why_margin:"본문 기사 영역은 안정적으로 유지하고, 바깥 여백과 상단 여백을 낙서·색상 정보·보조 텍스트가 점유하도록 설계해 특집의 병렬 서사를 형성",why_font:"특집 제목과 개념어에는 구멍 뚫린 디스플레이 서체를 사용해 쓰레기, 재활용, 공백의 개념을 문자 구조로 시각화하고, 본문은 중립적 고딕으로 유지해 잡지의 판독성을 확보",why_tracking:"장문 기사의 가독성을 유지하면서도 대형 실험 타이포그래피와 충돌하지 않도록 본문은 중립적으로, 제목군은 다소 넓게 설정",layout_type:"본문 3단(각 1열) + 사진 가변 레이아웃"},
  {g:"타이포그래피",pub_type:"전시도록",t:"펠릭스 곤살레스토레스—더블",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/felix-gonzalez-torres-catalog-kr/",img:"172_펠릭스 곤살레스토레스—더블",kw:["타이포그래피","전시도록","펠릭스","곤살레스토레스","더블","표지는","흐린","흑백","이미지","위에","작은","그래픽","삼성고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:186,h:243},m:{상:12,하:40,안:15,밖:12},c:{구성:"2단",간격:2},b:{크기:9,행간:14,자간:-20},ty:{이름:"그래픽 / 삼성고딕 / 삼성명조 / 트룸프 메디에팔",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"90mm",pn_y_left:"231.1mm",pn_x_right:"92.9mm",pn_y_right:"231.1mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"9pt",footnote:"6.5pt",특:"표지는 흐린 흑백 이미지 위에 작은 중앙 제목만 얹고, 내지는 한영 병렬 텍스트를 균형 있게 분할한다. 일부 색면 페이지에서는 매우 작은 백색 본문을 넓게 흩뿌려 읽기보다 응시하게 만드는 판면을 구성한다.",summary:"펠릭스 곤살레스토레스의 작업과 그가 즐겨 쓴 트룸프 메디에팔의 사용법을 재해석한 전시 도록. 작가가 기계적으로 기울인 로만을 썼다는 일화를 거꾸로 적용해, 정식 이탤릭을 세워 만든 기묘한 로만으로 책의 인쇄적 태도와 작가의 언어 감각을 연결한다.",why_dim:"전시 도록에 필요한 문서성과 이미지 수용력을 유지하면서도, 텍스트의 미세한 서체 변형과 넓은 여백을 감지하기 좋은 중형 판형",why_margin:"양쪽 페이지에 텍스트 블록을 낮고 넓게 배치해 고요한 긴장감을 만들고, 색면 페이지에서는 넓은 공백이 전시의 여운과 개념적 거리감을 형성",why_font:"전시 정보와 보조 체계에는 중립적 고딕·명조를 사용하고, 핵심 본문에는 변형된 트룸프 메디에팔 계열을 적용해 작가의 인쇄적 태도와 서체 개념을 책의 구조 안에 직접 반영",why_tracking:"조용한 문서적 리듬을 유지하고, 미세하게 낯선 서체 형태가 자간이 아니라 글자 구조에서 감지되도록 설정",layout_type:"본문 2단(2열)"},
  {g:"문학",pub_type:"단행본",t:"인생사용법",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/la-vie-mode-demploi-kr/",img:"173_인생사용법",kw:["문학","단행본","인생사용법","본문은","단정한","조판으로","길게","이어지고","신신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:144,h:216},m:{상:15,하:30,안:20,밖:24},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조 / 산돌 고딕네오 / 아브니르 / 어도비 개러몬드",분류:"혼합 (명조 / 고딕)"},pn:"중앙하단-외측-세로",pn_x_left:"12.4mm",pn_y_left:"134.7mm",pn_x_right:"128.4mm",pn_y_right:"134.7mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"12pt",footnote:"7pt",특:"본문은 단정한 1단 조판으로 길게 이어지고, 장 시작면에는 장 번호와 제목을 넓은 여백 속에 분리 배치한다. 후반부에는 삽화와 도식, 체스판 구조도가 본문 리듬을 깨지 않으면서 삽입된다.",summary:"조르주 페렉의 『인생사용법』 한국어판. 표지에는 체스 행마법 도표와 글자·숫자로 구성한 페렉의 초상을 결합하고, 내지에서는 원작의 서로 다른 목소리를 한국어 활자 체계로 번역하듯 대응시켜 장편 소설의 구조적 복잡성을 편집 디자인으로 재구성한다.",why_dim:"744쪽의 장편 소설을 안정적으로 수용하는 문고형 판형으로, 장기 독서에 적합하면서도 시리즈 장정의 연속성과 보관성을 유지",why_margin:"긴 본문을 편안하게 읽히게 하면서도 장 제목, 각주, 도판, 도식 삽입을 무리 없이 수용하는 균형 잡힌 문학 판면을 형성",why_font:"원작의 다성적 서술과 인용 층위를 한국어판에서도 구분하기 위해 본문에는 명조를, 보조 정보와 구조 표기에는 고딕 및 라틴 서체를 병용해 타이포그래피 번역이라는 개념을 구현",why_tracking:"장편 소설의 장시간 독서를 고려해 중립적 자간으로 안정적인 회색면을 만들고, 서체 간 성격 차이는 글자꼴과 위계로 처리",layout_type:"본문 1단 + 주석 2단(1열 사용)"},
  {g:"건축·공간",pub_type:"전시도록",t:"서도호—집 속의 집",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/do-ho-suh-home-within-home-kr/",img:"174_서도호—집 속의 집",kw:["건축·공간","전시도록","서도호","집","속의","모든","표제는","매우","가는","선형","서체로","그래픽","맞춤"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:216,h:275},m:{상:51,하:21,안:21,밖:22},c:{구성:"12단",간격:5},b:{크기:9,행간:14,자간:10},ty:{이름:"그래픽 / 맞춤 서체 / 산돌 고딕네오",분류:"고딕"},pn:"상단-우측-가로",pn_x_left:"185.4mm",pn_y_left:"9mm",pn_x_right:"183.7mm",pn_y_right:"9mm",pn_size:"17pt",pn_font:"고딕",pn_style:"회색 / 가로 / 숫자",running:"9pt",subheading:"150pt",footnote:"7.5pt",특:"모든 표제는 매우 가는 선형 서체로 처리되어 자수 도안처럼 보이고, 작품 사진은 페이지를 크게 점유한다. 면주와 쪽번호는 상단에 얇게 정렬되며, 한영 병렬 텍스트는 안정적인 칼럼 안에서 정돈된다.",summary:"서도호의 ‘집’ 연작과 이동, 기억, 내부 공간의 감각을 다루는 전시 도록. 설치 작업의 바느질과 반투명 직물 구조를 반영해, 레터고딕 기반 전용 선형 활자와 비침 효과를 활용한 덧표지로 건축적 윤곽과 봉제의 감각을 책으로 번역한다.",why_dim:"대형 도록 판형으로 설치 전경, 건축적 구조, 세부 도판을 충분히 수용하며 공간 작업의 스케일과 투명성을 시각적으로 전달하기 적합",why_margin:"상단 면주와 도판 영역을 분리하고, 넓은 판면 안에서 선형 표제와 대형 이미지가 호흡할 수 있도록 여백을 절제해 설정",why_font:"설치 작품의 봉제선과 구조선을 닮은 전용 선형 서체를 표제에 사용해 공간의 윤곽과 손작업의 감각을 드러내고, 본문은 중립적 고딕으로 유지해 전시 정보의 판독성을 확보",why_tracking:"매우 얇은 선형 제목이 흐트러지지 않도록 자간을 다소 넓히고, 본문은 차분한 정보 밀도를 유지하도록 중립적으로 설정",layout_type:"본문 2단(각 5열) + 주석(3열 가변)"},
  {g:"타이포그래피",pub_type:"전시도록",t:"유행가—엘리제를 위하여, 배영환",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/bae-young-whan-catalog-kr/",img:"175_유행가—엘리제를 위하여, 배영환",kw:["타이포그래피","전시도록","유행가","엘리제를","위하여","배영환","표지는","대형","세리프","제목과","기타","이미지의","ITC","루벌린"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:186,h:243},m:{상:12,하:23,안:21,밖:18},c:{구성:"14열",간격:0},b:{크기:10,행간:14,자간:-20},ty:{이름:"ITC 루벌린 그래프 / 그래픽 / 삼성고딕",분류:"고딕"},pn:"하단-중앙우측-가로",pn_x_left:"122.9mm",pn_y_left:"227.4mm",pn_x_right:"125.9mm",pn_y_right:"227.4mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"70pt",footnote:"7pt",특:"표지는 대형 세리프 제목과 기타 이미지의 비대칭 결합으로 구성되고, 내지는 작품 도판을 크게 싣는 페이지와 한영 병렬 텍스트 페이지가 교차한다. 제목 페이지에서는 단어를 여러 줄로 분해해 조형적으로 배치한다.",summary:"배영환의 전시를 기록한 도록. 영어 표제의 다섯 개 O를 기타 화음 운지처럼 배치해 작가의 음악적 참조를 표지 타이포그래피에 직접 반영하고, 내지에서는 작품 도판과 장문 비평을 넓은 여백 속에 교차시켜 감각적 사물성과 담론을 함께 드러낸다.",why_dim:"중형 도록 판형으로 표제 실험, 작품 세부 도판, 비평 텍스트를 균형 있게 수용하면서도 표지의 대형 타이포그래피 제스처를 유지하기 적합",why_margin:"큰 제목과 도판이 숨 쉴 수 있는 여백을 확보하고, 장문 비평과 캡션을 안정적으로 수용해 시각적 리듬과 독서 리듬을 함께 조절",why_font:"표제에는 굵고 개성 있는 세리프를 사용해 음악적 제스처와 전시의 인상을 선명하게 만들고, 본문과 정보 체계에는 중립적 고딕을 병용해 도록의 판독성을 유지",why_tracking:"대형 제목의 개방감과 본문의 안정적 회색면을 동시에 확보하기 위해 제목은 약간 넓히고, 본문은 중립적으로 유지",layout_type:"본문 2단 (6열) + 주석 4열 가변"},
  {g:"현대미술",pub_type:"전시도록",t:"카운트다운",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/countdown-catalog-kr/",img:"176_카운트다운",kw:["현대미술","전시도록","카운트다운","작가명이나","작품명이","아니라","전시","기간","날짜가","레일","알파벳"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:215,h:300},m:{상:14,하:49,안:18,밖:21},c:{구성:"4단",간격:4},b:{크기:9,행간:14,자간:0},ty:{이름:"뉴 레일 알파벳 / 맞춤 서체 / 윤고딕",분류:"혼합 (고딕 / 디스플레이)"},pn:"하단-중앙-가로",pn_x_left:"101.3mm",pn_y_left:"253.3mm",pn_x_right:"101.3mm",pn_y_right:"253.3mm",pn_size:"21pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"9pt",footnote:"7.5pt",특:"작가명이나 작품명이 아니라 전시 기간 날짜가 큰 제목이 되며, 펼친 면 아래에 다음 펼친 면 일부가 톱니 모양 경계와 함께 미리 보인다. 속장 바깥 모서리에는 전시 기간을 암시하는 세로 그러데이션이 반복되어 책 전체를 하나의 시간 장치처럼 만든다.",summary:"옛 서울역 문화역서울 284의 개관 프로젝트를 기록한 전시 도록. 작품명 대신 각 작품의 전시 기간을 표제로 삼고, 펼친 면이 다음 펼친 면 일부를 미리 드러내는 구성과 모서리의 그러데이션 표식으로 시간의 흐름과 점진적 개장을 편집 구조에 반영한다.",why_dim:"대형 도록 판형으로 공간 사진, 전시 일정 정보, 시간 기반 표제를 함께 수용하며, 전시장의 건축적 스케일과 연속적 설치 과정을 시각적으로 드러내기 적합",why_margin:"상단의 날짜 표제, 하단의 다음 면 노출, 바깥 모서리의 그러데이션 정보층이 서로 간섭하지 않도록 판면 가장자리에 기능적 여백을 확보",why_font:"철도와 시간표를 연상시키는 숫자 중심 디스플레이 서체를 사용해 옛 서울역의 맥락과 전시의 시간성을 직접 드러내고, 본문은 중립적 고딕으로 정리해 정보 전달성을 유지",why_tracking:"날짜 표제의 숫자 리듬과 세로형 획 대비를 또렷하게 유지하면서, 본문과 캡션은 과도한 개입 없이 안정적으로 읽히게 설정",layout_type:"본문 2단(각 2열) + 기타 및 주석 (4단 각 1열)"},
  {g:"문학",pub_type:"단행본",t:"어느 미술 애호가의 방",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/un-cabinet-damateur-kr/",img:"177_어느 미술 애호가의 방",kw:["문학","단행본","어느","미술","애호가의","방","표지는","고대비","2색","이미지와","대각선","분할","신신명조"],align_title:"우측 정렬, 좌측 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:144,h:216},m:{상:39,하:54,안:24,밖:36},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조 / 산돌 고딕네오 / 아브니르 / 어도비 개러몬드",분류:"혼합 (명조 / 고딕)"},pn:"하단-외측-가로(좌) / 상단-외측-가로(우)",pn_x_left:"12mm",pn_y_left:"197.5mm",pn_x_right:"129.2mm",pn_y_right:"15.6mm",pn_size:"7pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"-",footnote:"7.5pt",특:"표지는 고대비 2색 이미지와 대각선 분할, 반복 프레임을 결합해 복제와 액자 개념을 시각화한다. 내지는 단정한 1단 조판을 유지하고, 작품 목록 페이지에서도 동일한 문서적 리듬을 유지한다.",summary:"조르주 페렉 시리즈의 한 권으로, ‘액자’와 ‘복제’라는 소설의 주제를 표지 이미지 처리 방식으로 번역한 장정과 본문 디자인. 페렉의 초상을 반복·분절·중첩시키는 표지와, 장문의 문학 본문 및 목록형 정보 페이지를 안정적으로 수용하는 내지 구성이 특징이다.",why_dim:"문학 시리즈의 통일성을 유지하면서 120쪽 분량의 장편 산문과 각주, 목록 페이지를 안정적으로 수용하기 좋은 문고형 판형",why_margin:"긴 본문 독서에 적합한 안정적 판면을 만들고, 장 말미 목록·주석 영역까지 같은 문서적 리듬 안에서 수용하도록 여백을 균형 있게 설정",why_font:"문학 본문에는 안정적인 명조를 사용하고, 시리즈 체계와 보조 정보에는 고딕·라틴 서체를 병용해 문학동네 페렉 시리즈의 통일성과 책별 개념 차이를 동시에 유지",why_tracking:"장시간 독서에 적합한 균일한 본문 회색면을 만들고, 표지의 강한 조형성과는 분리된 차분한 내지 리듬을 확보",layout_type:"본문 1단 + 주석 2단(각 1열)"},
  {g:"아트이론·비평",pub_type:"실험출판",t:"Sasa[44] 연차 보고서 2010",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/sasa-44-annual-report-2010-kr/",img:"178_Sasa[44] 연차 보고서 2010",kw:["아트이론·비평","실험출판","Sasa[44]","연차","보고서","2010","대부분","페이지에","짧은","문장","배치되거나","미상"],align_title:"-",align_body:"좌측 정렬",align_note:"-",f:{w:78,h:126},m:{상:9,하:69,안:15,밖:12},c:{구성:"1단",간격:0},b:{크기:8.5,행간:13,자간:0},ty:{이름:"미상",분류:"명조"},pn:"하단-좌측-가로",pn_x_left:"11.9mm",pn_y_left:"109.3mm",pn_x_right:"14.5mm",pn_y_right:"109.3mm",pn_size:"8pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"-",footnote:"-",특:"대부분 페이지에 짧은 문장 1개만 배치되거나, 선그래프 1~4개가 규칙적으로 배열된다. 세 언어가 섹션별 또는 페이지별로 교차하고, 넓은 공백과 작은 쪽번호가 보고서의 건조한 리듬을 유지한다.",summary:"Sasa[44]의 2010년 일상을 월별·연간 수치로 기록한 5주년 특집 소책자. 한국어·스페인어·영어 3개 언어와 다수의 선그래프를 결합해, 개인적 습관의 축적을 통계 보고서이자 서정적 자기기록으로 제시한다.",why_dim:"손에 쥐는 데이터 북 형태의 소형 판형으로, 짧은 문장 기록과 도표, 다국어 병기를 응축해 연감처럼 읽히게 하기 적합",why_margin:"아주 작은 판면 안에서 텍스트와 그래프를 독립된 정보 블록으로 고립시켜, 개인 기록이 표본 데이터처럼 읽히도록 유도",why_font:"작은 판형과 장문이 아닌 짧은 데이터 문장을 고려해, 장식 없는 명조를 사용해 통계 문서 같은 건조함과 독서성을 동시에 확보",why_tracking:"짧은 문장과 숫자 정보가 왜곡 없이 또렷하게 읽히도록 중립적으로 설정",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"옵.신 1호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/ob-scene-no-1-kr/",img:"179_옵.신 1호",kw:["아트이론·비평","잡지·저널","옵.신","1호","본문","삽화","주석이","서로","다른","면군으로","미상"],align_title:"좌측 정렬",align_body:"양끝 정렬, 좌측 정렬",align_note:"좌측 정렬",f:{w:200,h:285},m:{상:10,하:32,안:15,밖:15},c:{구성:"17열",간격:0},b:{크기:8,행간:14,자간:-20},ty:{이름:"미상",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"94.8mm",pn_y_left:"258.1mm",pn_x_right:"99.6mm",pn_y_right:"258.1mm",pn_size:"26pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"6pt",특:"본문, 삽화, 주석이 서로 다른 면군으로 분리되고, 독자는 별표·원형 번호·삼각형 지시표 같은 그래픽 부호를 따라 이들을 연결한다. 일부 페이지는 이미지가 크게 고립되어 놓이고, 일부 페이지는 기울어진 본문과 주석 블록이 별도 층위로 병존해 읽기 순서를 흔든다.",summary:"공연 예술 저널 『옵.신』의 창간호. 본문, 삽화, 주석을 서로 다른 섹션으로 분리해 독자가 그래픽 부호를 따라 요소들을 다시 연결하며 읽도록 설계했고, 텅 빈 앞표지와 분절된 내지 구조를 통해 ‘무대 바깥의 것들’에 대한 관심을 수행적 독서 방식으로 번역한다.",why_dim:"저널과 도록의 중간 크기 판형으로, 분리된 텍스트·도판·주석 섹션과 이미지 페이지를 충분히 수용하면서도 창간호의 물성적 존재감을 확보하기 적합",why_margin:"서로 분리된 섹션과 그래픽 부호, 큰 이미지, 원형 쪽번호를 동시에 수용하고 독자가 페이지 사이를 넘나들며 연결 읽기를 수행할 수 있도록 판면 가장자리에 완충 여백을 확보",why_font:"분절된 정보 체계와 그래픽 부호가 핵심인 저널이므로, 본문과 주석은 중립적 고딕 계열로 정리해 독자가 연결 규칙과 구조를 따라가도록 하고 조형적 개입은 조판과 기호에서 처리",why_tracking:"분리된 섹션과 기울어진 조판에서도 판독성을 유지하고, 그래픽 부호·번호 체계와 본문을 명확히 분리하기 위해 중립 또는 약간 넓은 자간을 사용",layout_type:"본문 2단(각 5열) + 주석 6단(각 3열)"},
  {g:"문학",pub_type:"단행본",t:"증여의 수수께끼",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/enigme-du-don-kr/",img:"180_증여의 수수께끼",kw:["문학","단행본","증여의","수수께끼","표지는","접힌","덧표지의","사선과","대형","제목","신신명조"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:138,h:222},m:{상:21,하:36,안:21,밖:24},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"SM 신신명조 / 벤턴 산스 / 산돌 고딕네오 / 어도비 캐즐런 / 윤명조 / 캐즐런 540 / 포플러",분류:"혼합 (명조 / 고딕)"},pn:"상단-중앙외측-가로",pn_x_left:"42mm",pn_y_left:"11.4mm",pn_x_right:"91.7mm",pn_y_right:"11.4mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"11pt",footnote:"10pt",특:"표지는 접힌 덧표지의 사선과 대형 제목, 화살표 그래픽이 결합된 비대칭 구조이며, 내지는 단정한 1단 장문 조판을 기본으로 한다. 본문 중간 제목과 소제목은 위계적으로 정리되고, 시리즈 공통의 덧표지 시스템이 책마다 다른 조형을 만든다.",summary:"문학동네 인문 라이브러리 시리즈의 한 권으로, ‘증여’와 ‘교환’의 역학을 다룬 모리스 고들리에의 연구서를 비대칭 덧표지와 가변 타이포그래피로 시각화한 책. 474×270mm 종이를 각기 다른 각도로 접어 만드는 시리즈 장정 시스템 안에서, 이 책은 화살표와 비스듬한 대형 제목을 통해 이동·교환·방향성을 강조한다.",why_dim:"인문 라이브러리 시리즈의 통일성을 유지하면서 352쪽 분량의 장문 학술 텍스트를 안정적으로 수용하고, 비대칭 덧표지 구조를 얹기에 적합한 중간 판형",why_margin:"장문 독서에 적합한 안정적 본문 판면을 유지하되, 비대칭 덧표지와 큰 사선 제목 구조가 외부에서 강하게 작동하도록 내지 여백은 차분하게 설정",why_font:"장문 인문 본문에는 독서성이 높은 명조 계열을 사용하고, 표지와 소제 체계에는 고딕 및 개성 강한 디스플레이 서체를 병용해 시리즈의 개념적 통일성과 책별 주제 차이를 동시에 드러낸다",why_tracking:"학술 텍스트의 장시간 독서를 고려해 본문은 중립적으로 유지하고, 표지와 제목군은 사선 구조와 화살표 방향성이 또렷하게 보이도록 약간 넓은 자간을 사용",layout_type:"본문 1단"},
  {g:"현대미술",pub_type:"전시도록",t:"장미셸 오토니엘—마이 웨이",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/jean-michel-othoniel-catalog-kr/",img:"181_장미셸 오토니엘—마이 웨이",kw:["현대미술","전시도록","장미셸","오토니엘","마이","웨이","인터뷰","페이지에서는","한영","텍스트와","대형","컨덴스드","그래픽","삼성고딕"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:186,h:243},m:{상:12,하:13,안:15,밖:12},c:{구성:"2단",간격:3},b:{크기:9.5,행간:15,자간:0},ty:{이름:"그래픽 / 삼성고딕 / 푸투라 컨덴스드",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"90.5mm",pn_y_left:"232.1mm",pn_x_right:"93.8mm",pn_y_right:"232.1mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"6.5pt",subheading:"19pt",footnote:"6.5pt",특:"인터뷰 페이지에서는 한영 텍스트와 대형 컨덴스드 제목이 병렬되고, 작품 전경 페이지는 도판이 펼침면 전체를 크게 점유한다. 쪽번호는 하단에 작게 정리되며, 전체적으로 흰 여백이 넓고 구조가 절제되어 있다.",summary:"장미셸 오토니엘의 국내 첫 회고전을 기록한 전시 도록. 대형 도판과 인터뷰, 전시 전경을 균형 있게 배치하고, 굵은 컨덴스드 제목과 절제된 본문 체계를 통해 작가의 조각적 자아상과 유리·구슬 작업의 물성을 차분한 문서성 안에 정리한다.",why_dim:"전시 전경 사진, 인터뷰, 작품 도판을 함께 수용하면서도 이미지와 텍스트의 균형을 유지하기 좋은 중형 도록 판형",why_margin:"여백을 넓게 두어 인터뷰와 작품 도판이 서로 간섭하지 않게 하고, 작가의 유리 조각이 지닌 부유감과 고요한 전시 공간의 호흡을 판면에도 반영",why_font:"본문과 정보 체계에는 중립적 고딕을 사용하고, 인터뷰 제목과 강조 표제에는 푸투라 컨덴스드 계열을 적용해 작가의 자기 진술과 전시 제목에 조형적 긴장과 현대적 선명성을 부여",why_tracking:"넓은 여백과 큰 제목의 개방감을 유지하면서도 장문 인터뷰의 판독성을 해치지 않도록 중립 또는 약간 넓은 자간을 사용",layout_type:"본문 2단"},
  {g:"인문·사회",pub_type:"단행본",t:"예술가처럼 자아를 확장하는 법",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/how-to-boost-your-ego-like-an-artist-kr/",img:"182_예술가처럼 자아를 확장하는 법",kw:["인문·사회","단행본","예술가처럼","자아를","확장하는","법","한쪽","페이지는","장문","본문과","주석","다른","미상"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:177,h:231},m:{상:0,하:0,안:0,밖:0},c:{구성:"1, 3단 가변",간격:4},b:{크기:10,행간:17,자간:0},ty:{이름:"미상",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-중앙외측-가로",pn_x_left:"41.9mm",pn_y_left:"5.5mm",pn_x_right:"131.4mm",pn_y_right:"5.5mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"-",footnote:"7.5pt",특:"한쪽 페이지는 장문 본문과 주석, 다른 쪽 페이지는 대형 일러스트 또는 이미지 중심으로 구성되는 경우가 많다. 일부 면에서는 만화적 개념 도판이 펼침 전체를 점유하고, 상단의 장 표기와 하단 쪽번호는 비교적 절제된 체계로 유지된다.",summary:"예술사와 현대미술 사례를 통해 ‘자아 확장’의 방식을 풀어내는 교양서. 장문 비평 텍스트와 조경규의 만화적 일러스트레이션을 병치해, 이론적 설명과 시각적 패러디가 교차하는 읽기 구조를 만든다.",why_dim:"텍스트 중심 교양서의 안정성과 도판·일러스트레이션의 조형성을 함께 수용하기 좋은 중간 판형으로, 학술서와 대중 교양서 사이의 성격을 균형 있게 담기 적합",why_margin:"장문 본문과 큰 일러스트레이션, 캡션, 장 번호가 서로 충돌하지 않도록 넉넉한 여백을 두고, 좌우 페이지의 성격 차이를 명확히 나누는 판면 호흡을 확보",why_font:"장문 해설에는 독서성이 높은 본문용 서체를, 장 표기와 보조 정보에는 중립적 고딕을, 일러스트 안의 개념어와 효과어에는 만화적 디스플레이 성격을 병용해 교양서와 시각 패러디의 이중 성격을 분리",why_tracking:"본문은 긴 호흡의 독서를 위해 중립적으로 유지하고, 일러스트와 개념 도판 안의 텍스트는 조형적 성격이 살아나도록 약간의 유연성을 둠",layout_type:"본문 1단 + 주석 3단(각 1열)"},
  {g:"사진",pub_type:"전시도록",t:"백승우—아무도 사진을 읽지 않는다",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/back-seung-woo-catalog-kr/",img:"183_백승우—아무도 사진을 읽지 않는다",kw:["사진","전시도록","백승우","아무도","사진을","읽지","않는다","작품군","제목과","연도","쪽번호가","상단에","정밀하게","노이에","하스"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:188,h:256},m:{상:18,하:14,안:14,밖:13},c:{구성:"2단",간격:10},b:{크기:9,행간:14,자간:0},ty:{이름:"노이에 하스 그로테스크 / 산돌 고딕네오 / 산돌 명조 / 티엠포스",분류:"혼합 (명조 / 고딕)"},pn:"상단-중앙-가로",pn_x_left:"91.7mm",pn_y_left:"10.3mm",pn_x_right:"91.7mm",pn_y_right:"10.3mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"18pt",footnote:"7.5pt",특:"작품군 제목과 연도, 쪽번호가 상단에 정밀하게 정렬되고, 도판은 넓은 여백 속에 규격화된 방식으로 배치된다. 본문 해설은 한영 병렬 또는 프로젝트별 설명 단위로 정리되며, 사진 아래 캡션은 데이터 라벨처럼 작동한다. 전체적으로 실험보다 분류와 분석의 체계가 전면에 드러난다.",summary:"백승우의 사진 작업을 체계적 분류와 분석의 형식으로 정리한 전시 도록. 표지에는 읽히지 않는 사진을 암시하는 요철 사각형만 두고, 내지는 기술 참고서처럼 절제된 조판과 프로젝트별 구획, 영문 병렬 해설, 도판 캡션 체계를 통해 작가의 아카이브적 접근과 사진 읽기의 문제를 드러낸다.",why_dim:"사진 도판의 재현성과 장문 비평, 프로젝트별 분류 체계를 함께 수용하면서도 기술 문서 같은 정밀한 편집 인상을 유지하기 좋은 중형 도록 판형",why_margin:"도판과 캡션, 제목, 연도 표기, 병렬 해설이 독립된 정보 층위로 작동하도록 여백을 넉넉하게 두어 기술 참고서 같은 판면 질서를 확보",why_font:"사진 아카이브와 분석 텍스트를 기술 문서처럼 정리하기 위해 중립적 고딕을 중심으로 사용하고, 장문 비평과 보조 독서에는 명조를 병용해 체계성과 해설성을 동시에 확보",why_tracking:"기술 문서 같은 정밀함과 사진 캡션의 데이터성을 유지하기 위해 본문과 캡션은 중립적으로 설정하고, 제목군만 약간의 확장으로 위계를 분리",layout_type:"본문 2단"},
  {g:"기타",pub_type:"실험출판",t:"107개 수와 4개 낱말과 더 많은 낱말",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/107-numbers-and-4-words-and-many-more-words-kr/",img:"184_107개 수와 4개 낱말과 더 많은 낱말",kw:["기타","실험출판","107개","수와","4개","낱말과","더","많은","낱말","접힌","표지는","제목과","저자명을","넓게","흩어","미상"],align_title:"-",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:840,h:560},m:{상:24,하:40,안:19,밖:18},c:{구성:"8단",간격:20},b:{크기:14.5,행간:18,자간:0},ty:{이름:"미상",분류:"고딕"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"-",subheading:"-",footnote:"-",특:"접힌 표지는 큰 제목과 저자명을 넓게 흩어 배치하고, 펼치면 청색 바탕 위에 매우 작은 본문이 다단으로 빽빽하게 배열된다. 한 장 인쇄물이 접힘에 따라 포스터, 리플렛, 데이터 시트의 성격을 동시에 띠며, 판지 박 가공이 물성을 강조한다.",summary:"Sasa[44]의 설치 작품 ‘107개 수와 4개 낱말’을 설명하기 위해 만든 대형 접지 인쇄물. 1999년에 관한 107개의 수와 몇몇 낱말을 빽빽한 목록 텍스트와 접힌 표지 구조로 조직해, 작품 설명서이면서 동시에 독립적인 데이터 출판물로 기능한다.",why_dim:"전개 시에는 벽보처럼 읽히고 접으면 소책자처럼 취급되는 대형 접지 형식으로, 방대한 수치 정보를 한 장에 밀도 높게 담으면서도 휴대 가능한 인쇄물로 전환하기 적합",why_margin:"전개면에서는 극도로 촘촘한 목록 텍스트가 면 전체를 채우되 가장자리 호흡을 확보하고, 접힌 상태에서는 표지 타이포그래피가 독립적으로 읽히도록 외곽 여백을 기능적으로 설정",why_font:"수치와 짧은 설명어를 고밀도로 배열하는 데이터 인쇄물이므로, 장식 없는 고딕을 사용해 작은 크기에서도 숫자와 단어의 판독성을 유지하고 포스터적 제목과의 위계를 분명히 한다",why_tracking:"작은 본문에서 숫자와 연도가 뭉개지지 않도록 중립 자간을 유지하고, 표지 제목은 약간 넓혀 포스터처럼 개방감 있게 보이도록 설정",layout_type:"주석 8단"},
  {g:"건축·공간",pub_type:"전시도록",t:"스페이스 스터디",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/space-study-catalog-kr/",img:"185_스페이스 스터디",kw:["건축·공간","전시도록","스페이스","스터디","표지와","제목","페이지에서는","글자의","카운터를","제거한","그래픽","삼성고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:186,h:243},m:{상:12,하:18,안:15,밖:12},c:{구성:"6단",간격:3},b:{크기:8,행간:10,자간:0},ty:{이름:"그래픽 / 삼성고딕 / 스캔그래픽 유니카",분류:"고딕"},pn:"하단-우측-가로",pn_x_left:"147mm",pn_y_left:"231.3mm",pn_x_right:"150.1mm",pn_y_right:"231.3mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"94pt",footnote:"6.5pt",특:"표지와 제목 페이지에서는 글자의 카운터를 제거한 대형 타이포그래피가 조형 요소로 작동하고, 내지에서는 작품 도판이 넓은 여백 안에 정렬된다. 대담 페이지는 큰 제목형 타이포그래피와 2단 텍스트가 병렬되며, 전경 사진은 펼침면을 크게 점유한다.",summary:"플라토 전시 ‘스페이스 스터디’를 기록한 도록. 제목 글자의 내부 공간을 제거한 표지 타이포그래피를 통해 ‘공간 연구’라는 주제를 문자 내부와 외부의 관계로 번역하고, 내지에서는 작품 도판·대담·전시 전경을 정제된 구조 안에 배치해 공간 인식의 문제를 시각적으로 확장한다.",why_dim:"작품 도판, 인터뷰, 전시 전경, 텍스트를 균형 있게 수용하면서도 표지의 개념적 타이포그래피 제스처를 유지하기 좋은 중형 도록 판형",why_margin:"작품 도판과 텍스트, 제목형 그래픽이 서로 간섭하지 않도록 여백을 넓게 유지하고, 문자 내부/외부 공간에 대한 개념을 판면 호흡으로도 반영",why_font:"제목에는 글자 내부 공간을 제거한 변형 타이포그래피를 사용해 공간의 개념을 문자 구조 자체로 드러내고, 본문과 정보 체계에는 중립적 고딕을 사용해 도록의 판독성과 질서를 유지",why_tracking:"대형 제목의 개방감과 도판 중심 판면의 정돈감을 동시에 유지하기 위해 제목은 약간 넓히고, 본문은 중립적으로 유지",layout_type:"본문 2-3단 가변(2열 사용) + 주석 6단(각 1열)"},
  {g:"타이포그래피",pub_type:"단행본",t:"파울 레너—타이포그래피 예술",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/paul-renner-kr/",img:"186_파울 레너—타이포그래피 예술",kw:["타이포그래피","단행본","파울","레너","예술","본문은","주로","장문","해설과","산돌","고딕네오"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:180,h:240},m:{상:15,하:10,안:15,밖:20},c:{구성:"3단",간격:5},b:{크기:9,행간:17,자간:0},ty:{이름:"산돌 고딕네오 / 산돌 명조",분류:"혼합 (명조 / 고딕)"},pn:"하단-외측-가로",pn_x_left:"20mm",pn_y_left:"226.7mm",pn_x_right:"154.9mm",pn_y_right:"226.7mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"-",footnote:"6pt",특:"본문은 주로 2단 구조로 장문 해설과 도판 캡션을 정리하고, 도판은 페이지 상단 또는 우측에 독립 블록으로 배치된다. 표지는 푸투라 제작 동판 도상을 대형으로 사용해 책의 주제를 직접 노출하고, 내지는 절제된 구조 안에서 본문·주석·이미지가 안정적으로 병치된다.",summary:"파울 레너의 타이포그래피 작업과 사상을 다룬 연구서. 속장은 지은이가 영어 원서를 디자인하며 사용한 시스템을 한국어판에 옮겨, 장문 해설·도판·주석이 균형 있게 공존하는 학술적 레이아웃을 구성하고, 표지에는 1925년경 푸투라 제작용 동판 이미지를 배치해 서체사의 물질적 기원을 드러낸다.",why_dim:"타이포그래피 도판, 장문 해설, 주석을 함께 수용하는 연구서로서 안정적이면서도 도판 비중을 확보할 수 있는 중형 판형",why_margin:"본문 독서성과 도판 열람성을 동시에 확보하고, 각 장의 도판 캡션과 주석이 본문과 명확히 분리되면서도 한 판면 안에서 유기적으로 읽히도록 균형 있게 설정",why_font:"타이포그래피 이론과 서체사 해설을 위해 본문에는 독서성이 높은 명조를, 구조 표기와 제목에는 중립적 고딕을 사용해 연구서의 명료함과 현대적 질서를 함께 확보",why_tracking:"학술서의 장문 독서를 고려해 본문은 중립적으로 유지하고, 제목과 구조 표기는 약간 넓혀 정보 위계를 분명히 함",layout_type:"본문 1단(2열) + 주석 3단 (각 1열)"},
  {g:"아트이론·비평",pub_type:"실험출판",t:"이것은 미술이 아니다",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/this-is-not-art-kr/",img:"187_이것은 미술이 아니다",kw:["아트이론·비평","실험출판","이것은","미술이","아니다","본문은","차분한","진행되지만","형광","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:126,h:204},m:{상:15,하:42,안:16,밖:18},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:-20},ty:{이름:"미상",분류:"혼합 (명조 / 디스플레이)"},pn:"상단-우측-가로",pn_x_left:"88.6mm",pn_y_left:"6.45mm",pn_x_right:"88.6mm",pn_y_right:"6.45mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"13pt",footnote:"7.5pt",특:"본문은 차분한 1단 구조로 진행되지만, 형광 분홍색의 세로 인용문·주석·소문이 페이지 하단이나 측면에 돌출 삽입된다. 흑백 도판은 본문과 병렬 배치되고, 표지는 커다란 프레임과 반전된 선언문 구조로 책 전체의 문제의식을 먼저 드러낸다.",summary:"근대 미술의 형성과 제도, ‘미술 아닌 것’의 경계를 비판적으로 추적하는 이론서. 고채도 형광 분홍과 회색의 대비, 세로 조판과 각주형 인용문을 반복적으로 삽입해 학술적 본문 안에 선언문·주석·반례의 층위를 시각적으로 분리한다.",why_dim:"장문 이론 텍스트와 도판, 인용문, 각주성 개입을 함께 수용하는 인문서 판형으로, 비교적 조밀한 독서와 개념적 그래픽 개입을 동시에 담기 적합",why_margin:"기본 본문은 안정적으로 읽히게 두되, 형광 분홍 개입문과 세로 조판 블록이 판면에 사건처럼 삽입될 수 있도록 넉넉한 하단·측면 여백을 확보",why_font:"장문 이론서의 독서성을 유지하는 본문용 서체를 중심으로 하되, 형광 분홍 개입문과 선언적 표제는 보다 조형적인 디스플레이 감각으로 처리해 ‘미술/비미술’의 경계 문제를 시각적으로 강조",why_tracking:"학술적 장문 독서의 안정성을 위해 본문 자간은 중립적으로 유지하고, 시각적 긴장은 색상과 배치, 방향 전환에서 만들도록 설정",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"판 4호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/pan-4-kr/",img:"188_판 4호",kw:["아트이론·비평","잡지·저널","판","4호","희곡","형식의","텍스트는","좌우","페이지를","가로지르는","미상"],align_title:"우측 정렬(대제), 중앙 정렬(소제)",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:210,h:285},m:{상:6,하:12,안:13,밖:20},c:{구성:"12단",간격:4},b:{크기:9,행간:14,자간:-50},ty:{이름:"미상",분류:"혼합 (명조 / 고딕)"},pn:"상단-외측-가로",pn_x_left:"8.3mm",pn_y_left:"45.6mm",pn_x_right:"198.4mm",pn_y_right:"45.6mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"49pt",footnote:"9pt",특:"희곡 형식의 텍스트는 좌우 페이지를 가로지르는 구조로 배열되고, 대담 면은 밀도 높은 장문 조판으로 진행된다. 퍼포먼스 기록 사진은 펼침면을 크게 점유하며, 세로 러닝헤드와 권호 정보는 페이지 가장자리에서 저널의 연속성을 유지한다.",summary:"아시아 공연 예술 전문지 『판』 4호. ‘전 지구적 재앙 시대의 예술’을 주제로 삼아, 장문 대담·희곡·퍼포먼스 기록 사진을 한 권 안에서 병치하고, 러닝헤드와 세로 표기 체계를 유지한 채 저널과 도록의 중간 형식으로 조직한다.",why_dim:"잡지형 판형으로 장문 비평, 희곡 형식 텍스트, 퍼포먼스 기록 사진을 함께 수용하면서도 공연예술 저널의 물성과 연속 간행물의 정체성을 유지하기 적합",why_margin:"희곡 대사 배열, 장문 대담, 전면 사진, 세로 러닝 요소가 서로 충돌하지 않도록 가장자리 여백을 확보하고, 저널 전체의 규칙적 리듬을 유지",why_font:"희곡과 비평, 인터뷰, 공연 기록을 함께 수용하는 저널이므로 본문에는 독서성이 높은 서체를 사용하고, 러닝헤드와 구조 표기에는 중립적 고딕을 병용해 공연예술 저널의 문서성과 동시대성을 함께 확보",why_tracking:"장문 비평과 대사 배열의 판독성을 위해 중립 자간을 유지하고, 구조적 긴장은 행갈이와 페이지 병치에서 만듦",layout_type:"본문 가변(계단식 배열)"},
  {g:"현대미술",pub_type:"실험출판",t:"기술적 문제 = 정금형 × 이정우 × 잭슨홍",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/technical-problem-kr/",img:"189_기술적 문제 = 정금형 × 이정우 × 잭슨홍",kw:["현대미술","실험출판","기술적","문제","=","정금형","×","이정우","잭슨홍","겉표지가","안으로","접혀","들어가는","반전","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"중앙 정렬",f:{w:176,h:244},m:{상:12,하:20,안:12,밖:12},c:{구성:"1단",간격:0},b:{크기:15,행간:24,자간:0},ty:{이름:"미상",분류:"고딕"},pn:"하단-우측-가로",pn_x_left:"154.5mm",pn_y_left:"229.7mm",pn_x_right:"154.5mm",pn_y_right:"229.7mm",pn_size:"7pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8.5pt",subheading:"-",footnote:"-",특:"겉표지가 안으로 접혀 들어가는 반전 구조를 갖고 있으며, 현장 사진은 페이지를 크게 점유한다. 본문 활자는 곡선이 잘린 각진 형태로 통일되어 제목과 본문 모두에서 ‘기술적 문제’를 시각화한다. 하단의 작은 캡션과 쪽번호는 기록물의 문서성을 유지한다.",summary:"정금형, 이정우, 잭슨홍의 협업 퍼포먼스 ‘기술적 문제’를 기록한 중철 책자. 표지가 안쪽으로 접혀 들어간 뒤집힌 구조와, 곡선을 각진 직선으로 바꾼 ‘깨진’ 활자체를 통해 공연의 피처링 구조와 기술적·형식적 문제를 책의 물성과 조판 규칙 자체로 구현한다.",why_dim:"퍼포먼스 현장 사진, 대담 텍스트, 작품 설명을 함께 수용하면서도 중철 책자의 가벼운 물성과 실험적 구조를 유지하기 좋은 중형 판형",why_margin:"뒤집힌 표지 구조와 대형 현장 사진, 본문 조판, 하단 캡션 체계가 서로 충돌하지 않도록 여백을 넉넉히 두고, 중철 책자의 빠른 리듬을 유지",why_font:"공연의 피처링 구조와 기술적 결함, 결합, 마찰을 문자 형태 자체에서 드러내기 위해 곡선을 비죽한 직선으로 변환한 맞춤형 디스플레이 서체를 사용",why_tracking:"깨진 자형의 판독성을 유지하면서 대형 제목의 조형성을 살리기 위해 본문은 중립에 가깝게, 제목은 약간 넓혀 설정",layout_type:"본문 1단"},
  {g:"사진",pub_type:"전시도록",t:"이득영—두 얼굴",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/two-faces-book-kr/",img:"190_이득영—두 얼굴",kw:["사진","전시도록","이득영","두","얼굴","강북과","강남을","보여","주는","책이","서로","벰보","산돌"],align_title:"중앙 정렬",align_body:"-",align_note:"좌측 정렬(한글), 우측 정렬(영어)",f:{w:180,h:240},m:{상:7,하:8,안:10,밖:10},c:{구성:"3단",간격:5},b:{크기:8,행간:11,자간:0},ty:{이름:"벰보 / 산돌 고딕네오 / 산돌 명조 / 스캔그래픽 유니카",분류:"고딕"},pn:"중앙-우측-세로",pn_x_left:"32.9mm",pn_y_left:"114.7mm",pn_x_right:"142.8mm",pn_y_right:"114.7mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"-",footnote:"-",특:"강북과 강남을 보여 주는 두 책이 서로 뒤집혀 결합된 구조를 이루며, 펼침면에서는 사진이 위아래로 이어지거나 반전되어 지리적 대응 관계를 만든다. 본문 정보와 쪽번호는 중앙 띠 영역에 배치되고, 별책은 한강의 근대사를 별도 독서 단위로 제공한다. 표지는 전체 이미지를 가로 2%로 압축한 왜곡 이미지로 처리된다.",summary:"한강 상류 미사리에서 하류 김포대교까지 강북과 강남의 수변을 촬영한 이득영의 프로젝트를 책의 구조로 번역한 전시 도록. 강북과 강남을 보여 주는 두 책이 아랫면을 맞댄 형태로 결합되고, 전통 접지 방식으로 재단하지 않은 속장을 사용해 강변 풍경이 끊기지 않고 흐르는 인상을 만든다. 별책에는 한강의 근대사를 다룬 글이 수록된다.",why_dim:"파노라마 사진의 연속성과 두 권이 결합된 구조를 동시에 수용하기 좋은 중형 판형이며, 별책을 별도 크기로 분리해 본문과 비평의 위계를 분명히 하기 적합",why_margin:"두 강변 풍경이 지리적으로 조응하도록 펼침면의 연속성을 살리고, 전통 접지로 인해 재단되지 않은 가장자리와 넓은 사진 면이 숨 쉴 수 있도록 기능적 여백을 확보",why_font:"사진 도록의 캡션과 비평 텍스트에는 독서성이 높은 명조를, 구조 표기와 제목 체계에는 중립적 고딕을 병용해 파노라마 이미지의 연속성과 문서적 해설 구조를 함께 유지",why_tracking:"파노라마 사진과 중앙 띠 캡션 체계의 정밀한 정렬을 위해 본문과 캡션은 중립적으로 유지하고, 구조 표기만 약간 넓혀 위계를 분리",layout_type:"본문 3단"},
  {g:"사진",pub_type:"전시도록",t:"이미지 없는—이재이",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/imageless-jaye-rhee-kr/",img:"191_이미지 없는—이재이",kw:["사진","전시도록","이미지","없는","이재이","표지는","개의","선과","제목만으로","구성되고","내지에서는","MT","그로테스크"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:225,h:305},m:{상:20,하:19,안:15,밖:15},c:{구성:"2단",간격:14},b:{크기:11,행간:14,자간:50},ty:{이름:"MT 그로테스크",분류:"고딕"},pn:"상단-외측-가로",pn_x_left:"15mm",pn_y_left:"11.7mm",pn_x_right:null,pn_y_right:null,pn_size:"11pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"11pt",subheading:"21pt",footnote:"8pt",특:"표지는 몇 개의 선과 제목만으로 구성되고, 내지에서는 한 페이지에 작품명만 두거나 한 장의 이미지가 크게 점유하는 식으로 극단적으로 절제된 배치를 사용한다. 일부 면은 소형 이미지의 반복 배열, 일부 면은 전면 도판으로 구성되며, 텍스트는 영어 기준으로 짧고 정돈되게 배치된다.",summary:"이재이의 사진·비디오·퍼포먼스·설치 작업을 기록한 모노그래프. 제목처럼 이미지의 부재와 재현의 역설을 강조하기 위해 표지에는 선 몇 개와 최소한의 텍스트만 두고, 내지에서는 작품 이미지가 넓은 여백 속에 고립되거나 연속 배열되며 영어 텍스트가 차분하게 병치된다.",why_dim:"대형 도록 판형으로 사진과 설치 작업의 스케일을 충분히 재현하고, 이미지 주변의 공백 자체를 의미화하는 구성에 적합",why_margin:"작품 이미지가 넓은 공백 속에서 고립되어 보이도록 여백을 크게 확보하고, 텍스트와 도판이 서로 간섭하지 않게 하여 ‘이미지 없음’의 개념을 판면 호흡으로 확장",why_font:"작품과 여백의 관계를 전면화하는 미니멀 모노그래프이므로, 장식이 적고 중립적인 고딕을 사용해 텍스트를 최대한 비개입적으로 유지하고 이미지의 존재·부재를 부각",why_tracking:"텍스트가 조형적 주체가 아니라 여백 속 좌표처럼 기능하도록 중립 자간을 유지",layout_type:"본문 2단(1열) + 사진 가변"},
  {g:"타이포그래피",pub_type:"전시도록",t:"권진규—탈주",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/kwon-jin-kyu-kr/",img:"192_권진규—탈주",kw:["타이포그래피","전시도록","권진규","탈주","장문","비평","면은","좌측에","제목","필자","센테니얼","산돌"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:215,h:225},m:{상:9,하:21,안:30,밖:11},c:{구성:"9단",간격:6},b:{크기:7.5,행간:11,자간:0},ty:{이름:"벨 센테니얼 / 산돌 고딕네오 / 산돌 제비 / 트룸프 메디에팔",분류:"명조"},pn:"하단-내측-가로(우)",pn_x_left:null,pn_y_left:null,pn_x_right:"40mm",pn_y_right:"209.5mm",pn_size:"7.5pt",pn_font:"명조",pn_style:"청색 / 가로 / 숫자",running:"-",subheading:"12pt",footnote:"9pt",특:"장문 비평 면은 좌측에 제목·필자, 우측에 2단 본문을 두고, 도판 면은 한 점 전면 이미지·확대 디테일·복수 작품 병치로 전환된다. 작품 목록은 한 페이지에 개별 조각을 넓게 띄워 배치하고, 작품명·재료·크기·연도를 이미지 바깥에 두어 문서성과 전시성을 함께 유지한다.",summary:"권진규의 조각 세계를 다룬 전시 도록. 백색 지면 위에 벨 센테니얼과 산돌 계열 서체를 절제해 배치하고, 조각 사진을 전면·확대·개별 오브젝트 배열로 교차 편집해 인물상과 동물상, 비평 텍스트와 작품 목록의 층위를 차분하게 조직한다.",why_dim:"정사각형에 가까운 중형 판형으로 조각 작품의 정면성, 확대 디테일, 장문 비평과 작품 목록을 균형 있게 수용하고, 전시 도록의 밀도와 오브제성을 함께 확보하기 적합",why_margin:"백색 여백을 넉넉히 두어 조각 이미지가 독립된 오브젝트처럼 놓이게 하고, 하단의 쪽번호·캡션·작품 정보를 안정적으로 분리",why_font:"작품 캡션과 쪽번호에는 작은 크기에서도 식별력이 높은 벨 센테니얼을, 구조 정보에는 중립적 고딕을, 한글 제목과 작품 정보에는 산돌 계열 서체를 병용해 조각 도록의 문서성과 전시장의 정적 긴장을 함께 확보",why_tracking:"작품 정보와 장문 비평의 판독성을 유지하기 위해 본문 자간은 중립적으로 두고, 작은 캡션과 번호 체계가 백색 지면에서 또렷하게 읽히도록 설정",layout_type:"본문 2단 + 도판 전면, 작품 목록 3단 가변"},
  {g:"아트이론·비평",pub_type:"전시도록",t:"강애란 2006~2010",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/airan-kang-2006-2010-kr/",img:"193_강애란 2006~2010",kw:["아트이론·비평","전시도록","강애란","2006~2010","기본","본문은","장문","조판으로","진행되지만","산돌","고딕네오"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:218,h:288},m:{상:18,하:79,안:15,밖:61.84},c:{구성:"1단",간격:0},b:{크기:12,행간:17,자간:0},ty:{이름:"산돌 고딕네오 / 유니버스",분류:"명조"},pn:"중앙하단-중앙-가로",pn_x_left:"84mm",pn_y_left:"181.1mm",pn_x_right:"106.7mm",pn_y_right:"149.4mm",pn_size:"8pt",pn_font:"명조",pn_style:"회색 / 가로 / 숫자",running:"9.5pt",subheading:"10.5pt",footnote:"6pt",특:"기본 본문은 1단 장문 조판으로 진행되지만, 소형 작품 도판이 하단이나 측면에 불규칙하게 삽입되고, 섹션 오프너에서는 대형 고딕 제목이 오른쪽 페이지를 크게 점유한다. 일부 면은 색지 위에 소형 이미지와 시를 배치하고, 일본어 본문은 세로 조판으로 전환되어 한 권 안에서 서로 다른 읽기 단위를 만든다.",summary:"강애란의 2006~2010년 작업을 정리한 모노그래프. 발광하는 ‘가상 책’ 설치 이미지, 비평 텍스트, 연보성 섹션 표제, 다언어 본문을 병치하며, 페이지마다 크기와 비례가 달라지는 타이포그래피와 이미지 스케일 변화로 ‘한 권 안의 여러 책’이라는 작가 개념을 편집 구조로 번역한다.",why_dim:"장문 비평과 다언어 본문, 설치 작품 도판, 도록형 아카이브 이미지를 함께 수용하면서도 대형 작품 사진과 섹션 타이포그래피의 크기 변주를 안정적으로 펼치기 좋은 중대형 판형",why_margin:"상단의 날짜·작가명·섹션 정보와 하단의 페이지 체계를 유지하면서, 본문과 소형 도판, 대형 설치 사진이 서로 다른 크기로 공존할 수 있도록 하단과 안쪽 여백을 넉넉히 확보",why_font:"작품 이미지와 비평 텍스트, 섹션 제목을 한 권 안에서 명확히 구분하면서도 현대적이고 중립적인 인상을 유지하기 위해 고딕 계열을 사용하고, 대형 섹션 표제의 스케일 변화로 작가의 ‘가상 책’ 개념을 강조",why_tracking:"기본 본문은 판독성을 위해 중립적으로 유지하고, 섹션 제목과 일부 강조 정보에만 약간 넓은 자간을 적용해 크기 변주와 위계를 또렷하게 분리",layout_type:"본문 1단 + 사진 가변"},
  {g:"문학",pub_type:"전시도록",t:"미디어 시티 서울 2010",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/media-city-seoul-2010-catalog-kr/",img:"194_미디어 시티 서울 2010",kw:["문학","전시도록","미디어","시티","서울","2010","일반","텍스트","면은","또는","HY","타자전각"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:188,h:256},m:{상:27,하:11,안:24,밖:11},c:{구성:"12단",간격:3},b:{크기:8,행간:12,자간:0},ty:{이름:"HY 타자전각 / LL 아쿠라트 / 모노타이프 타이프라이터 / 윤고딕 500",분류:"고딕"},pn:"상단-좌측-가로",pn_x_left:"12.4mm",pn_y_left:"7.4mm",pn_x_right:"24.4mm",pn_y_right:"7.4mm",pn_size:"11pt",pn_font:"고딕",pn_style:"적색, 녹색, 청색 / 가로 / 숫자",running:"7pt",subheading:"11pt",footnote:"7pt",특:"일반 텍스트 면은 3단 또는 4단 모듈로 구성되고, 일부 에세이와 시 텍스트는 세로 조판으로 전환된다. 작가 소개 면은 좌측 약력·우측 작품 설명·하단 전시 이력으로 분절되며, 도판 면은 짙은 갈색 또는 회색 색면 위에 이미지와 캡션을 느슨하게 배치한다. 섹션마다 적색·녹색·청색 계열 색상을 달리해 도시 매체 환경의 다중 채널성을 강조한다.",summary:"서울시립미술관 국제 미디어아트 비엔날레 『미디어 시티 서울 2010』 도록. 작가 소개, 장문 에세이, 작품 도판, 전시 섹션 정보가 한 권 안에서 다언어·다서체 체계로 병치되며, 색상별 섹션 전환과 세로 조판, 타자기풍 서체, 짙은 색면 위의 도판 배열을 통해 미디어 환경의 다층성과 도시적 정보 흐름을 편집 구조로 시각화한다.",why_dim:"국제전 도록 특유의 방대한 작가 정보, 장문 비평, 다언어 텍스트, 작품 이미지를 함께 수용하면서도 포스터적 섹션 디자인과 도록의 문서성을 동시에 유지하기 좋은 A4 기반 대형 판형",why_margin:"상단의 쪽번호·섹션명·영문 병기와 하단의 캡션, 작품 정보, 작가 약력을 안정적으로 분리하고, 전면 색면과 세로 조판이 개입해도 정보 위계가 무너지지 않도록 가장자리 여백을 체계적으로 확보",why_font:"국제전 도록의 방대한 정보 구조를 중립적 고딕으로 정리하면서, 타자기풍 활자와 굵은 산세리프를 병용해 미디어·기록·전송·도시 네트워크라는 전시 주제를 시각적으로 부각",why_tracking:"장문 정보의 판독성을 위해 기본 자간은 중립적으로 두고, 섹션 제목과 일부 영문 표기에만 약간 넓은 자간을 적용해 채널 전환 같은 리듬과 정보 위계를 구분",layout_type:"본문 3단 + 작가 소개 4단, 도판 비정형"},
  {g:"건축·공간",pub_type:"전시도록",t:"유원지에서 생긴 일",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/works-in-the-open-air-catalog-kr/",img:"195_유원지에서 생긴 일",kw:["건축·공간","전시도록","유원지에서","생긴","일","도입부는","이중언어","텍스트와","얇은","점선","윤고딕","푸투라"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:180,h:240},m:{상:15,하:17,안:20,밖:20},c:{구성:"6단",간격:4},b:{크기:8,행간:13,자간:0},ty:{이름:"윤고딕 / 푸투라",분류:"고딕"},pn:"하단-우측-가로",pn_x_left:"164.1mm",pn_y_left:"228.3mm",pn_x_right:"164.1mm",pn_y_right:"228.3mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"19.5pt",footnote:"7.5pt",특:"도입부는 2단 이중언어 텍스트와 얇은 점선 구획으로 구성되고, 전경 사진 면은 펼침 전체를 크게 사용한다. 작품 소개 면에서는 작가명, 작품명, 텍스트, 약력을 비정형 블록으로 나누고 점선과 픽토그램을 연결선처럼 사용해 지면 요소를 놀이 기구처럼 변형한다.",summary:"경기도미술관 야외 프로젝트 전시를 기록한 소형 도록. 공공성과 사적 영역, 투명성과 침투성의 문제를 다루는 전시 개념에 맞춰, 얇은 점선과 아이소타이프 인물 픽토그램, 기하학적 구성의 제목 체계를 사용하고, 속장에서는 선형 도식과 넓은 여백 속에 작품 설명과 작가 약력을 배치해 공공 공간의 느슨한 경계를 시각화한다.",why_dim:"야외 전시 전경 사진, 작품 설명, 작가 약력, 이중언어 텍스트를 간결하게 수용하면서도 소책자처럼 가볍고 이동성 있는 읽기 경험을 만들기 좋은 중소형 판형",why_margin:"점선 도식과 인물 픽토그램, 이중언어 본문이 넉넉한 여백 안에서 독립적으로 놓이도록 균질한 여백을 확보하고, 작은 쪽수의 소책자 구조 안에서 공공 공간의 개방감을 유지",why_font:"현대주의와 공공성의 그래픽 언어를 환기하기 위해 중립적 산세리프와 기하학적 고딕을 병용하고, 전시의 제도적 정보와 실외 프로젝트의 개방적 분위기를 함께 전달",why_tracking:"본문은 판독성을 위해 중립적으로 유지하고, 제목과 일부 영문 표기에만 약간의 자간 확장을 주어 현대주의적 질서와 개방감을 강조",layout_type:"본문 2단 + 주석 3단"},
  {g:"현대미술",pub_type:"단행본",t:"Sasa[44] 연차 보고서 2009",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/sasa-44-annual-report-2009-kr/",img:"196_Sasa[44] 연차 보고서 2009",kw:["현대미술","단행본","Sasa[44]","연차","보고서","2009","면은","언어판을","좌우","대칭에","가깝게","배치하고","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬, 우측 정렬",align_note:"좌측 정렬",f:{w:394,h:545},m:{상:26,하:39,안:20,밖:22},c:{구성:"14단",간격:5},b:{크기:8,행간:9,자간:0},ty:{이름:"미상",분류:"고딕"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"8.5pt",subheading:"15pt",footnote:"-",특:"각 면은 두 개 언어판을 좌우 대칭에 가깝게 배치하고, 상단에는 동일한 제목과 연도만 작게 둔다. 본문은 월별 데이터 문장을 세로로 길게 적층하며, 페이지 하단에는 해당 언어 표기를 소문자처럼 배치한다. 회색 바탕과 과도하게 작은 본문 크기, 반복되는 문장 구조가 통계표와 콘셉추얼 아트 문서를 결합한 인상을 만든다.",summary:"Sasa[44]의 2009년 활동과 소비, 이동, 통신, 관람, 구매, 대기 행위를 8개 언어로 번역해 병렬 수록한 포스터형 연차 보고서. 접지된 4면 안에 국가별 언어판을 같은 구조로 반복 배치하고, 극도로 작은 활자와 넓은 회색 여백, 최소한의 제목 체계만으로 데이터 기록물과 전시용 포스터의 성격을 동시에 만든다.",why_dim:"8개 언어를 한 장 안에 병렬 배치하고, 연차 보고서의 데이터성과 전시용 포스터의 확장성을 동시에 확보하기 좋은 대형 포스터 판형",why_margin:"극소 활자 블록이 넓은 빈 공간 속에서 독립적으로 읽히도록 큰 여백을 유지하고, 포스터로 펼쳤을 때 언어판 사이의 간격과 시각적 침묵이 데이터의 객관성을 강화",why_font:"8개 언어의 방대한 월별 문장을 가장 중립적이고 균일하게 반복 표시해야 하므로 장식성이 거의 없는 고딕 계열을 사용해 데이터 기록물의 비개성적 톤과 다언어 호환성을 확보",why_tracking:"극도로 작은 본문을 높은 밀도로 안정적으로 유지해야 하므로 자간 조정 없이 중립값을 유지해 언어 간 폭 차이와 반복 구조가 그대로 드러나도록 설정",layout_type:"소제목 2단 + 본문 다단"},
  {g:"아트이론·비평",pub_type:"전시도록",t:"박미나—BCGKMRY",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/bcgkmry-catalog-kr/",img:"197_박미나—BCGKMRY",kw:["아트이론·비평","전시도록","박미나","BCGKMRY","도판","면은","중앙에","세로형","회화를","크게","LL","르코르뷔지에"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:210,h:297},m:{상:11,하:17,안:46,밖:20},c:{구성:"2단",간격:6},b:{크기:9,행간:13,자간:0},ty:{이름:"LL 르코르뷔지에 / 디도 엘더 / 윤고딕 / 푸투라",분류:"고딕"},pn:"중앙-내측-세로",pn_x_left:"187.5mm",pn_y_left:"143.6mm",pn_x_right:"19.6mm",pn_y_right:"143.6mm",pn_size:"11pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"12pt",subheading:"-",footnote:"-",특:"도판 면은 중앙에 세로형 회화를 크게 두고 제목과 작품 정보를 가장자리에 세로로 배치한다. 본문 면은 한글과 영어를 각각 2단 블록으로 나누고, 제목 ‘BCGKMRY’를 상단 중앙에 작게 두어 색채 체계의 분석 문서처럼 보이게 한다. 회색 바탕과 얇은 선형 정보 배치가 전시 도록보다 연구 보고서에 가까운 긴장을 만든다.",summary:"박미나의 색채 체계와 회화 방법론을 다룬 전시 도록. 회색 바탕 위에 색면 회화 도판을 크게 배치하고, 한·영 비평문과 작품 정보를 절제된 타이포그래피로 병치한다. 제목 ‘BCGKMRY’는 CMYK와 RGB를 교차한 작가의 색채 규칙을 반영하며, 코일 링 제본과 넓은 여백, 세로 제목 배치가 연구 노트 같은 인상을 강화한다.",why_dim:"회화 도판, 한·영 비평문, 작품 캡션을 함께 수용하면서도 아카이브 문서 같은 연구서적 인상을 유지하기 좋은 A4 기반 판형",why_margin:"코일 링 제본의 물성과 회색 바탕 위의 넓은 빈 공간을 살려, 도판과 비평문이 각각 독립된 블록처럼 읽히도록 균질한 여백을 확보",why_font:"색채 이론과 회화 연구의 분석적 분위기를 위해 기하학적 산세리프와 고전적 세리프, 디스플레이 성격의 제목 서체를 병용해 개념적 엄밀함과 전시 도록의 조형성을 함께 확보",why_tracking:"본문은 판독성을 위해 중립적으로 유지하고, 제목과 일부 작품 정보에만 약간의 자간 확장을 주어 색채 코드와 도판 정보의 구조를 분명히 구분",layout_type:"본문 2단"},
  {g:"그래픽디자인",pub_type:"단행본",t:"한국 디자인사 수첩",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/a-memo-for-a-korean-design-history-kr/",img:"198_한국 디자인사 수첩",kw:["그래픽디자인","단행본","한국","디자인사","수첩","기본","면은","질문과","답변이","이어지는","서울남산체","윤명조"],align_title:"-",align_body:"양끝 정렬, 좌측 정렬(일부)",align_note:"좌측 정렬",f:{w:140,h:224},m:{상:20,하:27,안:20,밖:20},c:{구성:"1단",간격:0},b:{크기:9.5,행간:17,자간:0},ty:{이름:"서울남산체 / 윤명조",분류:"혼합 (명조 / 고딕)"},pn:"상단-중앙-가로",pn_x_left:"67.3mm",pn_y_left:"6.8mm",pn_x_right:"67.3mm",pn_y_right:"6.8mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7pt",subheading:"-",footnote:"7pt",특:"기본 면은 질문과 답변이 이어지는 2단 장문 조판으로 구성되며, 질문은 색상과 들여쓰기 변화로 구분된다. 도판 면에서는 조영제의 포스터, 로고, 표지 이미지가 본문 사이에 삽입되고, 표지 초상의 픽셀 모자이크 개념이 한국 디자인사 자료집의 성격을 압축적으로 드러낸다.",summary:"디자인 연구자 강현주가 조영제와 나눈 장시간 대담을 바탕으로 한국 그래픽 디자인의 초기 장면과 제도 형성을 추적한 연구서. 표지 초상은 조영제가 만든 기업 로고를 픽셀처럼 조합해 구성하고, 내지에서는 장문 인터뷰와 도판, 로고 자료를 차분한 2단 구조와 넓은 하단 여백 속에 병치해 구술사와 시각 아카이브를 함께 제시한다.",why_dim:"장시간 대담 텍스트와 로고 자료, 작품 도판, 주석성 정보가 함께 들어가는 디자인사 연구서로서 휴대성과 장문 독서의 안정성을 동시에 확보하기 좋은 세로형 중형 판형",why_margin:"인터뷰 본문과 질문, 도판 캡션, 페이지 번호를 분리하면서 장문 독서의 호흡을 유지하기 위해 하단 여백을 넓히고, 안쪽 여백도 충분히 확보해 문서성과 읽기 안정성을 강화",why_font:"구술 인터뷰와 디자인사 자료를 함께 다루는 책이므로 본문에는 장문 독서에 적합한 명조를, 제목과 구조 정보에는 현대적이면서도 한국적 맥락을 가진 고딕을 사용해 연구서의 공공성과 역사성을 함께 확보",why_tracking:"장문 인터뷰의 판독성을 위해 자간은 중립적으로 유지하고, 질문과 답변의 위계는 색상과 배치 변화로 해결하도록 설정",layout_type:"본문 1단 + 사진 가변 + 주석 2단"},
  {g:"현대미술",pub_type:"전시도록",t:"볼프강 요프—죽음과 믿음",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/wolfgang-joop-catalog-kr/",img:"199_볼프강 요프—죽음과 믿음",kw:["현대미술","전시도록","볼프강","요프","죽음과","믿음","텍스트","면은","본문이","좌우","블록으로","정렬되고","윤고딕","푸투라"],align_title:"-",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:234,h:360},m:{상:14,하:65,안:23,밖:12},c:{구성:"19열",간격:0},b:{크기:8.5,행간:13,자간:0},ty:{이름:"윤고딕 / 푸투라",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"83mm",pn_y_left:"304.1mm",pn_x_right:"89mm",pn_y_right:"304.1mm",pn_size:"112pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 로마숫자",running:"8.5pt",subheading:"8.5pt",footnote:"8.5pt",특:"텍스트 면은 한·독·영 본문이 좌우 블록으로 정렬되고, 하단에는 대형 로마숫자 페이지 번호가 중앙축을 기준으로 반복된다. 도판 면은 조각 일부를 클로즈업해 안쪽 여백을 가로질러 배치하거나, 동일 작품의 좌우 대칭 이미지를 펼침 전체에 균형 있게 배치해 작품의 시각적·개념적 대칭성을 편집 구조로 번역한다.",summary:"볼프강 요프의 조각과 회화 작업을 다룬 전시 도록. 작품 이미지가 중철 축을 넘어 반대 면으로 이어지거나 중앙 정렬로 배치되고, 로마숫자 페이지 체계와 얇은 제목 활자가 대칭 구조를 반복해 죽음과 믿음, 아름다움과 불안 사이의 개념적 긴장을 시각적으로 강조한다.",why_dim:"대형 조각 이미지를 좌우 대칭으로 크게 펼치고, 중철 축을 활용한 전면 도판과 장문 텍스트를 함께 수용하기 좋은 가로형 대형 판형",why_margin:"이미지가 중철 축을 넘나들며 연결될 수 있도록 안쪽 여백을 구조적으로 활용하고, 하단의 로마숫자 페이지 체계와 작품 정보가 조용히 놓이도록 충분한 아래 여백을 확보",why_font:"조각 이미지의 물질감과 대칭 구성을 방해하지 않으면서 구조적 정보와 본문을 명확히 정리하기 위해 중립적 산세리프를 사용하고, 얇은 제목 활자로 고전성과 긴장감을 함께 부여",why_tracking:"대칭 구조와 중앙 정렬의 질서를 강조하기 위해 자간은 중립적으로 유지하고, 위계는 배치와 여백, 크기 대비로 해결하도록 설정",layout_type:"3단(본문 6열 + 주석 4열)"},
  {g:"인문·사회",pub_type:"단행본",t:"우리 동네—도쿄",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/our-spot-tokyo-kr/",img:"200_우리 동네—도쿄",kw:["인문·사회","단행본","우리","동네","도쿄","도입부에는","하루","날짜를","초대형","표제로","제시하고","미상"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"양끝 정렬",f:{w:257,h:364},m:{상:15,하:11,안:13,밖:12},c:{구성:"5단",간격:7},b:{크기:10,행간:12,자간:0},ty:{이름:"미상",분류:"고딕"},pn:"상단-외측-가로",pn_x_left:"30mm",pn_y_left:"7.6mm",pn_x_right:"221mm",pn_y_right:"7.6mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"10pt",subheading:"-",footnote:"10pt",특:"도입부에는 하루 날짜를 초대형 표제로 제시하고, 본문에서는 지시문과 사진, 시간 정보가 세로 흐름으로 배열된다. 다른 면에서는 여행 중 모은 영수증, 쇼핑백, 전단, 포장재 등을 격자처럼 병렬 배치해 도시 경험을 물건의 표면으로 재구성한다. 전체적으로 사용자의 자율 이동보다 타인의 지시를 수행하는 구조가 책의 시간성과 편집 리듬을 결정한다.",summary:"Sasa[44]가 박미나의 지시에 따라 도쿄를 이동하며 수행한 여행 프로젝트를 기록한 책. 하루의 동선, 시간, 지시문, 거리 풍경 사진, 수집한 기념품 이미지를 병치해 도시를 직접 경험하는 대신 타인의 언어를 따라 움직이는 수행적 여행 구조를 책으로 번역한다.",why_dim:"시간 순서의 사진, 지시문, 수집물 아카이브, 대형 날짜 타이포그래피를 한 페이지 안에서 충분한 간격으로 펼치고 여행 기록의 포스터적 스케일까지 확보하기 좋은 대형 판형",why_margin:"지시문과 이동 기록, 수집물 이미지, 대형 날짜 표제가 각각 독립된 층위로 읽히도록 넉넉한 공백을 유지하고, 도시를 걷는 리듬과 중단, 우회, 발견의 시간을 여백으로 체감하게 구성",why_font:"여행 안내문, 시간표, 거리 표지, 기념품 이미지가 한 책 안에서 서로 다른 정보 밀도로 공존하도록 비교적 중립적인 본문 서체와 강한 표제용 서체를 병용한 것으로 보이며, 수행적 여행의 문서성과 도시 그래픽의 즉시성을 함께 전달한다.",why_tracking:"지시문과 시간 정보, 이미지 캡션이 과도하게 감정화되지 않고 수행 기록처럼 읽히도록 중립적인 문자 리듬을 유지한 것으로 보인다.",layout_type:"본문 2단 + 사진 1단(중앙 1열)"},
  {g:"아트이론·비평",pub_type:"전시도록",t:"SMSM—색깔의 힘",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/the-power-of-color-book-kr/",img:"201_SMSM—색깔의 힘",kw:["아트이론·비평","전시도록","SMSM","색깔의","힘","초반부는","병기","텍스트와","프로젝트","개요","기관","그래픽","윤고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:180,h:240},m:{상:52,하:9,안:10,밖:10},c:{구성:"4단",간격:7},b:{크기:8.5,행간:13,자간:0},ty:{이름:"그래픽 / 윤고딕",분류:"고딕"},pn:"상단-중앙, 우측(1쪽에 동일 숫자 2개)-가로",pn_x_left:"83.6mm, 168.6mm",pn_y_left:"9.8mm",pn_x_right:"83.6mm, 168.6mm",pn_y_right:"9.8mm",pn_size:"7pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"6pt",subheading:"12.5pt",footnote:"8.5pt",특:"초반부는 한·영 병기 텍스트와 프로젝트 개요, 기관·참여자 정보를 정돈된 열 구조로 제시하고, 표지는 핑크 플로이드의 『The Dark Side of the Moon』과 모턴 워커 원서를 동시에 참조한 손 이미지와 스펙트럼 그래픽으로 구성된다. 후반부는 빨강, 노랑, 파랑, 보라 등 개별 색면이 펼침 전체를 지배하고, 하단에만 색의 효능 설명이 작게 배치되어 색 자체를 읽는 매체로 만든다.",summary:"경기도미술관 한뼘갤러리 프로젝트와 안산 단원보건소 설치 작업을 기록한 간행물. 앞부분은 SMSM의 보건소 프로젝트와 포스트-뮤지엄 담론, 설치 과정, 참여자 정보를 차분한 문서 구조로 정리하고, 후반부는 모턴 워커의 색채 치료 이론을 바탕으로 각 색의 효능만을 거의 정보 없이 색지와 짧은 텍스트로 제시해 독자가 자신의 몸 상태에 맞는 페이지를 선택하도록 만든다.",why_dim:"보건소 설치 프로젝트 기록, 이론 텍스트, 색상별 효능 페이지를 한 권 안에서 병치하면서도 휴대 가능한 소형 도록 형식을 유지하기 좋은 중형 판형",why_margin:"프로젝트 기록부와 색상 체험부가 서로 다른 독서 방식을 갖도록 앞부분은 문서적 여백을, 후반부는 색면 자체가 지면을 압도하도록 넓은 단색 공간을 확보해 보는 행위 자체를 체험으로 전환",why_font:"프로젝트 소개부와 색채 체험부의 성격이 크게 다르기 때문에, 전자는 중립적이고 공공기관 문서 같은 정보성을 유지하는 서체를, 후자는 앨범 커버와 색채 이론서의 대중적 인상을 환기하는 굵고 선명한 그래픽 서체를 사용해 두 층위의 성격을 분리한 것으로 보인다.",why_tracking:"초반부는 기록물의 판독성을 위해 중립적 리듬을 유지하고, 후반부는 색면과 짧은 효능 문구의 대비가 강하게 작동하도록 문자 개입을 최소화한 것으로 보인다.",layout_type:"본문 2단 + 주석 4단(각 1열)"},
  {g:"문학",pub_type:"전시도록",t:"이득영—테헤란",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/teheran-kr/",img:"202_이득영—테헤란",kw:["문학","전시도록","이득영","테헤란","앞면은","도로","건물","교차로가","이어지는","항공","견출고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬(한글), 우측 정렬(영어)",align_note:"-",f:{w:210,h:268},m:{상:32,하:10,안:10,밖:10},c:{구성:"3단",간격:5},b:{크기:10,행간:15,자간:0},ty:{이름:"SM 견출고딕 / 루트비히",분류:"고딕"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"10pt",subheading:"10pt",footnote:"-",특:"앞면은 도로, 건물, 교차로가 이어지는 항공 사진을 큰 면적으로 분절해 보여 주고, 뒷면은 에세이와 작품 정보, 제목을 회전·반전 배치해 접지 구조 자체를 읽도록 유도한다. 표지와 본문 일부에서 뒤집힌 방향성과 절반만 보이는 지구 이미지가 등장해 도시를 평면 지도이자 개념적 표면으로 다루는 태도를 강화한다.",summary:"서울 테헤란로를 공중 촬영해 이어 붙인 파노라마 작업을 중심으로 구성한 전시 연계 간행물. 작품 이미지를 여섯 번의 펼침으로 분절해 인쇄하고, 에세이와 작품 정보는 그 뒷면에 배치한 뒤 제본 없이 접지 상태로 마감해 독자가 직접 펼치고 이어 보며 작품의 축소판을 구성하도록 만든다.",why_dim:"공중 파노라마 이미지를 넓게 분절해 보여 주고, 접어서 보관했다가 펼쳐 직접 이어 볼 수 있는 구조를 만들기에 적합한 중형 판형",why_margin:"제본 없이 접지한 상태로 완성되는 구조이므로 앞뒤 면이 서로 다른 독서 방식을 갖도록 넓은 빈 공간과 단순한 정보 배치를 유지하고, 독자가 직접 펼침을 완성하는 행위가 읽기의 일부가 되게 구성",why_font:"파노라마 사진의 도시적 스케일과 접지 구조의 실험성을 함께 다루기 위해 구조적이고 단단한 제목용 고딕과, 에세이의 읽기 리듬을 유지하는 본문용 서체를 병용한 것으로 보인다.",why_tracking:"이미지가 중심인 간행물이므로 문자 개입을 절제하고, 에세이 부분도 구조와 방향 전환이 먼저 읽히도록 비교적 중립적인 리듬을 유지한 것으로 보인다.",layout_type:"본문 3단"},
  {g:"전시·큐레이션",pub_type:"전시도록",t:"플랫폼 서울 2008",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/platform-seoul-2008-catalog-kr/",img:"203_플랫폼 서울 2008",kw:["전시·큐레이션","전시도록","플랫폼","서울","2008","표지와","제목","면에서는","회전된","지구","이미지","윤고딕","윤명조"],align_title:"중앙 정렬",align_body:"양끝 정렬, 좌측 정렬",align_note:"좌측 정렬",f:{w:205,h:280},m:{상:10,하:9,안:15,밖:10},c:{구성:"9열",간격:0},b:{크기:8,행간:14.5,자간:0},ty:{이름:"윤고딕 / 윤명조 / 인터스테이트 / 플랑탱",분류:"혼합 (명조 / 고딕)"},pn:"중앙-중앙-세로",pn_x_left:"97.4mm",pn_y_left:"138.3mm",pn_x_right:"102.5mm",pn_y_right:"138.3mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"18pt",footnote:"7.5pt",특:"표지와 제목 면에서는 회전된 지구 이미지, 뒤집힌 제목, 큰 밑줄 표시가 등장해 방향 감각을 흔들고, 본문에서는 화살표, 정렬선, 세로 작가명, 좌우 대칭형 제목 배치가 반복된다. 비디오 프로그램과 작품 소개 면은 작은 도판과 캡션을 정교하게 분절하고, 어떤 면에서는 전시장 전경을 크게 보여 주면서도 가장자리의 그래픽 기호가 무대 지시처럼 개입한다.",summary:"서울 시내 여러 장소에 분산 개최된 연례 전시 ‘플랫폼 서울 2008’을 기록한 도록. 존 케이지의 『Silence』에서 발췌한 문장과 밑줄, 무대 지시를 연상시키는 화살표·정렬선·회전된 표제 요소를 반복 사용해 거리의 표지판과 공연의 큐시트를 결합한 듯한 읽기 구조를 만든다. 전시 주제인 퍼포먼스와 연극성, 이동성과 분산성을 편집 리듬 자체로 번역한 책이다.",why_dim:"다수의 전시 장소와 비디오 프로그램, 장문 비평, 도판, 공연적 구조를 함께 수용하면서도 도시 전시의 이동성과 표지판 같은 그래픽 리듬을 유지하기 좋은 중대형 판형",why_margin:"표지판·무대 지시·큐시트 같은 요소가 지면의 방향성과 리듬을 결정하도록 공백과 축을 크게 남기고, 작품 이미지와 비평문이 서로 다른 속도로 읽히게 만드는 여백 체계를 유지",why_font:"도시의 표지판, 공연의 지시 체계, 장문 비평문, 전시 캡션이 한 책 안에서 공존해야 하므로 공공적이고 구조적인 산세리프와 장문 독서용 세리프를 병용해 정보성과 연극성을 동시에 확보한 것으로 보인다.",why_tracking:"무대 지시 같은 그래픽 요소와 본문 텍스트가 충돌하지 않도록 기본 문자 리듬은 비교적 중립적으로 유지하고, 위계와 긴장은 회전·방향 전환·밑줄·배치로 만든 것으로 보인다.",layout_type:"본문 4-6열 가변 + 주석 2열 + 이미지 가변"},
  {g:"아트이론·비평",pub_type:"단행본",t:"인사서",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/the-book-of-greetings-kr/",img:"204_인사서",kw:["아트이론·비평","단행본","인사서","본문은","장관이나","기관장의","인사말만이","연속적으로","이어지며","어도비","캐즐런"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"-",f:{w:120,h:188},m:{상:15,하:32,안:20,밖:20},c:{구성:"1단",간격:0},b:{크기:13,행간:22,자간:0},ty:{이름:"어도비 캐즐런 / 윤명조",분류:"명조"},pn:"상단-중앙-가로",pn_x_left:"57mm",pn_y_left:"6.9mm",pn_x_right:"57mm",pn_y_right:"6.9mm",pn_size:"13pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"-",footnote:"-",특:"본문은 장관이나 기관장의 인사말만이 연속적으로 이어지며, 페이지 상단의 숫자와 작은 각주 표식이 문서적 리듬을 만든다. 화려한 도판이나 구분 장치 없이 유사한 문체의 텍스트가 누적되면서, 반복 자체가 비평적 장치가 되고 아카이브의 성격을 드러낸다.",summary:"1979년부터 2009년까지 아르코미술관 도록에 실린 인사말만을 모아 엮은 책. 장관, 위원장, 기관장의 관례적 서문을 시간 순으로 축적해 한국 문화행정 언어의 습관과 변화, 형식적 수사와 드물게 드러나는 개인적 어조를 읽어내게 만드는 편집 아카이브다.",why_dim:"짧은 인사말 텍스트를 연속적으로 읽게 하면서도 개인 문고본처럼 손에 잡히는 밀도와 제도 문서집의 응축된 인상을 동시에 주기 좋은 소형 판형",why_margin:"관례적 인사말의 반복을 장시간 읽도록 하기 위해 장식적 개입을 최소화하고, 짧은 서문 단위들이 조용히 이어지도록 차분한 여백과 안정적인 판면 호흡을 유지",why_font:"관례적 기관 서문의 보수적 문체와 책 전체의 문헌집 성격을 살리기 위해 고전적 세리프와 안정적인 명조 계열을 사용해 공문서와 교양서 사이의 어조를 유지한 것으로 보인다.",why_tracking:"유사한 길이와 문체의 인사말이 오랫동안 이어지는 구조이므로 독서 피로를 줄이기 위해 자극적 리듬보다 중립적이고 일정한 문자 흐름을 유지한 것으로 보인다.",layout_type:"본문 1단"},
  {g:"현대미술",pub_type:"단행본",t:"Sasa[44] 연차 보고서 2008",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/sasa-44-annual-report-2008-kr/",img:"205_Sasa[44] 연차 보고서 2008",kw:["현대미술","단행본","Sasa[44]","연차","보고서","2008","표지와","제목","면은","굵은","헬베티카","표제로"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:280,h:216},m:{상:17,하:16,안:8,밖:16},c:{구성:"4단",간격:0},b:{크기:8.5,행간:11,자간:0},ty:{이름:"헬베티카",분류:"고딕"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"8.5pt",subheading:"8.5pt",footnote:"8.5pt",특:"표지와 제목 면은 굵은 헬베티카 표제로 강한 선언성을 만들고, 본문에서는 월 이름을 크게 두고 각 항목을 비례가 다른 빈 사각형으로 표시한다. 후반부에는 한 해의 총합을 짧은 완결 문장으로 요약하고, 마지막 면에서는 여러 색 사각형이 중첩된 도형 배열로 데이터와 장식, 보고서와 포스터의 경계를 흐린다.",summary:"Sasa[44]의 2008년 소비와 이동, 관람, 구매, 통화, 대기 경험을 월별 데이터로 환산해 정리한 연차 보고서. 같은 해 출간된 작품집의 판형과 타이포그래피를 따르되, 지면 전체를 데이터 그래픽용 매트릭스로 전환해 월별 항목을 크기가 다른 사각형과 간결한 수치, 짧은 설명문으로 시각화한다.",why_dim:"작품집의 판형을 계승하면서도 연차 데이터 시각화에 필요한 매트릭스 구조를 안정적으로 펼치고, 월별 비교와 요약 문장을 한 눈에 읽게 하기 좋은 가로형 중형 판형",why_margin:"데이터 항목과 사각형 도식이 넓은 공백 속에서 독립적으로 읽히도록 간결한 배치를 유지하고, 숫자와 도형의 비례 관계가 시각적 사건으로 보이게 만드는 여백 구조를 취함",why_font:"수치와 설명문, 월별 표제를 최대한 중립적이고 명확하게 제시하면서도 작가의 자기 기록을 차갑게 분류하는 데이터 보고서의 어조를 만들기 위해 헬베티카를 사용한 것으로 보인다.",why_tracking:"숫자와 도형의 비례 관계가 중심이므로 문자 자체는 시각적 소음을 만들지 않도록 매우 중립적이고 압축된 리듬으로 운용된 것으로 보인다.",layout_type:"본문 4단(주석형)"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"페스티벌 봄 2009 매거진",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/festival-bom-2009-magazine-kr/",img:"206_페스티벌 봄 2009 매거진",kw:["아트이론·비평","잡지·저널","페스티벌","봄","2009","매거진","표지는","핑크색","바탕","위에","‘Festival’과","행사","미상"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"양끝 정렬",f:{w:240,h:360},m:{상:21,하:30,안:12,밖:23},c:{구성:"6단",간격:11},b:{크기:10,행간:17,자간:0},ty:{이름:"미상",분류:"명조"},pn:"하단-중앙-가로",pn_x_left:"122.6mm",pn_y_left:"340.1mm",pn_x_right:"110.4mm",pn_y_right:"340.1mm",pn_size:"17pt",pn_font:"명조",pn_style:"분홍 / 가로 / 숫자",running:"10pt",subheading:"19pt",footnote:"8pt",특:"표지는 핑크색 바탕 위에 ‘Festival’과 행사 정보가 규칙적으로 흩어진 배열로 이루어져 구체시의 생성 원리를 시각화한다. 내지에서는 기사마다 제목 배치와 이미지 점유율이 크게 달라지며, 어떤 면은 세로 제목과 작은 사진, 다른 면은 전면 사진과 긴 캡션, 또 다른 면은 반복된 동일 이미지와 넓은 공백을 사용한다. 잡지 전체가 통일된 템플릿보다 공연 프로그램의 다성성과 변칙성을 반영하는 편집 장치처럼 작동한다.",summary:"페스티벌 봄 2009의 공연 프로그램과 비평, 선언문, 이미지 자료를 담은 매거진. 표지는 고은의 구체시를 해석해 로고와 행사 정보를 반복 배열한 타이포그래피 장으로 구성하고, 내지는 기사 주제마다 판형 감각을 바꾸듯 각기 다른 배치와 사진 사용법을 적용해 공연예술의 실험성과 사건성을 지면 전체에 분산시킨다.",why_dim:"공연예술 페스티벌의 선언문, 평론, 프로그램, 사진을 잡지보다 크게 펼치고 기사별로 강한 시각적 전환을 만들기 좋은 대형 매거진 판형",why_margin:"기사별 성격이 크게 달라 하나의 통일 규칙보다 각 텍스트와 이미지가 독립적 사건처럼 보이도록 공백과 면 분할을 탄력적으로 운용하고, 공연적 긴장과 비상의 감각이 지면 전환마다 새로 발생하게 구성",why_font:"표지의 생성형 타이포그래피와 기사별로 달라지는 지면 성격을 고려하면, 기본 본문은 비교적 중립적으로 유지하되 제목과 구조 요소는 공연 포스터처럼 강하게 변주되는 방식으로 운용된 것으로 보인다.",why_tracking:"하나의 자간 규칙보다 기사별 성격에 따라 리듬이 달라지되, 전체적으로는 텍스트보다 배치와 반복, 방향 전환이 먼저 읽히도록 문자 운용이 조정된 것으로 보인다.",layout_type:"본문 2단 가변"},
  {g:"타이포그래피",pub_type:"전시도록",t:"킨로스, 현대 타이포그래피 (1992, 2004, 2009)",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/kinross-modern-typography-catalog-kr/",img:"207_킨로스, 현대 타이포그래피 (1992, 2004, 2009)",kw:["타이포그래피","전시도록","킨로스","현대","(1992","2004","2009)","표지는","실제","책보다","작은","안내장","크기로","HY","타자전각"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:210,h:297},m:{상:15,하:15,안:15,밖:15},c:{구성:"24열",간격:0},b:{크기:10,행간:17,자간:0},ty:{이름:"HY 타자전각 / 뉴트럴 / 모노타이프 타이프라이터 / 윤고딕",분류:"혼합 (명조 / 고딕)"},pn:"상단-좌측-세로",pn_x_left:"15mm",pn_y_left:"50mm",pn_x_right:"15mm",pn_y_right:"50mm",pn_size:"10.5pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"10.5pt",footnote:"7.5pt",특:"표지는 실제 책보다 작은 안내장 크기로 제작되어 도록 위에 임시로 붙은 부록처럼 보이며, 내지에서는 원서와 번역본 표지, 기사 지면, 서지 정보가 비교 대상처럼 나란히 놓인다. 전체적으로 전시 홍보물, 복사 자료, 타이포그래피 비평문이 한 권 안에서 겹쳐지며, ‘책을 다루는 전시를 다시 책으로 옮긴다’는 자기반영적 구조가 강하게 드러난다.",summary:"최성민의 개인전과 동명 연구 주제를 묶은 도록. 전시에서 다루는 단행본 표지를 참조한 작은 안내장형 표지를 A4 본문 위에 덧씌우고, 내지에서는 로빈 킨로스의 책 표지와 번역본, 관련 기사 지면, 타이포그래피 논의를 문헌 조사처럼 병렬 배치해 전시 도록과 연구 파일의 성격을 겹친다.",why_dim:"작은 안내장형 표지와 문헌 이미지, 기사 지면, 타이포그래피 분석 자료를 층위 있게 담아 전시 도록과 연구 문서의 이중 성격을 드러내기 좋은 A4 판형",why_margin:"책보다 작은 표지가 본문을 덮는 구조 자체가 도록의 개념이 되므로, 외피와 내지의 스케일 차이를 분명히 드러내고 문헌 복제 이미지가 조사 자료처럼 읽히도록 절제된 여백을 유지",why_font:"전시 안내장, 문헌 조사, 기사 스크랩, 서지 정보가 공존하는 구조이므로 타자기풍 서체와 중립적 산세리프를 병용해 연구 문서의 분위기와 전시 그래픽의 공공성을 동시에 드러낸 것으로 보인다.",why_tracking:"문헌 비교와 서지 정보의 위계가 중요하므로 문자 자체는 과장하지 않고, 조사 자료처럼 보이는 중립적 리듬과 메모 같은 건조함을 유지한 것으로 보인다.",layout_type:"본문 2, 3, 4단 가변"},
  {g:"타이포그래피",pub_type:"전시도록",t:"킨로스, 현대 타이포그래피 초판 13장 ‘보기’",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/kinross-modern-typography-first-edn-chapter-13-examples-kr/",img:"208_킨로스, 현대 타이포그래피 초판 13장 ‘보기’",kw:["타이포그래피","전시도록","킨로스","현대","초판","13장","‘보기’","표지는","탁한","연두색","위에","최소한의","제목과","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:210,h:297},m:{상:7,하:24,안:15,밖:12},c:{구성:"4단",간격:13},b:{크기:9,행간:14,자간:0},ty:{이름:"미상",분류:"고딕"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"14pt",subheading:"14pt",footnote:"14pt",특:"표지는 탁한 연두색 면 위에 최소한의 제목과 저자·역자 정보만 두어 부록 같은 인상을 만들고, 내지에서는 원서의 펼침 이미지를 크게 재현한 뒤 여백 위에 한국어 해설을 덧붙인다. 책 자체를 해설하는 책이라는 자기반영적 구조가 강하며, 전시 도록이라기보다 연구 번역물과 해제집에 가까운 형식으로 설계되어 있다.",summary:"로빈 킨로스의 『현대 타이포그래피』 초판 13장을 번역해 소개한 팸플릿. 개정판에서 크게 바뀐 장을 별도 소책자로 떼어내어, 초판에 실렸던 작품 사례와 논의가 어떻게 교체되고 갱신되었는지 드러내며, 전시와 연구 자료 사이의 중간 형식으로 기능한다.",why_dim:"전시장에서 배포·열람하기 쉬운 A4 팸플릿 형식으로, 원서의 사례 도판과 번역문, 해설을 연구 자료처럼 병치하기 적합한 판형",why_margin:"작은 팸플릿이 전시 문맥 속 연구 부록처럼 읽히도록 넓은 바탕과 절제된 정보 배치를 유지하고, 원서 이미지와 해설문이 조사 자료처럼 보이게 여백을 크게 남김",why_font:"번역문, 서지 정보, 해설, 원서 도판이 함께 들어가는 연구 팸플릿이므로 본문은 중립적이고 문헌적인 분위기를 유지하고, 표지는 제목과 정보만으로 간결하게 조직하는 방식이 사용된 것으로 보인다.",why_tracking:"타이포그래피 자체를 해설하는 자료이므로 문자의 개성보다 문헌적 명료성과 비교 독서가 우선되게끔 중립적인 문자 리듬이 유지된 것으로 보인다.",layout_type:"본문 2단 + 주석 4단"},
  {g:"타이포그래피",pub_type:"전시도록",t:"킨로스, 현대 타이포그래피 초판 12장 ‘현대주의와 현대성’",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/kinross-modern-typography-first-edn-chapter-12-kr/",img:"209_킨로스, 현대 타이포그래피 초판 12장 ‘현대주의와 현대성’",kw:["타이포그래피","전시도록","킨로스","현대","초판","12장","‘현대주의와","현대성’","표지는","탁한","연두색","위에","제목과","저자","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:180,h:240},m:{상:12,하:30,안:12,밖:12},c:{구성:"3단",간격:5},b:{크기:9,행간:17,자간:0},ty:{이름:"미상",분류:"혼합 (명조 / 고딕)"},pn:"상단-우측-가로",pn_x_left:"160.6mm",pn_y_left:"12mm",pn_x_right:"158.7mm",pn_y_right:"12mm",pn_size:"7.5pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"7pt",footnote:"7pt",특:"표지는 탁한 연두색 면 위에 제목과 저자·역자 정보만 작게 두어 전시 부록 같은 인상을 만들고, 내지는 본문을 차분히 연속 배치해 장 전체를 번역문으로 읽게 한다. 이미지보다 문단과 각주, 인용의 흐름이 중심이 되어 전시 도록이라기보다 해제 없는 번역 논문집이나 문헌 팸플릿에 가까운 인상을 준다.",summary:"로빈 킨로스의 『현대 타이포그래피』 초판에서 결론에 해당하는 장을 따로 번역한 팸플릿. 개정판에서 크게 수정된 장을 별도 출판물로 분리해, 현대주의와 현대성에 대한 킨로스의 초기 문제의식과 이후 개정판 사이의 차이를 비교 가능한 문헌으로 제시한다.",why_dim:"결론 성격의 긴 이론 텍스트를 소책자처럼 집중해서 읽히게 하면서도 전시장에서 배포·열람하기 좋은 연구 팸플릿 형식에 적합한 중형 판형",why_margin:"텍스트 중심의 연구 팸플릿이므로 시각적 장식보다 문헌성과 읽기 집중도를 우선하고, 전시 연계 부록처럼 보이도록 여백을 절제해 단정한 학술 문서의 분위기를 유지",why_font:"긴 이론 문장을 번역해 싣는 연구 팸플릿이므로 본문은 학술 문헌의 안정성과 판독성을 우선하는 서체를 사용하고, 표지 역시 정보만 남기는 건조한 구성으로 처리한 것으로 보인다.",why_tracking:"결론 장의 논지를 끊김 없이 따라가게 하기 위해 문자 리듬은 과장 없이 일정하게 유지되고, 위계 역시 표지의 최소한 정보와 본문의 문단 구조 안에서 해결된 것으로 보인다.",layout_type:"본문 1단(2열) + 주석 3단(1열)"},
  {g:"인문·사회",pub_type:"단행본",t:"현대 타이포그래피—비판적 역사 에세이",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/modern-typography-kr/",img:"210_현대 타이포그래피—비판적 역사 에세이",kw:["인문·사회","단행본","현대","타이포그래피","비판적","역사","에세이","짙은","녹색","표지","위에","검은","막대와","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:135,h:216},m:{상:14,하:36,안:18,밖:18},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:20},ty:{이름:"미상",분류:"혼합 (명조 / 고딕)"},pn:"하단-우측-가로",pn_x_left:"104mm",pn_y_left:"188.1mm",pn_x_right:"105mm",pn_y_right:"188.1mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"11pt",subheading:"11pt",footnote:"7.5pt",특:"짙은 녹색 표지 위에 검은 막대와 노란 제목 정보를 배치해 초판의 반항적 표면을 환기하고, 내지에서는 단일 컬럼 중심의 장문 본문 사이에 사료 도판과 회전된 캡션, 비교용 이미지가 삽입된다. 전반적으로 이론서의 차분한 리듬을 유지하면서도 표지와 일부 도판 배치에서 역사 서술의 비판적 태도를 시각적으로 강조한다.",summary:"1700년 이후 서구 타이포그래피 역사를 개괄하며, ‘현대’를 단순한 양식이 아니라 더 넓은 사회적·기술적·물질적 조건 속에서 이해하려는 로빈 킨로스의 대표 저작 한국어판. 실기에 대한 설명과 원리를 둘러싼 논쟁, 드물게 촬영된 사료 도판, 풍부한 참고 자료를 통해 현대 타이포그래피를 비판적으로 다시 읽게 만든다. 한국어판은 개정판의 구조를 느슨히 따르면서도 초판 표지의 반항적 기운을 되살린다.",why_dim:"장문 역사 서술과 도판, 주석, 참고 자료를 안정적으로 수용하면서도 연구서와 번역서의 밀도 높은 독서를 지속할 수 있는 중형 판형",why_margin:"장문 본문과 도판, 참고 자료가 공존하는 학술적 독서 구조를 안정적으로 유지하고, 표지에서는 초판의 시각적 반항성을 비교적 강하게 드러내도록 구성",why_font:"역사 서술과 비평, 참고 자료, 도판을 함께 담는 연구서이므로 본문은 판독성과 지속 독서를 우선하는 문헌적 서체를 사용하고, 표지에서는 초판의 반항적 정서를 환기하는 단순하고 강한 그래픽 처리가 이루어진 것으로 보인다.",why_tracking:"장문 번역 텍스트의 안정적 독서를 최우선으로 두되, 도판과 캡션, 참고 자료가 과도하게 튀지 않도록 중립적 문자 리듬이 유지된 것으로 보인다.",layout_type:"본문 1단"},
  {g:"현대미술",pub_type:"실험출판",t:"에스케이모마 하이라이트—350‌점의 서울 한국현대미술관 컬렉션",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/skmoma-highlights-kr/",img:"211_에스케이모마 하이라이트—350‌점의 서울 한국현대미술관 컬렉션",kw:["현대미술","실험출판","에스케이모마","하이라이트","350‌점의","서울","한국현대미술관","컬렉션","정통","미술관","소장품","도록처럼","작품","벰보","윤명조"],align_title:"-",align_body:"-",align_note:"좌측 정렬",f:{w:144,h:240},m:{상:23,하:23,안:15,밖:15},c:{구성:"2단",간격:7},b:{크기:8,행간:15,자간:0},ty:{이름:"벰보 / 윤명조",분류:"명조"},pn:"상하단-외측-가로",pn_x_left:"15.1mm",pn_y_left:"9.3mm, 228.1mm",pn_x_right:"124.3mm",pn_y_right:"9.6mm, 228.4mm",pn_size:"7pt",pn_font:"혼합 (명조 / 고딕)",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"-",footnote:"8pt",특:"내지는 정통 미술관 소장품 도록처럼 작품 이미지와 작가명, 재료, 크기, 연도를 조용히 배열하지만, 여러 페이지에서 이미지 자리 전체를 짙은 검은 사각형이나 원형이 대신 점유한다. 이 결손된 자리표시는 ‘가짜 미술관’ 설정을 시각적으로 밀어붙이며, 마지막 표지에서도 실제 이미지를 지운 검은 블록만 남겨 카탈로그의 재현 규칙을 패러디한다.",summary:"존재하지 않는 가상 미술관 ‘서울 한국현대미술관’의 소장품 안내서를 가장한 책. 온라인 상품 소개 문체를 비틀어 한국 현대미술의 계보와 제도, 모더니티, 전시 언어를 패러디하며, 고희동에서 최병일에 이르는 작품 이미지를 ‘컬렉션 하이라이트’ 형식으로 배열한다. 검은 색면 블록은 실제 작품 이미지가 있어야 할 자리를 대체해, 미술관 카탈로그의 권위와 재현 체계를 동시에 비워내는 장치로 작동한다.",why_dim:"방대한 가상 컬렉션을 목록형으로 수록하면서도 문고본보다 길고 슬림한 비례를 통해 미술관 안내서와 카탈로그 사이의 어정쩡한 형식을 강조하기 좋은 판형",why_margin:"작품 이미지와 캡션, 목록성 정보가 차분한 카탈로그 리듬으로 이어지되, 검은 공백 블록이 반복적으로 개입해 부재와 허구를 체감하게 하는 방향으로 여백과 빈 면을 적극 사용",why_font:"정통 미술관 도록의 고전적 권위와 학술적 톤을 흉내 내기 위해 전통적 세리프 계열과 명조 계열을 사용해 카탈로그 문체의 제도성을 강화한 것으로 보인다.",why_tracking:"패러디의 핵심이 이미지 결손과 서술 방식에 있으므로, 문자는 과장하기보다 보수적이고 품위 있는 리듬을 유지해 오히려 허구의 설정이 더 설득력 있게 보이도록 구성한 것으로 보인다.",layout_type:"본문 2단"},
  {g:"인문·사회",pub_type:"단행본",t:"디자인 멜랑콜리아",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/design-melancholia-kr/",img:"212_디자인 멜랑콜리아",kw:["인문·사회","단행본","디자인","멜랑콜리아","단일","컬럼","중심의","문단과","각주","미상"],align_title:"좌측 정렬(대제), 우측 정렬(소제)",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:152,h:210},m:{상:19,하:26,안:24,밖:12},c:{구성:"1단",간격:0},b:{크기:9.5,행간:17,자간:0},ty:{이름:"미상",분류:"명조"},pn:"상단-외측-가로(좌) / 하단-외측-가로(우)",pn_x_left:"32mm",pn_y_left:"18.8mm",pn_x_right:"116.3mm",pn_y_right:"181.5mm",pn_size:"8pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"7pt",subheading:"13pt",footnote:"6.5pt",특:"내지는 단일 컬럼 중심의 긴 문단과 각주, 인용, 소제목이 질서 있게 이어지는 전형적 비평서 구조를 취한다. 화면처럼 보이는 표면의 매끈함보다 문장과 논리의 누적이 중심이지만, 표지에서는 『모노클』 페이지를 과장되게 확대해 망점과 인쇄 물질성을 전면화함으로써 책의 비판 대상과 방법론을 시각적으로 압축한다.",summary:"서동진이 디자인을 둘러싼 자본주의적 욕망, 창의성 담론, 노동, 신자유주의의 정동 구조를 비판적으로 분석한 이론서. 표지에는 책의 주요 참조 대상 중 하나인 잡지 『모노클』의 한 페이지를 인쇄 망점이 드러날 정도로 확대해 사용함으로써, 매끈한 라이프스타일 매체의 표면을 비평의 대상으로 다시 드러내고 해체하는 제스처를 취한다.",why_dim:"장문 비평문과 주석, 참고 논의가 안정적으로 이어지면서도 일반 교양서보다 약간 응축된 밀도를 유지하기 좋은 중형 판형",why_margin:"장문 비평 텍스트와 각주가 차분하게 누적되도록 안정적인 판면 호흡을 유지하고, 표지에서는 확대된 인쇄 망점의 물질감이 즉각 인지되도록 비교적 절제된 구성 안에 강한 표면 효과를 남김",why_font:"비평서의 장문 독서를 안정적으로 지탱할 수 있는 본문용 서체를 중심으로 구성하고, 표지에서는 망점 확대 이미지가 시각적 개념을 대신 수행하도록 문자 개입을 절제한 것으로 보인다.",why_tracking:"텍스트 중심 비평서이므로 문자의 리듬은 과장되지 않고 일정하게 유지되며, 논지 전개와 비평적 톤이 흐트러지지 않도록 중립적 운용이 우선된 것으로 보인다.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"단행본",t:"인터페이스 연대기",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/interface-chronology-kr/",img:"213_인터페이스 연대기",kw:["인문·사회","단행본","인터페이스","연대기","표지는","붉은","바탕","위에","해상도","테스트","미상"],align_title:"좌측 정렬(대제), 우측 정렬(소제)",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:152,h:200},m:{상:19,하:16,안:24,밖:12},c:{구성:"6단",간격:4},b:{크기:8.5,행간:17,자간:10},ty:{이름:"미상",분류:"혼합 (명조 / 고딕)"},pn:"상단-외측-가로(좌) / 하단-외측-가로(우)",pn_x_left:"32mm",pn_y_left:"18.8mm",pn_x_right:"116.3mm",pn_y_right:"181.5mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"19pt",footnote:"7pt",특:"표지는 붉은 바탕 위에 해상도 테스트 차트, 숫자, 선묶음, 검은 도형, 흰 제목을 과밀하게 겹쳐 배치해 인터페이스와 측정 장치의 시각 언어를 직접 인용한다. 반면 내지는 긴 본문과 소제목, 인용, 각주, 사진 도판을 차분하게 정리해 비평서의 독서 리듬을 유지하며, 과도한 표지와 절제된 본문 사이의 온도 차가 책의 주제를 더욱 선명하게 만든다.",summary:"디자인과 테크놀로지가 현실 경험을 어떻게 조직하고 변형해 왔는지를 추적하는 이론서. 전쟁, 정보 처리, 인터페이스, 시각 문화의 역사를 비평적으로 엮으며, 표지에는 디지털카메라 해상도 시험용 도표 패턴을 차용해 측정·판독·인터페이스의 문제를 한 장의 그래픽으로 압축한다.",why_dim:"장문 비평문과 도판, 각주, 참고 문헌을 안정적으로 수용하면서도 지나치게 학술서적으로 무겁지 않은 읽기 경험을 만드는 중형 판형",why_margin:"비평 텍스트와 도판, 각주가 서로 간섭하지 않도록 안정적인 판면 질서를 유지하되, 표지에서는 계측 도표의 긴장감이 즉각 드러나도록 강한 대비와 패턴을 전면화",why_font:"장문 비평서의 안정적 독서를 지탱하는 본문용 서체를 기본으로 하되, 표지에서는 계측과 판독, 기술 인터페이스의 공격적 시각 언어를 강조하는 강한 제목 처리가 사용된 것으로 보인다.",why_tracking:"본문은 논지 전개와 각주 읽기에 방해되지 않도록 중립적인 문자 리듬을 유지하고, 시각적 긴장은 자간보다 표지의 밀도와 도형 배치에서 형성되도록 운용된 것으로 보인다.",layout_type:"본문 1단 + 주석 2단(각 3열) + 각주 3단(각 2열)"},
  {g:"문학",pub_type:"단행본",t:"햄릿",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/hamlet-kr/",img:"214_햄릿",kw:["문학","단행본","햄릿","등장인물","이름","대사","주석","번호","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬, 우측 정렬(일부)",align_note:"좌측 정렬",f:{w:170,h:255},m:{상:17,하:25,안:14,밖:14},c:{구성:"2단",간격:2},b:{크기:8.5,행간:14,자간:0},ty:{이름:"미상",분류:"고딕"},pn:"하단-중앙-가로",pn_x_left:"82mm",pn_y_left:"237mm",pn_x_right:"82mm",pn_y_right:"237mm",pn_size:"7pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"7pt",footnote:"7pt",특:"내지는 등장인물 이름, 대사, 주석 번호, 행 번호가 파랑과 주황 등의 색으로 체계적으로 구분되며, 마치 전화번호부나 데이터 시트처럼 보일 정도로 텍스트가 구조화된다. 본문 정렬과 들여쓰기, 숫자 배치가 내용 해석보다 정보 분류를 우선하며, 고전 희곡을 문학 텍스트이자 시각적 데이터베이스로 전환하는 급진적 편집 태도가 두드러진다.",summary:"민음사 세계문학전집 100호 출간 기념 특별판 가운데 한 권으로, 셰익스피어의 『햄릿』을 역사적 배경보다 텍스트의 구조와 데이터성에 집중해 다시 디자인한 책. 등장인물명, 대사, 주석, 행 번호, 장면 구분을 산세리프 활자와 들여짜기, 색 코딩, 정렬 규칙으로 체계화해, 고전을 해석하기보다 텍스트를 정보 구조로 읽게 만든다.",why_dim:"희곡의 대사 구조, 주석, 행 번호, 인물별 구분을 층위 있게 담아내면서도 세계문학전집 특별판으로서 책의 밀도와 소장성을 유지하기 좋은 세로형 중형 판형",why_margin:"대사와 주석, 행 번호가 서로 충돌하지 않도록 정보 구조를 명확히 분리하고, 여백 역시 감상적 분위기보다 텍스트의 데이터적 배열과 색상 구분이 잘 드러나도록 절제해 사용",why_font:"희곡의 발화 구조와 주석 체계를 감정적 문학 장치보다 정보 구조로 읽게 하기 위해 중립적이고 체계적인 산세리프 중심 구성을 택한 것으로 보이며, 색과 정렬을 통해 의미보다 관계를 먼저 드러내도록 설계된 것으로 보인다.",why_tracking:"텍스트를 전화번호부처럼 취급한다는 원칙에 맞춰 자간과 리듬 역시 표현적이지 않고 데이터 정렬에 가까운 중립적 운용을 따른 것으로 보인다.",layout_type:"본문 2단"},
  {g:"현대미술",pub_type:"전시도록",t:"Sasa[44]—전시 작업, 연대순",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/sasa-kukje-mono-kr/",img:"215_Sasa[44]—전시 작업, 연대순",kw:["현대미술","전시도록","Sasa[44]","전시","작업","연대순","표지는","작가명과","제목을","산세리프로","명확히","제시하고","윤고딕","헬베티카"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:280,h:216},m:{상:16,하:16,안:16,밖:16},c:{구성:"4단",간격:7},b:{크기:8.5,행간:11,자간:0},ty:{이름:"윤고딕 / 헬베티카",분류:"고딕"},pn:"상단-중앙우측-가로",pn_x_left:"195.1mm",pn_y_left:"15.6mm",pn_x_right:"195.1mm",pn_y_right:"15.6mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8.5pt",subheading:"8.5pt",footnote:"8.5pt",특:"표지는 작가명과 책 제목을 큰 산세리프로 명확히 제시하고, 내지에서는 작품을 연대순으로 배열하되 가로형 판형 안에서 이미지와 캡션이 넓게 펼쳐진다. 전시 전경과 공동 작업 면에서는 정사각형에 가까운 공통 영역이 두 권 사이의 구조적 연결고리로 작동하며, 박미나 책과의 대응 관계 자체가 책의 개념이 된다.",summary:"국제갤러리에서 열린 박미나와 Sasa[44]의 공동 전시에 맞춰 제작된 Sasa[44]의 작품집. 박미나의 책과 동일한 페이지 비례와 그리드 체계를 공유하지만, 이 책은 가로형 판형과 연대순 배열을 택해 짝을 이루는 구조를 만든다. 두 작가의 공동 작업은 두 책 모두에 같은 배열로 실리고, 이때 본문은 공통의 정사각형 영역을 차지해 두 권이 서로를 반사하는 한 쌍의 시스템처럼 읽히게 한다.",why_dim:"박미나의 세로형 작품집과 동일한 그리드를 공유하면서도, 자신의 작업을 연대순으로 펼쳐 보이기 위해 가로형 비례를 취해 두 권이 짝을 이루는 관계를 분명히 드러내기 좋은 판형",why_margin:"짝을 이루는 다른 책과의 구조적 대응이 중요하므로, 공통의 정사각형 본문 영역이 안정적으로 유지되도록 여백과 이미지 배치를 통제하고, 공동 작업에서는 두 책이 같은 공간 질서를 공유하도록 설계",why_font:"두 작가의 책이 하나의 시스템처럼 읽혀야 하므로 중립적이고 구조적인 산세리프를 사용해 캡션, 날짜, 작품 정보, 제목이 과도한 개성 없이 정렬되고, 두 권 사이의 대응 관계가 더 선명하게 드러나도록 한 것으로 보인다.",why_tracking:"연대순 배열과 캡션 체계, 짝을 이루는 다른 책과의 구조 대응이 핵심이므로 문자 운용 역시 표현보다 질서와 비교 가능성을 우선하는 중립적 리듬을 따른 것으로 보인다.",layout_type:"본문 4단"},
  {g:"현대미술",pub_type:"전시도록",t:"박미나—딩뱃 회화와 기타 작업, 역연대순",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/meena-park-kukje-mono-kr/",img:"216_박미나—딩뱃 회화와 기타 작업, 역연대순",kw:["현대미술","전시도록","박미나","딩뱃","회화와","기타","작업","역연대순","표지는","작가명과","제목을","산세리프로","명확히","제시하고","윤고딕","헬베티카"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:216,h:280},m:{상:16,하:81,안:16,밖:16},c:{구성:"3단",간격:8},b:{크기:8.5,행간:11,자간:0},ty:{이름:"윤고딕 / 헬베티카",분류:"고딕"},pn:"상단-우측-가로",pn_x_left:"196.9mm",pn_y_left:"15.5mm",pn_x_right:"197.05mm",pn_y_right:"15.5mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8.5pt",subheading:"8.5pt",footnote:"8.5pt",특:"표지는 작가명과 제목을 큰 산세리프로 명확히 제시하고, 내지에서는 박미나의 딩뱃 회화를 역연대순으로 배치한다. 회화가 세로형 판형 안에서 넓고 평평한 색면으로 펼쳐지고, 공동 전시 장면이나 협업 작업에서는 Sasa[44] 책과 동일한 정사각형 이미지 영역이 반복되어 두 권이 서로의 거울처럼 작동한다.",summary:"국제갤러리에서 열린 박미나와 Sasa[44]의 공동 전시에 맞춰 제작된 박미나의 작품집. Sasa[44] 책과 동일한 페이지 비례와 그리드 체계를 공유하지만, 이 책은 세로형 판형과 역연대순 배열을 택해 짝을 이루는 관계를 만든다. 두 작가의 공동 작업은 두 권에 동일한 배열로 실리고, 그때 본문은 두 판형이 공유하는 정사각형 영역을 차지해 서로 다른 책이 하나의 시스템처럼 읽히게 한다.",why_dim:"Sasa[44]의 가로형 책과 정확히 대응하는 비례를 유지하면서도, 박미나의 세로형 회화 작업과 역연대순 배열을 더 자연스럽게 수용하기 좋은 세로형 판형",why_margin:"짝을 이루는 다른 책과 동일한 그리드와 정사각형 본문 영역을 유지해 두 권의 구조적 대응을 분명히 하고, 회화 이미지가 안정적으로 자리 잡으면서도 공동 작업에서는 같은 공간 원리가 반복되도록 설계",why_font:"두 권이 한 쌍의 시스템처럼 읽혀야 하므로 중립적이고 구조적인 산세리프를 사용해 제목, 캡션, 날짜, 작품 정보를 정렬하고, 박미나의 이미지 자체가 시각적 중심이 되도록 문자는 절제한 것으로 보인다.",why_tracking:"역연대순 배열과 짝을 이루는 다른 책과의 구조 대응이 핵심이므로, 문자 운용 역시 개성보다 질서와 비교 가능성을 우선하는 중립적 리듬을 따른 것으로 보인다.",layout_type:"본문 3단 + 그림 가변"},
  {g:"현대미술",pub_type:"기관출판",t:"나우 점프—스테이션 2",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/now-jump-performing-arts-program-kr/",img:"217_나우 점프—스테이션 2",kw:["현대미술","기관출판","나우","점프","스테이션","2","표지는","강한","적색","바탕","위에","변형된","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:112,h:148},m:{상:5,하:6,안:16,밖:30},c:{구성:"1단",간격:0},b:{크기:8.5,행간:13,자간:0},ty:{이름:"미상",분류:"고딕"},pn:"상단-외측-가로",pn_x_left:"6.2mm",pn_y_left:"5.4mm",pn_x_right:"102.6mm",pn_y_right:"5.4mm",pn_size:"7.5pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"8.5pt",footnote:"6.5pt",특:"표지는 강한 적색 바탕 위에 변형된 N, J, P 글자가 얽히듯 커다랗게 배치되어 페스티벌의 약자를 시각적 상징으로 만든다. 내지에서는 공연별 사진과 텍스트가 비교적 절제된 판면 안에 놓이지만, 제목은 여전히 세로로 압축된 검은 대문자 활자로 처리되어 포스터와 프로그램 북 사이의 긴장을 만든다.",summary:"백남준아트센터 개관 페스티벌의 공연예술 프로그램을 소개하는 소형 안내서. 페스티벌 이름 속에 우연히 숨어 있는 백남준의 영문 머리글자 N, J, P를 전용 타이포그래피로 변형해 표지와 내지의 핵심 그래픽으로 삼고, 공연별 소개와 설치 사진, 일정 정보를 컴팩트하게 배치해 행사 현장에서 즉시 사용되는 프로그램 북의 성격을 강조한다.",why_dim:"행사 현장에서 휴대와 열람이 쉬운 A6 크기로, 공연 일정과 작품 설명, 장소 정보를 빠르게 탐색하는 프로그램 북 형식에 적합한 판형",why_margin:"작은 판형 안에서 공연명, 일정, 장소, 이미지가 즉시 식별되도록 정보 배치를 간결하게 유지하고, 전용 제목 활자가 책 전체의 리듬과 표지의 에너지를 주도하도록 구성",why_font:"행사명에 숨어 있는 N, J, P를 시각적 정체성의 핵심으로 만들기 위해 강하게 압축된 산세리프를 변형해 전용 활자처럼 운용하고, 내지 역시 프로그램 정보의 즉시성과 포스터적 존재감을 함께 확보한 것으로 보인다.",why_tracking:"작은 판형에서 공연 정보가 빠르게 읽혀야 하므로 본문은 중립적 리듬을 유지하되, 제목 활자만 강한 압축과 변형으로 정체성을 전면화한 것으로 보인다.",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"기관출판",t:"나우 점프",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/now-jump-guidebooks-kr/",img:"218_나우 점프",kw:["아트이론·비평","기관출판","나우","점프","권은","서로","다른","성격의","자료를","담지만","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:111,h:147},m:{상:6,하:9,안:6,밖:6},c:{구성:"30열",간격:0},b:{크기:6,행간:8,자간:0},ty:{이름:"미상",분류:"고딕"},pn:"상단-외측-가로",pn_x_left:"3.8mm",pn_y_left:"5.7mm",pn_x_right:"103mm",pn_y_right:"5.7mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"6pt",footnote:"6.5pt",특:"각 권은 서로 다른 성격의 자료를 담지만 표지와 제목 체계는 동일한 전용 활자를 공유해 시리즈로 묶인다. 내지에서는 작가별 텍스트와 전시 사진, 아카이브 이미지, 설명문이 비교적 절제된 그리드 안에 놓이고, 어떤 권은 인물 중심, 어떤 권은 작품 중심, 또 어떤 권은 사료 중심으로 편집되어 세트 전체가 페스티벌의 다층적 지도를 이룬다.",summary:"백남준아트센터 개관 페스티벌을 위해 제작된 4권짜리 안내서 세트. 전시, 공연, 인물, 아카이브 등 서로 다른 정보 층위를 각각 독립된 소책자로 나누어 담고, 페스티벌 이름 속에 우연히 숨어 있는 N, J, P를 변형한 전용 타이포그래피를 시리즈 전체의 정체성으로 사용한다. 책마다 분량과 기능이 다르지만 같은 그래픽 언어를 공유해, 개관 페스티벌 전체를 하나의 이동형 정보 시스템처럼 읽게 만든다.",why_dim:"전시 안내, 아카이브, 인물 정보, 프로그램을 한 권에 과밀하게 넣는 대신 여러 권의 소형 책으로 분리해 휴대성과 탐색성을 높이고, 행사 현장에서 선택적으로 참조하기 좋은 세트 구성을 만들기 위한 판형",why_margin:"각 권이 서로 다른 정보량과 기능을 가지면서도 현장에서 빠르게 펼쳐 보고 비교할 수 있도록 판면을 간결하게 유지하고, 시리즈 전체가 하나의 안내 체계로 인지되도록 공통 그래픽 리듬을 유지",why_font:"페스티벌 이름에서 추출한 N, J, P를 시리즈 아이덴티티의 핵심으로 삼기 위해 강하게 압축된 산세리프 계열을 변형한 전용 제목 활자를 사용하고, 본문은 각 권의 정보 기능에 맞춰 비교적 중립적으로 조직한 것으로 보인다.",why_tracking:"여러 권이 하나의 시스템으로 묶여 읽혀야 하므로 표지와 제목에서는 강한 통일감을 만들고, 본문은 각 권의 자료 성격에 맞게 중립적 리듬으로 운용한 것으로 보인다.",layout_type:"주석 3단"},
  {g:"인문·사회",pub_type:"잡지·저널",t:"판 3호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/pan-3-kr/",img:"219_판 3호",kw:["인문·사회","잡지·저널","판","3호","장문","비평문","인터뷰","다큐멘터리","사진","미상"],align_title:"좌측 정렬, 우측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:210,h:285},m:{상:5,하:10,안:15,밖:20},c:{구성:"12단",간격:5},b:{크기:9,행간:14,자간:0},ty:{이름:"미상",분류:"혼합 (명조 / 고딕)"},pn:"중앙상단-외측-세로",pn_x_left:"8.3mm",pn_y_left:"45.6mm",pn_x_right:"198.3mm",pn_y_right:"45.6mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"50pt",footnote:"8pt",특:"내지는 장문 비평문, 인터뷰, 다큐멘터리 사진, 공연 장면, 캡션을 기사별로 다르게 배치한다. 어떤 면은 큰 사진이 판면 대부분을 차지하고, 다른 면은 긴 텍스트와 소제목, 세로 면주가 정보 구조를 만든다. 상단의 가는 규칙선과 가장자리 세로 텍스트가 반복되어 서로 다른 기사들을 하나의 잡지 체계 안에 묶어 준다.",summary:"공연예술네트워크 판이 발행한 매거진 3호. 공연예술을 둘러싼 비평, 인터뷰, 현장 기록, 사진 자료를 묶은 잡지로, 기사마다 판면의 비중과 이미지 사용 밀도를 다르게 조절해 공연 담론과 동시대 사회 이슈가 교차하는 장을 만든다. 표지에 중철한 형식과 다양한 흑백·컬러 사진의 병치는 현장성, 기록성, 담론성을 함께 강조한다.",why_dim:"공연예술 관련 긴 글과 인터뷰, 현장 사진, 캡션, 세로 방향 정보 등을 함께 담으면서 잡지적 리듬과 시각적 호흡을 확보하기 좋은 중대형 판형",why_margin:"기사별로 텍스트와 이미지의 비중이 크게 달라지므로 각 글의 성격에 따라 공백과 판면 밀도를 달리하고, 세로 정보와 가는 구분선이 잡지 전체의 리듬을 느슨하게 통일하도록 구성",why_font:"공연예술 담론과 현장 기록, 인터뷰, 사진 캡션이 한 잡지 안에서 공존해야 하므로 본문은 비교적 중립적이고 판독성 높은 서체를 사용하고, 제목과 세로 면주는 잡지의 방향성과 구조를 드러내는 방식으로 운용한 것으로 보인다.",why_tracking:"기사 성격이 다양하므로 문자 운용은 과도한 개성보다 유연한 정보 정리와 판면 간 균형을 우선하며, 긴 글과 캡션이 함께 읽히는 중립적 리듬을 유지한 것으로 보인다.",layout_type:"본문 2단(각 5열) + 주석 4단(각 3열)"},
  {g:"아트이론·비평",pub_type:"단행본",t:"불공평하고 불완전한 네덜란드 디자인 여행",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/dutch-design-tour-kr/",img:"220_불공평하고 불완전한 네덜란드 디자인 여행",kw:["아트이론·비평","단행본","불공평하고","불완전한","네덜란드","디자인","여행","본문은","장문","서술과","비평적","소제목이","차분하게","미상"],align_title:"중앙 정렬",align_body:"좌측 정렬, 우측 정렬(일부)",align_note:"좌측 정렬",f:{w:153,h:210},m:{상:0,하:0,안:0,밖:0},c:{구성:"1, 2단",간격:5},b:{크기:9,행간:17,자간:0},ty:{이름:"미상",분류:"혼합 (명조 / 고딕)"},pn:"하단-우측-가로",pn_x_left:"117.7mm",pn_y_left:"196.1mm",pn_x_right:"125.8mm",pn_y_right:"196.1mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"17pt",footnote:"7pt",특:"본문은 장문 서술과 비평적 소제목이 차분하게 이어지는 구조를 가지지만, 중간중간 여행 중 촬영한 스냅 사진이 위아래로 뒤집혀 삽입되어 정돈된 논의 흐름을 의도적으로 흔든다. 표지와 첫 면의 이미지 인용은 네덜란드 디자인 신화에 대한 거리 두기와 오해, 번역, 재해석의 문제를 책의 입구에서부터 드러내며, 말미에는 저자들이 직접 만든 문자 도판과 시각 실험이 등장해 여행기와 디자인 연구가 겹쳐진다.",summary:"네덜란드 체류 중 남긴 메모, 재방문 기록, 외부자의 시선에서 본 네덜란드 디자인 문화 비평을 뒤섞은 책. 앞표지와 첫 페이지에는 바르바라 피서르의 작업 이미지와, 베르크플라츠 티포흐라피가 디자인한 우표 이미지를 배치해 책의 핵심 참조점을 드러낸다. 본문 중간에 삽입된 여행 스냅 사진들은 위아래를 뒤집어 인쇄되어, 계산된 논의와 우연한 관찰 사이의 간극을 시각적으로 강조한다.",why_dim:"장문 여행기와 디자인 비평, 참조 이미지, 스냅 사진을 함께 담으면서도 일반 교양서와 연구서 사이의 응축된 독서 밀도를 유지하기 좋은 중형 판형",why_margin:"텍스트 중심의 비평 구조를 안정적으로 유지하되, 삽입 이미지와 뒤집힌 스냅 사진이 갑작스러운 시각적 중단과 전환을 만들도록 공백과 판면 규칙을 느슨하게 조절",why_font:"여행기와 비평서, 참조 이미지와 도판 실험이 한 권 안에서 공존해야 하므로 본문은 비교적 중립적이고 지속 독서에 적합한 서체를 사용하고, 일부 시각 실험 면에서는 문자와 도형이 비평 대상 자체가 되도록 운용한 것으로 보인다.",why_tracking:"계산된 논의와 우연한 스냅, 인용 이미지 사이의 대비가 핵심이므로 자간과 리듬은 대체로 절제되어 있고, 시각적 긴장은 배치와 방향 전환, 이미지 개입을 통해 형성된 것으로 보인다.",layout_type:"본문 1단 + 사진/주석 2단"},
  {g:"건축·공간",pub_type:"단행본",t:"오토 멜랑콜리아",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/auto-melancholia-cd-kr/",img:"221_오토 멜랑콜리아",kw:["건축·공간","단행본","오토","멜랑콜리아","중철","인쇄물의","내지에서는","좌우","면에","노랫말이나","미상"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"-",f:{w:120,h:120},m:{상:22,하:6,안:6,밖:6},c:{구성:"2단",간격:4},b:{크기:7.5,행간:12,자간:0},ty:{이름:"미상",분류:"명조"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"7pt",subheading:"12pt",footnote:"-",특:"중철 인쇄물의 내지에서는 좌우 면에 노랫말이나 짧은 텍스트가 조용히 병치되고, 표면 이미지는 석양 하늘과 자동차 실루엣을 담아 멜랑콜리한 감정을 직접 호출한다. CD 슬리브와 케이스는 음반 패키지의 익숙한 형식을 따르지만, 전시장 설치와 결합되면서 단순한 음반이 아니라 관객의 청취 행위를 전시 경험으로 바꾸는 장치가 된다.",summary:"대안공간 풀에서 열린 Sasa[44] 개인전에 맞춰 제작된 오디오 CD와 인쇄물 세트. Sasa[44]가 선곡한 감상적 가요가 담긴 CD는 전시장 안 실제 크기 자동차 모형 내부에서 재생되었고, 관객은 한 시간에 한 명씩 입장해 자동차 안에 앉아 음악을 들으며 정서적 몰입 상태를 경험했다. 중철 제본 인쇄물과 플라스틱 케이스는 이 사적인 청취 상황을 전시용 매체로 번역한다.",why_dim:"오디오 CD, 중철 인쇄물, 플라스틱 케이스가 결합된 패키지 형식으로, 전시장에서 음악과 인쇄물을 함께 경험하는 멀티플 구조를 직접 반영하기 위한 구성",why_margin:"음악 감상이라는 사적 몰입과 전시 맥락 사이의 간극을 유지하기 위해 인쇄물은 비교적 담담한 텍스트 배열을 택하고, 자동차와 하늘 사진이 감상적 정서를 환기하는 이미지 장치로 작동하도록 여백과 표면을 단순화",why_font:"음악과 감상, 사적 정조를 다루는 작업이지만 전시용 출판물로도 기능해야 하므로 문자 구성은 과도하게 감정적이지 않고, 이미지와 패키지 형식이 분위기를 주도하도록 절제된 서체 운용을 택한 것으로 보인다.",why_tracking:"청취 경험과 감상적 분위기가 핵심이므로 자간과 리듬은 설명적 기능을 유지하는 수준에서 조용히 정리되고, 정서적 긴장은 사진 이미지와 설치 상황이 담당하도록 한 것으로 보인다.",layout_type:"본문 2단"},
  {g:"현대미술",pub_type:"실험출판",t:"백현진—오거니즘 메커니즘 블러리즘",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/hyunjhin-baik-kr/",img:"222_백현진—오거니즘 메커니즘 블러리즘",kw:["현대미술","실험출판","백현진","오거니즘","메커니즘","블러리즘","책은","장부터","작품","도판을","전면에","내세우고","ST","송티"],align_title:"좌측 정렬, 우측 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:210,h:280},m:{상:10,하:24,안:25,밖:9},c:{구성:"2단",간격:9},b:{크기:10,행간:12,자간:-60},ty:{이름:"ST 송티 / 베르톨트 블록 / 벰보 북 / 윤명조",분류:"혼합 (명조 / 고딕)"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"27pt",subheading:"118pt",footnote:"7.5pt",특:"책은 첫 장부터 작품 도판을 전면에 내세우고, 제목과 출판 정보는 뒤로 유예된다. 캡션이 즉시 붙지 않은 제목순 배열 때문에 이미지는 한동안 무질서하게 떠다니는 것처럼 보이지만, 후반부에 영문 서문과 대형 제목, 시각적으로 강조된 알파벳순 색인이 등장하면서 전체 구조가 뒤늦게 정리된다. 즉, 초반은 감각적 몰입, 후반은 분류와 해석의 단계로 분리된 독특한 독서 구조를 가진다.",summary:"다방면에서 활동하는 백현진의 미술 작업을 다룬 작품집. 책을 펼치면 곧바로 작품 도판이 시작되고, 속표지·서문·차례는 뒤쪽으로 밀려나 있어 독자가 설명보다 이미지의 흐름 속으로 먼저 진입하게 만든다. 도판은 제작 연도나 매체가 아니라 제목 순으로 배열되고, 캡션도 즉시 붙지 않아 무작위처럼 보이는 배열감이 발생한다. 책의 끝에 이르러서야 표제면과 3개 국어 서문, 시각적으로 강조된 색인이 이어지며 책 전체의 읽기 순서를 전복한다.",why_dim:"회화와 드로잉, 대형 도판, 후반부의 장문 서문과 색인을 함께 수용하면서도 이미지 중심의 몰입과 작품집의 물성을 균형 있게 유지하기 좋은 중대형 판형",why_margin:"독자가 설명보다 이미지에 먼저 압도되도록 도판 중심의 빈 판면을 길게 유지하고, 후반부에 텍스트와 색인을 밀집시켜 앞뒤의 정보 밀도 차이를 극적으로 만듦",why_font:"초반 도판 위주의 감각적 몰입과 후반부의 문헌적 정리 단계가 뚜렷이 갈리므로, 거친 존재감의 제목용 서체와 안정적인 본문용 서체를 병용해 작품집의 물질성과 색인 체계의 구분을 강하게 드러낸 것으로 보인다.",why_tracking:"이미지와 텍스트의 위계가 시점에 따라 크게 뒤집히는 책이므로 문자 리듬 역시 일관되게 감정적이기보다, 초반은 최소 개입, 후반은 강한 분류와 정리를 돕는 방향으로 운용된 것으로 보인다.",layout_type:"본문 2단"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"판 2/3호",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/pan-23-kr/",img:"223_판 2-3호",kw:["아트이론·비평","잡지·저널","판","2/3호","표지는","작은","공연","현장","사진들을","자유로운","미상"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:210,h:285},m:{상:5,하:12,안:15,밖:20},c:{구성:"12단",간격:5},b:{크기:8.5,행간:14,자간:0},ty:{이름:"미상",분류:"혼합 (명조 / 고딕)"},pn:"중앙상단-외측-세로",pn_x_left:"8.5mm",pn_y_left:"45.6mm",pn_x_right:"198.6mm",pn_y_right:"45.6mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"45pt",footnote:"7.5pt",특:"표지는 작은 공연 현장 사진들을 자유로운 격자로 흩뿌리고 그 위에 큰 ‘판’ 자를 겹쳐 잡지의 운동성과 집합성을 시각화한다. 내지에서는 동두천 관련 장문 글과 기록 사진이 긴 호흡으로 이어지는가 하면, 다른 기사에서는 참여자 메모를 그대로 촬영한 이미지, 공연 장면 사진, 인터뷰 텍스트가 각기 다른 밀도로 배치된다. 기사별 편집 어조가 다르지만 상단 규칙선과 세로 정보, 면 구성의 반복이 전체를 하나의 시리즈로 묶는다.",summary:"공연예술네트워크 판의 2/3호 합본 매거진. 공연예술 현장, 인터뷰, 참여자 기록, 지역 리서치, 퍼포먼스 사진을 뒤섞어 담으며 기사마다 다른 온도의 편집 방식을 취한다. 표지에서는 공연 현장 사진들을 격자처럼 흩뿌리고 큰 ‘판’ 자를 겹쳐 배치해 잡지의 현장성·집합성·운동성을 압축하고, 내지에서는 장문 글과 사진, 참여자 메모, 다큐멘트 이미지가 각 기사 성격에 따라 다르게 조직된다.",why_dim:"긴 글, 인터뷰, 현장 사진, 참여 기록을 함께 싣는 잡지로서 기사별 편집 밀도 차이를 수용하면서도 이미지의 존재감을 충분히 살릴 수 있는 중대형 판형",why_margin:"기사마다 텍스트와 이미지 비중이 다르므로 공백과 판면 밀도를 유동적으로 조절하고, 세로 면주와 가는 규칙선을 반복해 서로 다른 기사들을 하나의 잡지 체계 안에 묶음",why_font:"공연예술 현장 기록과 인터뷰, 리서치, 참여자 문서가 공존하는 잡지이므로 본문은 판독성과 유연성이 높은 서체를 바탕으로 운용하고, 표지와 제목에서는 잡지의 집합적 에너지와 시리즈 정체성이 드러나도록 더 강한 문자 처리가 사용된 것으로 보인다.",why_tracking:"기사 성격이 크게 달라지기 때문에 자간 역시 표현적 효과보다 정보 정리와 판면 균형을 우선하는 중립적 운용을 따르되, 표지에서는 큰 글자의 중첩과 대비로 긴장을 만든 것으로 보인다.",layout_type:"본문 2단(각 5열) + 주석 2열"},
  {g:"인문·사회",pub_type:"단행본",t:"디자이너란 무엇인가—사물·장소·메시지",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/what-is-a-designer-kr/",img:"224_디자이너란 무엇인가—사물·장소·메시지",kw:["인문·사회","단행본","디자이너란","무엇인가","사물","장소","메시지","평소에는","절제된","본문","조판과","소박한","표제","어도비","캐즐런"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:138,h:210},m:{상:15,하:30,안:20,밖:17},c:{구성:"1단",간격:0},b:{크기:9.5,행간:17,자간:0},ty:{이름:"어도비 캐즐런 / 윤명조",분류:"명조"},pn:"하단-외측-가로",pn_x_left:"25.5mm",pn_y_left:"188.7mm",pn_x_right:"111.8mm",pn_y_right:"188.7mm",pn_size:"8pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"14pt",footnote:"7.5pt",특:"평소에는 절제된 본문 조판과 소박한 표제 배치로 이론서의 밀도를 유지하지만, 일부 면에서는 초록색 바탕 위에 텍스트를 90도 회전해 배치해 독자가 책을 돌려 읽게 만든다. 표지와 속표지의 극도로 단정한 문자 배열, 본문 중간의 실험적 전환, 차분한 본문 조판이 함께 작동해 ‘디자인이란 무엇인가’라는 질문을 책의 구조 자체에서 반복한다.",summary:"노먼 포터의 디자인 이론서를 최성민이 번역한 책. 디자이너의 역할을 사물·장소·메시지라는 세 축을 통해 다시 묻고, 디자인을 단순한 형식 문제가 아니라 사회적 실천과 비판적 사고의 문제로 다룬다. 본문은 차분한 판면 위에서 긴 논의를 전개하지만, 일부 장에서는 텍스트 방향을 회전시키거나 색지 전체를 바꾸는 방식으로 독서 리듬을 전환해 책 자체가 사고 실험의 장이 되게 한다.",why_dim:"장문 이론 텍스트를 안정적으로 읽히게 하면서도 색지 전환, 방향 회전 같은 실험적 판면을 수용할 수 있는 세로형 중형 판형",why_margin:"기본적으로는 긴 문장을 안정적으로 읽히게 하는 차분한 여백 구조를 유지하되, 특정 장에서 방향 전환과 색면 변화가 강하게 감지되도록 판면의 규칙성을 일부러 깨뜨림",why_font:"서구 디자인 이론서의 번역본으로서 비평적이고 장문 중심의 독서를 버티는 서양식 세리프와 한글 명조 계열의 조합이 적절하며, 실험적 판면 전환 속에서도 텍스트의 논리성과 품위를 유지하기 위해 고전적 인상이 강한 서체를 선택한 것으로 보인다.",why_tracking:"장문 독서의 안정성과 논리 전개가 핵심이므로 자간은 과도한 표현보다 균형 잡힌 독서 리듬을 우선했을 가능성이 크고, 회전된 페이지에서도 문장의 응집력을 유지하도록 비교적 절제된 설정을 택한 것으로 보인다.",layout_type:"본문 1단"},
  {g:"인문·사회",pub_type:"단행본",t:"사람, 건축, 도시",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/people-architecture-city-kr/",img:"225_사람, 건축, 도시",kw:["인문·사회","단행본","사람","건축","도시","전체적으로는","차분한","장문","조판이","중심이지만","사이사이에","아리따","돋움"],align_title:"좌측 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:174,h:237},m:{상:17,하:57,안:25,밖:26},c:{구성:"1,2,3단 가변",간격:4},b:{크기:10,행간:18,자간:0},ty:{이름:"아리따 돋움 / 윤명조",분류:"혼합 (명조 / 고딕)"},pn:"상단-우측-가로",pn_x_left:"132.6mm",pn_y_left:"8.4mm",pn_x_right:"132mm",pn_y_right:"8.4mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"18pt",footnote:"8pt",특:"전체적으로는 차분한 장문 조판이 중심이지만, 장 사이사이에 흑백 건축 사진, 실내 풍경, 도시 전경이 배치되어 건축 비평의 대상을 구체적 현실로 환원한다. 사진 면은 비교적 넓은 여백 속에 들어가고, 본문 면은 문단과 소제목이 안정적으로 이어져 이론서와 현장 기록집의 성격을 함께 가진다. 건축을 사람과 삶의 문제로 읽으려는 책의 태도가 판면에서도 과장 없이 지속된다.",summary:"건축가 정기용의 글과 프로젝트, 도시와 주거에 대한 사유를 함께 묶은 대형 비평서. 건축을 개별 건물의 형식이 아니라 사람의 삶, 주거 방식, 공동체와 도시 환경의 관계 속에서 읽어내며, 긴 글과 현장 사진, 건축 도판이 교차하는 구조를 가진다. 본문은 차분한 장문 독서를 유지하지만, 사진과 도판이 중간중간 개입해 사유의 대상을 구체적인 장소와 현실의 장면으로 붙들어 둔다.",why_dim:"장문 비평과 건축 프로젝트 사진, 도판, 캡션을 함께 담으면서도 일반 교양서보다 조금 넓은 시야와 안정된 독서 밀도를 확보할 수 있는 중대형 판형",why_margin:"긴 문장과 사진 도판이 함께 놓여도 답답하지 않도록 여백을 넉넉하게 두고, 건축 사진이 개입하는 면에서는 텍스트와 이미지가 서로 간섭하지 않게 판면의 호흡을 길게 유지",why_font:"건축과 도시를 둘러싼 공공적 논의와 장문 비평을 함께 담아야 하므로, 제목·소제목과 정보 요소에는 명료한 고딕이, 본문 독서에는 안정적이고 긴 호흡을 버티는 명조가 적합하다. 두 계열의 병용은 건축 담론의 공공성과 에세이적 밀도를 함께 드러내는 방식으로 보인다.",why_tracking:"장문 비평서의 성격상 자간은 표현적 개성보다 지속 독서의 안정성과 문단 리듬을 우선하는 방향으로 설정되었을 가능성이 크고, 사진과 도판이 섞인 판면에서도 텍스트의 밀도를 과도하게 높이지 않도록 절제된 운용을 택한 것으로 보인다.",layout_type:"본문 1,2단 가변 + 주석 2단"},
  {g:"문학",pub_type:"단행본",t:"서울 이야기",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/seoul-stories-kr/",img:"226_서울 이야기",kw:["문학","단행본","서울","이야기","차분한","장문","조판이","기본을","이루되","중간중간","아리따","돋움"],align_title:"좌측 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:174,h:237},m:{상:17,하:57,안:25,밖:26},c:{구성:"1,2,3단 가변",간격:4},b:{크기:10,행간:18,자간:0},ty:{이름:"아리따 돋움 / 윤명조",분류:"혼합 (명조 / 고딕)"},pn:"상단-우측-가로",pn_x_left:"132.6mm",pn_y_left:"8.4mm",pn_x_right:"132mm",pn_y_right:"8.4mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"18pt",footnote:"8pt",특:"차분한 장문 조판이 기본을 이루되, 중간중간 서울의 풍경 사진, 실내에서 바깥을 바라보는 장면, 도시 구조를 드러내는 지도 도판이 끼어들며 텍스트의 사유를 실제 공간과 연결한다. 사진은 비교적 큰 비중으로 배치되지만 과장되지 않고, 지도와 캡션은 자료적 성격을 유지해 도시 비평서와 건축 기록집의 성격을 함께 만든다.",summary:"건축가 정기용이 서울이라는 도시를 사람의 삶과 거주, 기억, 권력, 장소의 축적이라는 관점에서 풀어낸 도시 비평서. 장문 에세이와 도시·건축 사진, 지도와 도판이 함께 엮이며, 서울의 형성과 변화 과정을 거시적 도시 구조와 일상적 생활 공간의 층위에서 동시에 읽어낸다. 차분한 본문 조판 위에 사진과 지도 도판이 삽입되어 도시를 추상적 개념이 아니라 구체적 장면과 흔적으로 체감하게 한다.",why_dim:"장문 도시 비평과 사진, 지도, 도판을 함께 담으면서도 독서성과 시각 자료의 판독성을 동시에 확보할 수 있는 중대형 판형",why_margin:"긴 호흡의 문장을 안정적으로 읽히게 하면서도 지도와 사진이 들어오는 면에서 시야가 충분히 열리도록 넉넉한 판면과 여백 구조를 유지",why_font:"도시와 건축, 생활 공간을 다루는 공공적 논의와 장문 에세이를 함께 담기 위해 명료한 제목용 고딕과 안정적인 본문용 명조를 병용한 것으로 보인다. 정보성과 독서성을 동시에 확보하려는 선택이다.",why_tracking:"장문 위주의 도시 비평서이므로 자간은 개성보다 지속적인 독서 리듬과 문단 안정성을 우선해 절제된 값으로 운용했을 가능성이 크다. 지도와 사진이 섞여도 텍스트 밀도가 과도하게 답답해지지 않도록 균형을 맞춘 설정으로 보인다.",layout_type:"본문 1,2단 가변 + 주석 2단"},
  {g:"인문·사회",pub_type:"전시도록",t:"안양공공예술프로젝트 2007",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/apap-2007-catalog-kr/",img:"227_안양공공예술프로젝트 2007",kw:["인문·사회","전시도록","안양공공예술프로젝트","2007","로고는","엘리먼의","비츠","서체를","변주해","만든","HY","타자전각"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:232,h:254},m:{상:11,하:17,안:12,밖:8},c:{구성:"3단",간격:4},b:{크기:9,행간:14,자간:0},ty:{이름:"HY 타자전각 / 모노타이프 타이프라이터 / 비츠 / 악치덴츠 그로테스크 / 윤고딕",분류:"혼합 (고딕 / 타자기 / 실험적 디스플레이)"},pn:"하단-중앙-가로",pn_x_left:"111.7mm",pn_y_left:"246.8mm",pn_x_right:"115.6mm",pn_y_right:"246.8mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"17pt",footnote:"9pt",특:"로고는 폴 엘리먼의 비츠 서체를 변주해 만든 다양한 형태로 구성되고, 지도의 경계선을 침범하듯 배치된다. 본문은 작품 설치 사진을 크게 다루면서, 작가 인터뷰·해설·작품 정보가 상하 혹은 좌우 블록으로 정리된다. 타자기체와 고딕체, 한글 본문체가 병용되며, 공공장소에서의 작품 경험을 기록하는 도큐먼트와 비평의 혼합 구조가 두드러진다.",summary:"공공예술 프로젝트를 도시 공간 속 실제 설치 장면 중심으로 기록한 전시 도록. 재생과 재활이라는 프로젝트 주제에 맞춰, 길에서 주운 산업 부품의 형상을 문자화한 폴 엘리먼의 비츠 계열 글자와 타자기·고딕 계열 활자를 혼용해 로고와 정보 체계를 구축했다. 로고는 지도 경계선을 가로지르며 도시 개입의 성격을 드러내고, 본문은 작품이 장소와 관계 맺는 방식을 사진 연작과 인터뷰, 해설 텍스트를 통해 병치한다.",why_dim:"공공예술 프로젝트의 현장 사진과 지도, 인터뷰, 해설을 함께 담기에 충분한 판형이면서도, 일반 도록보다 약간 넓은 비율로 도시 공간의 수평적 확장감과 사진 중심 전개를 살리기 위한 선택",why_margin:"작품이 도시 환경 안에서 어떻게 작동하는지 보여 주기 위해 사진의 현장성과 장소성을 우선시하는 편집. 로고와 지도 요소는 전시가 도시 조직을 가로지르는 사건임을 드러내고, 텍스트 블록은 작품 해설과 대화 기록을 차분하게 정리하는 데 쓰인다.",why_font:"공공예술 프로젝트의 현장 기록물이라는 성격상 작품 정보, 인터뷰, 지도, 해설을 층위별로 구분할 필요가 있었고, 이에 따라 중립적 정보 전달용 고딕체와 타자기 계열 서체를 기본으로 삼되, 로고에는 길에서 주운 산업 부품의 형태를 연상시키는 비츠를 사용해 재생·재활의 주제를 시각적으로 강조한 것으로 보인다.",why_tracking:"자간은 제목과 로고에서 산업 부품 같은 조형성과 낯선 물성을 강조하는 방향으로 활용되고, 본문과 정보 영역에서는 기록물·문서적 읽기 리듬을 해치지 않도록 비교적 중립적으로 유지된 것으로 보인다.",layout_type:"본문 3단"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"DT2—현대 미술가와 디자이너를 위한 메소드",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/dt-2-kr/",img:"228_DT2—현대 미술가와 디자이너를 위한 메소드",kw:["아트이론·비평","잡지·저널","DT2","현대","미술가와","디자이너를","위한","메소드","제목","없는","앞표지","이미지와","텍스트의","느슨한","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:186,h:248},m:{상:21,하:25,안:6,밖:5},c:{구성:"6단",간격:5},b:{크기:10,행간:17,자간:-20},ty:{이름:"미상",분류:"명조"},pn:"하단-좌측, 중앙(1P 동일 쪽번호 2개)-가로",pn_x_left:"6.5mm(외측), 96.4mm(중앙)",pn_y_left:"229.3mm",pn_x_right:"6.3mm(외측), 96.2mm(중앙)",pn_y_right:"229.3mm",pn_size:"9.5pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"-",footnote:"7.5pt",특:"제목 없는 앞표지, 이미지와 텍스트의 느슨한 병치, 도식과 사진·도판의 혼합 배치가 핵심이다. 본문은 특정한 기사형 리듬보다 리서치 문서처럼 구성되며, 주제별로 다른 형식의 이미지와 설명이 공존한다. 즉, 하나의 통일된 서사보다 다양한 방법론을 수집·비교·제시하는 편집 구조가 강조된다.",summary:"불연속 간행물 DT의 두 번째 호로, 현대 미술가와 디자이너의 창작 방법론을 다양한 형식의 글과 도판으로 탐색한 프로젝트형 간행물. 제목 없는 앞표지에는 잭슨홍이 직접 디자인한 운송 상자가 실려 있어, 책의 출발점부터 완성된 결과물보다 과정과 도구, 이동과 방법론 자체를 환기한다.",why_dim:"에세이·도판·도식·자료 이미지가 함께 들어가는 방법론 중심 간행물의 성격에 맞춰, 일반 단행본보다 넓고 안정적인 작업 면적을 확보하면서도 읽기와 보관이 가능한 실용적 크기를 택한 것으로 보인다.",why_margin:"창작 방법 또는 ‘메소드’를 다루는 기획에 맞춰, 텍스트와 도판이 논문처럼 엄격하게 흐르기보다 자료집·리서치 북처럼 병치되고 비교되는 구조가 두드러진다. 사례 이미지, 다이어그램, 목록, 설명문이 혼재하며 각 스프레드마다 정보 밀도가 달라진다.",why_font:"여러 필자와 다양한 시각 자료가 병치되는 방법론 중심 간행물의 특성상, 특정 서체의 개성보다 정보 계층을 유연하게 처리할 수 있는 중립적이고 기능적인 서체 선택이 우선되었을 가능성이 크다. 다만 제공된 자료만으로는 실제 서체를 특정하기 어렵다.",why_tracking:"제목 없는 앞표지와 자료집 성격의 본문 구성으로 보아, 자간 역시 조형적 과시보다는 정보 구획과 가독성, 자료 간 위계 조절을 위한 실무적 설정이 중심이었을 가능성이 높다. 그러나 현재 자료만으로 구체적 판단은 어렵다.",layout_type:"본문 2단(각 3열) + 주석 3단(각 2열)"},
  {g:"아트이론·비평",pub_type:"단행본",t:"오프 킬터—한국 현대 미술가 연구 노트",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/off-kilter-kr/",img:"229_오프 킬터—한국 현대 미술가 연구 노트",kw:["아트이론·비평","단행본","오프","킬터","한국","현대","미술가","연구","노트","비대칭","타이포그래피의","표지와","여백","중심","본문","산스"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"중앙 정렬",f:{w:130,h:205},m:{상:16,하:29,안:15,밖:15},c:{구성:"1단",간격:0},b:{크기:9,행간:13,자간:-10},ty:{이름:"길 산스",분류:"고딕"},pn:"하단-우측-가로(좌), 상단-우측-가로(우)",pn_x_left:"104.7mm",pn_y_left:"178.8mm",pn_x_right:"106.1mm",pn_y_right:"8.8mm",pn_size:"11pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자(좌측 페이지는 대괄호로 감싸짐]",running:"7.5pt",subheading:"16.5pt",footnote:"7.5pt",특:"비대칭 타이포그래피의 표지와 여백 중심 본문, 이미지와 텍스트의 병치 구조",summary:"미술·디자인 평론가 임근준이 한국 현대 미술가 6인의 작업을 분석한 영어 비평집으로, 기존 한국어 비평 일부를 번역해 해외 독자에게 소개하는 데 초점을 둔다.",why_dim:"영문 비평집으로서 휴대성과 독서 집중도를 고려한 비교적 아담한 판형",why_margin:"텍스트 중심 평론 구조에 작품 도판이 절제되어 삽입되는 편집",why_font:"영문 비평집의 성격에 맞춰 중립적이고 현대적인 인상의 산세리프 선택",why_tracking:"자간은 덩어리감 유지 중심의 안정적 설정",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"전시도록",t:"혀, 해방되다!",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/tongue-liberated-catalog-kr/",img:"230_혀, 해방되다!",kw:["아트이론·비평","전시도록","혀","해방되다!","오른쪽","페이지에","반복되는","은색","좌우","페이지의","어도비","캐즐런"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:188,h:180},m:{상:8,하:8,안:16,밖:8},c:{구성:"12단",간격:4},b:{크기:8.5,행간:14,자간:0},ty:{이름:"어도비 캐즐런 / 윤고딕 / 윤명조 / 프랭클린 고딕",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"중앙-우측-세로(우)",pn_x_left:null,pn_y_left:null,pn_x_right:"169.6mm",pn_y_right:"88.7mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"6.5pt",subheading:"14pt",footnote:"6.5pt",특:"오른쪽 페이지에 반복되는 은색 원, 좌우 페이지의 정제된 정보 배열, 음성 파형을 책 구조로 번역한 개념적 반복 시스템이 특징이다. 작품 이미지와 해설, 인터뷰·기록 텍스트가 공존하지만 전체를 지배하는 것은 원형 모티프와 파형 기반 시각화다.",summary:"‘스피치 액트’를 주제로 한 전시의 도록으로, 은색 원 모티프를 통해 맥 OS 음성 ‘비키’의 음성 파형을 시각적으로 번역한 실험적 구조가 핵심이다. 오른쪽 페이지마다 배치된 원의 크기는 실제 음성 파형에서 추출되며, 도록 전체가 하나의 녹음 장치처럼 작동한다. 전시 기록과 이론 텍스트, 작품 이미지가 공존하지만, 핵심은 말하기·기록·재생의 관계를 책의 물성 안에 구조화하는 데 있다.",why_dim:"정사각형에 가까운 비율로 전시의 음성·기록 실험을 응축된 구조 안에 담고, 원형 모티프와 페이지 반복 체계를 안정적으로 운용하기 위한 선택",why_margin:"오른쪽 페이지마다 반복되는 은색 원과 파형 기반 직경 변화가 핵심이므로, 여백은 이를 방해하지 않도록 비교적 절제되고 균질하게 유지되며, 텍스트와 도판은 기록물로서 차분히 정리된다.",why_font:"전시의 이론적·기록적 성격에 맞춰 본문과 해설에는 안정적인 명조 계열과 중립적 고딕 계열을 사용하고, 표제나 강조 요소에는 보다 선명한 존재감을 가진 프랭클린 고딕을 배치해 음성·담론·기록의 층위를 구분한 것으로 보인다.",why_tracking:"자간은 음성 파형을 시각화한 원형 모티프와 충돌하지 않도록 본문에서는 비교적 절제되고 안정적으로 유지되며, 제목과 강조 영역에서는 기계 음성과 시각 신호의 또렷한 인상을 만들기 위해 다소 조밀하거나 단단한 설정이 사용되었을 가능성이 높다.",layout_type:"본문 3단(각 4열) + 주석 4단(각 3열)"},
  {g:"현대미술",pub_type:"전시도록",t:"지용호—뮤턴트",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/yong-ho-ji-mutant-kr/",img:"231_지용호—뮤턴트",kw:["현대미술","전시도록","지용호","뮤턴트","검은","바탕에","백색","텍스트를","놓은","서문","유니버스","윤고딕"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:213,h:264},m:{상:14,하:34,안:18,밖:18},c:{구성:"12단",간격:3},b:{크기:10,행간:12,자간:10},ty:{이름:"유니버스 / 윤고딕",분류:"고딕"},pn:"하단-외측-가로",pn_x_left:"48.1mm",pn_y_left:"248.8mm",pn_x_right:"161.6mm",pn_y_right:"248.8mm",pn_size:"9pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"17pt",footnote:"8pt",특:"검은 바탕에 백색 텍스트를 놓은 서문·개념 설명 페이지와, 작품을 크게 확대해 보여 주는 도판 페이지가 강한 대비를 이룬다. 일부 스프레드는 좌측에 텍스트와 작품 정보를, 우측에 대형 이미지를 배치해 조각의 물질성과 도록의 정보 구조를 명확히 분리한다.",summary:"폐타이어를 재료로 한 지용호의 조각 작업을 기록한 작가 도록. 탄소 분말이 섞인 무광 검정 잉크를 사용해 원작의 어둡고 빛을 흡수하는 물성을 인쇄물 위에 재현하려 했으며, 검은 바탕 위에 텍스트와 도판이 놓이는 구조를 통해 작품의 육중함과 인공 생물체 같은 긴장을 강조한다. 서문과 개념 설명, 작품 정보, 대형 도판이 이어지는 비교적 정제된 작가 모노그래프 구조다.",why_dim:"조각 작품의 질감과 디테일을 충분히 살릴 수 있는 중대형 판형으로, 검은 바탕의 강한 시각 밀도와 대형 도판의 물성을 안정적으로 수용하기 위한 선택",why_margin:"검은 바탕 면 위에 텍스트와 이미지가 놓이는 구성이 핵심이므로, 여백은 장식보다 도판의 압도감과 텍스트의 판독성을 동시에 유지하기 위한 완충 영역으로 작동한다.",why_font:"검은 바탕 위에서 높은 판독성을 확보해야 하는 작가 도록의 조건상, 중립적이면서도 구조적인 인상을 가진 산세리프 계열이 적합하다. 유니버스는 작품 정보와 영문 서술의 체계성을, 윤고딕은 한글 정보의 선명한 전달을 맡으며 조각의 인공적·산업적 분위기와도 잘 맞는다.",why_tracking:"자간은 검은 면 위에서 글자가 번져 보이거나 뭉개지지 않도록 지나치게 좁지 않게 유지하면서도, 제목과 작품 정보에서는 조각의 단단함과 구조적 긴장을 드러내기 위해 비교적 조밀하고 단단한 리듬으로 설정되었을 가능성이 크다.",layout_type:"본문 1단(8열) + 주석 2,3단(4-5열) 가변"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"판 1호",designer:"슬기와 민",src:"https://www.sulki-min.com/wp/pan-1-kr/",img:"232_판 1호",kw:["아트이론·비평","잡지·저널","판","1호","인터뷰와","비평문","전면","사진","제목","면이","윤명조","윤고딕"],align_title:"좌측 정렬, 우측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:210,h:285},m:{상:8,하:10,안:15,밖:20},c:{구성:"12단",간격:5},b:{크기:10,행간:17,자간:0},ty:{이름:"윤명조 / 윤고딕",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"중앙상단-외측-세로",pn_x_left:"8.1mm",pn_y_left:"45.9mm",pn_x_right:"198.3mm",pn_y_right:"45.9mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"45pt",footnote:"7pt",특:"긴 인터뷰와 비평문, 전면 사진, 제목 면이 혼합되며, 상단의 가로선과 여백을 반복적으로 사용해 기사별 리듬을 만든다.",summary:"공연예술 현장과 사건, 담론을 아우르는 저널로, 제호의 여백 처리처럼 독자가 ‘예술-판’, ‘춤-판’ 등 다양한 의미를 연상하도록 열어 둔 실험적 공연예술 매거진.",why_dim:"잡지형 판형을 유지하면서도 공연 사진, 인터뷰, 비평 텍스트를 유연하게 수용할 수 있는 크기여서 저널의 담론성과 현장성을 함께 담기에 적합하다.",why_margin:"상단의 넓은 여백과 선형 구획은 기사, 사진, 면주를 느슨하게 분리하면서도 저널 전체에 일정한 호흡을 부여한다.",why_font:"담론 중심의 긴 글에는 명조를, 기사 정보와 제목, 면주에는 고딕을 배치해 공연예술 저널의 비평성과 기록성을 함께 드러낸다.",why_tracking:"자간을 과도하게 조정하기보다 기사 가독성과 제목의 밀도를 안정적으로 유지하는 방향으로 설정된 것으로 보인다.",layout_type:"본문 2단(각 5열) + 주석 2열"},
  {g:"현대미술",pub_type:"전시도록",t:"이형구—호모 스피시스",designer:"슬기와 민",src:"https://www.sulki-min.com/wp/hyungkoo-lee-venice-catalog-kr/",img:"233_이형구—호모 스피시스",kw:["현대미술","전시도록","이형구","호모","스피시스","광학","장치","연작에는","위생적이고","정제된","모더니즘적","보도니","윤고딕"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:210,h:276},m:{상:48,하:23,안:18,밖:18},c:{구성:"3단",간격:6},b:{크기:11,행간:17,자간:0},ty:{이름:"보도니 / 윤고딕 / 헬베티카 텍스트북",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"중앙상단-중앙외측-가로",pn_x_left:"78mm",pn_y_left:"35.3mm",pn_x_right:"126.9mm",pn_y_right:"35.1mm",pn_size:"11pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"18pt",footnote:"8pt",특:"광학 장치 연작에는 위생적이고 정제된 모더니즘적 구성, 유사 진화 생물학 조각 파트에는 종의 기원 초판을 연상시키는 대칭적 구성을 적용해 두 계열을 분리한다.",summary:"제52회 베니스 비엔날레 한국관 전시에 맞춰 제작된 도록으로, 이형구 작업의 두 축인 광학 장치와 가공의 화석 조각을 서로 다른 타이포그래피 질서로 구분해 보여 준다.",why_dim:"국제전 도록에 어울리는 안정된 세로형 판형으로, 조각 도판의 스케일과 학술적 텍스트를 함께 담으면서도 작품의 이중 구조를 분절감 있게 전개하기 좋다.",why_margin:"넓은 여백과 상단 기준선은 작품군 간의 성격 차이를 또렷하게 구획하고, 사진과 텍스트의 대비를 선명하게 만든다.",why_font:"보도니와 전통적 대칭형 구성은 진화론 서적 같은 고전적 문헌성을 환기하고, 헬베티카와 윤고딕은 광학 장치 파트의 위생적이고 분석적인 분위기를 강화한다.",why_tracking:"작품군별 분위기 차이를 살리되 전체 도록의 학술성과 정돈감을 유지하기 위해 자간은 비교적 절제된 방식으로 운용된 것으로 보인다.",layout_type:"본문 1단 + 주석 3단"},
  {g:"현대미술",pub_type:"전시도록",t:"상상 충전",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/charge-your-imagination-catalog-kr/",img:"234_상상 충전",kw:["현대미술","전시도록","상상","충전","여섯","섹션을","서로","다른","색면과","마스코트","HY","타자전각"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:188,h:256},m:{상:14,하:22,안:24,밖:28},c:{구성:"2단",간격:7},b:{크기:7.5,행간:17,자간:0},ty:{이름:"HY 타자전각 / LL 아쿠라트 / 모노타이프 타이프라이터 / 산돌 아트 / 윤고딕 500",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"중앙-외측-세로",pn_x_left:"8.5mm",pn_y_left:"120.7mm",pn_x_right:"176.8mm",pn_y_right:"120.7mm",pn_size:"7pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"15pt, 150pt",footnote:"8pt",특:"여섯 섹션을 서로 다른 색면과 마스코트 변주로 구분하고, 굵고 큰 제목 타이포그래피를 전면에 배치한다. 본문부는 작품 이미지, 작가 정보, 어린이 눈높이의 해설을 비교적 정돈된 다단 구조로 배치해 교육성과 친근함을 함께 확보한다.",summary:"어린이를 위한 전시 도록으로, 글자 A·R·T를 조합해 헬로 키티를 연상시키는 마스코트 ‘헬로 아티’를 만들고, 여섯 가지 풍선으로 전시의 여섯 섹션을 구분했다. 친근한 캐릭터성과 색면 구성, 큰 제목 타이포그래피와 교육용 해설 구조가 결합된 어린이 대상 전시 연계 출판물이다.",why_dim:"어린이 대상 도록으로서 큰 제목, 캐릭터 그래픽, 섹션별 색면 구성을 충분히 펼쳐 보이면서도 교육용 텍스트와 작품 도판을 함께 안정적으로 담기 위한 세로형 판형",why_margin:"큰 제목과 캐릭터, 풍선 모티프, 작품 도판과 해설이 서로 부딪히지 않도록 넉넉한 호흡을 주는 여백이 필요하며, 어린이용 출판물답게 시각 요소들이 답답하지 않게 펼쳐지도록 여백이 완충 역할을 한다.",why_font:"어린이 전시의 친근함과 교육적 정보 전달을 동시에 만족시키기 위해, 중립적 산세리프와 장난스럽고 기호적인 서체, 타자기풍 서체를 혼합해 사용한 것으로 보인다. 큰 제목과 마스코트에는 캐릭터성이 강한 서체가, 정보와 해설에는 읽기 쉬운 고딕 계열이 적합하다.",why_tracking:"자간은 큰 제목에서 또렷하고 장난기 있는 인상을 만들기 위해 다소 단단하게 조정되었을 가능성이 높고, 해설과 정보 텍스트에서는 어린이용 출판물이라도 판독성을 해치지 않도록 비교적 안정적으로 유지되었을 것이다.",layout_type:"본문 2단"},
  {g:"아트이론·비평",pub_type:"실험출판",t:"Sasa[44] 연차 보고서 2006",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/sasa-44-annual-report-2006-kr/",img:"235_Sasa[44] 연차 보고서 2006",kw:["아트이론·비평","실험출판","Sasa[44]","연차","보고서","2006","영수증","카드","사용","내역","수기","기록","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:213,h:290},m:{상:15,하:10,안:30,밖:15},c:{구성:"1단",간격:0},b:{크기:10,행간:14,자간:0},ty:{이름:"미상",분류:"고딕"},pn:"중앙-외측-세로",pn_x_left:"4.8mm",pn_y_left:"141.3mm",pn_x_right:"203.05mm",pn_y_right:"141.3mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"85pt",footnote:"-",특:"영수증, 카드 사용 내역, 수기 기록, 간단한 막대그래프를 반복적으로 배치해 일상 데이터의 축적 자체가 책의 구조가 되도록 구성했다.",summary:"영수증과 수기 기록을 전면 스캔해 배열하고 여덟 가지 생활 지표를 간단한 도표로 병치한 첫 개인 연차 보고서로, 데이터와 일상을 거의 가공 없이 드러낸다.",why_dim:"타공과 스캔 이미지, 영수증 원본 비례를 수용하면서 데이터 아카이브를 거의 원본 크기 감각으로 읽히게 하려는 판형이다.",why_margin:"스캔 영수증과 기록물을 가능한 한 있는 그대로 보여 주는 아카이브형 구성에 맞춰 여백이 정보 간 간섭을 줄이고 자료 열람성을 높인다.",why_font:"자료의 비가공성과 연차 보고서 형식을 우선한 구성으로, 특정 서체의 개성보다 기록물과 도표의 직접성이 전면에 놓인다.",why_tracking:"도표와 기록 이미지의 정보 밀도를 흐리지 않도록 자간 개입을 최소화한 것으로 보인다.",layout_type:"본문 1단"},
  {g:"아트이론·비평",pub_type:"단행본",t:"큐레이터의 사물함 자료 목록 개정판",designer:"슬기와 민",src:"https://www.sulki-min.com/wp/a-revised-inventory-kr/",img:"236_큐레이터의 사물함 자료 목록 개정판",kw:["아트이론·비평","단행본","큐레이터의","사물함","자료","목록","개정판","대부분의","지면이","표와","색인","목록으로","구성되며","발바움"],align_title:"중앙 정렬",align_body:"중앙 정렬",align_note:"중앙 정렬, 좌측 정렬",f:{w:127,h:198},m:{상:15,하:26,안:13,밖:17},c:{구성:"1단",간격:0},b:{크기:6.5,행간:0,자간:0},ty:{이름:"발바움",분류:"명조"},pn:"상단-외측-가로",pn_x_left:"17mm",pn_y_left:"7.8mm",pn_x_right:"105mm",pn_y_right:"7.8mm",pn_size:"11pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"7.5pt",subheading:"14pt",footnote:"-",특:"대부분의 지면이 표와 색인, 목록으로 구성되며, Places·Dates 같은 항목별 구획과 publisher별 정렬 페이지가 아카이브의 탐색 구조를 책 전체에 걸쳐 유지한다.",summary:"전시와 함께 성장해 온 국제적 큐레토리얼 아카이브를 서울 버전으로 재정리한 방대한 목록집으로, 보이지 않는 정리·분류·보존 노동을 책이라는 물체로 가시화한다.",why_dim:"조르주 페렉의 『공간의 종류』 판형을 참조해, 분류와 정돈에 관한 책이라는 개념적 출처를 물리적 크기에서도 환기한다.",why_margin:"방대한 목록과 색인, 출판사별·장소별·연도별 정렬 정보를 안정적으로 담기 위해 여백은 과시보다 열람성과 분류 체계를 우선한다.",why_font:"페렉의 『공간의 종류』와 같은 본문 활자체를 사용해 분류, 목록, 서지 정보가 중심인 책의 문헌적 성격과 개념적 참조 관계를 분명히 드러낸다.",why_tracking:"목록과 표의 촘촘한 정보를 안정적으로 식별하게 하려는 목적이 우선되어, 자간은 중립적이고 보수적으로 유지된 것으로 보인다.",layout_type:"본문 1단(표 형식)"},
  {g:"현대미술",pub_type:"전시도록",t:"박원주—약함의 힘",designer:"슬기와 민",src:"https://www.sulki-min.com/wp/park-wonjoo-kr/",img:"237_박원주—약함의 힘",kw:["현대미술","전시도록","박원주","약함의","힘","좌우","페이지에","한영","텍스트를","나누어","싣거나","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:210,h:279},m:{상:14,하:28,안:15,밖:15},c:{구성:"7단",간격:4},b:{크기:8,행간:15,자간:0},ty:{이름:"미상",분류:"명조(타자기체)"},pn:"하단-중앙-가로",pn_x_left:"103.2mm",pn_y_left:"268.5mm",pn_x_right:"103.2mm",pn_y_right:"268.5mm",pn_size:"8pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"8pt",footnote:"8pt",특:"좌우 페이지에 한영 텍스트를 나누어 싣거나 작품 사진을 크게 배치하며, 작품 정보와 설치 사진이 느슨하지만 정밀한 질서 안에서 공존한다.",summary:"A4와 미국식 레터 규격 사무용지로 조각을 만드는 작가의 작업을 다룬 작품집으로, 판형 자체도 두 종이 규격의 가로·세로 치수에서 끌어와 작품 개념을 책의 물성으로 옮긴다.",why_dim:"A4와 레터 규격의 치수를 결합해 만든 크기로, 작가가 다루는 두 종이 규격의 관계를 책의 외형 자체에서 즉각 드러내도록 했다.",why_margin:"여백은 작품 사진과 한영 텍스트가 서로 간섭하지 않게 두면서, 종이 규격의 개념적 비교가 차분하게 읽히도록 한다.",why_font:"사무용지 규격과 제도적 표준을 다루는 작업의 개념에 맞춰, 장식보다 정보 정리와 규격성을 우선하는 중립적 고딕 계열이 사용된 것으로 보인다.",why_tracking:"자간은 종이 규격, 작품 정보, 한영 병기 텍스트를 또렷하게 분절하기 위해 좁거나 과장되지 않은 중립적 값으로 유지된 것으로 보인다.",layout_type:"본문 2단(각 3열) + 주석 3단(각 2열)"},
  {g:"현대미술",pub_type:"전시도록",t:"홍승혜의 공간 배양법",designer:"슬기와 민",src:"https://www.sulki-min.com/wp/hong-seung-hyes-method-of-space-cultivation-kr/",img:"238_홍승혜의 공간 배양법",kw:["현대미술","전시도록","홍승혜의","공간","배양법","지면","한가운데","가로","절취선을","두어","위아래","FF","밸런스"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:188,h:246},m:{상:18,하:124,안:38,밖:40},c:{구성:"2단",간격:3},b:{크기:10,행간:13,자간:0},ty:{이름:"FF 밸런스 / SM 태고딕",분류:"고딕"},pn:"중앙상단-외측-세로",pn_x_left:"11.9mm",pn_y_left:"67.3mm",pn_x_right:"179.2mm",pn_y_right:"67.3mm",pn_size:"8pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8pt",subheading:"-",footnote:"8pt",특:"지면 한가운데 가로 절취선을 두어 위아래 절반을 서로 다른 페이지와 조합할 수 있게 만들었고, 작품의 재조합 원리를 책의 읽기 방식으로 옮겼다.",summary:"홍승혜가 기존 작업을 해체·재조합해 새로운 작업으로 확장한 전시를 기록한 도록으로, 속장 중앙의 가로 절취선을 따라 독자가 지면을 분리하고 다시 조합해 볼 수 있도록 설계한 참여적 구조의 책이다.",why_dim:"전시 도록으로서 휴대와 열람이 가능한 크기를 유지하면서도, 작품 도판과 한영 텍스트, 절취선 실험 구조를 충분히 수용할 수 있는 판형이다.",why_margin:"여백은 절취선을 따라 위아래 지면이 분리되거나 재조합될 때도 이미지와 텍스트가 독립적으로 읽히도록 안정적인 호흡을 만든다.",why_font:"격자, 모듈, 조합 같은 홍승혜 작업의 구조적 성격을 선명하고 중립적으로 드러내기 위해 장식성이 적고 구조가 분명한 고딕 계열을 사용했다.",why_tracking:"절취와 재조합이 핵심인 구조 안에서 텍스트의 안정적 가독성과 모듈감 있는 인상을 유지하기 위해 자간은 과장 없이 비교적 절제해 설정한 것으로 보인다.",layout_type:"본문 1단(2열) + 주석 2단(각 1열)"},
  {g:"인문·사회",pub_type:"단행본",t:"크레이지 아트 메이드 인 코리아",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/crazy-art-made-in-korea-kr/",img:"239_크레이지 아트 메이드 인 코리아",kw:["인문·사회","단행본","크레이지","아트","메이드","인","코리아","좌페이지에서는","여백","속에","제목과","저자명","인물","윤명조","120"],align_title:"좌측 정렬(대제), 우측 정렬(저자)",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:132,h:216},m:{상:15,하:35,안:18,밖:18},c:{구성:"1단",간격:0},b:{크기:9,행간:17,자간:0},ty:{이름:"윤명조 120 / 윤명조 130",분류:"명조"},pn:"하단-중앙-가로(오른 페이지에 나란히 배치, 268 | 269)",pn_x_left:null,pn_y_left:null,pn_x_right:"59mm",pn_y_right:"201mm",pn_size:"9pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"9pt",subheading:"12pt",footnote:"7.5pt",특:"좌페이지에서는 큰 여백 속에 제목과 저자명, 인물 이미지를 느슨하게 배치하고, 우페이지에서는 상단의 짧은 리드문과 중간 제목, 장문 본문을 위계적으로 정렬한다. 별색 가는 규칙선과 작은 도판 캡션, 하단 외측 쪽번호가 반복되며, 이미지 페이지와 텍스트 페이지의 밀도 차이를 이용해 리듬을 만든다.",summary:"1988년 민주화 투쟁에서 IMF 경제 위기까지를 가로지르는 한국 현대미술 비평서. 작가 고승욱을 비롯한 동시대 미술가들의 작업을 정치적 올바름, 세속적 성공, 포스트민중미술, 코미디와 우울 같은 축으로 읽어내며, 장문의 평론과 작가론을 통해 1990년대 이후 한국 미술의 조건을 비판적으로 사유한다.",why_dim:"문고판에 가까운 세로형 판형으로 장문의 비평 텍스트를 오래 읽기 적합하고, 좌측의 큰 여백과 우측의 밀도 높은 본문을 안정적으로 수용해 평론집 특유의 집중 독서 리듬을 만들기 좋다.",why_margin:"바깥 여백을 넓게 두어 제목면과 본문면 모두에 정적이고 사유적인 호흡을 만들고, 본문 블록을 안쪽으로 모아 장문 비평이 흔들리지 않게 고정한다. 이미지 캡션과 쪽번호도 같은 하단 축 위에서 안정적으로 읽히도록 여백이 완충 역할을 한다.",why_font:"장문의 한국 현대미술 비평을 오래 읽히게 하면서도, 제목과 소제목에서 문학적 긴장감과 비평서의 문헌적 분위기를 동시에 확보하기 위해 획 대비가 있는 명조 계열을 선택한 것으로 보인다.",why_tracking:"제목과 본문 모두 지나치게 벌어지지 않은 촘촘한 조판으로 비평 텍스트의 집중도를 유지하고, 좁은 자간을 통해 문장 덩어리가 단단한 회색면을 이루도록 조정한 것으로 보인다.",layout_type:"본문 1단"},
  {g:"사진",pub_type:"단행본",t:"기계 비평",designer:"슬기와 민",src:"https://www.sulki-min.com/wp/machine-criticism-kr/",img:"240_기계 비평",kw:["사진","단행본","기계","비평","사진과","장문","텍스트를","병치하는","HY","타자전각"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:165,h:220},m:{상:24,하:11,안:17,밖:13},c:{구성:"4단",간격:3},b:{크기:9,행간:16,자간:0},ty:{이름:"HY 타자전각 / 어도비 캐즐런 / 윤명조 / 파이카 10피치",분류:"명조"},pn:"상단-좌측-가로",pn_x_left:"12.7mm",pn_y_left:"14.4mm",pn_x_right:"22.9mm",pn_y_right:"14.4mm",pn_size:"7pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자(좌측 페이지는 대괄호로 감싸짐]",running:"7pt",subheading:"-",footnote:"7pt",특:"기계 사진과 장문 비평 텍스트를 병치하는 레이아웃, 복고적이고 작도된 인상의 제목 타이포그래피, 사진의 물성과 글의 해설이 함께 작동하는 구성",summary:"사진에 등장하는 육중한 기계를 비평적으로 읽어내는 책. 자와 컴퍼스로 작도한 듯한 복고적 글자체를 사용해 기계의 물성과 시대감을 타이포그래피 차원에서 반향시킨다.",why_dim:"사진과 장문 비평 텍스트를 함께 수용하면서도, 지나치게 크지 않은 판형으로 독서성과 도판 재현의 균형을 맞춘 크기다.",why_margin:"기계 사진의 물성과 장문 비평을 함께 보여 주기 위해 이미지와 본문 사이의 긴장을 조절하는 여백 운용이 중요했을 것으로 보인다.",why_font:"기계의 구조적이고 복고적인 인상을 드러내기 위해 작도된 느낌의 제목용 서체와, 장문 비평에 적합한 본문용 명조 계열 서체를 함께 사용한 것으로 보인다.",why_tracking:"기계의 단단하고 복고적인 인상을 살리기 위해 제목과 표제에서는 자간을 지나치게 좁히지 않고 구조감을 드러냈을 가능성이 있다.",layout_type:"본문 1단 + 주석 2단"},
  {g:"현대미술",pub_type:"전시도록",t:"광주비엔날레 2006—열풍 변주곡",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/gwangju-biennale-2006-catalog-kr/",img:"241_광주비엔날레 2006—열풍 변주곡",kw:["현대미술","전시도록","광주비엔날레","2006","열풍","변주곡","작가","소개와","해설","페이지는","좌우","언어를","슈템펠","개러몬드"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:180,h:240},m:{상:10,하:16,안:16,밖:24},c:{구성:"4단",간격:4},b:{크기:8.5,행간:15,자간:0},ty:{이름:"슈템펠 개러몬드 / 악치덴츠 그로테스크 / 윤고딕 / 윤명조",분류:"명조"},pn:"하단-중앙내측-가로",pn_x_left:"127.3mm",pn_y_left:"233mm",pn_x_right:"47.3mm",pn_y_right:"233mm",pn_size:"9pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"6.5pt",subheading:"13.5pt",footnote:"6.5pt",특:"작가 소개와 해설 페이지는 좌우 언어를 분리하거나 2단 텍스트 블록을 구성하고, 전시 전경·작품 도판 페이지는 큰 이미지와 작은 캡션을 느슨한 모듈 안에 배치한다. 일부 스프레드는 다수의 소도판을 격자형으로 배열하고, 면주와 장 제목은 바깥 여백의 세로 축에 고정해 전시의 장 구성을 책 전체에 걸쳐 연결한다.",summary:"2006 광주비엔날레 도록으로, 다수의 작가와 섹션을 2권 구성 안에 담아내며 전시 전경, 작품 도판, 큐레이터 텍스트, 작가 소개를 절제된 타이포그래피와 넓은 여백 속에 정리한다. 이전과 이후의 광주비엔날레 도록보다 디자인과 제작 모두에서 한층 절제된 인상을 주는 출판물이다.",why_dim:"국제전 도록에 필요한 충분한 도판 크기와 장문 해설의 가독성을 함께 확보하면서도, 2책 분권 구조를 무리 없이 다루기 좋은 중형 세로 판형이다.",why_margin:"도판, 장문 해설, 작가 정보, 면주를 한 지면 안에서 충돌 없이 공존시키기 위해 바깥 여백을 상대적으로 넓게 두고, 중앙 텍스트 블록과 하단 쪽번호를 느슨하게 고정하는 완충 공간으로 사용한다.",why_font:"국제전 도록의 문헌성과 장문의 읽기 리듬을 위해 개러몬드와 윤명조 같은 명조 계열을 사용하고, 작가명·면주·정보 체계에는 악치덴츠 그로테스크와 윤고딕을 배치해 전시 구조를 명료하게 정리한 것으로 보인다. 한글과 영문, 본문과 정보 계층을 서로 다른 성격의 서체로 분리해 다언어 도록의 질서를 안정화한다.",why_tracking:"본문은 비교적 중립적인 자간으로 장시간 읽기 적합한 회색면을 만들고, 제목과 면주, 정보 요소는 다소 조여진 자간으로 긴장감을 높여 절제된 인상을 유지한 것으로 보인다.",layout_type:"본문 1, 2단 가변(2, 3열), 주석 1열"},
  {g:"인문·사회",pub_type:"실험출판",t:"우리 동네—뉴욕",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/our-spot-new-york-kr/",img:"242_우리 동네—뉴욕",kw:["인문·사회","실험출판","우리","동네","뉴욕","지시문","페이지는","날짜별","소제목과","굵은","섹션","헬베티카","아쿠라트"],align_title:"-",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:128,h:197},m:{상:16,하:12,안:12,밖:10},c:{구성:"2단",간격:2},b:{크기:7,행간:8,자간:0},ty:{이름:"헬베티카 / 아쿠라트 계열 / 타임스 계열",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"하단-외측-가로",pn_x_left:"10mm",pn_y_left:"188mm",pn_x_right:"114.8mm",pn_y_right:"188mm",pn_size:"7.5pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"6.5pt",subheading:"9pt",footnote:"6.5pt",특:"지시문 페이지는 날짜별 소제목과 굵은 섹션 헤드를 따라 정보지처럼 조밀하게 흐르고, 여행사진 페이지는 동일 비율의 소형 이미지 여러 장을 격자 배열한다. 수집물 페이지는 신문, 메뉴, 영수증, 포장재 같은 오브제를 백색 배경 위에 독립적으로 배치해 여행의 흔적을 표본처럼 보여 준다. 세로 면주와 하단 러닝 타이틀이 페이지 바깥 축에서 전체 구조를 묶는다.",summary:"2005년 3월 Sasa[44]가 친구 계성수의 지침을 따라 사흘간 뉴욕을 여행한 기록집. 타임아웃 뉴욕의 정보지 형식을 빌려 여행 지시문, 현장 사진, 수집한 신문과 소품 이미지를 병치해 도시 체험을 개인적 여행 매뉴얼이자 시각 아카이브로 재구성한다.",why_dim:"타임아웃 뉴욕과 유사한 휴대용 소형 판형을 차용해 실제 여행 가이드처럼 손에 쥐고 읽기 좋으며, 지시문·사진·수집물 이미지를 압축적으로 운영하기 적합한 크기다.",why_margin:"작은 판형 안에서 텍스트 블록과 이미지 그리드를 또렷하게 유지하기 위해 여백을 비교적 균일하게 두고, 하단 여백은 쪽번호와 러닝 타이틀을 안정적으로 고정하는 바닥선 역할을 한다.",why_font:"도시 여행 가이드의 즉시성과 표지판 같은 정보 전달에는 중립적 고딕이 적합하고, 본문 설명과 인용, 일부 신문·가이드북 참조 인상에는 명조 계열이 보조적으로 작동한다. 정보지와 기록물의 이중 성격을 살리기 위해 산문과 데이터성 요소를 서로 다른 톤으로 구분한 것으로 보인다.",why_tracking:"작은 판형에서도 사진 캡션과 지시문을 빠르게 훑을 수 있도록 본문은 중립적 자간으로 유지하고, 섹션 헤드와 면주에는 다소 벌어진 자간을 적용해 정보 블록 간 구획을 선명하게 만든 것으로 보인다.",layout_type:"본문 2단"},
  {g:"아트이론·비평",pub_type:"아카이브",t:"보고서 (공지가 아닙니다)",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/report-not-announcement-book-kr/",img:"243_보고서 (공지가 아닙니다)",kw:["아트이론·비평","아카이브","보고서","(공지가","아닙니다)","본문은","한쪽으로","정렬된","짧은","산문과","목록형","미상"],align_title:"중앙 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:110,h:180},m:{상:24,하:22,안:14,밖:14},c:{구성:"1단",간격:0},b:{크기:7.5,행간:12,자간:0},ty:{이름:"미상",분류:"명조"},pn:"하단-중앙-가로",pn_x_left:"52.4mm",pn_y_left:"163.6mm",pn_x_right:"52.4mm",pn_y_right:"163.6mm",pn_size:"7.5pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"7pt",subheading:"12pt",footnote:"7.5pt",특:"본문은 한쪽으로 정렬된 짧은 산문과 목록형 텍스트를 작은 텍스트 블록으로 얹고, 반대쪽에는 드로잉이나 메모 이미지를 고립된 오브제처럼 배치한다. 제목과 필자명은 상단에 작게 놓이고, 페이지 대부분을 비워 두는 방식으로 이동 중의 단상과 보고의 단편성을 강조한다.",summary:"여행이 잦은 미술가, 저술가, 큐레이터 33명이 ‘유동성의 현 상태’를 성찰한 온라인 프로젝트를 기록한 책. 포켓판 페이퍼백의 형식을 빌려 짧은 산문, 인터뷰, 메모, 목록형 텍스트를 담아 이동과 경계, 분리와 접속의 감각을 건조하고 절제된 편집으로 묶어낸다.",why_dim:"여행자의 길벗처럼 손에 들고 이동하며 읽기 좋은 작은 판형을 택해, 유동성과 이동성을 다루는 프로젝트의 주제를 책의 물성으로 직접 연결한다.",why_margin:"작은 판형 안에서도 텍스트가 숨 쉴 수 있도록 넉넉한 안 여백과 상단 여백을 확보하고, 하단에는 쪽번호만 남겨 읽기의 리듬을 최대한 방해하지 않는 정적 판면을 만든다.",why_font:"에세이와 기록문에는 문헌적이고 사적인 톤을 지닌 명조 계열이 적합하고, 필자명이나 구조 표지에는 중립적 고딕을 사용해 온라인 프로젝트의 아카이브적 질서를 정돈한 것으로 보인다.",why_tracking:"자간 개입을 최소화한 중립적 조판으로 짧은 텍스트 블록의 고요한 리듬을 유지하고, 작은 판형에서도 문장 사이 밀도가 과해 보이지 않도록 안정적인 회색면을 형성한 것으로 보인다.",layout_type:"본문 1단"},
  {g:"문학",pub_type:"전시도록",t:"박미나 1995~2005",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/meena-park-1995-2005-kr/",img:"244_박미나 1995~2005",kw:["문학","전시도록","박미나","1995~2005","인터뷰와","대담","페이지는","개의","텍스트","블록을","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:188,h:256},m:{상:7,하:14,안:14,밖:14},c:{구성:"2단",간격:8},b:{크기:8.5,행간:11,자간:0},ty:{이름:"미상",분류:"고딕"},pn:"상단-우측-가로",pn_x_left:"154mm",pn_y_left:"7.5mm",pn_x_right:"154mm",pn_y_right:"7.7mm",pn_size:"8.5pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"13pt",footnote:"-",특:"인터뷰와 대담 페이지는 두 개의 텍스트 블록을 느슨하게 분리해 상단에 배치하고, 도판 페이지는 작품의 실제 비례를 반영해 이미지 크기를 가변적으로 조정한다. 어떤 작품은 한 페이지에 단독으로 크게 놓이고, 어떤 작품은 서로 다른 폭의 이미지가 병렬 배치된다. 상단의 작은 러닝 헤드와 하단 중앙 쪽번호만 남겨 전체 판면은 매우 절제된 상태를 유지한다.",summary:"박미나의 1995~2005년 작업을 묶은 작가 모노그래프로, 인터뷰와 비평 대담, 작품 도판, 실제 작품 크기를 반영한 재현 방식을 통해 색채와 사물, 회화와 설치의 관계를 아카이브적으로 정리한다. 표지 없이 투명 플라스틱 덧표지와 노출 제본을 사용하고, 한국어 에세이는 별책으로 삽입해 본책과 부록의 위계를 분리한다.",why_dim:"작품의 실제 크기 차이를 도판 안에서 충분히 반영하고 한영 텍스트와 인터뷰, 작품 목록을 안정적으로 수용하기 위한 중대형 세로 판형이다. 별책까지 동일 판형으로 맞춰 본책과 부록을 하나의 세트처럼 인식하게 한다.",why_margin:"도판의 실제 크기 감각과 장문의 인터뷰 텍스트를 함께 유지하기 위해 상단과 안쪽에 여유를 두고, 하단은 캡션과 쪽번호가 과장 없이 머무는 얕은 여백으로 정리한다. 넓은 빈 공간은 작품의 물리적 비례를 강조하고 노출 제본 구조의 실험성을 더 선명하게 드러낸다.",why_font:"작품 재현의 객관성과 인터뷰 텍스트의 중립적 전달을 위해 장식성이 적은 고딕 계열을 택한 것으로 보인다. 표지 없는 구조와 투명 덧표지, 실측 도판 같은 개념적 장치를 과도하게 해석하지 않고 명료하게 드러내기 위해 정보성 높은 서체가 적합하다.",why_tracking:"자간 개입을 최소화한 중립적 조판으로 도판과 텍스트가 서로 경쟁하지 않게 하고, 작품 실측 재현과 아카이브적 정보 구성이 차갑고 정확한 인상으로 읽히도록 조정한 것으로 보인다.",layout_type:"본문 2단"},
  {g:"현대미술",pub_type:"실험출판",t:"쑈쑈쑈—‘쇼는 계속되어야 한다’를 재활용하다",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/show-show-show-kr/",img:"245_쑈쑈쑈—‘쇼는 계속되어야 한다’를 재활용하다",kw:["현대미술","실험출판","쑈쑈쑈","‘쇼는","계속되어야","한다’를","재활용하다","한쪽","방향에서는","한국어가","반대","영어가","미상"],align_title:"좌측 정렬",align_body:"양끝 정렬",align_note:"좌측 정렬",f:{w:148,h:210},m:{상:8,하:8,안:10,밖:5},c:{구성:"1단",간격:0},b:{크기:9,행간:15,자간:0},ty:{이름:"미상",분류:"명조"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"8pt",subheading:"10pt",footnote:"6.5pt",특:"한쪽 방향에서는 한국어가, 반대 방향에서는 영어가 정방향이 되도록 텍스트를 뒤집어 배치하며, 이미지 역시 공연 스틸과 리허설 사진이 서로 맞은편에서 대응하도록 설계했다. 표지와 본문에 세로로 놓인 제목, 면주, 쪽번호가 책의 회전 동작을 유도하고, 검은 공연 이미지와 넓은 여백의 텍스트 페이지가 교차하며 강한 리듬을 만든다.",summary:"Sasa[44]의 아르코 예술극장 공연 작품을 기록한 책으로, 제롬 벨의 『쇼는 계속되어야 한다』를 한국적 맥락으로 ‘번역’한 시도를 텍스트와 스틸 이미지로 재구성한다. 한국어와 영어를 책의 양쪽 방향에 뒤집어 배치하고, 실제 공연 비디오의 스틸과 리허설 사진을 반대편 페이지에서 마주 보게 배열해 번역과 재연, 대칭과 전도의 구조를 책 전체에 심는다.",why_dim:"공연 스틸과 텍스트를 한 화면처럼 다루기 좋은 표준적인 세로 판형으로, 양방향 읽기 구조와 중철 제본의 가벼운 물성을 구현하기에 적합하다. 얇은 분량의 책을 빠르게 뒤집고 양쪽 방향으로 읽게 만드는 데도 알맞은 크기다.",why_margin:"두 방향으로 읽히는 구조 안에서도 텍스트와 이미지가 흔들리지 않도록 비교적 균일한 여백을 두고, 바깥쪽에는 세로 면주를 위한 좁은 띠를 남긴다. 중앙 여백은 양면의 반전 구조를 또렷하게 인식시키는 축으로 작동한다.",why_font:"공연 기록물의 즉시성과 번역 개념의 구조적 명료함을 살리기 위해 장식성이 적은 고딕 계열을 사용한 것으로 보인다. 양방향 독서, 세로 제목, 면주, 스틸 캡션 같은 정보 장치를 일관된 톤으로 통제하기에도 적합하다.",why_tracking:"뒤집힌 양방향 조판에서도 판독성을 유지하기 위해 본문은 중립적 자간으로 두고, 세로 제목과 구조 표지 요소에는 약간 벌어진 자간을 적용해 회전된 상태에서도 정보 블록을 선명히 식별하게 한 것으로 보인다.",layout_type:"본문 1단 가변"},
  {g:"현대미술",pub_type:"단행본",t:"말나무 / 보이지 않는 기하학 / 로베르 필리우",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/tree-speak-invisible-geometry-robert-filliou-kr/",img:"246_말나무 - 보이지 않는 기하학 - 로베르 필리우",kw:["현대미술","단행본","말나무","/","보이지","않는","기하학","로베르","필리우","색면이","강한","참고문헌","페이지와","극도로","절제된","미상"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:150,h:150},m:{상:6,하:6,안:6,밖:6},c:{구성:"1단",간격:0},b:{크기:7,행간:8,자간:0},ty:{이름:"미상",분류:"고딕"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"-",running:"-",subheading:"-",footnote:"-",특:"색면이 강한 참고문헌 페이지와 극도로 절제된 타이포 페이지, 공공조형물 사진 페이지가 서로 다른 밀도로 교차한다. 한쪽에서는 작은 서지 정보와 제목을 넓은 여백 속에 띄엄띄엄 배치하고, 다른 쪽에서는 공공조형물의 단어 조각을 이미지처럼 다룬다. 일부 페이지는 연속 이미지를 넘기며 움직임을 감지하게 하는 플립북 구조를 사용해 책 자체를 시간 기반 매체처럼 작동시킨다.",summary:"홍승혜가 서울 마로니에공원에 설치한 공공미술 작품과 그 개념적 배경을 다루는 연계 간행물. 세 개의 텍스트 축과 작품 이미지를 정방형 판형 안에 배치하고, 조형물 디자인 과정을 플립북 애니메이션처럼 보여 주며 공공 조형, 언어, 기하학, 로베르 필리우에 대한 참조를 하나의 출판물로 묶어낸다.",why_dim:"정방형 판형을 사용해 공공조형물의 기하학적 성격과 플립북 시퀀스의 프레임성을 동시에 강조하고, 텍스트와 이미지가 상하·좌우 어느 쪽으로도 치우치지 않게 배치되도록 했다.",why_margin:"정방형 판면 안에 작은 텍스트 블록과 도판, 플립북 시퀀스를 각각 독립된 사건처럼 놓기 위해 여백을 균일하게 유지하고, 페이지 가장자리의 빈 공간이 기하학적 질서와 느린 읽기 리듬을 강화한다.",why_font:"공공미술과 기하학, 언어 조형을 다루는 책의 개념을 과장 없이 명확하게 드러내기 위해 중립적이고 구조가 선명한 고딕 계열이 적합하다. 정방형 판면 안에서 단어를 조형 요소처럼 다루고, 참고문헌과 제목, 캡션을 하나의 질서 안에 묶는 데도 효과적이다.",why_tracking:"단어를 조형물처럼 띄워 배치하면서도 작은 본문과 서지 정보의 판독성을 유지하기 위해 과도한 압축 없이 비교적 중립적인 자간을 사용하고, 제목과 키워드는 약간 벌어진 호흡으로 두어 공간감과 개념적 분절을 강화한 것으로 보인다.",layout_type:"본문 1단"},
  {g:"시각문화·매체",pub_type:"단행본",t:"nature.gif/nature.jpg",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/nature-gif-nature-jpg-kr/",img:"247_nature.gif-nature.jpg",kw:["시각문화·매체","단행본","nature.gif/nature.jpg","페이지","안에","동일한","풍경","이미지를","여러","프랭클린","고딕"],align_title:"-",align_body:"-",align_note:"좌측 정렬",f:{w:170,h:235},m:{상:5,하:36,안:4,밖:5},c:{구성:"1단",간격:0},b:{크기:6,행간:7,자간:0},ty:{이름:"프랭클린 고딕",분류:"고딕"},pn:"-",pn_x_left:null,pn_y_left:null,pn_x_right:null,pn_y_right:null,pn_size:"-",pn_font:"-",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"-",footnote:"7pt",특:"한 페이지 안에 동일한 풍경 이미지를 여러 압축 조건으로 반복 배치하고, 각 이미지 옆에 해상도·색수·전송 시간 같은 기술 정보를 붙인다. 우측의 색상 막대와 십자 기호, 회색 단계 막대가 실험 장비처럼 반복되며, 이미지 자체보다 비교 체계가 지면의 주인공이 되는 구조다.",summary:"GIF와 JPEG 압축 기술의 차이를 하나의 풍경 이미지에 단계별로 적용해 비교한 실험적 출판물. 파일 형식, 색수, 해상도, 전송 시간 같은 메타데이터를 함께 제시하며, 디지털 이미지의 손상과 명료성, 인터넷 유통 구조를 인쇄 지면 위에서 분석적으로 드러낸다.",why_dim:"압축 단계가 다른 이미지를 반복 비교하고, 좌측 설명 텍스트와 우측 색상 막대·기호를 함께 수용하기에 적합한 중형 세로 판형이다. 실험 도판의 차이를 한눈에 관찰할 수 있는 충분한 이미지 크기와 주변 정보 영역을 동시에 확보한다.",why_margin:"반복되는 실험 이미지와 메타데이터가 일정한 좌표 위에 놓이도록 균일한 여백을 유지하고, 가장자리 여백은 설명문과 색상 견본, 기호를 이미지 본체와 분리하는 완충 구역으로 작동한다.",why_font:"기술 정보, 파일 포맷, 수치 데이터를 빠르게 식별하게 하려면 획이 단단하고 압축적인 고딕 계열이 적합하다. 프랭클린 고딕은 실험 보고서 같은 건조한 인상을 유지하면서도 작은 크기의 메타데이터를 안정적으로 읽히게 한다.",why_tracking:"작은 기술 정보와 수치가 반복해서 등장하는 구성에서 문자 뭉침을 피하고 비교 독해를 돕기 위해 과도하게 조이지 않은 중립적 자간을 유지하고, 제목과 라벨은 약간 벌어진 자간으로 정보 블록 간 층위를 분명히 한 것으로 보인다.",layout_type:"주석 1단"},
  {g:"건축·공간",pub_type:"잡지·저널",t:"1/4—방향 감각",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/orientatie-kr/",img:"248_1-4—방향 감각",kw:["건축·공간","잡지·저널","1/4","방향","감각","평소에는","차분한","저널","형식으로","읽히지만","미상"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:240,h:221},m:{상:11,하:13,안:12,밖:52},c:{구성:"9단",간격:4},b:{크기:9.5,행간:11,자간:0},ty:{이름:"미상",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"중앙-중앙-세로 (좌)",pn_x_left:"135.3mm",pn_y_left:"105.5mm",pn_x_right:null,pn_y_right:null,pn_size:"23pt",pn_font:"고딕",pn_style:"흑색 / 세로 / 숫자",running:"8.5pt",subheading:"29pt",footnote:"6pt",특:"평소에는 차분한 2단 저널 형식으로 읽히지만, 중간중간 거꾸로 뒤집힌 사진과 캡션 페이지가 삽입되어 독자의 방향 감각을 흔든다. 분홍색 작은 캡션 블록과 큰 검은 숫자, 사선 화살표, 거꾸로 놓인 풍경 사진이 본문 사이에서 돌출되며, 정방향 독서를 끊고 회전 동작을 요구한다.",summary:"퀸스트하위스 SYB의 네 호 한정 저널 첫 호로, ‘방향 감각’을 주제로 네덜란드의 외딴 미술 공간과 한국 사이의 지리적 거리를 텍스트와 이미지의 개념적 어긋남으로 번역한 출판물. 편집자들이 설명한 SYB 주변 풍경에 엉뚱하게 대응하는 서울 근교의 사진을 촬영해 본문 사이에 거꾸로 삽입하고, 독서의 방향감 자체를 흔드는 방식으로 주제를 시각화한다.",why_dim:"기성 저널의 판형과 분량을 유지한 상태에서, 본문 중간에 삽입되는 전도된 이미지와 캡션 페이지가 기존 구조를 교란하면서도 무리 없이 수용되도록 한 판형으로 보인다.",why_margin:"기존 저널 구조 안에서 일반 본문과 뒤집힌 사진-캡션 페이지가 공존해야 하므로 균일한 여백을 유지하되, 삽입 이미지가 회전되어도 판면의 중심을 잃지 않게 충분한 빈 공간을 남긴다. 여백은 방향 상실과 정적 긴장을 동시에 만드는 장치다.",why_font:"저널의 기본 정보 구조를 중립적으로 유지하면서도, 삽입된 캡션과 방향 지시 요소를 명료하게 드러내기 위해 구조가 선명한 고딕 계열이 적합하다. 회전된 이미지와 분홍색 텍스트 블록이 등장해도 활자 체계가 흔들리지 않고 전체 편집 질서를 붙잡아 준다.",why_tracking:"정상 본문에서는 안정적인 읽기 리듬을 위해 중립적 자간을 유지하고, 분홍색 삽입 캡션과 방향 표지 요소는 약간 벌어진 자간으로 처리해 회전된 이미지 속에서도 별도의 층위로 즉시 인식되게 한 것으로 보인다.",layout_type:"본문 2단(각 4열) + 중앙 1열 공백"},
  {g:"아트이론·비평",pub_type:"잡지·저널",t:"DT1",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/dt-1-kr/",img:"249_DT1",kw:["아트이론·비평","잡지·저널","DT1","표지에서는","거대한","녹색","이니셜과","숫자를","배경처럼","윤고딕","윤명조"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:186,h:248},m:{상:15,하:8,안:20,밖:20},c:{구성:"12단",간격:4},b:{크기:8,행간:14,자간:0},ty:{이름:"윤고딕 / 윤명조",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-중앙-가로",pn_x_left:"91.5mm",pn_y_left:"8.2mm",pn_x_right:"91.2mm",pn_y_right:"8.2mm",pn_size:"8pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"6.5pt",subheading:"8pt",footnote:"6pt",특:"표지에서는 거대한 녹색 이니셜과 숫자를 배경처럼 깔고, 그 위에 창간 정신 13개 조항을 얹어 선언문과 표지를 하나의 장으로 결합한다. 본문에서는 좌측에 장문 비평 텍스트를 느슨하게 놓고 우측에는 도판을 큼직하게 배치하며, 상단 러닝 헤드와 소제목은 아주 작게 눌러 전체 긴장을 낮춘다.",summary:"몇몇 저술가, 미술가, 디자이너가 공동 기획·편집한 부정기 간행물의 창간호. 내용은 진지하지만 접근 방식은 학술지보다 실험적이며, 앞뒤가 불분명한 표지와 창간 정신을 나열한 목록형 선언, 본문 속 이미지-텍스트 병치를 통해 비평과 디자인의 네트워크적 태도를 드러낸다.",why_dim:"장문의 비평 텍스트와 도판, 선언적 표지 조형을 함께 수용하면서도 저널보다 약간 큰 밀도로 읽히게 하는 중대형 판형이다. 실험적 편집과 학술적 독서를 동시에 감당할 수 있는 균형 잡힌 크기다.",why_margin:"큰 표지 타이포와 본문 상단의 느슨한 정보 배치, 우측 도판의 여백 호흡을 유지하기 위해 상단과 바깥 여백을 비교적 넉넉하게 두고, 좌측 텍스트 블록과 이미지가 서로 침범하지 않도록 판면을 정리한다.",why_font:"표지와 선언문, 정보 구조에는 단단하고 구조적인 윤고딕이 적합하고, 장문 비평과 본문 읽기에는 윤명조가 문헌적 리듬을 제공한다. 실험적 저널의 제도성과 비평성을 동시에 드러내기 위해 고딕과 명조를 역할별로 분리한 선택으로 보인다.",why_tracking:"본문은 안정적인 독해를 위해 중립적 자간을 유지하되, 표지의 선언 조항과 큰 이니셜 주변 정보는 다소 벌어진 자간으로 두어 층위와 긴장감을 만들고, 실험적 표지 조형이 답답해 보이지 않게 한 것으로 보인다.",layout_type:"본문 1단(8열) + 주석 2단(5열)"},
  {g:"건축·공간",pub_type:"잡지·저널",t:"퍼스펙타 36—병치",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/perspecta-36-juxtapositions-kr/",img:"250_퍼스펙타 36—병치",kw:["건축·공간","잡지·저널","퍼스펙타","36","병치","표지에서는","단어","빈도와","길이를","원형과","축으로","미상"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:229,h:305},m:{상:15,하:19,안:22,밖:21},c:{구성:"5단",간격:5},b:{크기:9,행간:11,자간:0},ty:{이름:"미상",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"중앙하단-외측-세로",pn_x_left:"4.3mm",pn_y_left:"208mm",pn_x_right:"219.5mm",pn_y_right:"208mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"6pt",subheading:"15pt",footnote:"6pt",특:"표지에서는 단어 빈도와 글 길이를 원형과 선, 축으로 환산한 다이어그램이 본책과 덧표지 사이에 분산되어 인쇄된다. 본문에서는 정식 논문과 비격식 텍스트가 병치되고, 반투명한 종이에 인쇄된 회화·사진이 일정 간격으로 삽입되어 다음 장의 본문과 우연한 중첩 효과를 만든다. 이미지 위에 본문이 비쳐 보이거나, 도면과 사진이 반투명하게 겹치며 ‘병치’라는 주제가 물리적 독서 경험으로 전환된다.",summary:"예일 건축 대학의 학술 저널 『Perspecta』 36호로, ‘병치’라는 주제 아래 정식 논문과 비격식 대화, 반투명 삽지 위의 회화와 사진을 중첩시키는 편집을 통해 건축 담론의 다층적 독해를 시도한다. 표지에서는 글의 길이와 특정 단어의 출현 빈도를 시각화한 도표를 본책과 반투명 덧표지에 나누어 인쇄해, 두 층이 겹쳐질 때만 완성되는 구조를 만든다.",why_dim:"학술 저널의 긴 본문, 도판, 도표, 반투명 삽지의 중첩 효과를 충분히 보여 주기 위한 대형 판형이다. 건축 담론 특유의 넓은 여백과 복수 이미지 비교, 레이어드된 정보 구조를 안정적으로 수용한다.",why_margin:"도표와 본문, 투명 삽지의 중첩을 각기 독립된 층으로 인식하게 하기 위해 넓은 상단과 바깥 여백을 두고, 본문과 이미지가 숨 쉴 수 있는 중립적 공간을 확보한다. 여백은 학술 저널의 질서와 실험적 병치를 동시에 지지하는 바탕면이다.",why_font:"건축 학술 저널의 정보 밀도와 도표, 캡션, 러닝 헤드, 투명 삽지 위 텍스트를 일관되게 통제하려면 구조가 명확한 고딕 계열이 적합하다. 중립적 활자 체계는 복잡한 중첩 효과 속에서도 독해를 안정시키고, 표지 다이어그램의 계측적 인상을 강화한다.",why_tracking:"본문과 캡션은 학술 저널답게 중립적 자간으로 판독성을 유지하고, 표지 타이틀과 다이어그램 주변의 정보 요소는 약간 벌어진 자간으로 두어 층위와 간격감을 명확히 한 것으로 보인다.",layout_type:"본문 1, 2단 가변(각 3 2열) + 주석 5단 (각 1열)"},
  {g:"건축·공간",pub_type:"잡지·저널",t:"퍼스펙타 35—건축 법규",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/perspecta-35-building-codes-kr/",img:"251_퍼스펙타 35—건축 법규",kw:["건축·공간","잡지·저널","퍼스펙타","35","건축","법규","기본","구조는","차분한","학술","저널의","미상"],align_title:"우측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:229,h:305},m:{상:16,하:20,안:8,밖:10},c:{구성:"4단",간격:8},b:{크기:10,행간:15,자간:0},ty:{이름:"미상",분류:"혼합 (명조 / 고딕 / 디스플레이)"},pn:"상단-우측-가로",pn_x_left:"167.5mm",pn_y_left:"5mm",pn_x_right:"396.1mm",pn_y_right:"5mm",pn_size:"10pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"7pt",subheading:"-",footnote:"9pt",특:"기본 구조는 차분한 학술 저널의 2단 본문과 도판 배치이지만, 일정 간격마다 더 작은 판형의 청색 브리프가 본문 흐름과 무관하게 삽입된다. 브리프는 배경 페이지의 상태를 반향하며 어떤 장에서는 본문 위에 반투명하게 겹쳐지고, 어떤 장에서는 독립된 청색 면으로 또렷하게 부상한다. 큰 본문 활자와 작은 삽지의 스케일 차이가 읽기의 거리와 속도를 반복적으로 재조정한다.",summary:"예일 건축 대학의 학술 저널 『Perspecta』 35호로, 건축 법규를 주제로 본격적 논문과 보다 사적이고 스케치 같은 ‘브리프’를 교차 배치한다. 큰 판형의 본문 속에 작은 크기의 청색 삽지 브리프가 16쪽 간격으로 끼어들며, 학술적 독해의 흐름을 끊고 다른 목소리와 속도를 삽입하는 구조를 만든다.",why_dim:"큰 판형의 학술 저널 형식을 유지해 장문 논문, 도판, 각주를 안정적으로 수용하면서도, 그 사이에 더 작은 청색 브리프 삽지가 들어와 축소된 읽기 스케일을 대비시키기에 적합하다. 판형 자체가 독서 거리와 정보 위계를 조정하는 장치로 작동한다.",why_margin:"큰 판형 안에서 장문 본문과 도판, 각주를 숨 쉬게 하고, 삽지 브리프가 배경 페이지 위에 얹힐 때도 서로 간섭하지 않도록 넓은 상단과 바깥 여백을 확보한다. 여백은 학술적 안정감과 삽입 요소의 돌출감을 동시에 조율하는 장치다.",why_font:"건축 학술 저널의 복잡한 정보 구조와 각주, 러닝 헤드, 삽지 위의 짧은 브리프를 일관되게 다루기 위해 중립적이고 계측적인 고딕 계열이 적합하다. 큰 판형의 본문을 안정적으로 읽히게 하면서도 삽지의 개입을 과장 없이 구조적으로 드러내는 선택이다.",why_tracking:"장문 논문과 각주의 가독성을 위해 본문은 중립적 자간으로 유지하고, 청색 브리프와 러닝 헤드의 얇은 정보 요소는 약간 벌어진 자간으로 층위를 나누어 큰 판형 안에서도 정보 블록을 명료하게 식별하게 한 것으로 보인다.",layout_type:"본문 2단(각 1열) + 주석 4단(각 1열)"},
  {g:"아트이론·비평",pub_type:"기관출판",t:"얀 반 에이크 미술원 2003년 연차 보고서",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/jan-van-eyck-academie-annual-report-2003-kr/",img:"252_얀 반 에이크 미술원 2003년 연차 보고서",kw:["아트이론·비평","기관출판","얀","반","에이크","미술원","2003년","연차","보고서","거의","모든","펼침에서","중앙","부근을","세로","쿠리어","푸투라"],align_title:"좌측 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:240,h:328},m:{상:9,하:11,안:52,밖:16},c:{구성:"2단",간격:11},b:{크기:8,행간:11,자간:0},ty:{이름:"쿠리어 뉴 / 푸투라",분류:"고딕"},pn:"하단-외측-가로",pn_x_left:"44.8mm",pn_y_left:"319.5mm",pn_x_right:"189.9mm",pn_y_right:"319.5mm",pn_size:"15pt",pn_font:"고딕",pn_style:"흑색 / 가로 / 숫자",running:"8.5pt",subheading:"13.5pt",footnote:"8pt",특:"거의 모든 펼침에서 중앙 부근을 세로 데이터 스트립이 관통하며, 좌우로 네덜란드어와 영어 본문 또는 제목과 이미지가 배치된다. 어떤 페이지는 푸투라의 거대한 표제가 회색 바탕 위에서 단독으로 서고, 어떤 페이지는 쿠리어 뉴 목록이 지면 전체를 패턴처럼 덮는다. 사진과 문서는 보고서 안의 증거물처럼 삽입되며, 데이터 띠가 각 섹션을 동일한 구조 안으로 묶는다.",summary:"얀 반 에이크 미술원의 2003년 활동을 정리한 연차 보고서. 프로그램, 포트폴리오, 이미지 크레디트, 조직 구조, 수집된 기록물 등을 네덜란드어와 영어 병기로 제시하며, 중앙을 가로지르는 세로 데이터 스트립과 쿠리어 뉴의 기계적 목록, 푸투라의 굵은 제목을 결합해 행정 문서와 실험적 디자인 출판의 중간 지점을 만든다.",why_dim:"연차 보고서에 필요한 방대한 목록, 이중언어 본문, 사진, 표제 페이지를 안정적으로 수용하기 위한 대형 세로 판형이다. 기관 문서의 양과 위계를 펼침면 전체에서 시각적으로 조직하기에 적합하다.",why_margin:"넓은 회색 바탕 위에 굵은 제목, 본문 블록, 사진, 세로 데이터 띠를 서로 충돌 없이 배치하기 위해 바깥 여백과 상단 여백을 넉넉하게 확보한다. 여백은 행정 정보의 밀도와 이미지의 침묵 사이를 중재하는 평면으로 작동한다.",why_font:"기계적 기록과 데이터 열, 파일명, 목록성 정보에는 등폭의 쿠리어 뉴가 적합하고, 기관명과 섹션 표제처럼 위계가 큰 요소에는 구조적이고 압축적인 푸투라가 적합하다. 두 서체를 병치해 행정 문서의 객관성과 디자인 기관의 실험성을 동시에 드러낸다.",why_tracking:"세로 데이터 스트립의 작은 등폭 텍스트는 정보 압축을 위해 중립적 자간을 유지하고, 푸투라의 대형 제목과 이중언어 표제는 약간 벌어진 자간으로 두어 넓은 회색 면에서 또렷한 구조를 형성하게 한 것으로 보인다.",layout_type:"본문 2단 가변"},
  {g:"문학",pub_type:"실험출판",t:"최슬기 미로",designer:"슬기와 민 (Sulki and Min)",src:"https://www.sulki-min.com/wp/labyrinth-kr/",img:"253_최슬기 미로",kw:["문학","실험출판","최슬기","미로","차례","페이지에서는","제목","페이지","번호","단어들이","미상"],align_title:"중앙 정렬",align_body:"좌측 정렬",align_note:"좌측 정렬",f:{w:127,h:203},m:{상:9,하:16,안:8,밖:13},c:{구성:"1단",간격:0},b:{크기:7,행간:9,자간:0},ty:{이름:"미상",분류:"명조"},pn:"하단-중앙-가로(우)",pn_x_left:null,pn_y_left:null,pn_x_right:"59.4mm",pn_y_right:"188mm",pn_size:"8pt",pn_font:"명조",pn_style:"흑색 / 가로 / 숫자",running:"-",subheading:"9pt",footnote:"-",특:"차례 페이지에서는 제목·페이지 번호·단어들이 원래의 줄글 구조를 잃고 펼침면 전체에 흩어진다. 본문에서는 단어가 사라진 자리마다 화살표, 점선, 원, 좌표 같은 기호가 남아 방향 지시와 길찾기의 잔해처럼 기능한다. 어떤 페이지는 거의 백지에 가까울 만큼 비어 있고, 어떤 페이지는 미세한 지도 기호가 한쪽 구역에만 밀집해 독자를 시선의 미로로 끌어들인다.",summary:"호르헤 루이스 보르헤스의 단편 소설집 『미로』의 차례를 출발점으로 삼아, 모든 단어를 표준 거리 지도 기호로 치환한 실험적 출판물. 원래의 문학적 논리는 사라지고, 대신 차례·면주·본문·도판이 기호와 숫자, 화살표, 선분의 체계로 재구성되며 수수께끼 같은 독서 환경을 만든다.",why_dim:"차례의 단어들을 지도 기호 체계로 대치한 미세한 선·기호 조합과 넓은 빈 공간을 유지하려면, 기호들이 숨 쉬는 여백과 정밀한 배치를 확보할 수 있는 판형이 필요했을 것으로 보인다.",why_margin:"극도로 적은 기호와 숫자, 선분이 넓은 빈 면 위에서 방향감과 불확실성을 형성하도록 여백을 크게 남긴다. 여백은 단순한 빈 공간이 아니라 독해의 망실과 미로적 배회를 발생시키는 구조적 장치다.",why_font:"원본 차례의 문학적 출처와 보르헤스적 분위기를 유지하는 데에는 명조 계열이 어울리지만, 실제 책의 핵심은 활자보다 지도 기호 체계의 조합에 있다. 따라서 문자와 기호가 동등한 표지 체계로 다뤄지며, 읽기와 보기 사이를 오가는 인상을 만든다.",why_tracking:"기호와 숫자가 서로 충돌하지 않고 개별 사건처럼 떠 보이게 하기 위해 비교적 벌어진 자간과 느슨한 간격을 유지하고, 일부 단어는 분절 배치로 처리해 언어가 해체되는 감각을 강화한 것으로 보인다.",layout_type:"주석 1단"}
];

const GENRE_KW = {
  "타이포그래피":   ["타이포","서체","폰트","글꼴","자간","행간","레터링","캘리그래피","활자","조판"],
  "아트이론·비평":  ["이론","비평","에세이","텍스트","개념","담론","철학","미학","비판"],
  "시각문화·매체":  ["시각","미디어","매체","이미지","사진","영상","스크린","디지털","인쇄"],
  "건축·공간":      ["건축","공간","도시","파빌리온","설치","환경","장소","구조","재료"],
  "그래픽디자인":   ["그래픽","디자인","브랜딩","아이덴티티","포스터","출판","인쇄","일러스트"],
  "전시·큐레이션":  ["전시","큐레이션","도록","카탈로그","갤러리","미술관","컬렉션","아카이브"],
  "현대미술":       ["현대미술","회화","조각","설치","퍼포먼스","개념미술","작가","작품"],
  "문학":           ["문학","시","소설","에세이","산문","글쓰기","서사","언어","텍스트"],
  "사진":           ["사진","포토그래피","이미지","앨범","다큐멘터리","포트폴리오","촬영"],
  "인문·사회":      ["인문","사회","역사","문화","연구","학술","논문","비평","분석"],
  "기타":           [],
};




// Compute actual column width in mm given publication params

// ── Layer 3: Sulki & Min Style Principles ──────────────────────
const STYLE_PRINCIPLES = [
  {principle:"행간은 본문 크기의 1.5~2.0배로 설정한다"},
  {principle:"상 여백은 하 여백보다 작게, 안 여백은 밖 여백보다 크게 설정하는 경향이 있다"},
  {principle:"서체 분류는 장르의 성격보다 편집 의도에 따라 결정한다"},
  {principle:"자간은 서체 분류와 내용 밀도에 따라 -10~-40 범위에서 조정한다"},
  {principle:"판형은 콘텐츠의 텍스트/이미지 비율과 독서 방식으로 결정한다"},
  {principle:"단 구성은 콘텐츠 성격에 따라 결정하되, 실험적 출판물은 유동적 단 구성을 허용한다"},
];

// ── 타이포그래피 기본 원칙 ────────────────────────────────────────
// 출처: typography_design_rules_knowledge (rule IDs 포함)
// 용도: LaTeX 생성 시 기본 위반 방지 가드레일. 슬기와민 스타일 위에 깔리는 바닥선.
// 주의: 매 API 호출마다 전문을 전달하지 말고 요약만 프롬프트에 포함할 것.
const TYPO_BASE = {
  // MEASURE-003: 행간은 본문 호흡과 수직 리듬을 결정한다
  // 작은 글자일수록 행간 비율을 크게 → 가독성 확보
  leadingRatio: (pt) => {
    if (pt <= 7)  return 1.75;  // 각주·캡션급 (7pt↓)
    if (pt <= 9)  return 1.65;  // 각주 (8~9pt)
    if (pt <= 11) return 1.60;  // 소본문 (10~11pt)
    if (pt <= 13) return 1.55;  // 본문 (12~13pt)
    if (pt <= 16) return 1.40;  // 소제목 (14~16pt)
    if (pt <= 24) return 1.25;  // 중제목 (17~24pt)
    return 1.15;                 // 대제목 (25pt+)
  },
  // MEASURE-004 + HANGUL-003: 한글 자간은 마지막 미세 조정 수단
  // 본문 기본 0, 작은 글자는 약간 넓혀서 음절 분리 방지
  trackingForSize: (pt) => {
    if (pt <= 8)  return 20;
    if (pt <= 10) return 0;
    return -10;
  },
  // PAGE-002: 여백은 읽기 조건이다 — 판형 높이 기준 면주 크기
  runningHeadSize: (pageHeightMm) => {
    if (pageHeightMm <= 170) return 7;
    if (pageHeightMm <= 220) return 8;
    if (pageHeightMm <= 260) return 9;
    return 10;
  },
  // HIER-001: 본문 크기 기반 위계별 권장 글자 크기
  // 편집 디자인 관례: 소제목 ×1.4, 중제목 ×1.8, 대제목 ×2.2
  headingSizes: (bodyPt) => {
    const h3 = Math.round(bodyPt * 1.2 * 2) / 2;  // section: ×1.2
    const h2 = Math.round(bodyPt * 1.6 * 2) / 2;  // subtitle: ×1.6
    const h1 = Math.round(bodyPt * 2.2 * 2) / 2;  // title: ×2.2
    return { h1, h2, h3 };
  },
  // 행간 조견표 — JS 계산값 → AI에 compact string으로 전달
  // "size/leading" 쌍을 AI가 반드시 참조하도록
  leadingTable: () => {
    const pts = [7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36];
    return pts.map(pt => {
      const ratio = pt<=7?1.75:pt<=9?1.65:pt<=11?1.60:pt<=13?1.55:pt<=16?1.40:pt<=24?1.25:1.15;
      const lead = Math.round(pt * ratio * 10) / 10;
      return pt + '→' + lead;
    }).join(' ');
  },
  // GRID-001: 그리드는 반복 가능한 배치 규칙
  // 가변단 N단 입력 시 편집 디자인 관례 기반 단 조합
  // 긴 본문은 전체 단을 쓰지 않고 합쳐서 사용
  columnCombinations: (n) => {
    const combos = {
      2: [[2,0],[1,1]],
      3: [[3,0],[2,1]],
      4: [[4,0],[3,1],[2,2]],
      5: [[3,2],[4,1],[5,0]],
      6: [[4,2],[3,3],[6,0]],
    };
    return combos[n] || [[n,0]];
  },
  // HIER-001: 위계는 읽기 순서 설계 — 프롬프트 요약용 가드레일 문장
  // HANGUL-001: 한글 줄맞춤은 외곽보다 내부 간격이 중요
  // HANGUL-002: 조사는 앞말과 시각적으로 함께 읽혀야 함
  promptGuard: [
    'Different text sizes MUST have different leading ratios (MEASURE-003)',
    'Hangul tracking: adjust only as last resort, body default=0 (HANGUL-003)',
    'Margins are reading conditions, not leftover space (PAGE-002)',
    'Visual hierarchy must be readable in order: title→sub→body→caption→footnote (HIER-001)',
    'Hangul: avoid 조사 alone at line start in titles/captions (HANGUL-002)',
    'Paragraph rhythm: use indentation OR spacing, not both (PARA-002)',
  ].join(' | '),
};

// Page Preview
// ── 지면 미리보기 ─────────────────────────────────────
function PagePreview({ p, bodyText }) {
  const SC = 1.5;
  const pw = p.f.w * SC, ph = p.f.h * SC;
  const mt = p.m.상 * SC, mb = p.m.하 * SC, ml = p.m.안 * SC, mr = p.m.밖 * SC;
  const cw = pw - ml - mr, ch = ph - mt - mb;
  const nc = p.c.구성.includes("4단") ? 4 : p.c.구성.includes("3단") ? 3 :
             (p.c.구성.includes("2단") || p.c.구성.includes("좌이미지")) ? 2 : 1;
  const gut = p.c.간격 * SC;
  const cw2 = nc > 1 ? (cw - gut * (nc - 1)) / nc : cw;
  // CSS text rendering at page scale
  const fs = Math.max(5.5, p.b.크기 * SC * 0.71);
  const lh = p.b.행간 * SC * 0.71;
  const ff = p.ty.분류 === "고딕" ? "'Noto Sans KR', sans-serif" : "'Noto Serif KR', serif";
  const ls = p.b.자간 ? `${(p.b.자간/1000).toFixed(3)}em` : "normal";

  const pos = p.pn || "";
  const isB = pos.includes("하단");
  const isO = pos.includes("외측") || pos.includes("바깥");
  const isC = pos.includes("중앙");
  const pnX = isO ? pw - mr * 0.5 : isC ? pw / 2 : ml * 0.5;
  const pnY = isB ? ph - mb * 0.42 : mt * 0.36;

  return (
    <div style={{ position:"relative", background:"white", border:"1px solid #d0d0d0", width:pw, height:ph, boxShadow:"2px 4px 12px rgba(0,0,0,0.1)", flexShrink:0, overflow:"hidden" }}>
      {/* 마진 가이드 */}
      <div style={{ position:"absolute", left:ml, top:mt, width:cw, height:ch, outline:"1px dashed rgba(80,130,220,0.18)", pointerEvents:"none", zIndex:2 }} />
      {/* 열 구분선 */}
      {Array.from({length:nc-1},(_,i)=>{
        const gx = ml + (i+1)*(cw2+gut) - gut/2;
        return <div key={i} style={{ position:"absolute", left:gx, top:mt, width:1, height:ch, background:"rgba(80,130,220,0.15)", zIndex:2 }} />;
      })}
      {/* 텍스트 열 */}
      {Array.from({length:nc},(_,i)=>(
        <div key={i} style={{ position:"absolute", left:ml+i*(cw2+gut), top:mt, width:cw2, height:ch, overflow:"hidden",
          fontSize:fs, lineHeight:`${lh}px`, fontFamily:ff, letterSpacing:ls,
          color:"#1a1a1a", wordBreak:"keep-all", overflowWrap:"break-word",
          textAlign:"justify", padding:0, whiteSpace:"pre-wrap" }}>
          {bodyText || ""}
        </div>
      ))}
      {/* 쪽번호 */}
      {pos && pos !== "없음" && (
        <div style={{ position:"absolute", left:pnX, top:pnY, fontSize:7, color:"#aaa", transform:"translateX(-50%)", fontFamily:T.mono, zIndex:3 }}>1</div>
      )}
    </div>
  );
}


// ── Auto-diff LaTeX changes ──────────────────────────────────────
function diffLatex(oldCode, newCode) {
  if (!oldCode || !newCode) return [];
  const diffs = [];

  // ── 전용 추출 헬퍼: 첫 번째 매치 값 ──────────────────────────────
  const get = (str, re) => str.match(re)?.[1];

  // ── \notef 전용 (본문 fontsize보다 먼저 체크) ─────────────────────
  // 형식: \newcommand{\notef}{\rmfamily\fontsize{Xpt}{Ypt}\selectfont}
  const notef = /\\newcommand\{\\notef\}\{(?:\\[a-zA-Z]+)*\\fontsize\{([\d.]+)pt\}\{([\d.]+)pt\}/;
  const oldNote  = oldCode.match(notef);
  const newNote  = newCode.match(notef);
  if (oldNote && newNote) {
    if (oldNote[1] !== newNote[1]) diffs.push(`주석 크기: ${oldNote[1]}pt → ${newNote[1]}pt`);
    if (oldNote[2] !== newNote[2]) diffs.push(`주석 행간: ${oldNote[2]}pt → ${newNote[2]}pt`);
  }

  // ── \footnotesize (하단 각주) ─────────────────────────────────────
  const fnre = /\\renewcommand\{\\footnotesize\}\{\\fontsize\{([\d.]+)pt\}\{([\d.]+)pt\}/;
  const oldFn = oldCode.match(fnre), newFn = newCode.match(fnre);
  if (oldFn && newFn) {
    if (oldFn[1] !== newFn[1]) diffs.push(`각주 크기: ${oldFn[1]}pt → ${newFn[1]}pt`);
    if (oldFn[2] !== newFn[2]) diffs.push(`각주 행간: ${oldFn[2]}pt → ${newFn[2]}pt`);
  }

  // ── 본문 fontsize (\\selectfont 바로 앞) ──────────────────────────
  const bodyre = /\\fontsize\{([\d.]+)pt\}\{([\d.]+)pt\}\\selectfont/;
  const oldBody = oldCode.match(bodyre), newBody = newCode.match(bodyre);
  if (oldBody && newBody) {
    if (oldBody[1] !== newBody[1]) diffs.push(`본문 크기: ${oldBody[1]}pt → ${newBody[1]}pt`);
    if (oldBody[2] !== newBody[2]) diffs.push(`본문 행간: ${oldBody[2]}pt → ${newBody[2]}pt`);
  }

  // ── 여백 ─────────────────────────────────────────────────────────
  const margins = [
    [/top=([\d.]+)mm/,    '상단 여백'],
    [/bottom=([\d.]+)mm/, '하단 여백'],
    [/inner=([\d.]+)mm/,  '내측 여백'],
    [/outer=([\d.]+)mm/,  '외측 여백'],
  ];
  for (const [re, label] of margins) {
    const o = get(oldCode, re), n = get(newCode, re);
    if (o && n && o !== n) diffs.push(`${label}: ${o}mm → ${n}mm`);
  }

  // ── 자간 ─────────────────────────────────────────────────────────
  const oldLS = get(oldCode, /LetterSpace=([-\d.]+)/);
  const newLS = get(newCode, /LetterSpace=([-\d.]+)/);
  if (oldLS && newLS && oldLS !== newLS) diffs.push(`자간: ${oldLS} → ${newLS}`);

  return diffs;
}


// ── Generate editorial rationale ─────────────────────────────────
async function generateRationale(p) {
  const prompt =
    p.t + ' (' + p.g.split("/")[0].trim() + ') ' +
    p.f.w + '×' + p.f.h + 'mm ' + p.b.크기 + 'pt/' + p.b.행간 + 'pt ' + p.ty.분류 + '\n' +
    (p.why_dim     ? '판형:' + p.why_dim.slice(0,50)     + '\n' : '') +
    (p.why_margin  ? '여백:' + p.why_margin.slice(0,50)  + '\n' : '') +
    (p.why_font    ? '서체:' + p.why_font.slice(0,50)    + '\n' : '') +
    '이 편집 디자인의 핵심 의도를 한국어 3문장으로 설명해. 편집 디자이너 시각으로.';
  try {
    const res = await fetch('/anthropic/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 180,
        system: '편집 디자이너. 한국어 3문장. 핵심만.',
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    return (data.content || []).map(x => x.text || '').join('').trim();
  } catch (e) { return ''; }
}

// ── App ───────────────────────────────────────────────

// Log Actions
function LogActions({ L, allLogs, setAllLogs, setCurrentLog, includeFullPrompts, setIncludeFullPrompts }) {
  const [showJson, setShowJson] = useState(false);      // 현재 로그 JSON 뷰어
  const [showAllJson, setShowAllJson] = useState(false); // 전체 로그 JSON 뷰어
  const [copied, setCopied] = useState('');

  const logData = includeFullPrompts ? L : { ...L, prompts: { ...L.prompts, _note:"enable includeFullPrompts for full prompts" } };
  const logStr = JSON.stringify(logData, null, 2);
  const allStr = JSON.stringify(allLogs, null, 2);

  function copyText(str, key) {
    const done = () => { setCopied(key); setTimeout(() => setCopied(''), 1800); };
    const fb = () => {
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch(e) {}
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(str).then(done).catch(() => { fb(); done(); });
    } else { fb(); done(); }
  }

  const btnStyle = (accent) => ({
    padding:"5px 12px", fontSize:11.5, fontWeight:600, cursor:"pointer", borderRadius:3,
    border: accent ? "1.5px solid #c8b898" : "1.5px solid #d0d0d0",
    background: accent ? "#fff8f0" : "#fafafa",
    color: accent ? "#7a5a2a" : "#555",
  });

  return (
    <div style={{ marginTop:10 }}>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
        {/* 현재 로그 복사/보기 */}
        <button onClick={() => copyText(logStr, 'this')} style={btnStyle(true)}>
          {copied==='this' ? '✓ Copied' : '📋 Copy this log'}
        </button>
        <button onClick={() => setShowJson(v => !v)} style={btnStyle(true)}>
          {showJson ? 'Hide JSON' : 'View JSON'}
        </button>

        {/* 전체 로그 복사/보기 */}
        <button onClick={() => copyText(allStr, 'all')} style={btnStyle(false)}>
          {copied==='all' ? '✓ Copied' : `📋 Copy all (${allLogs.length}건)`}
        </button>
        <button onClick={() => setShowAllJson(v => !v)} style={btnStyle(false)}>
          {showAllJson ? 'Hide all' : 'View all'}
        </button>

        {/* Clear */}
        <button onClick={() => {
            if (window.confirm('세션 로그를 전부 삭제할까요?')) {
              _LOG_STORE.logs = []; setAllLogs([]); setCurrentLog(null);
            }
          }}
          style={{ padding:"5px 12px", fontSize:11.5, fontWeight:400, cursor:"pointer",
            border:"1px solid #e8e8e8", borderRadius:3, background:"transparent", color:"#bbb" }}>
          Clear all
        </button>

        <label style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:"#aaa", marginLeft:4, cursor:"pointer" }}>
          <input type="checkbox" checked={includeFullPrompts} onChange={e => setIncludeFullPrompts(e.target.checked)} />
          full prompts
        </label>
      </div>

      {/* 현재 로그 인라인 뷰어 */}
      {showJson && (
        <div style={{ marginTop:8, position:"relative" }}>
          <textarea readOnly value={logStr} rows={14}
            style={{ width:"100%", fontFamily:"var(--font-mono)", fontSize:10.5, lineHeight:1.5,
              border:"1px solid #e0d8cc", borderRadius:4, padding:"8px 10px",
              background:"#1a1a18", color:"#d4c9a8", resize:"vertical", boxSizing:"border-box" }}
            onClick={e => e.target.select()} />
          <div style={{ position:"absolute", top:6, right:8, fontSize:10, color:"#888" }}>클릭→전체선택</div>
        </div>
      )}

      {/* 전체 로그 인라인 뷰어 */}
      {showAllJson && (
        <div style={{ marginTop:8, position:"relative" }}>
          <div style={{ fontSize:11, color:"#aaa", marginBottom:4 }}>
            {allLogs.length}건 · 세션 종료 시 초기화됨
          </div>
          <textarea readOnly value={allStr} rows={18}
            style={{ width:"100%", fontFamily:"var(--font-mono)", fontSize:10.5, lineHeight:1.5,
              border:"1px solid #e0d8cc", borderRadius:4, padding:"8px 10px",
              background:"#1a1a18", color:"#d4c9a8", resize:"vertical", boxSizing:"border-box" }}
            onClick={e => e.target.select()} />
          <div style={{ position:"absolute", top:6, right:8, fontSize:10, color:"#888" }}>클릭→전체선택</div>
        </div>
      )}
    </div>
  );
}




// LaTeX 특수문자 escape
function escapeLatex(s) {
  return String(s || '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

// ── 주석 마커 검증: noteLatex의 \textsuperscript{N} ↔ bodyLatex의 \ImpFN{N} 쌍 확인 ──
function extractNoteNumbers(noteLatex) {
  return [...String(noteLatex || '').matchAll(/\\textsuperscript\{(\d+)\}/g)]
    .map(m => m[1]);
}

function validateNoteMarkers(bodyLatex, noteLatex) {
  const nums = extractNoteNumbers(noteLatex);
  const missing = nums.filter(n =>
    !new RegExp(`\\\\ImpFN\\{${n}\\}`).test(bodyLatex)
  );
  if (missing.length > 0) {
    throw new Error(
      `본문 마커 누락: ${missing.map(n => `\\ImpFN{${n}}`).join(', ')} — 주석에 번호가 있지만 본문에 대응 마커가 없습니다`
    );
  }
}

// escapeLatex + sanitize를 적용하되 \ImpFN{N} 마커는 손대지 않음
// side-note fallback 경로: processedBody에 이미 \ImpFN{N}이 있으므로 escape 제외
function escapeLatexPreservingImpFN(s) {
  const IMPFN_RE = /(\\ImpFN\{\d+\})/g;
  return String(s || '').split(IMPFN_RE).map((part, i) =>
    i % 2 === 0 ? escapeLatex(sanitizeUnicodeForLatex(part)) : part
  ).join('');
}

// 사용자 입력으로 본문 블록 직접 생성 (Claude fallback / 기본 구조)
// 반각 CJK 문자(U+FF61-FF9F) → 전각 등가로 치환. 한국어 폰트 대부분이 전각만 지원.
function sanitizeUnicodeForLatex(s) {
  return String(s || '')
    .replace(/｢/g, '「')  // ｢ → 「
    .replace(/｣/g, '」')  // ｣ → 」
    .replace(/｡/g, '。')  // ｡ → 。
    .replace(/､/g, '、')  // ､ → 、
    .replace(/･/g, '・')  // ･ → ・
    .replace(/[ｦ-ﾟ]/g, ''); // 나머지 반각 가타카나 제거
}

function validateNoHalfwidthCJK(name, content) {
  const bad = String(content || '').match(/[｡-ﾟ]/g);
  if (bad) {
    const unique = [...new Set(bad)].map(c => `${c}(U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')})`).join(' ');
    return `${name} 에 반각 CJK 문자가 남아 있습니다: ${unique}`;
  }
  return null;
}

// ── Semantic body parser ─────────────────────────────────────────────────

function parseFootnoteMap(footnoteText) {
  const superMap = {'¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'};
  const fnMap = {};
  if (!footnoteText || !footnoteText.trim()) return { fnMap, superMap };
  let cur = null, buf = [];
  for (const line of footnoteText.split('\n')) {
    const m1 = line.match(/^["''"「『\s]*(\d+)[.)]\s*(.+)/);
    const m2 = line.match(/^([¹²³⁴⁵⁶⁷⁸⁹])\s*(.+)/);
    if (m1)      { if (cur) fnMap[cur] = buf.join(' ').trim(); cur = m1[1]; buf = [m1[2]]; }
    else if (m2) { if (cur) fnMap[cur] = buf.join(' ').trim(); cur = superMap[m2[1]]; buf = [m2[2]]; }
    else if (cur && line.trim()) buf.push(line.trim());
  }
  if (cur) fnMap[cur] = buf.join(' ').trim();
  return { fnMap, superMap };
}

// 각주 마커 위치 anchor 추출: Claude가 \ImpFN{N}을 완전히 삭제했을 때 복원에 사용
// 반환: { '1': '앞 텍스트 최대 25자', ... }
function extractFootnoteAnchors(bodyText) {
  const anchors = {};
  // [N] 형식 마커만 대상 (원본 입력 기준)
  const re = /\[(\d+)\]/g;
  let m;
  while ((m = re.exec(bodyText)) !== null) {
    const n = m[1];
    const before = bodyText.slice(Math.max(0, m.index - 40), m.index);
    // 공백 정리 후 마지막 25자 — 한국어 3~5어절
    anchors[n] = before.replace(/\s+/g, ' ').trim().slice(-25);
  }
  return anchors;
}

// 각주 마커 사전 치환: Claude 전송 전 [N] ¹ ① ^N → \ImpFN{N}
// Claude는 미지의 LaTeX 명령을 그대로 유지하므로, 마커 손실 없이 post-processing이 \footnote{}로 치환
function preReplaceFnMarkers(bodyText) {
  if (!bodyText) return bodyText;
  const superMap = {'¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'};
  const circleMap = {'①':'1','②':'2','③':'3','④':'4','⑤':'5','⑥':'6','⑦':'7','⑧':'8','⑨':'9','⑩':'10'};
  let result = bodyText;
  // 위첨자 유니코드 (¹²³...)
  for (const [ch, n] of Object.entries(superMap)) result = result.split(ch).join(`\\ImpFN{${n}}`);
  // 원문자 (①②③...)
  for (const [ch, n] of Object.entries(circleMap)) result = result.split(ch).join(`\\ImpFN{${n}}`);
  // [N] 대괄호
  result = result.replace(/\[(\d+)\]/g, (_, n) => `\\ImpFN{${n}}`);
  // ^N 캐럿 (숫자 뒤에 다른 숫자 없을 때만)
  result = result.replace(/\^(\d+)(?!\d)/g, (_, n) => `\\ImpFN{${n}}`);
  return result;
}

function injectFnIntoEscaped(text, fnMap, superMap) {
  if (!Object.keys(fnMap).length) return text;
  const numToSuper = Object.fromEntries(Object.entries(superMap).map(([k,v]) => [v, k]));
  const nums = Object.keys(fnMap).sort((a, b) => +b - +a);
  let r = text;
  for (const n of nums) {
    const content = escapeLatex(sanitizeUnicodeForLatex(fnMap[n]));
    const sup = numToSuper[n];
    if (sup) r = r.split(sup).join(`\\footnote{${content}}`);
    r = r.replace(new RegExp('\\[' + n + '\\]', 'g'), `\\footnote{${content}}`);
    r = r.replace(new RegExp('\\^' + n + '(?!\\d)', 'g'), `\\footnote{${content}}`);
  }
  return r;
}

// Split paragraph containing inline Korean dialogue into sub-blocks.
// Matches 「...」 『...』 “...” (curly double quotes) only.
// Single quotes excluded to avoid splitting English contractions.
function splitInlineDialogue(text) {
  const re = /(「[^」]*」|『[^』]*』|“[^”]*”)/g;
  const parts = [];
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(last, m.index).trim();
    if (before) parts.push({ type: 'paragraph', text: before });
    parts.push({ type: 'dialogue', text: m[0] });
    last = m.index + m[0].length;
  }
  const after = text.slice(last).trim();
  if (after) parts.push({ type: 'paragraph', text: after });
  return parts.length > 1 ? parts : [{ type: 'paragraph', text }];
}

const _PREFACE_RE = /^(서문|머리말|들어가며|프롤로그|서론|시작하며|foreword|preface|introduction)\s*$/i;
const _SCENE_RE   = /^(\*\s*\*\s*\*|\*{3,}|—{1,3}|―{1,3}|※|\d{1,3})$/;
const _TOC_RE     = /^\d+[\.\)]\s+\S/;

function _isHeadingLike(text, prevBlank, nextBlank) {
  if (!text || text.length > 60) return false;
  // Starts with dialogue marker → always body/dialogue, never heading
  if (/^[「『"'"]/.test(text)) return false;
  if (/[.。!！?？,、，]$/.test(text)) return false; // has terminal punct → body
  if (prevBlank && nextBlank && text.length <= 40) return true;
  if (/^(제\s*\d+\s*[장절화편부]|第\s*\d+\s*[章節]|\d+\s*[장절화])/.test(text)) return true;
  if (/^[\d.]*\s*[^/]{1,25}\/[^/]{1,20}$/.test(text)) return true; // "제목 / 작가"
  return false;
}

function parseBodyBlocks(raw) {
  if (!raw || !raw.trim()) return [];
  const rawLines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks = [];
  let paraLines = [];

  const flushPara = () => {
    if (!paraLines.length) return;
    const text = paraLines.join('\n').trim();
    if (!text) { paraLines = []; return; }
    // Full-line dialogue?
    if (/^(「[^」]*」|『[^』]*』|“[^”]*”)$/.test(text)) {
      blocks.push({ type: 'dialogue', text });
    } else {
      blocks.push(...splitInlineDialogue(text));
    }
    paraLines = [];
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // Blank line
    if (!trimmed) {
      flushPara();
      // Double blank → scene break
      if (i + 1 < rawLines.length && !rawLines[i + 1].trim()) {
        blocks.push({ type: 'sceneBreak' });
        while (i + 1 < rawLines.length && !rawLines[i + 1].trim()) i++;
      }
      continue;
    }

    // Scene break markers (standalone)
    if (_SCENE_RE.test(trimmed) && !paraLines.length) {
      blocks.push({ type: 'sceneBreak' });
      continue;
    }

    // Preface keyword (standalone)
    if (_PREFACE_RE.test(trimmed) && !paraLines.length) {
      blocks.push({ type: 'preface', text: trimmed });
      continue;
    }

    // Markdown headings
    const mH1 = trimmed.match(/^#\s+(.+)/);
    const mH2 = trimmed.match(/^##\s+(.+)/);
    const mH3 = trimmed.match(/^###\s+(.+)/);
    if (mH1 || mH2 || mH3) {
      flushPara();
      blocks.push({ type: mH1 ? 'h1' : mH2 ? 'h2' : 'h3', text: (mH1||mH2||mH3)[1] });
      continue;
    }

    // Heading detection (non-markdown): must be isolated (prev+next blank)
    const prevBlank = i === 0 || !rawLines[i - 1].trim();
    const nextBlank = i + 1 >= rawLines.length || !rawLines[i + 1].trim();
    if (prevBlank && nextBlank && _isHeadingLike(trimmed, prevBlank, nextBlank)) {
      flushPara();
      // "숫자. 제목 / 작가명" split
      const slashM = trimmed.match(/^([\d.]*\s*)?(.{1,30}?)\s*\/\s*(.{1,20})$/);
      if (slashM) {
        const titlePart = ((slashM[1] || '') + slashM[2]).trim();
        const authorPart = slashM[3].trim();
        blocks.push({ type: 'sectionHeading', text: titlePart });
        blocks.push({ type: 'author', text: authorPart });
      } else {
        blocks.push({ type: 'sectionHeading', text: trimmed });
      }
      continue;
    }

    // TOC block: ≥3 consecutive numbered entries → single \tableofcontents
    if (_TOC_RE.test(trimmed) && !paraLines.length) {
      let cnt = 1, j = i + 1;
      while (j < rawLines.length && (_TOC_RE.test(rawLines[j].trim()) || !rawLines[j].trim())) {
        if (rawLines[j].trim()) cnt++;
        j++;
      }
      if (cnt >= 3) {
        if (!blocks.some(b => b.type === 'toc')) blocks.push({ type: 'toc' });
        while (i + 1 < rawLines.length &&
               (_TOC_RE.test(rawLines[i + 1].trim()) || !rawLines[i + 1].trim())) i++;
        continue;
      }
    }

    paraLines.push(line);
  }
  flushPara();
  return blocks;
}

function blockToLatex(block, fnMap, superMap, { preserveImpFnMarkers = false, headingGapPt = 10 } = {}) {
  // preserveImpFnMarkers=true: side-note 모드 fallback — \ImpFN{N}은 escape 제외, \footnote 주입 없음
  const esc = preserveImpFnMarkers
    ? t => escapeLatexPreservingImpFN(t || '')
    : t => injectFnIntoEscaped(escapeLatex(sanitizeUnicodeForLatex(t || '')), fnMap, superMap);
  const gap = Math.max(4, Number(headingGapPt) || 10);
  switch (block.type) {
    case 'h1':
      return `\\Needspace{6\\baselineskip}\n{\\noindent\\hone ${esc(block.text)}\\par}\n\\vspace{${Math.round(gap * 1.5 * 10) / 10}pt}`;
    case 'sectionHeading':
    case 'h2':
      return `\\Needspace{4\\baselineskip}\n{\\noindent\\htwo ${esc(block.text)}\\par}\n\\vspace{${Math.round(gap * 1.1 * 10) / 10}pt}`;
    case 'author':
      return `{\\noindent\\hthree ${esc(block.text)}\\par}\n\\vspace{${gap}pt}`;
    case 'h3':
    case 'subheading':
      return `\\Needspace{4\\baselineskip}\n{\\noindent\\hthree ${esc(block.text)}\\par}\n\\vspace{${Math.round(gap * 0.8 * 10) / 10}pt}`;
    case 'preface':
      return `\\Needspace{4\\baselineskip}\n{\\noindent\\htwo ${esc(block.text)}\\par}\n\\vspace{${gap}pt}`;
    case 'toc':
      return `\\tableofcontents\n\\newpage`;
    case 'dialogue':
      return `\\begin{imprintdialogue}\n${esc(block.text)}\n\\end{imprintdialogue}`;
    case 'quote':
      return `\\begin{imprintquote}\n${esc(block.text)}\n\\end{imprintquote}`;
    case 'sceneBreak':
      return `\\vspace{1\\baselineskip}\n\\begin{center}＊\\end{center}\n\\vspace{0.5\\baselineskip}`;
    case 'paragraph':
    default: {
      const text = esc(block.text || '');
      return text.trim() ? `{\\bodyf\n\\noindent ${text}\\par\n}` : '';
    }
  }
}

// 역할별 행간 계산 (MEASURE-003 / SYSTEM-001)
// Editorial Style Data의 실제 값이 있으면 그것을 우선 사용
function computeLeading(sizePt, role) {
  const size = parseFloat(sizePt);
  const ratioByRole = {
    title: 1.10, subtitle: 1.20, heading: 1.20, subheading: 1.25,
    body: 1.55, quote: 1.50, footnote: 1.35, titleFootnote: 1.30,
    caption: 1.30, folio: 1.20, runningHead: 1.20,
  };
  const ratio = ratioByRole[role] || 1.55;
  return Math.round(size * ratio * 2) / 2; // 0.5pt 단위로 반올림
}

// 가변단 paracol wrapping: %%PARACOL_SWITCHCOLUMN%% 마커 기준으로 본문/주석 분리
const PARACOL_MARKER = '%%PARACOL_SWITCHCOLUMN%%';
const PARACOL_SEP_RE = /===NOTE===|---NOTE---/gi;
function wrapParacol(body, bodyMm, noteMm, colGapMm) {
  if (!body.includes(PARACOL_MARKER)) return body;
  const idx = body.indexOf(PARACOL_MARKER);
  const mainPart = body.slice(0, idx).trim();
  const notePart = body.slice(idx + PARACOL_MARKER.length).trim();
  const gap = colGapMm || 8;
  const bMm = bodyMm || 60;
  const nMm = noteMm || 24;
  // \setlength + \setcolumnwidth 반드시 \begin{paracol}보다 앞에 위치해야 함
  return [
    `\\setlength{\\columnsep}{${gap}mm}`,
    `\\setcolumnwidth{${bMm}mm,${nMm}mm}`,
    `\\begin{paracol}{2}`,
    mainPart,
    `\\switchcolumn`,
    notePart,
    `\\end{paracol}`,
  ].join('\n');
}

// 고정 단 구성 wrapping: Claude가 multicols를 생성하지 않았을 때 JS에서 보장
function wrapFixedColumns(body, n, colGapMm) {
  if (n <= 1) return body;
  if (body.includes('\\begin{multicols}') || body.includes('\\begin{multicols*}') || body.includes('\\begin{paracol}')) return body;
  const gap = colGapMm || 10;
  return `\\setlength{\\columnsep}{${gap}mm}\n\\begin{multicols*}{${n}}\n${body}\n\\end{multicols*}`;
}

// 가변단 그리드 계산: vg={total,body,note}, textW=판면너비(mm), colGap=단간격(mm)
// 반환: { unitW, bodyW, noteW, gap, bodyG, noteG, totalG }
// ──────────────────────────────────────────────────────────────────────────
// 진정한 그리드 공식 (타이포그래피 모듈 그리드):
//   총 N개 단위, 각 단위 사이 (N-1)개 gap:  unitW × N + gap × (N-1) = textW
//   → unitW = (textW − gap × (N−1)) / N
// span 너비 (n개 단위 차지):  spanW(n) = unitW × n + gap × (n−1)
// 본문열과 주석열 사이 간격 = gap (1칸, 항상 일정)
// 예) total=5, body=4, note=1, textW=84, gap=8
//   → unitW=(84−32)/5=10.4mm, bodyW=10.4×4+8×3=65.6mm, noteW=10.4mm, col-sep=8mm ✓
function calcVariableGrid(vg, textW, colGap) {
  const totalG = Math.max(1, (vg && Number(vg.total)) || 2);
  const bodyG  = Math.max(1, (vg && Number(vg.body))  || 1);
  const noteG  = Math.max(0, (vg && Number(vg.note))  || 1);
  const gap    = typeof colGap === 'number' ? colGap : 8;
  // 스펙 단순화 공식(spec: bodyW=(textW-gap)*body/total)과 다름 — 타이포그래피 모듈 그리드 방식이 정확함
  // unitW × N + gap × (N−1) = textW → unitW = (textW − gap × (N−1)) / N
  // unitW: 단위 1개 너비
  const unitW = (textW - gap * (totalG - 1)) / totalG;
  // spanW: n개 단위가 차지하는 너비 (내부 gap 포함), 소수점 1자리 반올림
  const spanW = n => n <= 0 ? 0 : Math.round((unitW * n + gap * (n - 1)) * 10) / 10;
  const bodyW = spanW(bodyG);
  const noteW = spanW(noteG);
  // 본문+주석 사이 간격 = gap (고정, 항상 1 gap)
  return { unitW: Math.round(unitW * 10) / 10, bodyW, noteW, gap, bodyG, noteG, totalG };
}

// 본문 내부 단 구성: bodyTextColumns=2일 때 multicols 래핑
// bodyTextColumns=1 → 그대로 반환 / ≥2 → \begin{multicols}{N} 래핑
function wrapBodyTextColumns(bodyLatex, bodyTextColumns) {
  const n = Number(bodyTextColumns || 1);
  if (n <= 1) return bodyLatex;
  return [`\\begin{multicols*}{${n}}`, '', bodyLatex.trim(), '', `\\end{multicols*}`].join('\n');
}

// 주석 영역 내부 단 구성: noteTextColumns≥2일 때 multicols 래핑
function wrapNoteTextColumns(noteLatex, noteTextColumns) {
  const n = Number(noteTextColumns || 1);
  if (!noteLatex || !noteLatex.trim()) return '';
  if (n <= 1) return noteLatex;
  return [`\\begin{multicols*}{${n}}`, '', noteLatex.trim(), '', `\\end{multicols*}`].join('\n');
}

// wrapping quote 제거: 전체 원고가 큰따옴표 하나로 감싸진 경우만 제거
// 문장 내부 대화 따옴표는 건드리지 않음
function stripWrappingQuotes(s) {
  let t = String(s || '').trim();
  const pairs = [['"', '"'], ['“', '”'], ['‘', '’'], ["'", "'"]];
  for (const [open, close] of pairs) {
    if (t.startsWith(open) && t.endsWith(close) && t.length > open.length + close.length) {
      return t.slice(open.length, t.length - close.length).trim();
    }
  }
  return s;
}

// 제목/소제목 블록을 paracol 바깥으로 분리
// side-note 레이아웃에서 본문 첫 줄과 주석 첫 줄이 맞도록
// 제목·소제목은 paracol 앞에 배치해야 정렬이 맞음
function extractHeadingPrefix(bodyLatex) {
  let prefix = '';
  let rest = bodyLatex;
  // \renewcommand{\imprintrunninghead}{...}
  const rhRe = /^(\\renewcommand\{\\imprintrunninghead\}\{[^}]*\}\n+)/;
  const rhM = rest.match(rhRe);
  if (rhM) { prefix += rhM[1]; rest = rest.slice(rhM[1].length); }
  // 제목: \Needspace{...}\n{\hone ...}\n\vspace{...}\n
  const h1Re = /^(\\Needspace\{[^}]+\}\n\{\\hone[\s\S]*?\\par\}\n\\vspace\{[^}]+\}\n*)/;
  const h1M = rest.match(h1Re);
  if (h1M) { prefix += h1M[1] + '\n'; rest = rest.slice(h1M[1].length); }
  // 소제목: \Needspace{...}\n{\htwo ...}\n\vspace{...}\n
  const h2Re = /^(\\Needspace\{[^}]+\}\n\{\\htwo[\s\S]*?\\par\}\n\\vspace\{[^}]+\}\n*)/;
  const h2M = rest.match(h2Re);
  if (h2M) { prefix += h2M[1] + '\n'; rest = rest.slice(h2M[1].length); }
  return { prefix, body: rest };
}

// 가변단 레이아웃 조립 (JS 보장 — Claude 의존 없음)
// notePosition: 'right'(기본) | 'left' | 'top' | 'bottom'
// hasNote=false → paracol 2열 (1열=본문, 2열=빈 주석 영역)  ← adjustwidth 제거 (memoir에서 \footnote 충돌)
// hasNote=true, right/left → paracol 직접 조립 (\setlength + \setcolumnwidth + \begin{paracol}{2})
// hasNote=true, top/bottom → adjustwidth 블록 (상/하 배치)
function wrapVariableLayout({
  bodyLatex, noteLatex, grid, notePosition, textW = 84,
  bodyColumnStart = 1,       // 본문 시작 열 (1=왼쪽 끝) — top/bottom 모드에서 왼쪽 indent
  bottomNoteFlowColumns = 1, // 하단 주석 flow 단 수 (bottom 모드)
  bottomNoteWidth = 'full',  // 'full'=판면 전체폭 | 'body'=본문 폭 (bottom 모드)
}) {
  const { bodyW, noteW, gap, unitW = 0 } = grid;
  const pos = notePosition || 'right';
  const hasNote = !!(noteLatex && noteLatex.trim());
  const gapFmt = `${typeof gap === 'number' ? gap.toFixed(1) : gap}mm`;

  // 본문 왼쪽 indent 계산 (top/bottom 모드, bodyColumnStart > 1)
  // (bodyColumnStart-1)개 unitW + (bodyColumnStart-1)개 gap
  const _bcs = Math.max(1, Number(bodyColumnStart) || 1);
  const leftIndentBody = (_bcs > 1 && unitW > 0)
    ? Math.round((_bcs - 1) * (unitW + gap) * 10) / 10
    : 0;

  if (!hasNote) {
    // 주석 없음 처리
    // top/bottom: 본문을 bodyColumnStart 인덴트 + 전체 폭으로 직접 배치 (paracol 불필요)
    if (pos === 'top' || pos === 'bottom') {
      const _bcs = Math.max(1, Number(bodyColumnStart) || 1);
      const _leftInd = (_bcs > 1 && unitW > 0)
        ? Math.round((_bcs - 1) * (unitW + gap) * 10) / 10
        : 0;
      const _rightInd = Math.max(0, textW - bodyW - _leftInd);
      if (_leftInd > 0 || _rightInd > 0) {
        return [
          `\\begingroup`,
          _leftInd > 0  ? `\\setlength{\\leftskip}{${_leftInd.toFixed(1)}mm}` : null,
          _rightInd > 0 ? `\\setlength{\\rightskip}{${_rightInd.toFixed(1)}mm}` : null,
          `\\noindent`,
          bodyLatex.trim(),
          `\\par\\endgroup`,
        ].filter(Boolean).join('\n');
      }
      return bodyLatex.trim();
    }
    // left/right: paracol로 본문 열 폭 보장
    // \setlength + \setcolumnwidth 반드시 \begin{paracol}보다 앞 (paracol이 begin 시점에 계산)
    const isLeft = pos === 'left';
    const col1 = isLeft ? noteW : bodyW;
    const col2 = isLeft ? bodyW : noteW;
    return [
      `\\setlength{\\columnsep}{${gapFmt}}`,
      `\\setcolumnwidth{${col1}mm,${col2}mm}`,
      `\\begin{paracol}{2}`,
      isLeft ? `\\mbox{}` : bodyLatex.trim(),
      `\\switchcolumn`,
      isLeft ? bodyLatex.trim() : `\\mbox{}`,
      `\\end{paracol}`,
    ].join('\n');
  }

  if (pos === 'top') {
    const leftInd = leftIndentBody.toFixed(1);
    const rightIndentBody = Math.max(0, textW - bodyW - leftIndentBody).toFixed(1);
    const rightIndentNote = (textW - noteW).toFixed(1);
    const noteBlock = [
      `\\begin{adjustwidth}{0mm}{${rightIndentNote}mm}`,
      noteLatex.trim(),
      `\\end{adjustwidth}`,
    ].join('\n');
    const bodyBlock = [
      `\\begin{adjustwidth}{${leftInd}mm}{${rightIndentBody}mm}`,
      bodyLatex.trim(),
      `\\end{adjustwidth}`,
    ].join('\n');
    return [noteBlock, `\\vspace{${gapFmt}}`, bodyBlock].join('\n');
  }

  if (pos === 'bottom') {
    // 본문 블록 (bodyColumnStart 적용)
    // \leftskip/\rightskip 그룹 사용 — memoir에서 \footnote과 adjustwidth 충돌 방지
    const leftInd = leftIndentBody.toFixed(1);
    const rightIndBody = Math.max(0, textW - bodyW - leftIndentBody);
    const rightIndBodyFmt = rightIndBody.toFixed(1);
    const _needsIndent = leftIndentBody > 0 || rightIndBody > 0;
    const bodyBlock = _needsIndent
      ? [
          `\\begingroup`,
          leftIndentBody > 0 ? `\\setlength{\\leftskip}{${leftInd}mm}` : null,
          rightIndBody > 0   ? `\\setlength{\\rightskip}{${rightIndBodyFmt}mm}` : null,
          `\\noindent`,
          bodyLatex.trim(),
          `\\par\\endgroup`,
        ].filter(Boolean).join('\n')
      : bodyLatex.trim();

    // 하단 주석 블록 (bottomNoteWidth + bottomNoteFlowColumns 적용)
    const noteContent = (noteLatex || '').trim();
    if (!noteContent) return bodyBlock;

    const noteWidthEff = bottomNoteWidth === 'body' ? bodyW : textW;
    const leftIndNote = (bottomNoteWidth === 'body' && leftIndentBody > 0) ? leftInd : '0';
    const rightIndNote = Math.max(0, textW - noteWidthEff - (bottomNoteWidth === 'body' ? leftIndentBody : 0)).toFixed(1);
    const _bnfc = Math.max(1, Number(bottomNoteFlowColumns) || 1);
    const wrappedNote = _bnfc >= 2
      ? [`\\begin{multicols*}{${_bnfc}}`, noteContent, `\\end{multicols*}`].join('\n')
      : noteContent;
    const noteBlock = [
      `\\begin{adjustwidth}{${leftIndNote}mm}{${rightIndNote}mm}`,
      wrappedNote,
      `\\end{adjustwidth}`,
    ].join('\n');
    return [bodyBlock, `\\vspace{${gapFmt}}`, noteBlock].join('\n');
  }

  // right(기본) 또는 left → paracol 직접 조립
  // \setlength + \setcolumnwidth 반드시 \begin{paracol}보다 앞 (paracol이 begin 시점에 계산)
  const isLeft = pos === 'left';
  const col1 = isLeft ? noteW : bodyW;
  const col2 = isLeft ? bodyW : noteW;
  return [
    `\\setlength{\\columnsep}{${gapFmt}}`,
    `\\setcolumnwidth{${col1}mm,${col2}mm}`,
    `\\begin{paracol}{2}`,
    isLeft ? noteLatex.trim() : bodyLatex.trim(),
    `\\switchcolumn`,
    isLeft ? bodyLatex.trim() : noteLatex.trim(),
    `\\end{paracol}`,
  ].join('\n');
}

// memoir page style 생성 (fancyhdr 대체)
// pnPos: 쪽번호 위치 "상단-외측"|"하단-내측"|"하단-중앙"|"없음" 등
// rhPos: 면주 위치 "상단-외측"|...|"하단-중앙"|"외측-수직"|"내측-수직" (pnPos와 독립)
function buildMemoirPageStyle({ pnPos, pnSizePt, hasRunningHead, rhPos, rhVertPos }) {
  const pPos = (pnPos || '하단-외측').replace(/\s/g, '');
  const rPos = (rhPos  || '상단-외측').replace(/\s/g, '');
  const pnNone = pPos === '없음' || pPos === '-' || pPos === '';

  const pnCmd = `{\\foliof\\thepage}`;
  const rhCmd = hasRunningHead ? `{\\runningheadf\\imprintrunninghead}` : null;
  const mt = `{}`;

  // 위치 문자열 → {odd: [L,C,R], even: [L,C,R], top} 반환
  function placementSlots(cmd, posStr) {
    const isTop   = posStr.includes('상단');
    const isOuter = posStr.includes('외측');
    const isInner = posStr.includes('내측');
    if (isOuter)      return { odd: [mt, mt, cmd],  even: [cmd, mt, mt],  top: isTop };
    else if (isInner) return { odd: [cmd, mt, mt],  even: [mt, mt, cmd],  top: isTop };
    else              return { odd: [mt, cmd, mt],  even: [mt, cmd, mt],  top: isTop };
  }

  let headSlots = { odd: [mt,mt,mt], even: [mt,mt,mt] };
  let footSlots = { odd: [mt,mt,mt], even: [mt,mt,mt] };

  // 쪽번호 배치
  if (!pnNone) {
    const ps = placementSlots(pnCmd, pPos);
    if (ps.top) headSlots = { odd: ps.odd, even: ps.even };
    else        footSlots = { odd: ps.odd, even: ps.even };
  }

  // 면주 배치
  // 수직 여백 배치: \smash + \rlap/\llap + \rotatebox → header 슬롯에서 여백으로 확장
  // 홀수=외측(오른쪽), 짝수=외측(왼쪽) 에 90° 회전 (아래→위 방향)
  let extraSty = []; // 수직 면주에 필요한 추가 선언
  if (hasRunningHead && rhCmd) {
    const isVertOuter = rPos === '외측-수직';
    const isVertInner = rPos === '내측-수직';
    if (isVertOuter || isVertInner) {
      // \smash: 수직 공간 0으로 만들어 헤더/푸터 높이에 영향 없게 함
      // \rlap: 오른쪽으로 zero-width overflow (외측 여백으로 침범)
      // \llap: 왼쪽으로 zero-width overflow (내측/외측 여백으로 침범)
      // \rotatebox{90}: 반시계 90° → 텍스트 하단→상단 방향
      const rhRight = `{\\smash{\\rlap{\\kern3mm\\rotatebox{90}{\\runningheadf\\imprintrunninghead}}}}`;
      const rhLeft  = `{\\smash{\\llap{\\rotatebox{-90}{\\runningheadf\\imprintrunninghead}\\kern3mm}}}`;
      // rhVertPos 결정: auto이면 pnPos 기준으로 반대편 슬롯 선택
      //   쪽번호가 상단에 있으면 면주를 하단 슬롯(footer)으로, 아니면 상단 슬롯(header)으로
      // center이면 슬롯 배치 없이 건너뜀 → styContent에서 eso-pic으로 처리
      const resolvedVertPos = (rhVertPos === 'auto')
        ? (pPos.startsWith('상단') ? 'bottom' : 'top')
        : (rhVertPos || 'top');
      // 수직 면주는 상/중/하 모든 위치에서 eso-pic 절대좌표로 처리
      // → memoir 헤더/푸터 슬롯 미사용 (슬롯 경계에서 텍스트 잘림 방지)
      // styContent의 eso-pic 블록이 resolvedVertPos에 따라 Y좌표·makebox 정렬을 결정
    } else {
      // 수평 6위치: 기존 슬롯 기반 배치
      const rs = placementSlots(rhCmd, rPos);
      const target = rs.top ? headSlots : footSlots;
      ['odd','even'].forEach(side => {
        [0,1,2].forEach(i => {
          if (target[side][i] === mt) target[side][i] = rs[side][i];
        });
      });
    }
  }

  const join3 = (arr) => arr.join('');
  const oddHead  = join3(headSlots.odd);
  const evenHead = join3(headSlots.even);
  const oddFoot  = join3(footSlots.odd);
  const evenFoot = join3(footSlots.even);

  const folioSize = pnSizePt || 8;
  const folioLead = computeLeading(folioSize, 'folio');

  return [
    `% ── 면주 / 쪽번호 macro (memoir 전용) ────────────────────────`,
    pnNone ? `% pn-status: none` : `% pn-status: active`,
    `\\newcommand{\\foliof}{\\sffamily\\fontsize{${folioSize}pt}{${folioLead}pt}\\selectfont}`,
    `\\newcommand{\\runningheadf}{\\sffamily\\fontsize{${folioSize}pt}{${folioLead}pt}\\selectfont}`,
    `\\newcommand{\\imprintrunninghead}{}`,
    `\\makepagestyle{imprint}`,
    `\\makeheadrule{imprint}{\\textwidth}{0pt}`,
    `\\makefootrule{imprint}{\\textwidth}{0pt}{0pt}`,
    `\\makeoddhead{imprint}${oddHead}`,
    `\\makeevenhead{imprint}${evenHead}`,
    `\\makeoddfoot{imprint}${oddFoot}`,
    `\\makeevenfoot{imprint}${evenFoot}`,
  ].join('\n');
}

function buildBodyContent({ title, subtitle, body, footnote, runningHead, preserveImpFnMarkers = false, alignTitle = '', alignSubtitle = '', headingGapPt = 12 }) {
  // preserveImpFnMarkers=true: body에 이미 \ImpFN{N} 삽입된 경우 (side-note fallback)
  // → \footnote 주입 없이 \ImpFN{N}만 보존하며 escape
  const { fnMap, superMap } = preserveImpFnMarkers ? { fnMap: {}, superMap: {} } : parseFootnoteMap(footnote);
  const esc = t => escapeLatex(sanitizeUnicodeForLatex(t || ''));
  // 정렬 문자열 → LaTeX 명령
  const toAlignCmd = (s) => {
    if (!s) return '';
    if (s.includes('중앙')) return '\\centering';
    if (s.includes('우측') || s.includes('오른')) return '\\raggedleft';
    return ''; // 좌측 = 기본값
  };
  const titleAlignCmd    = toAlignCmd(alignTitle);
  const subtitleAlignCmd = toAlignCmd(alignSubtitle || alignTitle); // 소제목은 별도 필드 없으면 제목과 동일
  const gap = Math.max(4, Number(headingGapPt) || 12);
  const lines = [];
  lines.push('% ============================================================');
  lines.push('% 문서 본문 시작 — 아래 영역은 직접 수정해도 됩니다');
  lines.push('% ============================================================');
  lines.push('');
  const rh = esc(runningHead);
  if (rh) {
    // memoir pagestyle: \imprintrunninghead는 main.tex 헤더에서 \renewcommand로 설정됨
    // buildBodyContent는 body 내용만 생성 — \lhead/\rhead 사용 안 함
    lines.push(`\\renewcommand{\\imprintrunninghead}{${rh}}`);
    lines.push('');
  }
  const t = esc(title);
  if (t) {
    lines.push('\\Needspace{6\\baselineskip}');
    lines.push(`{\\noindent\\hone${titleAlignCmd ? `\n${titleAlignCmd}` : ''} ${t}\\par}`);
    lines.push(`\\vspace{${Math.round(gap * 1.8 * 10) / 10}pt}`);
    lines.push('');
  }
  const st = esc(subtitle);
  if (st) {
    lines.push('\\Needspace{4\\baselineskip}');
    lines.push(`{\\noindent\\htwo${subtitleAlignCmd ? `\n${subtitleAlignCmd}` : ''} ${st}\\par}`);
    lines.push(`\\vspace{${Math.round(gap * 1.3 * 10) / 10}pt}`);
    lines.push('');
  }
  if (body && body.trim()) {
    const blocks = parseBodyBlocks(body);
    for (const block of blocks) {
      const latex = blockToLatex(block, fnMap, superMap, { preserveImpFnMarkers, headingGapPt: gap });
      if (latex.trim()) { lines.push(latex); lines.push(''); }
    }
  }
  lines.push('% ============================================================');
  lines.push('% 문서 본문 끝');
  lines.push('% ============================================================');
  return lines.join('\n');
}

function buildMissingBodyPlaceholder() {
  return [
    '% ============================================================',
    '% BODY CONTENT MISSING',
    '% 사용자가 입력한 본문이 이 위치에 들어가야 합니다.',
    '% ============================================================',
    '',
    '{\\hone 제목을 여기에 입력하세요\\par}',
    '\\vspace{20pt}',
    '',
    '{\\bodyf',
    '본문을 여기에 붙여넣으세요.',
    '}',
    '',
    '% ============================================================',
    '% 문서 본문 끝',
    '% ============================================================',
  ].join('\n');
}

// LaTeX 출력 구조 검증 — .sty에 document body 코드가 없는지, main.tex 구조가 올바른지
// layoutConfig: styleConfig (optional) — side-note/multicols 구조 검증에 사용
function validateLatexExport({ mainTex, sty, layoutConfig = null }) {
  const errors = [];
  function count(s, re) { return (s.match(re) || []).length; }
  // 주석 줄(% 시작) 제외한 .sty 실행 코드만 검사
  const styCode = sty.split('\n').filter(l => !l.trimStart().startsWith('%')).join('\n');
  if (count(mainTex, /\\documentclass/g) !== 1)
    errors.push('main.tex: \\documentclass 가 정확히 1개여야 합니다');
  if (count(mainTex, /\\begin\{document\}/g) !== 1)
    errors.push('main.tex: \\begin{document} 가 정확히 1개여야 합니다');
  if (count(mainTex, /\\end\{document\}/g) !== 1)
    errors.push('main.tex: \\end{document} 가 정확히 1개여야 합니다');
  for (const [label, re] of [
    ['\\documentclass', /\\documentclass/],
    ['\\begin{document}', /\\begin\{document\}/],
    ['\\end{document}', /\\end\{document\}/],
    ['\\begin{multicols}', /\\begin\{multicols\}/],
    // \begin{paracol}은 imprintlayout 환경 제거로 더 이상 .sty에 없음 — 필요시 블랙리스트 추가 가능
  ]) {
    if (re.test(styCode))
      errors.push(`imprint-style.sty: ${label} 은 .sty에 있으면 안 됩니다`);
  }
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(styCode))
    errors.push('imprint-style.sty: 제어 문자 포함 (JS 백슬래시 escape 오류)');
  // 반각 CJK 문자 검증 — U+FF61-FF9F (UnBatang 미지원, XeLaTeX Missing character 오류 원인)
  const halfCJKMain = validateNoHalfwidthCJK('main.tex', mainTex);
  if (halfCJKMain) errors.push(halfCJKMain);
  const halfCJKSty = validateNoHalfwidthCJK('imprint-style.sty', sty);
  if (halfCJKSty) errors.push(halfCJKSty);
  if (!sty.includes('\\NeedsTeXFormat'))
    errors.push('imprint-style.sty: \\NeedsTeXFormat 없음');
  if (!sty.includes('\\makepagestyle{imprint}'))
    errors.push('imprint-style.sty: memoir pagestyle \\makepagestyle{imprint} 없음');
  if (!mainTex.includes('\\pagestyle{imprint}'))
    errors.push('main.tex: \\pagestyle{imprint} 없음');
  // \thepage 검증: buildMemoirPageStyle이 pn-status:active일 때 항상 \thepage를 포함하므로
  // 별도 체크 불필요 — 체크 시 false positive만 발생함 (제거)
  // ── 추가 구조 검증 ────────────────────────────────────────────
  // \end{document} 뒤 stray character 검사
  const afterEndDoc = mainTex.split('\\end{document}')[1] || '';
  if (afterEndDoc.replace(/\s/g, '').length > 0)
    errors.push('main.tex: \\end{document} 뒤에 불필요한 문자가 있습니다 — ' + JSON.stringify(afterEndDoc.trim().slice(0,20)));
  // \ImpFN 매크로 정의 검사 (main.tex에서 사용하면 sty에 정의되어야 함)
  if (/\\ImpFN\{/.test(mainTex) && !sty.includes('\\newcommand{\\ImpFN}'))
    errors.push('imprint-style.sty: \\ImpFN 매크로 정의 없음 (main.tex에서 \\ImpFN{N} 사용 중)');
  // paracol 패키지 검사
  if (/\\begin\{paracol\}/.test(mainTex) && !sty.includes('paracol'))
    errors.push('imprint-style.sty: \\RequirePackage{paracol} 없음 (main.tex에 \\begin{paracol} 사용 중)');
  // multicol 패키지 검사
  if (/\\begin\{multicols\*?\}/.test(mainTex) && !sty.includes('multicol'))
    errors.push('imprint-style.sty: \\RequirePackage{multicol} 없음 (main.tex에 \\begin{multicols} 사용 중)');
  // imprintlayout 미정의 환경 검사 (→ LaTeX 즉시 오류, post-processing으로 제거되어야 함)
  if (/\\begin\{imprintlayout\}/.test(mainTex))
    errors.push('main.tex: \\begin{imprintlayout} — 정의되지 않은 환경입니다. 재생성해 주세요');
  // body에 \usepackage 잔존 검사
  const bodyMatch2 = mainTex.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  if (bodyMatch2) {
    const bodyOnly = bodyMatch2[1];
    if (/^\\usepackage\{/m.test(bodyOnly))
      errors.push('main.tex: \\usepackage 가 document body 안에 있습니다 — preamble 명령은 body에 사용 불가');};
  // document body에 실제 내용 있는지 확인
  const bodyMatch = mainTex.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  const bodySection = bodyMatch ? bodyMatch[1].replace(/\\XeTeXlinebreaklocale[^\n]*\n?/g, '')
    .replace(/\\XeTeXlinebreakskip[^\n]*\n?/g, '')
    .replace(/\\pagestyle[^\n]*\n?/g, '')
    .replace(/\\renewcommand\{\\imprintrunninghead\}[^\n]*\n?/g, '')
    .replace(/^\s*%[^\n]*\n?/gm, '')
    .trim() : '';
  const warnings = [];
  if (!bodySection) warnings.push('⚠ main.tex document body에 본문 내용이 없습니다');
  // Semantic structure warnings
  const bodyFCount = (bodySection.match(/\{\\bodyf/g) || []).length;
  const hasDialogueEnv = /\\begin\{imprintdialogue\}/.test(bodySection);
  const hasStructure = /\\begin\{imprintdialogue\}|\\begin\{imprintquote\}|\\htwo|\\hthree|\\tableofcontents|\\begin\{center\}/.test(bodySection);
  const dialogueMarkerCount = (bodySection.match(/「[^」]*」|『[^』]*』/g) || []).length;
  if (bodyFCount === 1 && !hasStructure && bodySection.length > 200)
    warnings.push('⚠ 원문에 여러 문단이 있었지만 main.tex에는 하나의 body block만 있습니다');
  if (dialogueMarkerCount >= 3 && !hasDialogueEnv)
    warnings.push('⚠ 본문 안에 대화문(「」)이 감지되었지만 imprintdialogue 환경이 생성되지 않았습니다');

  // ── 추가 검증 (layoutConfig 기반 + 구조 규칙) ─────────────────────────────

  // [G1] \setcolumnwidth 3값 이상 — gap이 포함된 것 (2값 초과 = 오류)
  const scwMatches = mainTex.match(/\\setcolumnwidth\{([^}]+)\}/g) || [];
  for (const m of scwMatches) {
    const inner = m.replace(/\\setcolumnwidth\{/, '').replace(/\}$/, '');
    const args = inner.split(',');
    if (args.length > 2)
      errors.push(`main.tex: \\setcolumnwidth{${inner}} — 인수가 ${args.length}개입니다. gap은 \\setlength{\\columnsep}{Nmm}으로 분리하세요 (2값만 허용)`);
  }

  // [G2] sty에 \setmainhangulfont / \setsanshangulfont → kotex 이중 바인딩 오류
  if (/\\setmainhangulfont/.test(styCode))
    errors.push('imprint-style.sty: \\setmainhangulfont 사용 — kotex와 이중 바인딩으로 한글 깨짐 발생. 제거하세요');
  if (/\\setsanshangulfont/.test(styCode))
    errors.push('imprint-style.sty: \\setsanshangulfont 사용 — kotex와 이중 바인딩으로 한글 깨짐 발생. 제거하세요');

  // [G3] wrapping quote 잔존 — {\\bodyf ... \noindent "전체내용"\par } 패턴만 감지
  // 주의: imprintdialogue 환경 안에서는 "\par가 정상이므로 bodyf 블록 한정으로 검사
  // "\par 단독 체크는 false positive(대화문 끝)가 많아 제거
  // \noindent " 체크: bodyf 블록 안에서만 경고 (dialogue 환경 밖)
  const bodyFBlocks = mainTex.match(/\{\\bodyf[\s\S]*?\}/g) || [];
  const dialogueFreeBodyF = bodyFBlocks
    .filter(b => !b.includes('\\begin{imprintdialogue}') && !b.includes('\\begin{imprintquote}'));
  if (dialogueFreeBodyF.some(b => /\\noindent\s+"/.test(b)))
    warnings.push('⚠ main.tex: \\bodyf 블록이 \\noindent "로 시작합니다 — wrapping quote 잔존 가능성 확인 필요');

  // [G4] side-note 구조 검증 (paracol 사용 시)
  const hasParacolInMain = /\\begin\{paracol\}/.test(mainTex);
  if (hasParacolInMain) {
    const paracolCount    = count(mainTex, /\\begin\{paracol\}/g);
    const switchColCount  = count(mainTex, /\\switchcolumn(?!\*)/g);
    const endParacolCount = count(mainTex, /\\end\{paracol\}/g);
    if (paracolCount !== 1)
      errors.push(`main.tex: \\begin{paracol} 가 ${paracolCount}개 — 정확히 1개여야 합니다`);
    // Method B(interleaved)는 마커마다 \switchcolumn 쌍 생성 → 1개 이상이면 유효
    if (switchColCount < 1)
      errors.push(`main.tex: \\switchcolumn 이 없습니다 — paracol 내부 열 전환 누락`);
    if (endParacolCount !== 1)
      errors.push(`main.tex: \\end{paracol} 이 ${endParacolCount}개 — 정확히 1개여야 합니다`);
    // paracol 적용 순서 검증: \setlength{\columnsep}와 \setcolumnwidth가 \begin{paracol}보다 앞에 있어야 함
    const beginParacolIdx = mainTex.indexOf('\\begin{paracol}');
    const columnsepIdx    = mainTex.indexOf('\\setlength{\\columnsep}');
    const setcolwidthIdx  = mainTex.indexOf('\\setcolumnwidth{');
    if (columnsepIdx !== -1 && columnsepIdx > beginParacolIdx)
      errors.push('main.tex: \\setlength{\\columnsep} 가 \\begin{paracol} 뒤에 있습니다 — 앞으로 이동해야 합니다');
    if (setcolwidthIdx !== -1 && setcolwidthIdx > beginParacolIdx)
      errors.push('main.tex: \\setcolumnwidth 가 \\begin{paracol} 뒤에 있습니다 — 앞으로 이동해야 합니다');
    if (paracolCount === 1 && endParacolCount === 1 && paracolCount !== endParacolCount)
      errors.push('main.tex: \\begin{paracol} / \\end{paracol} 짝이 맞지 않습니다');

    // [G5] \textsuperscript{N} ↔ \ImpFN{N} 대응 검증
    // Method A(단일 switchcolumn): body/note 구간 분리 검사
    // Method B(interleaved): body/note가 교차 배치 → mainTex 전체에서 검색
    const isMethodB = switchColCount > 1;
    if (isMethodB) {
      // Method B: mainTex 전체에서 양쪽 마커 존재 여부 확인
      const allSupNums = [...mainTex.matchAll(/\\textsuperscript\{(\d+)\}/g)].map(m => m[1]);
      for (const n of [...new Set(allSupNums)]) {
        if (!mainTex.includes(`\\ImpFN{${n}}`))
          errors.push(`main.tex: \\textsuperscript{${n}} 있지만 \\ImpFN{${n}} 없음 — body 마커 소실`);
      }
    } else {
      // Method A: 첫 번째 switchcolumn 기준으로 body/note 분리 검사
      const switchIdx = mainTex.indexOf('\\switchcolumn');
      if (switchIdx !== -1) {
        const bodyColTex = mainTex.slice(0, switchIdx);
        const noteColTex = mainTex.slice(switchIdx);
        const noteSupNums = [...noteColTex.matchAll(/\\textsuperscript\{(\d+)\}/g)].map(m => m[1]);
        for (const n of noteSupNums) {
          if (!bodyColTex.includes(`\\ImpFN{${n}}`))
            errors.push(`main.tex: note column에 \\textsuperscript{${n}}이 있지만 body column에 \\ImpFN{${n}}이 없습니다`);
        }
      }
    }

    // bodyTextColumns 검증 (layoutConfig 있을 때만, Method A에서만 적용)
    if (layoutConfig && !isMethodB) {
      const btc = Number(layoutConfig.bodyTextColumns || 1);
      const beforeSwitch = mainTex.split('\\switchcolumn')[0] || '';
      const multicolsInBody = count(beforeSwitch, /\\begin\{multicols\*?\}/g);
      if (btc >= 2 && multicolsInBody === 0)
        errors.push(`main.tex: bodyTextColumns=${btc}인데 body column 안에 \\begin{multicols}가 없습니다`);
      if (btc === 1 && multicolsInBody > 0)
        errors.push(`main.tex: bodyTextColumns=1인데 body column 안에 \\begin{multicols}가 ${multicolsInBody}개 있습니다`);
    }
  }

  // columnGapMm consistency + grid ratio validation
  if (layoutConfig && layoutConfig.columnMode === 'variable') {
    const expectedGap = (layoutConfig.columnGapMm ?? 8).toFixed(1);
    const gapMatch = mainTex.match(/\\setlength\{\\columnsep\}\{([^}]+)\}/);
    if (gapMatch) {
      const actualGap = gapMatch[1].replace('mm','').trim();
      if (Math.abs(parseFloat(actualGap) - parseFloat(expectedGap)) > 0.05)
        errors.push(`main.tex: \\setlength{\\columnsep}{${gapMatch[1]}} — styleConfig.columnGapMm=${expectedGap}mm와 불일치`);
    }
    if (layoutConfig.variableGrid) {
      const pos = layoutConfig.notePosition || 'right';
      const isLR = pos === 'left' || pos === 'right';
      // 검증 전 자동 보정: left/right 모드에서 body+note > total이면 note를 줄임
      const _vgChk = layoutConfig.variableGrid;
      const vg = (isLR && (_vgChk.body + _vgChk.note) > _vgChk.total)
        ? { ..._vgChk, note: Math.max(1, _vgChk.total - _vgChk.body) }
        : _vgChk;
      // 보정 후에도 초과하면 에러 (total 자체가 너무 작은 경우)
      if (isLR && (vg.body + vg.note) > vg.total)
        errors.push(`가변단 오류: 본문 열(${vg.body}) + 주석 열(${vg.note}) = ${vg.body+vg.note} > 총 그리드(${vg.total}) — 주석 열을 ${vg.total - vg.body} 이하로 줄이세요`);
      if (!isLR && (vg.body > vg.total || vg.note > vg.total))
        errors.push(`가변단 오류: 본문 열(${vg.body}) 또는 주석 열(${vg.note})이 총 그리드(${vg.total})를 초과합니다`);
      const btc = Number(layoutConfig.bodyTextColumns || 1);
      const ntc = Number(layoutConfig.noteTextColumns || 1);
      // top/bottom 위치: 본문이 전체 판면 폭(vg.total)을 사용 → bodyTextColumns 상한은 vg.total
      // left/right 위치: 본문이 vg.body 열만 사용 → bodyTextColumns 상한은 vg.body
      const bodyMaxCols = isLR ? vg.body : vg.total;
      if (btc > bodyMaxCols)
        errors.push(`layout: bodyTextColumns(${btc}) > bodyGridUnits(${bodyMaxCols})`);
      if (ntc > vg.note)
        errors.push(`layout: noteTextColumns(${ntc}) > noteGridUnits(${vg.note})`);
    }
  }

  return { errors, warnings };
}

// Imprint 1.0.0 — App Component
// UI: Split-panel layout (Left: Input / Right: Package + Output)
export default function App() {
  const [step, setStep] = useState(0);
  const [fields, setFields] = useState({ 제목:"", 소제목:"", 본문:"", 면주:"", 각주:"" });
  const [inputTab, setInputTab] = useState('text'); // 'text' | 'experiment'
  const [experimentFeedback, setExperimentFeedback] = useState(''); // 사용자 정답 피드백 (레거시, 유지)
  const [satisfactionScore, setSatisfactionScore] = useState(null); // 1~5 또는 null
  const [feedbackCorrections, setFeedbackCorrections] = useState([]); // [{target_variable, system_pct, user_pct, direction_match}]
  const [feedbackCurrentVar, setFeedbackCurrentVar] = useState('body_leading');
  const [feedbackCurrentSystemPct, setFeedbackCurrentSystemPct] = useState('');
  const [feedbackCurrentUserPct, setFeedbackCurrentUserPct] = useState('');
  const [experimentAnalysis, setExperimentAnalysis] = useState(null); // 분석 결과 {matchRate, diff, nextRule}
  const [experimentLoading, setExperimentLoading] = useState(false); // 분석 API 호출 중

  const [styleConfig, setStyleConfig] = useState({
    columnMode: 'auto',       // 'auto'|'fixed'|'variable'
    fixedColumns: 1,          // 1~10 (columnMode==='fixed' 일 때)
    variableGrid: { total: 5, body: 4, note: 1 }, // columnMode==='variable' 일 때
    columnGapMm: 8,           // 가변단 열 간격 (mm) — \setlength{\columnsep}{Nmm}
    bodyTextColumns: 1,       // 본문 영역 내부 단 수 (1=1단, 2=2단 multicols)
    noteTextColumns: 1,       // 주석 영역 내부 단 수 (1=1단, 2=2단 multicols)
    notePosition: 'right',    // 'right'|'left'|'top'|'bottom'
    bodyColumnStart: 1,       // 본문 시작 열 (1=왼쪽 끝, top/bottom 모드에서 왼쪽 여백 생성)
    bottomNoteFlowColumns: 2, // 하단 주석 단 수 (notePosition==='bottom' 일 때)
    bottomNoteWidth: 'full',  // 'full'=판면 전체 폭 | 'body'=본문 폭에 맞춤
    bodyNoteSplit: null,      // null=auto, {body:N, note:M} (legacy)
    rhPos: '자동',            // 면주 위치: '자동'=DB 패키지 기반 도출 | '상단-외측'|...|'외측-수직'|'내측-수직'
    rhVertPos: 'auto',        // 수직 면주 세로 위치: 'auto'=쪽번호 반대편 | 'top'=상단 | 'bottom'=하단
    rhAuto: true,             // true=제목에서 자동 추출 / false=직접 입력(fields.면주)
    extraDirective: '',
    paperW: '',               // 판형 너비 override (mm), 빈값=DB 사용
    paperH: '',               // 판형 높이 override (mm), 빈값=DB 사용
  });

  // ── 유효 면주 텍스트 ───────────────────────────────────────────
  function effectiveRH() {
    return (fields.면주 || '').trim();
  }

  // ── 각주 자동 파싱 ─────────────────────────────────────────────
  // 본문의 상위 번호(¹²³, [1], ^1)와 각주 칸의 번호 목록을 매칭해
  // LaTeX \footnote{} 명령으로 인라인 삽입
  function injectFootnotes(bodyText, footnoteText) {
    if (!footnoteText || !footnoteText.trim()) return bodyText;
    // 번호 마커 정규화 테이블 (모듈 상수 SUP_TO_NUM, CIRC_TO_NUM 사용)
    const superMap = SUP_TO_NUM;
    const circleMap = CIRC_TO_NUM;
    const symOrder = ['*','**','†','‡','※']; // 순서 기반 기호 마커
    // 각주 텍스트 파싱
    // 지원 패턴: "1. 내용" / "1) 내용" / "¹ 내용" / "① 내용" / "(1) 내용"
    //            "* 내용" / "** 내용" / "† 내용" / "※ 내용" / "※1 내용"
    const fnMap = {};  // key → content (key = 숫자 문자열 or 기호)
    let cur = null, buf = [];
    const flush = () => { if (cur !== null) { fnMap[cur] = buf.join(' ').trim(); cur = null; buf = []; } };
    for (const line of footnoteText.split('\n')) {
      const m_num   = line.match(/^["''"「『\s]*(\d+)[.)]\s+(.+)/);  // "1. 내용" / "1) 내용" / ""1. 내용"
      const m_paren = line.match(/^["''"「『\s]*\((\d+)\)\s+(.+)/); // "(1) 내용"
      const m_sup   = line.match(/^([¹²³⁴⁵⁶⁷⁸⁹])\s+(.+)/);  // "¹ 내용"
      const m_circ  = line.match(/^([①②③④⑤⑥⑦⑧⑨⑩])\s+(.+)/);// "① 내용"
      const m_note  = line.match(/^(※(\d+)|※)\s+(.+)/);       // "※1 내용" / "※ 내용"
      const m_sym   = line.match(/^(\*\*|\*|†|‡)\s+(.+)/);    // "* 내용" / "† 내용"
      if (m_num)   { flush(); cur = m_num[1];                      buf = [m_num[2]];   }
      else if (m_paren) { flush(); cur = m_paren[1];               buf = [m_paren[2]]; }
      else if (m_sup)  { flush(); cur = superMap[m_sup[1]];        buf = [m_sup[2]];   }
      else if (m_circ) { flush(); cur = circleMap[m_circ[1]];      buf = [m_circ[2]];  }
      else if (m_note) { flush(); cur = m_note[2] ? `※${m_note[2]}` : '※'; buf = [m_note[3]]; }
      else if (m_sym)  { flush(); cur = m_sym[1];                  buf = [m_sym[2]];   }
      else if (cur !== null && line.trim()) { buf.push(line.trim()); }
    }
    flush();
    if (!Object.keys(fnMap).length) return bodyText;
    // LaTeX 특수문자 이스케이프
    const esc = s => s
      .replace(/\\/g, '\\textbackslash{}')
      .replace(/~/g, '\\textasciitilde{}')
      .replace(/\^/g, '\\textasciicircum{}')
      .replace(/\$/g, '\\$').replace(/\{/g, '\\{').replace(/\}/g, '\\}')
      .replace(/&/g, '\\&').replace(/%/g, '\\%').replace(/#/g, '\\#').replace(/_/g, '\\_');
    // 본문에서 마커 치환 (긴 패턴/큰 번호 먼저 → 부분 매칭 방지)
    let result = bodyText;
    // 기호 마커 치환 (symOrder 순서 유지)
    for (const sym of ['**', '*', '†', '‡']) {
      if (fnMap[sym]) {
        result = result.split(sym).join(`\\footnote{${esc(fnMap[sym])}}`);
        delete fnMap[sym];
      }
    }
    // ※N / ※ 마커 치환
    const noteKeys = Object.keys(fnMap).filter(k => k.startsWith('※')).sort((a,b) => b.length - a.length || b.localeCompare(a));
    for (const k of noteKeys) {
      const escaped = k.replace('※', '※'); // literal
      result = result.split(k).join(`\\footnote{${esc(fnMap[k])}}`);
      delete fnMap[k];
    }
    // 숫자 마커 치환 (큰 번호 먼저 → 10보다 1이 먼저 치환되어 '10'이 '1'+'0'으로 깨지는 일 방지)
    const nums = Object.keys(fnMap).sort((a,b) => +b - +a);
    for (const n of nums) {
      const content = esc(fnMap[n]);
      // 위첨자 유니코드 (¹²³...)
      const supChar = Object.entries(superMap).find(([,v]) => v === n)?.[0];
      if (supChar) result = result.split(supChar).join(`\\footnote{${content}}`);
      // 원문자 유니코드 (①②③...)
      const circChar = Object.entries(circleMap).find(([,v]) => v === n)?.[0];
      if (circChar) result = result.split(circChar).join(`\\footnote{${content}}`);
      // [N] 브래킷
      result = result.replace(new RegExp('\\[' + n + '\\]', 'g'), `\\footnote{${content}}`);
      // (N) 괄호
      result = result.replace(new RegExp('\\(' + n + '\\)', 'g'), `\\footnote{${content}}`);
      // ^N 캐럿
      result = result.replace(new RegExp('\\^' + n + '(?!\\d)', 'g'), `\\footnote{${content}}`);
    }
    return result;
  }

  function detectContentStructure(bodyText) {
    if (!bodyText) return null;
    const lines = bodyText.split('\n');
    const hints = [];
    const tocKeywords = /^(목차|차례|contents|table\s+of\s+contents)$/i;
    const tocEntry = /^\d+[\.\)]\s+\S/;
    const tocLines = lines.filter(l => tocEntry.test(l.trim()));
    if (tocLines.length >= 3 || lines.some(l => tocKeywords.test(l.trim()))) hints.push('TOC_PRESENT');
    const prefaceRe = /^(서문|머리말|들어가며|프롤로그|서론|시작하며|foreword|preface|introduction)\s*$/i;
    if (lines.some(l => prefaceRe.test(l.trim()))) hints.push('PREFACE_PRESENT');
    if (lines.some(l => /^#{1,3}\s/.test(l))) hints.push('MARKDOWN_HEADINGS');
    for (let i = 1; i < lines.length - 1; i++) {
      const cur = lines[i].trim();
      if (cur.length > 0 && cur.length < 30 && lines[i-1].trim() === '' && lines[i+1].trim() === '') {
        hints.push('SUBHEADINGS_PRESENT'); break;
      }
    }
    return hints.length > 0 ? hints.join(', ') : null;
  }

  const [hint, setHint] = useState("");
  const [selectionMode, setSelectionMode] = useState('auto'); // 'auto'|'genre-forced'|'ref-locked'

  const [lockedStyleId, setLockedStyleId] = useState(null); // lockedStyle 모드에서 고정
  const [runMeta, setRunMeta] = useState(null); // 마지막 실행 메타 로그

  // ── v29: alignment 결정 (item 2) ────────────────────────────────
  // DB 항목에 alignment 필드 없으므로 장르/출판형식/단수 추론
  function inferAlignment(p, numCols) {
    const g = p.g || '';
    const pub = p.pub_type || '';
    const layout = p.layout_type || '';
    const summary = p.특 || '';
    // 1순위: DB 본문 정렬 필드 직접 사용
    if (p.align_body) {
      const ab = p.align_body;
      if (ab.includes('양끝') || ab.includes('justify')) return { alignment: 'justified', source: 'DB-align_body', reason: `DB 본문정렬: ${ab}` };
      if (ab.includes('좌측') || ab.includes('ragged'))  return { alignment: 'ragged',    source: 'DB-align_body', reason: `DB 본문정렬: ${ab}` };
      if (ab.includes('중앙') || ab.includes('center'))  return { alignment: 'ragged',    source: 'DB-align_body', reason: `DB 본문정렬: ${ab} (중앙→ragged)` };
      if (ab.includes('우측'))                            return { alignment: 'ragged',    source: 'DB-align_body', reason: `DB 본문정렬: ${ab} (우측→ragged)` };
    }
    // 2순위: 특징 필드 명시적 언급
    if (summary.includes('양끝') || summary.includes('justified') || summary.includes('좌우 정렬')) {
      return { alignment: 'justified', source: 'DB-특', reason: 'DB 특징에 양끝정렬 명시' };
    }
    if (summary.includes('좌측') || summary.includes('ragged') || summary.includes('왼쪽 정렬')) {
      return { alignment: 'ragged', source: 'DB-특', reason: 'DB 특징에 좌측정렬 명시' };
    }
    // 장르/출판형식 기반 추론
    if (g.includes('문학') || g.includes('인문') || g.includes('연구') || pub === '단행본') {
      if (numCols >= 2) return { alignment: 'justified', source: 'inferred', reason: '장문 단행본/연구 다단 → 양끝' };
      const textW = p.f.w - p.m.안 - p.m.밖;
      const colW = numCols > 1 ? Math.round((textW - (numCols-1)*(p.c.간격||5))/numCols) : textW;
      if (colW < 55) return { alignment: 'ragged', source: 'inferred', reason: `단폭 ${colW}mm 협소 → 좌측` };
      return { alignment: 'justified', source: 'inferred', reason: '장문 독서 텍스트 → 양끝' };
    }
    if (pub === '전시도록' || pub === '아카이브') {
      return { alignment: 'ragged', source: 'inferred', reason: '전시도록/캡션 중심 → 좌측' };
    }
    if (pub === '잡지·저널') {
      const textW = p.f.w - p.m.안 - p.m.밖;
      const colW = numCols > 1 ? Math.round((textW - (numCols-1)*(p.c.간격||5))/numCols) : textW;
      if (colW < 50) return { alignment: 'ragged', source: 'inferred', reason: `잡지 좁은단 ${colW}mm → 좌측` };
      return { alignment: 'justified', source: 'inferred', reason: '잡지 다단 → 양끝' };
    }
    if (pub === '실험출판') {
      return { alignment: 'ragged', source: 'inferred', reason: '실험출판 → 좌측/비정형' };
    }
    return { alignment: 'justified', source: 'fallback', reason: '기본값 양끝' };
  }
  const [matchMethod, setMatchMethod] = useState(''); // 'semantic' | 'keyword' | ''
  const [displayBodySize, setDisplayBodySize] = useState(null); // 다단 보정 후 실제 적용 글자 크기
  const rationaleCache = useRef({});
  const [runLog, setRunLog] = useState([]);
  const pushLog = (id, label, status, detail='') =>
    setRunLog(prev => {
      const idx = prev.findIndex(x => x.id === id);
      const entry = { id, label, status, detail };
      return idx >= 0 ? prev.map((x,i) => i===idx ? entry : x) : [...prev, entry];
    });
  const [matching, setMatching] = useState(false);
  const [rationale, setRationale] = useState('');
  const [chosenReason, setChosenReason] = useState('');
  const [structuredReason, setStructuredReason] = useState(null); // {reference_reason, content_match, layout_reason, design_concept[], design_task[], visual_element[], ...}
  const [evidenceMap, setEvidenceMap] = useState(null);
  const [revisionLog, setRevisionLog] = useState([]); // Revision Trajectory [{id, type, ...}]
  const [textProfile, setTextProfile] = useState(null); // analyzeText 결과
  const [selIdx, setSelIdx] = useState(() => {
    try { return Number(localStorage.getItem('imprint_last_selidx') || 0); } catch { return 0; }
  });
  const [loading, setLoading] = useState(false);
  const [appliedMargins, setAppliedMargins] = useState(null); // corrections.margins from last run()
  const [latex, setLatex] = useState(() => {
    try { return localStorage.getItem('imprint_last_latex') || ""; } catch { return ""; }
  });
  const [styCode, setStyCode] = useState(() => {
    try { return localStorage.getItem('imprint_last_sty') || ""; } catch { return ""; }
  });
  const [requiredFonts, setRequiredFonts] = useState([]);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("intent");
  const [copied, setCopied] = useState(false);
  const [copiedSty, setCopiedSty] = useState(false);
  const [refineInput, setRefineInput] = useState("");
  const [refineLoading, setRefineLoading] = useState(false);
  const [refineHistory, setRefineHistory] = useState([]); // [{role, content, chatContent, changes}]
  const [streamingText, setStreamingText] = useState('');  // SSE 스트리밍 중 실시간 텍스트
  const [currentLog, setCurrentLog] = useState(() => {
    try { const s = localStorage.getItem('imprint_last_log'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [allLogs, setAllLogs] = useState([]);              // 세션 내 전체 로그 (인메모리)
  // includeFullPrompts: 미구현 기능 (export 시 prompt 전문 포함)

  // 마지막 생성 결과 localStorage 영구 저장 — 새로고침 후에도 피드백 탭 유지
  useEffect(() => {
    try { if (latex) localStorage.setItem('imprint_last_latex', latex);
          else localStorage.removeItem('imprint_last_latex'); } catch {}
  }, [latex]);
  useEffect(() => {
    try { if (styCode) localStorage.setItem('imprint_last_sty', styCode);
          else localStorage.removeItem('imprint_last_sty'); } catch {}
  }, [styCode]);
  useEffect(() => {
    try { if (currentLog) localStorage.setItem('imprint_last_log', JSON.stringify(currentLog));
          else localStorage.removeItem('imprint_last_log'); } catch {}
  }, [currentLog]);
  useEffect(() => {
    try { localStorage.setItem('imprint_last_selidx', String(selIdx)); } catch {}
  }, [selIdx]);

  // Evidence Map: latex 생성 완료 시 백그라운드 실행
  useEffect(() => {
    if (!latex || !apiKey) return;
    const bodyText = (fields['본문'] || '').trim();
    if (!bodyText || !structuredReason) return;
    buildEvidenceMap(bodyText, structuredReason, apiKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latex]);

  // ── 1차 후보 스코어링 v29: 분리 점수 계산 ──────────────────────────
  // contentScore / genreScore / pubTypeScore / layoutScore 분리
  // hint 있을 때 장르/출판형태 일치 점수를 실제 반영 (item 6)
  function scoreKw(p, text, hint) {
    const t = text.toLowerCase();
    const words = t.split(/[\s,.·:;!?()\[\]{}""'']+/).filter(w => w.length >= 2);

    // ── contentScore: 키워드 + 내용 요약 매칭
    let contentScore = 0;
    p.kw.forEach(k => { if (t.includes(k.toLowerCase())) contentScore += 1.5; });
    const fieldsToMatch = [
      { text: p.summary,      weight: 2.0 },
      { text: p.특,           weight: 1.5 },
      { text: p.why_font,     weight: 1.2 },
      { text: p.why_margin,   weight: 1.0 },
      { text: p.why_dim,      weight: 0.8 },
      { text: p.why_tracking, weight: 0.6 },
      { text: p.layout_type,  weight: 0.8 },
    ];
    fieldsToMatch.forEach(({ text: ft, weight }) => {
      if (!ft) return;
      const fl = ft.toLowerCase();
      words.forEach(w => { if (fl.includes(w)) contentScore += weight * 0.3; });
    });

    // ── genreScore: hint와 장르 일치 + GENRE_KW 키워드 매칭
    let genreScore = 0;
    if (hint) {
      // 장르 선택 모드: 선택 장르 일치 항목에 강한 부스트 (동일 contentScore라도 확실히 우선)
      if (p.g.includes(hint)) genreScore += 8; // 고정 +3 → +8로 상향
      // 장르 다양성 보너스: 더 많은 장르에 분포한 항목이 다채로운 결과를 냄
      if (p.g.includes(hint) && p.g.length > 1) genreScore += 0.5;
    } else {
      // 자동 모드: 장르 이름이 텍스트에 있으면 소폭 부스트
      if (p.g && t.includes(p.g.split('/')[0].toLowerCase())) genreScore += 1;
      // GENRE_KW 기반 장르 추론 부스트
      const gKw = GENRE_KW[p.g] || [];
      const gMatch = gKw.filter(k => t.includes(k)).length;
      if (gMatch > 0) genreScore += Math.min(gMatch * 0.5, 2.0); // 가중치 상향
    }

    // ── alignScore: 정렬 방식 매칭
    let alignScore = 0;
    if (p.align_body) {
      if (t.includes('좌측') && p.align_body.includes('좌측')) alignScore += 0.5;
      if (t.includes('양쪽') && p.align_body.includes('양쪽')) alignScore += 0.5;
      if (t.includes('중앙') && p.align_body.includes('중앙')) alignScore += 0.5;
    }

    // pubTypeScore 제거 — 출판형태는 필터 기준이 아닌 책의 속성 정보
    const pubTypeScore = 0;

    // ── layoutScore 제거 ──
    // 데이터 완성도는 선택 관련성과 무관함.
    // 완성도 높은 항목(플라톤의 위염 등)이 모든 장르에서 반복 선택되는 원인이었음.
    const layoutScore = 0;

    // 분리 점수를 p 객체에 붙여서 rerank에서 참조 가능하게
    p._scores = { contentScore, genreScore, pubTypeScore, layoutScore, alignScore };

    return contentScore + genreScore + pubTypeScore + alignScore;
  }

  // ── 텍스트 구조/의미 분석 (v29: 3축 분리 + 전시도록 근거 카운트) ─
  async function analyzeText(text) {
    const schema = '{"topic":"미술|문학|디자인|건축|타이포그래피|사진|사회|역사|철학|기타","genre":"타이포그래피|그래픽디자인|아트이론·비평|현대미술|전시·큐레이션|인문·사회|문학|건축·공간|시각문화·매체|사진|기타","textForm":"에세이|비평문|연구문|인터뷰|작품설명|목록형|서사|데이터|실험","pubType":"단행본|잡지·저널|전시도록|아카이브|실험출판|기관출판","tone":"학술|문학|실험|정보|기록|비평","density":"low|mid|high","fn":"none|few|many","read":"장문|탐색|도판|아카이브","layout":"안정|밀도|실험|미니멀|비선형","structure":"서사|논증|목록|인터뷰|카탈로그|데이터","exhibitEvidence":0,"riskyKeywords":[]}';
    const sysPrompt = 'Return ONLY valid JSON. Rules: topic/textForm/pubType from FULL style+structure, NOT single keywords. pubType=전시도록 ONLY if 2+ signals: work-list/exhibition-dates/venue/artist-bio/caption/curator-text/artwork-desc. exhibitEvidence=count(0-7). riskyKeywords=misleading words like 전시/작품/작가. If exhibitEvidence<2 set pubType=단행본 or 잡지.';
    const cacheKey = makeAiCacheKey('analyzeText', [simpleHash(text), text.length, text.slice(0, 200)]);
    const cached = getAiCache('analyzeText', cacheKey);
    if (cached) return cached;
    try {
      const res = await fetch('/anthropic/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', max_tokens: 200,
          system: sysPrompt,
          messages: [{ role: 'user', content: '텍스트 분석→JSON: ' + schema + '\n텍스트:' + text.slice(0, 200) }]
        })
      });
      const data = await res.json();
      const raw = (data.content||[]).map(x=>x.text||'').join('');
      const parsed = JSON.parse(raw.replace(/^[^{]*/,'').replace(/[^}]*$/,''));
      setAiCache('analyzeText', cacheKey, parsed);
      return parsed;
    } catch(e) { return null; }
  }

  // ── 텍스트 양/각주에 따른 파라미터 보정 ──────────────────────────
  function applyTextCorrections(p, matchText, footnoteText) {
    const len = matchText.length;
    const fnCount = (footnoteText||'').split(/\n/).filter(l=>l.trim()).length;    let { 크기: bs, 행간: bl, 자간: bt } = p.b;
    let margins = { ...p.m };
    let layoutHint = '';

    if (len > 3000) {
      // 장문: 글자 크기 소폭 축소 허용, 행간 유지
      bs = Math.max(bs - 0.5, 8);
      layoutHint = '2단 또는 3단 구성 선호';
    }
    if (len < 500) {
      // 단문: 여백 여유 있게, 1단 선호
      margins = { ...margins, 상: Math.max(margins.상, 20), 밖: Math.max(margins.밖, 16) };
      layoutHint = '1단 구성 선호, 여백 넉넉하게';
    }
    if (fnCount >= 3) {
      // 각주 많음: 하단 여백 증가
      margins.하 = Math.max(margins.하 + 4, 20);
      layoutHint += ' 주석 영역 분리 선호';
    }
    const learned = applySystemRules({
      bodySize: bs,
      bodyLeading: bl,
      tracking: bt || 0,
      marginTop: margins.상,
      marginBottom: margins.하,
      marginInner: margins.안,
      marginOuter: margins.밖,
    });
    bs = learned.bodySize;
    bl = learned.bodyLeading;
    bt = learned.tracking;
    margins = {
      상: learned.marginTop,
      하: learned.marginBottom,
      안: learned.marginInner,
      밖: learned.marginOuter,
    };
    return { bs, bl, bt, margins, layoutHint };
  }

  // ── AI 타이포그래피 미세조정: 텍스트 의미 기반 수치 조정 ──────────────
  // 레퍼런스 기본값 ±1.5pt(크기) / ±3pt(행간) / ±5mm(여백) 범위 내 조정
  async function adjustTypography(text, profile, p, structReason, _apiKey) {
    if (!_apiKey) return null;
    try {
      // 레퍼런스 기본값에 학습된 수치 보정 직접 적용 (applySystemRules)
      const base = applySystemRules({
        bodySize:     p.b.크기,
        bodyLeading:  p.b.행간,
        tracking:     p.b.자간 || 0,
        marginTop:    p.m.상,
        marginBottom: p.m.하,
        marginInner:  p.m.안,
        marginOuter:  p.m.밖,
      });
      const _designRules = buildDesignRules();
      // paragraph_spacing 학습 규칙이 있으면 프롬프트에 명시
      const _parSpacingHint = base.paragraphSpacingPct != null
        ? `\n문단간격(\\parskip): 기준값에서 ${base.paragraphSpacingPct > 0 ? '+' : ''}${Math.round(base.paragraphSpacingPct)}% 적용 (confidence:${base.paragraphSpacingConf})`
        : '';
      const prompt = `편집 디자인 조판 전문가. 입력 텍스트의 성격을 보고 레퍼런스 수치를 미세조정하라.${_designRules ? `\n[사용자 디자인 규칙 — 이전 피드백 기반, 우선 반영]\n${_designRules}` : ''}${_parSpacingHint}
텍스트(앞200자):"${text.slice(0,200)}"
성격: 장르/주제:${profile?.topic||'-'} 문체:${profile?.textForm||'-'} 톤:${profile?.tone||'-'}
디자인개념:${(structReason?.design_concept||[]).join(',')} 과제:${(structReason?.design_task||[]).join(',')}
기본수치: 크기${base.bodySize}pt 행간${base.bodyLeading}pt 자간${base.tracking} 여백${base.marginTop}/${base.marginBottom}/${base.marginInner}/${base.marginOuter}mm
한도:크기±1.5pt(최소7pt),행간±3pt(최소크기×1.3),자간±20,여백±20mm(최소5mm). 불필요하면기본값유지.
반환JSON:{"bodySize":<n>,"bodyLeading":<n>,"tracking":<n>,"marginTop":<n>,"marginBottom":<n>,"marginInner":<n>,"marginOuter":<n>,"parSkip":<n_or_null>,"reasons":[{"variable":"<항목>","base":"<기본>","adjusted":"<조정>","reason":"<이유10자>"}]}
parSkip은 문단 간격 pt값(null이면 기본값 유지). reasons는변경항목만.`;

      const cacheKey = makeAiCacheKey('adjustTypography', [simpleHash(prompt)]);
      const cached = getAiCache('adjustTypography', cacheKey);
      if (cached) return cached;

      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch('/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': _apiKey },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 400,
          system: 'Return ONLY valid JSON, no other text.',
          // 같은 본문+설정이면 prompt가 동일 → 캐시 히트
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }] }],
        }),
      });
      clearTimeout(tid);
      if (!res.ok) return null;
      const data = await res.json();
      const raw = (data.content || []).map(x => x.text || '').join('');
      const parsed = JSON.parse(raw.replace(/^[^{]*/, '').replace(/[^}]*$/, ''));

      // 안전 범위 클램핑
      const clamp = (v, b, d, mn) => Math.max(mn, Math.min(b + d, Math.max(b - d, Number(v) || b)));
      const adjSize = clamp(parsed.bodySize, base.bodySize, 1.5, 7);
      const adjMargins = {
        상: keepLearnedNumericDirection('margin_top',    p.m.상, base.marginTop,    clamp(parsed.marginTop,    base.marginTop,    20, 5)),
        하: keepLearnedNumericDirection('margin_bottom', p.m.하, base.marginBottom, clamp(parsed.marginBottom, base.marginBottom, 20, 5)),
        안: keepLearnedNumericDirection('margin_inner',  p.m.안, base.marginInner,  clamp(parsed.marginInner,  base.marginInner,  20, 5)),
        밖: keepLearnedNumericDirection('margin_outer',  p.m.밖, base.marginOuter,  clamp(parsed.marginOuter,  base.marginOuter,  20, 5)),
      };
      const learnedMarginReasons = [
        ['상단 여백', p.m.상, base.marginTop, adjMargins.상],
        ['하단 여백', p.m.하, base.marginBottom, adjMargins.하],
        ['내측 여백', p.m.안, base.marginInner, adjMargins.안],
        ['외측 여백', p.m.밖, base.marginOuter, adjMargins.밖],
      ]
        .filter(([, ref, , adjusted]) => Math.abs(Number(ref) - Number(adjusted)) > 0.05)
        .map(([variable, ref, learnedBase, adjusted]) => ({
          variable,
          base: ref,
          adjusted,
          reason: Math.abs(Number(learnedBase) - Number(adjusted)) > 0.05 ? '학습규칙+미세조정' : '학습규칙',
        }));
      const aiReasons = Array.isArray(parsed.reasons) ? parsed.reasons : [];
      const mergedReasons = [
        ...aiReasons.filter(r => !learnedMarginReasons.some(lr => lr.variable === r.variable)),
        ...learnedMarginReasons,
      ];
      const result = {
        bs: adjSize,
        bl: clamp(parsed.bodyLeading, base.bodyLeading, 3, Math.round(adjSize * 1.3 * 10) / 10),
        bt: clamp(parsed.tracking, base.tracking, 20, -100),
        margins: adjMargins,
        reasons: mergedReasons,
        // parSkip: AI가 반환한 문단 간격 pt값 (null이면 기본값 유지)
        parSkip: (typeof parsed.parSkip === 'number' && parsed.parSkip > 0) ? parsed.parSkip : null,
      };
      setAiCache('adjustTypography', cacheKey, result);
      return result;
    } catch (e) {
      console.warn('[adjustTypography] 실패:', e.message);
      return null;
    }
  }

  // ── Semantic Rerank v29: 혼합 후보 구성 + 탈락 이유 반환 ──────────
  // 후보 구성: 장르top4 + 출판형태top3 + 내용유사도top3 + 레이아웃다양성2
  // 탈락 이유 3개 반환 (item 7, 8)
  // genreCompare 중 이전 선택 샘플 감점 (item 6)
  async function semanticRerank(text, profile, ranked, hint, testCtx) {
    try {
      const profileStr = profile
        ? `topic:${profile.topic||''} form:${profile.textForm||''} pubType:${profile.pubType||''} tone:${profile.tone||''} structure:${profile.structure||''} exhibitEv:${profile.exhibitEvidence??0}`
        : '';

      // ── 후보 풀 구성: 내용 상위 + 레이아웃 다양성 + 장르 다양성 ──────────
      // hint가 있으면 이미 run()에서 _diverseRanked로 다양성 보장된 ranked가 들어옴
      // 여기서 최종 풀 구성: 내용 상위 8 + 다른 layout_type 4 + 다른 genre 4 = max 16
      const byContent = ranked.slice(0, 8);
      const usedLayouts = new Set(byContent.map(r=>r.p.layout_type));
      const usedGenres = new Set(byContent.map(r=>r.p.g||'기타'));

      // 레이아웃 다양성: top 8 이후에서 다른 layout_type
      const byLayout = ranked.slice(8).filter(r => !usedLayouts.has(r.p.layout_type)).slice(0, 4);

      // 장르 다양성: 다른 장르 항목 추가 (hint 없을 때 특히 중요)
      const byGenre = ranked.filter(r => {
        const g0 = r.p.g || '기타';
        return !usedGenres.has(g0) && !byContent.find(c=>c.i===r.i) && !byLayout.find(l=>l.i===r.i);
      }).slice(0, 4);

      // 합치고 중복 제거 (최대 16개)
      const seen = new Set();
      let pool = [...byContent, ...byLayout, ...byGenre].filter(r => {
        if (seen.has(r.i)) return false;
        seen.add(r.i); return true;
      }).slice(0, 16);

      // ── 학습된 서체 스타일 필터링 ──────────────────────────────────────
      // font_style confidence medium 이상이면 해당 서체 계열 레퍼런스 우선
      const _learnedFont = getSystemFontStyle();
      if (_learnedFont) {
        const filtered = pool.filter(r => {
          const cls = (r.p.ty?.분류 || '').toLowerCase();
          if (_learnedFont === 'gothic') return /고딕|sans|gothic|그로테스크|grotesque/i.test(cls);
          if (_learnedFont === 'serif')  return /명조|serif|부리|바탕/i.test(cls);
          return true;
        });
        // fallback: 필터 후 후보가 2개 미만이면 필터 무시 (레이아웃 파괴 방지)
        if (filtered.length >= 2) pool = filtered;
      }
      // genreCompare 중 이전 선택 항목 감점 표시
      const prevId = testCtx?.prevStyleId;

      const candidates = pool.map(({ i, p }) => {
        const penalty = (prevId !== undefined && i === prevId) ? '[PREV-USED-PENALIZE]' : '';
        return `[${i}]${penalty}${p.t}|${p.g.split('/')[0].trim()}|${p.pub_type||''}|${(p.summary||'').slice(0,40)}|${(p.특||'').slice(0,25)}`;
      }).join('\n');

      const genreConstraint = hint
        ? `[장르강제:"${hint}"] 반드시 해당 장르 선택. 우선순위:①장르일치 ②내용적합 ③레이아웃다양성. [PREV-USED-PENALIZE] 항목 회피.\n`
        : `[자동모드] 텍스트 문체·구조·주제 종합 판단. 단일 키워드로 장르 판단 금지. 서사/논증 텍스트에 잡지형 다단 금지.\n`;

      const cacheKey = makeAiCacheKey('semanticRerank', [
        simpleHash(text), text.length, hint || '', profileStr, candidates,
        simpleHash(buildDesignRules() || ''), prevId ?? '',
      ]);
      const cached = getAiCache('semanticRerank', cacheKey);
      if (cached) return cached;

      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 25000);
      const res = await fetch('/anthropic/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }, signal: ctrl.signal,
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', max_tokens: 600,
          system: 'Return ONLY valid JSON, no other text.',
          messages: [{ role: 'user', content: [
            // ── 캐시 대상: 레퍼런스 후보 데이터 (같은 본문이면 동일 → 캐시 히트) ──
            {
              type: 'text',
              text: '후보([idx]제목|장르|출판형태|요약|특징):\n' + candidates + '\n\n' +
                    '반환 JSON:\n{"i":<index>,"reference_reason":"<20자>","content_match":"<20자>","layout_reason":"<20자>","typography_reason":"<20자>","margin_reason":"<20자>","design_concept":["<개념1>","<개념2>"],"design_task":["<과제1>","<과제2>"],"visual_element":["<요소1>","<요소2>","<요소3>"],"rejected":[{"i":<idx>,"reason":"<15자>"},{"i":<idx>,"reason":"<15자>"},{"i":<idx>,"reason":"<15자>"}],"prevUsedForced":<true|false>,"prevUsedReason":"<이유 or empty>"}\n\ndesign_concept: 본문 정서/분위기 2~4개 (예: ["조용한 회고","기억의 회복"])\ndesign_task: 조판 과제 2~4개 (예: ["읽기 속도 낮추기","정적 분위기 만들기"])\nvisual_element: 실제 수치/스타일 3~6개 (예: ["120×192mm 판형","8.5pt/16pt","넓은 하단 여백"])',
              cache_control: { type: 'ephemeral' }
            },
            // ── 비캐시: 본문·프로파일·사용자 학습 규칙 ──────────────────────
            {
              type: 'text',
              text: (() => {
                const _rules = buildDesignRules();
                return '편집 디자인 레퍼런스 중 최적 1개를 선택하라.\n' +
                  (_rules
                    ? '[사용자 디자인 규칙 — 이전 피드백 기반, 레퍼런스 선택 시 우선 반영]\n' + _rules + '\n\n'
                    : '') +
                  genreConstraint + '\n' +
                  (profileStr ? '텍스트 프로파일: ' + profileStr + '\n\n' : '') +
                  '입력 텍스트(앞 200자): "' + text.slice(0,200) + '"';
              })()
            }
          ]}]
        })
      });
      clearTimeout(tid);
      const data = await res.json();
      const raw = (data.content||[]).map(x=>x.text||'').join('');
      const parsed = JSON.parse(raw.replace(/^[^{]*/,'').replace(/[^}]*$/,''));
      const idx = parseInt(parsed.i);
      // 반드시 pool 내에 존재하는 index여야 함 (AI가 list 위치를 index로 혼동하는 방지)
      const poolIds = new Set(pool.map(r => r.i));
      if (!isNaN(idx) && DB[idx] && poolIds.has(idx)) {
        const result = { i: idx, structured: parsed };
        setAiCache('semanticRerank', cacheKey, result);
        return result;
      }
      // pool에 없는 index 반환 시 → pool[0]의 idx 사용 (가장 높은 점수 항목)
      if (pool.length > 0) {
        const fallback = pool[0];
        const result = { i: fallback.i, structured: { ...parsed, i: fallback.i, reference_reason: '(index보정)' + (parsed.reference_reason||'') } };
        setAiCache('semanticRerank', cacheKey, result);
        return result;
      }
    } catch(e) { /* semanticRerank 오류 → null 반환으로 키워드 결과 사용 */ }
    return null;
  }

  // ── Combined: analyze + auto-select + generate ─────────────────
  async function run() {
    // wrapping quote 제거: 전체 원고가 큰따옴표 하나로 감싸진 경우
    const rawBodyText = (fields.본문 || [fields.제목, fields.소제목].filter(Boolean).join(' ')).trim();
    const matchText = stripWrappingQuotes(rawBodyText);
    if (!matchText) return;
    setMatching(true);
    setErr("");
    setLatex("");
    setStyCode("");
    setRationale("");
    setStructuredReason(null);
    setTextProfile(null);
    setRunLog([]);
    setRevisionLog([]);
    setEvidenceMap(null);
    setExperimentFeedback('');
    setSatisfactionScore(null);
    setExperimentAnalysis(null);
    setExperimentLoading(false);
    setDisplayBodySize(null);
    const h = hint;

    const hasFootnoteText = !!(fields.각주?.trim());
    const hasFootnoteMarkers = /[¹²³⁴⁵⁶⁷⁸⁹]|\[\d+\]|\^\d+(?!\d)|\*(?!\*)|\†|\‡|※|[①②③④⑤⑥⑦⑧⑨⑩]/.test(fields.본문 || '');
    const needsLLMFootnotes = hasFootnoteMarkers && !hasFootnoteText;
    // ===NOTE=== 구분자 → 마커 변환 (paracol 전처리)
    const cleanBody = stripWrappingQuotes(fields.본문 || '');
    const hasParacolSep = PARACOL_SEP_RE.test(cleanBody);
    const bodyForProcess = cleanBody.replace(PARACOL_SEP_RE, PARACOL_MARKER);
    // 각주 마커를 \ImpFN{N} LaTeX 명령으로 사전 치환: Claude가 LaTeX 명령을 그대로 보존하므로 손실 없음
    // post-processing에서 \ImpFN{N} → \footnote{내용}으로 치환 (100% JS 보장)
    const processedBody = hasFootnoteText ? preReplaceFnMarkers(bodyForProcess) : bodyForProcess;
    const footnoteTextForClaude = hasFootnoteText ? fields.각주.trim() : null;
    // anchor: Claude가 \ImpFN{N}을 완전히 삭제한 경우 원래 위치 복원에 사용
    const fnAnchors = hasFootnoteText ? extractFootnoteAnchors(fields.본문 || '') : {};
    const contentStructureHints = detectContentStructure(fields.본문 || '');
    const bodyBlock = [
      fields.제목   && `TITLE: ${fields.제목}`,
      fields.소제목 && `SUBTITLE: ${fields.소제목}`,
      processedBody && `BODY:\n${processedBody}`,
      effectiveRH() && `RUNNING HEAD: ${effectiveRH()}`,
      styleConfig.extraDirective && `STYLE DIRECTIVE: ${styleConfig.extraDirective}`,
      contentStructureHints && `CONTENT STRUCTURE DETECTED: ${contentStructureHints}`,
      footnoteTextForClaude && `FOOTNOTES:\n${footnoteTextForClaude}`,
    ].filter(Boolean).join('\n\n');

    try {
      // ── Stage 1: 텍스트 분석 + 후보 추출 (병렬) ───────────────────
      // hint 있을 때: DB를 장르/출판형태로 먼저 필터 → 그 안에서 content 스코어링
      // hint 없을 때: 전체 DB에서 content 스코어링
      pushLog('analyze', '텍스트 분석', 'running');
      pushLog('kw', '후보 추출', 'running');

      const [profile, ranked] = await Promise.all([
        analyzeText(matchText),
        Promise.resolve((() => {
          if (h) {
            // 장르 선택 → g 필드만으로 엄격히 필터
            // 출판형태(pub_type)는 책의 속성 정보일 뿐, 필터 기준으로 사용하지 않음
            const RELATED_GENRE = {
              '문학':          ['인문·사회','아트이론·비평'],
              '아트이론·비평': ['현대미술','전시·큐레이션','문학'],
              '현대미술':      ['전시·큐레이션','아트이론·비평'],
              '건축·공간':     ['그래픽디자인','타이포그래피'],
              '타이포그래피':  ['그래픽디자인','아트이론·비평'],
              '그래픽디자인':  ['타이포그래피','전시·큐레이션'],
              '인문·사회':     ['문학','아트이론·비평'],
              '전시·큐레이션': ['현대미술','아트이론·비평'],
              '시각문화·매체': ['아트이론·비평','그래픽디자인'],
              '사진':          ['아트이론·비평','현대미술'],
              '기타':          ['아트이론·비평','인문·사회'],
            };

            // 1차: g 필드가 선택 장르와 일치하는 항목만
            const primary = DB
              .map((p, i) => ({ i, p }))
              .filter(({ p }) => p.g.includes(h));

            let pool = primary;
            if (primary.length < 5) {
              // 모수 부족(사진 4건 등) → 연관 장르로 확장
              const related = (RELATED_GENRE[h] || []);
              const extended = DB
                .map((p, i) => ({ i, p }))
                .filter(({ p }) => related.some(r => p.g.includes(r)));
              pool = [...primary, ...extended.filter(e => !primary.find(pr => pr.i === e.i))];
              if (pool.length < 5) pool = DB.map((p,i)=>({i,p})); // 최후 수단
            }
            return pool
              .map(({ i, p }) => ({ i, s: scoreKw(p, matchText, h), p }))
              .sort((a, b) => b.s - a.s);
          } else {
            return DB
              .map((p, i) => ({ i, s: scoreKw(p, matchText, ''), p }))
              .sort((a, b) => b.s - a.s);
          }
        })())
      ]);

      setTextProfile(profile);
      // analyzeText가 감지한 genre를 hint 없을 때 자동 활용
      const autoGenre = (!h && profile?.genre) ? profile.genre : null;

      // ── 자동 모드: analyzeText 장르 결과로 재스코어링 (hint 없을 때만) ───
      // 자동 장르가 있으면 해당 장르 항목에 추가 점수를 부여해 다양성 확보
      if (!h && autoGenre) {
        ranked.forEach(r => {
          if (r.p.g.includes(autoGenre)) {
            r.s += 3; // 자동 감지 장르 부스트
          }
        });
        ranked.sort((a, b) => b.s - a.s);
      }

      // ── 후보 다양성 보장: layout_type / genre / designer 중복 제한 ───────
      // semanticRerank에 넣을 상위 후보를 다양하게 구성 (같은 layout_type 3개 이하)
      const _diverseRanked = (() => {
        const layoutCount = {};
        const genreCount = {};
        const result = [];
        for (const r of ranked) {
          const lt = r.p.layout_type || 'unknown';
          const g0 = r.p.g || '기타';
          if ((layoutCount[lt] || 0) >= 3) continue; // layout_type 당 최대 3개
          if (!h && (genreCount[g0] || 0) >= 4) continue; // 자동 모드: genre당 최대 4개
          layoutCount[lt] = (layoutCount[lt] || 0) + 1;
          genreCount[g0] = (genreCount[g0] || 0) + 1;
          result.push(r);
          if (result.length >= 30) break; // 최대 30개 (rerank pool의 3배)
        }
        // 다양성 필터로 너무 적어지면 원본 상위로 보완
        if (result.length < 10) return ranked.slice(0, 30);
        return result;
      })();

      const filteredLabel = h
        ? `장르 "${h}" 풀 ${Math.min(ranked.length, 999)}개 중 상위 추출`
        : autoGenre
          ? `자동 장르 "${autoGenre}" 재스코어링 + 다양성 구성`
          : `전체 DB 상위 추출`;
      pushLog('analyze', '텍스트 분석', 'done',
        profile
          ? `genre:${profile.genre||''} · topic:${profile.topic||''} · form:${profile.textForm||''} · pub:${profile.pubType||''} · exhibitEv:${profile.exhibitEvidence??'-'}`
          : '분석 완료');
      // 장르 다양성 확인 로그
      const _genreDistrib = {};
      _diverseRanked.slice(0, 16).forEach(r => {
        const g = r.p.g || '기타';
        _genreDistrib[g] = (_genreDistrib[g] || 0) + 1;
      });
      pushLog('kw', '후보 추출', 'done',
        filteredLabel + ` | 다양성 풀 ${_diverseRanked.slice(0,16).length}개 ` +
        Object.entries(_genreDistrib).map(([g,n])=>`${g}:${n}`).join(' '));

      // ── Stage 2: Semantic Rerank (LaTeX 전에 실행) ───────────────
      pushLog('semantic', '시맨틱 리랭크', 'running', '내용/디자인 의도 기반 최적 레퍼런스 선별 중');
      setStep(1);
      setMatching(false);
      setLoading(true);

      // testMode: 기능 비활성화 (useState 제거됨 → 'normal' 고정)
      const testMode = 'normal';
      const isLocked = (testMode === 'lockedStyle' || selectionMode === 'ref-locked') && lockedStyleId !== null;
      const isLengthCompare = testMode === 'lengthCompare' && lockedStyleId !== null;
      const forceIdx = (isLocked || isLengthCompare) ? lockedStyleId : null;

      let rerank = null;
      if (forceIdx !== null) {
        // 고정 스타일 사용 (rerank 건너뜀)
        rerank = { i: forceIdx, structured: { reference_reason:'styleLock', content_match:'', layout_reason:'', typography_reason:'', margin_reason:'', rejected:[], prevUsedForced:false, prevUsedReason:'' } };
      } else {
        const testCtx = testMode === 'genreCompare' ? { prevStyleId: runMeta?.selectedStyleId } : null;
        rerank = await semanticRerank(matchText, profile, _diverseRanked, h, testCtx);
      }

      let chosen, structReason;
      if (rerank) {
        chosen = { i: rerank.i, p: DB[rerank.i] };
        structReason = rerank.structured;
        setSelIdx(rerank.i);
        setMatchMethod('semantic');
        setChosenReason(structReason.reference_reason || '');
        setStructuredReason(structReason);
        pushLog('semantic', '시맨틱 리랭크', 'done',
          chosen.p.t + (structReason.rejected?.length ? ` | 탈락: ${structReason.rejected.map(r=>r.reason).join(' / ')}` : ''));
      } else {
        chosen = ranked[0];
        setSelIdx(chosen.i);
        setMatchMethod('keyword');
        setChosenReason('');
        pushLog('semantic', '시맨틱 리랭크', 'done', '키워드 결과 사용: ' + chosen.p.t);
      }

      // ── Stage 3: 텍스트 양 보정 ─────────────────────────────────
      const corrections = applyTextCorrections(chosen.p, matchText, fields.각주);
      setAppliedMargins(corrections.margins);

      // ── Stage 3c: AI 타이포그래피 미세조정 ───────────────────────
      pushLog('typo', '타이포 조정', 'running', 'AI 기반 수치 미세조정 중');
      const typoAdj = await adjustTypography(matchText, profile, chosen.p, structReason, apiKey);
      if (typoAdj) {
        corrections.bs = typoAdj.bs;
        corrections.bl = typoAdj.bl;
        corrections.bt = typoAdj.bt;
        corrections.margins = typoAdj.margins;
        setAppliedMargins(typoAdj.margins);
        if (typoAdj.reasons?.length > 0) {
          setStructuredReason(prev => prev ? { ...prev, variable_reasons: typoAdj.reasons } : { variable_reasons: typoAdj.reasons });
        }
      }
      pushLog('typo', '타이포 조정', 'done',
        typoAdj?.reasons?.length > 0 ? `${typoAdj.reasons.length}개 수치 조정` : '기본값 유지');

      // ── Stage 3b: alignment 확정 ────────────────────────────────
      // isLengthCompare: 이전 runMeta의 alignment 고정
      const numColsEst = (() => {
        const 구성 = chosen.p.c.구성 || '';
        const m = 구성.match(/(\d+)[단열]/);
        return m ? parseInt(m[1]) : 1;
      })();
      const alignResult = (isLengthCompare && runMeta?.selectedAlignment)
        ? { alignment: runMeta.selectedAlignment, source: 'locked-lengthCompare', reason: 'lengthCompare 고정' }
        : inferAlignment(chosen.p, numColsEst);

      // ── Stage 3c: 메타 로그 저장 (item 8) ───────────────────────
      const meta = {
        runId: Date.now(),
        selectedStyleId: chosen.i,
        hint: h,
        filteredCount: ranked.length,
        fallback: ranked.length < 5 && !h,
        testMode,
        styleLock: isLocked || isLengthCompare,
        lockedStyleId: forceIdx,
        topic: profile?.topic || '',
        textForm: profile?.textForm || '',
        pubType: profile?.pubType || '',
        riskyKeywords: profile?.riskyKeywords || [],
        exhibitEvidence: profile?.exhibitEvidence ?? 0,
        selectedAlignment: alignResult.alignment,
        alignmentSource: alignResult.source,
        alignmentReason: alignResult.reason,
        contentScore: chosen.p._scores?.contentScore ?? 0,
        genreScore: chosen.p._scores?.genreScore ?? 0,
        pubTypeScore: chosen.p._scores?.pubTypeScore ?? 0,
        layoutScore: chosen.p._scores?.layoutScore ?? 0,
        selectionReason: structReason?.reference_reason || '',
        rejected: structReason?.rejected || [],
        prevUsedForced: structReason?.prevUsedForced || false,
        styleDrift: isLengthCompare && runMeta?.selectedStyleId !== undefined && runMeta.selectedStyleId !== chosen.i,
        alignmentDrift: isLengthCompare && runMeta?.selectedAlignment !== undefined && runMeta.selectedAlignment !== alignResult.alignment,
      };
      setRunMeta(meta);
      // lockedStyle 모드 첫 실행 시 styleid 기억
      if (testMode === 'lockedStyle' && lockedStyleId === null) setLockedStyleId(chosen.i);
      if (isLengthCompare && lockedStyleId === null) setLockedStyleId(chosen.i);

      // ── Stage 4: LaTeX 생성 ──────────────────────────────────────
      pushLog('latex', 'LaTeX 생성', 'running', '출판물 데이터 → XeLaTeX 조판 중');

      const p = chosen.p;
      const bodySize   = corrections.bs || p.b.크기;
      const dbLead = corrections.bl || p.b.행간;
      const minLead = Math.round(bodySize * TYPO_BASE.leadingRatio(bodySize) * 10) / 10;
      const bodyLead = (dbLead && dbLead / bodySize >= 1.3) ? dbLead : minLead;
      const hasFootnote = p.footnote && p.footnote !== '-';
      let fnSize = hasFootnote ? parseFloat(p.footnote.replace('pt','')) : 8;
      fnSize = getLearnedDesignOverride('footnote_size', fnSize);
      // 각주는 본문보다 작으므로 행간 비율 더 크게
      let fnLead = Math.round(fnSize * TYPO_BASE.leadingRatio(fnSize) * 10) / 10;
      fnLead = getLearnedDesignOverride('footnote_leading', fnLead);
      // 면주 크기: 판형 높이 기준으로 자동 산출
      const pnAutoSize = TYPO_BASE.runningHeadSize(p.f.h);
      // ── 서체 선택 (v1.2: 가용 5개 폰트군 완전 매핑) ───────────────
      // 가용: NotoSerif / NanumMyeongjo(serif) / NotoSans / NotoSans_SemiCondensed / Pretendard(sans)
      // 판단 기준: 서체 분류의 첫 번째 언급 = 본문 서체
      const fontClass = p.ty.분류 || '';
      const fc = fontClass.toLowerCase();

      // 본문 서체 결정
      const bodyIsSerif =
        (fc.includes('명조') || fc.includes('세리프')) &&
        !fc.startsWith('고딕') &&
        !fc.match(/^혼합.*고딕.*명조/);   // 혼합(고딕/명조) = 본문 고딕

      const isNeoGrotesque = fc.includes('네오그로테스크') || fc.includes('그로테스크');
      const isCondensed    = fc.includes('컨덴스드') || fc.includes('condensed');
      const isDisplay      = fc.includes('디스플레이') || fc.includes('실험') || fc.includes('모듈');

      // 혼합 레이아웃 판정: 본문/제목 서체군이 명확히 다른 경우
      const isMixed = fc.includes('혼합') || (fc.includes('명조') && fc.includes('고딕'));
      // 각주/면주만 다른 폰트 — 전체 isMixedLayout은 false
      const mixedFnOnly  = /각주.고딕|각주.*고딕/.test(fc) && !fc.includes('제목');
      const mixedRhOnly  = /면주.고딕|면주.*고딕/.test(fc);
      const isMixedLayout = isMixed && !mixedFnOnly && !mixedRhOnly;

      let mainFont, sansFont;
      if (bodyIsSerif) {
        // 명조 계열
        mainFont = isDisplay ? 'NanumMyeongjo' : 'NotoSerif';
        sansFont = 'Pretendard';
      } else if (isNeoGrotesque || isCondensed) {
        // 네오그로테스크 / 컨덴스드 → NotoSans_SemiCondensed (중간 압축)
        mainFont = 'NotoSans_SemiCondensed';
        sansFont = 'NotoSans_SemiCondensed';
      } else if (isDisplay && !bodyIsSerif) {
        // 디스플레이/실험 고딕 → Pretendard
        mainFont = 'Pretendard';
        sansFont = 'Pretendard';
      } else {
        // 고딕 기본 → Pretendard
        mainFont = 'Pretendard';
        sansFont = isMixedLayout ? 'NotoSerif' : 'Pretendard';
      }

      // 혼합(고딕/명조): 본문=Pretendard, 제목=NotoSerif (or NanumMyeongjo for display)
      if (isMixedLayout && !bodyIsSerif) {
        mainFont = 'Pretendard';
        sansFont = 'NotoSerif';
      }

      // footnote/running head 전용 폰트 — 항상 고딕(NotoSans) 강제
      // 사용자 피드백: "주석·면주는 고딕체여야 한다" — 레퍼런스 분류 무관하게 적용
      const fnFont = 'NotoSans';
      const rhFont = 'NotoSans';

      // ── FONT_MANIFEST ──────────────────────────────────────────────
      // 사용자 폴더에 실제 존재하는 폰트만 등록. 이 목록 외 폰트는 절대 출력 안 됨.
      // Pretendard = .otf  /  나머지 = .ttf  /  NanumMyeongjo = -Regular 접미어 없음
      const FONT_MANIFEST = {
        // ── 명조 계열
        NanumMyeongjo: {
          ext: '.ttf',
          upright: 'NanumMyeongjo', bold: 'NanumMyeongjoBold',
          italic: null, boldItalic: null,
        },
        NotoSerif: {
          ext: '.ttf',
          upright: 'NotoSerif-Regular', bold: 'NotoSerif-Bold',
          italic: 'NotoSerif-Italic', boldItalic: 'NotoSerif-BoldItalic',
        },
        NotoSerif_SemiCondensed: {
          ext: '.ttf',
          upright: 'NotoSerif_SemiCondensed-Regular', bold: 'NotoSerif_SemiCondensed-Bold',
          italic: 'NotoSerif_SemiCondensed-Italic', boldItalic: 'NotoSerif_SemiCondensed-BoldItalic',
        },
        NotoSerif_Condensed: {
          ext: '.ttf',
          upright: 'NotoSerif_Condensed-Regular', bold: 'NotoSerif_Condensed-Bold',
          italic: 'NotoSerif_Condensed-Italic', boldItalic: 'NotoSerif_Condensed-BoldItalic',
        },
        NotoSerif_ExtraCondensed: {
          ext: '.ttf',
          upright: 'NotoSerif_ExtraCondensed-Regular', bold: 'NotoSerif_ExtraCondensed-Bold',
          italic: 'NotoSerif_ExtraCondensed-Italic', boldItalic: 'NotoSerif_ExtraCondensed-BoldItalic',
        },
        // ── 고딕 계열
        NotoSans: {
          ext: '.ttf',
          upright: 'NotoSans-Regular', bold: 'NotoSans-Bold',
          italic: 'NotoSans-Italic', boldItalic: 'NotoSans-BoldItalic',
        },
        NotoSans_SemiCondensed: {
          ext: '.ttf',
          upright: 'NotoSans_SemiCondensed-Regular', bold: 'NotoSans_SemiCondensed-Bold',
          italic: 'NotoSans_SemiCondensed-Italic', boldItalic: 'NotoSans_SemiCondensed-BoldItalic',
        },
        NotoSans_Condensed: {
          ext: '.ttf',
          upright: 'NotoSans_Condensed-Regular', bold: 'NotoSans_Condensed-Bold',
          italic: 'NotoSans_Condensed-Italic', boldItalic: 'NotoSans_Condensed-BoldItalic',
        },
        NotoSans_ExtraCondensed: {
          ext: '.ttf',
          upright: 'NotoSans_ExtraCondensed-Regular', bold: 'NotoSans_ExtraCondensed-Bold',
          italic: 'NotoSans_ExtraCondensed-Italic', boldItalic: 'NotoSans_ExtraCondensed-BoldItalic',
        },
        // ── 디스플레이 / 혼용
        Pretendard: {
          ext: '.otf',
          upright: 'Pretendard-Regular', bold: 'Pretendard-Bold',
          italic: null, boldItalic: null,
        },
      };
      const ALLOWED_FONTS = Object.keys(FONT_MANIFEST);

      function fontspecCmd(cmd, name) {
        // 목록 밖 폰트 요청 시 NotoSerif로 강제 fallback
        const safeName = ALLOWED_FONTS.includes(name) ? name : 'NotoSerif';
        const m = FONT_MANIFEST[safeName];
        const opts = [
          'Path=./fonts/', `Extension=${m.ext}`,
          `UprightFont=${m.upright}`,
          m.bold ? `BoldFont=${m.bold}` : null,
          m.italic ? `ItalicFont=${m.italic}` : null,
          m.boldItalic ? `BoldItalicFont=${m.boldItalic}` : null,
        ].filter(Boolean).join(',\n  ');
        return `\\${cmd}{${safeName}}[\n  ${opts}\n]`;
      }
      const fontBlock =
        `% Fonts — 가용: NotoSerif / NanumMyeongjo / Pretendard / NotoSans_SemiCondensed\n` +
        `% 원본 서체: ${p.ty.이름} (${fontClass})\n` +
        fontspecCmd('setmainfont', mainFont) + '\n' +
        (mainFont !== sansFont
          ? fontspecCmd('setsansfont', sansFont) + '\n'
          : `% sans = main (단일 서체군)\n`) +
        (isMixedLayout
          ? `% 혼합 레이아웃: 본문=\\rmfamily, 제목/소제목=\\sffamily\n`
          : '') +
        ((mixedFnOnly || mixedRhOnly) && fnFont !== mainFont
          ? fontspecCmd('newfontfamily\\fnfont', fnFont) + ' % 각주/면주 전용\n'
          : '');
      // ── 단 구성 분석 ─────────────────────────────────────────────
      const 구성 = p.c.구성 || '';
      const layoutType = p.layout_type || '';
      const colGap = p.c.간격 || 0;
      // variable mode gap: styleConfig 우선, DB 기본값 fallback + 학습 보정
      const columnGapMm = getLearnedDesignOverride('column_gap', Number(styleConfig.columnGapMm ?? p.c?.간격 ?? 8));

      const baseColMatch = 구성.match(/(\d+)[단열]/);
      const baseN = baseColMatch ? parseInt(baseColMatch[1]) : 1;
      // 열 표기 = 무조건 모듈 그리드 (가변)
      // 일반 타이포그래피에서 본문은 열을 개별 사용하지 않고 묶어서 사용
      const isYeol   = 구성.includes('열');
      const isVariable = 구성.includes('가변') || layoutType.includes('가변') || isYeol;
      const isModuleGrid = baseN >= 6 || isYeol;

      function parseUnits(str, keyword) {
        const m = str.match(new RegExp(keyword + '\\s*(\\d+)[단열]'));
        return m ? parseInt(m[1]) : null;
      }
      let bodyUnits  = parseUnits(layoutType, '본문') || (isModuleGrid ? null : baseN);
      let noteUnits  = parseUnits(layoutType, '주석');
      const imageUnits = parseUnits(layoutType, '이미지');

      // 열 표기이고 layout_type에 명시 없으면:
      // 본문 ~2/3, 주석 ~1/3 으로 기본 분할 (편집 디자인 관례)
      if (isYeol && !bodyUnits && baseN >= 6) {
        // styleConfig에 사용자 지정 분할이 있으면 그걸 우선
        if (styleConfig.bodyNoteSplit) {
          bodyUnits = styleConfig.bodyNoteSplit.body;
          noteUnits = styleConfig.bodyNoteSplit.note;
        } else {
          bodyUnits = Math.round(baseN * 0.65); // 약 2/3
          noteUnits = baseN - bodyUnits;         // 나머지
        }
      }

      // styleConfig.columnMode → 사용자 지정 단 우선
      // 'auto': 데이터 기반 / 'fixed': fixedColumns 사용 / 'variable': variableGrid 사용
      // 학습된 단 수 피드백 반영 — 사용자가 수동으로 단 수 설정하지 않은 경우(auto)에만 적용
      const _learnedCols = styleConfig.columnMode === 'auto' ? getSystemColumnCount() : null;
      const colMode = _learnedCols
        ? 'fixed'                        // 학습 규칙으로 고정단 모드 전환
        : styleConfig.columnMode || 'auto';
      const _fixedCols = _learnedCols || styleConfig.fixedColumns || 1;
      // legacy 호환: 'auto'|'fixed'|'variable'
      const userMode = colMode === 'fixed' ? String(_fixedCols)
                     : colMode === 'variable' ? 'variable'
                     : 'auto';
      const userOverride = colMode !== 'auto';

      // 판면 너비 (mm) → 모듈 단위 폭 계산
      const textW = p.f.w - p.m.안 - p.m.밖;
      function unitWidth(n) {
        // n개 모듈을 차지할 때의 실제 폭 (gap 포함)
        if (!baseN || baseN < 2) return textW;
        const unit = (textW - (baseN - 1) * colGap) / baseN;
        return Math.round((unit * n + (n - 1) * colGap) * 10) / 10;
      }

      // LaTeX 단 설정 지시문 생성
      let colSetupBlock = '';
      let colPackages = '';

      if (userOverride && userMode === 'variable') {
        // 사용자 지정 가변 단: variableGrid.total / body / note
        const _vgRaw = styleConfig.variableGrid || { total: 2, body: 1, note: 1 };
        const _notePos = styleConfig.notePosition || 'right';
        const _isSide = _notePos === 'left' || _notePos === 'right';
        // left/right 모드에서 body+note > total이면 note를 자동 보정
        const vg = _isSide && (_vgRaw.body + _vgRaw.note) > _vgRaw.total
          ? { ..._vgRaw, note: Math.max(1, _vgRaw.total - _vgRaw.body) }
          : _vgRaw;
        const vGrid = calcVariableGrid(vg, textW, columnGapMm);
        const hasNoteCol = vGrid.noteG > 0;
        const btc = Number(styleConfig.bodyTextColumns || 1);
        const ntc = Number(styleConfig.noteTextColumns || 1);
        const _bcs = Number(styleConfig.bodyColumnStart || 1);
        const _bnfc = Number(styleConfig.bottomNoteFlowColumns || 1);
        const _bnw = styleConfig.bottomNoteWidth || 'full';
        const _isBottom = _notePos === 'bottom';
        colPackages = '\\usepackage{paracol}\n';
        if (btc >= 2 || ntc >= 2 || (_isBottom && _bnfc >= 2)) colPackages += '\\usepackage{multicol}\n';
        if (['top','bottom'].includes(styleConfig.notePosition) && colMode === 'variable') {
          colPackages += '\\usepackage{changepage}\n'; // adjustwidth
        }
        // JS가 wrapping 보장 — Claude는 순수 텍스트 LaTeX만 생성
        colSetupBlock =
          '% VARIABLE GRID: body=' + vGrid.bodyW + 'mm / note=' + vGrid.noteW + 'mm / gap=' + vGrid.gap + 'mm\n' +
          '% (' + vGrid.bodyG + '/' + vGrid.totalG + ' body cols + ' + vGrid.noteG + '/' + vGrid.totalG + ' note cols, 1unit=' + vGrid.unitW + 'mm)\n' +
          (_bcs > 1 ? '% body-column-start=' + _bcs + ' (body indented from col ' + _bcs + ')\n' : '') +
          (btc >= 2 ? '% body-text-columns=' + btc + ' (multicols inside body col)\n' : '') +
          (ntc >= 2 ? '% note-text-columns=' + ntc + ' (multicols inside note col)\n' : '') +
          (_isBottom && _bnfc >= 2 ? '% bottom-note-flow-columns=' + _bnfc + ' (multicols for bottom note, width=' + _bnw + ')\n' : '') +
          '% JS HANDLES LAYOUT WRAPPING — do NOT add \\begin{imprintlayout} or \\begin{paracol}\n' +
          (hasNoteCol && hasParacolSep
            ? '% NOTE SPLIT DETECTED: Write body content, then %%PARACOL_SWITCHCOLUMN%% on its own line, then note content\n' +
              '% CRITICAL: preserve %%PARACOL_SWITCHCOLUMN%% verbatim — do NOT remove or paraphrase it\n'
            : '% No note separator → write body content only (JS will use imprintbodyspan for correct column width)\n') +
          (styleConfig.extraDirective ? 'Directive:' + styleConfig.extraDirective + '\n' : '');



      } else if (userOverride && userMode !== 'auto') {
        // 사용자 지정 고정 단수
        const n = parseInt(userMode);
        if (n <= 1) {
          colSetupBlock = '';
        } else {
          colPackages = '\\usepackage{multicol}\n';
          colSetupBlock =
            'cols=' + n + ' \\setlength{\\columnsep}{' + (colGap||5) + 'mm}\n' +
            '\\begin{multicols*}{' + n + '}...\\end{multicols*}\n';
        }

      } else if (!isModuleGrid && baseN <= 1) {
        colSetupBlock = '';

      } else if (!isYeol && !noteUnits) {
        // 단(열 아님) + 주석 열 없음 → 일반 multicols 레이아웃
        // 단 수: layout_type의 bodyUnits 우선, 없으면 c.구성 baseN 사용 (6단+ 포함)
        const _effN = bodyUnits || baseN;
        colPackages = '\\usepackage{multicol}\n';
        colSetupBlock =
          '% ' + _effN + '-column layout' + (_effN !== baseN ? ' (layout_type: ' + layoutType + ')' : '') +
          (isVariable
            ? ' (VARIABLE — analyze content and vary columns editorially)\n' +
              '% Base: ' + _effN + ' cols. Headlines/openers → full-width. Body → ' + _effN + ' cols. Vary intentionally.\n' +
              '% Each switch: \\end{multicols*} → \\begin{multicols*}{N}\n'
            : '\n') +
          '\\setlength{\\columnsep}{' + colGap + 'mm}\n' +
          '% \\begin{multicols*}{' + _effN + '} ... \\end{multicols*}\n';

      } else {
        // 모듈 그리드 (열 표기) 또는 본문+주석 분리 → paracol
        // ⚠️ 단, 사용자가 실제 주석 컬럼 내용을 입력하지 않은 경우 paracol 사용 안 함
        // (fields.각주는 페이지 하단 footnote이지, 사이드 note column이 아님)
        const hasActualNoteContent = styleConfig.bodyNoteSplit !== null;
        if (bodyUnits && noteUnits && !hasActualNoteContent) {
          // note 컬럼 내용 없음 → multicol 또는 single로 downgrade
          const effectiveCols = Math.min(bodyUnits, 3);
          if (effectiveCols <= 1) {
            colSetupBlock = '% Single column (note-column downgraded: no side-note content)\n';
          } else {
            colPackages = '\\usepackage{multicol}\n';
            colSetupBlock =
              '% ' + effectiveCols + '-column layout (note-col downgraded: no side-note content)\n' +
              '\\setlength{\\columnsep}{' + colGap + 'mm}\n' +
              '% \\begin{multicols*}{' + effectiveCols + '} ... \\end{multicols*}\n';
          }
        } else {
          colPackages = '\\usepackage{paracol}\n';
          const unit = baseN > 1 ? ((textW - (baseN-1)*colGap)/baseN).toFixed(1) : textW;

          if (bodyUnits && noteUnits) {
          const bw = unitWidth(bodyUnits);
          const nw = unitWidth(noteUnits);
          colSetupBlock =
            '% ' + (isYeol ? '열' : '단') + ' MODULE GRID: base=' + baseN + ', 1unit=' + unit + 'mm, textwidth=' + textW + 'mm\n' +
            (isYeol ? '% 열 notation → variable merged blocks (body does NOT use each column individually)\n' : '') +
            '% Body  → ' + bodyUnits + ' units = ' + bw + 'mm\n' +
            '% Notes → ' + noteUnits + ' units = ' + nw + 'mm\n' +
            (imageUnits ? '% Image → ' + imageUnits + ' units = ' + unitWidth(imageUnits) + 'mm\n' : '') +
            '\\setlength{\\columnsep}{' + colGap + 'mm}\n' +
            '% \\setcolumnwidth{' + bw + 'mm,' + nw + 'mm}\n' +
            '% \\begin{paracol}{2} <body> \\switchcolumn <notes> \\end{paracol}\n' +
            '% CRITICAL: do NOT use \\begin{imprintlayout} — use \\begin{paracol}{2} directly\n' +
            (isVariable ? '% Variable layout: section breaks may switch column configuration\n' : '');
        } else {
          const effectiveCols = bodyUnits || (isYeol ? Math.round(baseN * 0.65) : (baseN <= 4 ? baseN : Math.round(baseN / 3)));
          const ew = unitWidth(effectiveCols);
          colSetupBlock =
            '% ' + (isYeol ? '열' : '단') + ' MODULE GRID: base=' + baseN + ', 1unit=' + unit + 'mm\n' +
            (isYeol ? '% 열: body uses merged block (' + effectiveCols + ' units = ' + ew + 'mm), NOT individual columns\n' : '') +
            '% \\noindent\\begin{minipage}{' + ew + 'mm}...\\end{minipage}\n' +
            (isVariable ? '% Variable: sections may use 1-col, 2-col, or full-width blocks\n' : '');
        }
        } // end else (hasActualNoteContent)
      }

      // ── Auto mode: styContent 빌드 전 multicol 패키지 사전 확보 ──────────────
      // wrapFixedColumns가 auto 경로에서 실행될 때 \begin{multicols}가 생성되므로
      // styColPkgs에 multicol이 없으면 검증 오류 발생 → 여기서 미리 추가
      // 조건: 열 표기 아님(단 레이아웃) + noteUnits 없음(paracol 미사용) + 유효한 단 수
      if (colMode === 'auto' && !isYeol && !noteUnits) {
        const _autoEffCols = bodyUnits || baseN;
        if (_autoEffCols >= 2 && _autoEffCols <= 8 && !colPackages.includes('multicol')) {
          colPackages += '\\usepackage{multicol}\n';
        }
      }

      const numCols = userOverride && userMode !== 'auto' && userMode !== 'variable'
        ? parseInt(userMode)
        : (isModuleGrid ? (bodyUnits || 2) : baseN);

      // ── 다단 글자 크기 자동 보정 (v24) ──────────────────────────────
      // 단 수 많을수록 컬럼 폭 좁아지므로 글자 크기 축소 필요
      // 2~3단: -0.5pt / 4단 이상: -1pt (최소 7pt 유지)
      let adjustedBodySize = Math.max(7, bodySize); // 0pt 방어: memoir/fontspec은 0pt 불허
      if (numCols >= 4)      adjustedBodySize = Math.max(adjustedBodySize - 1.0, 7);
      else if (numCols >= 2) adjustedBodySize = Math.max(adjustedBodySize - 0.5, 7);
      // 주석/각주 글자 크기는 본문 이하로 강제 (rule 1)
      if (fnSize > adjustedBodySize) {
        fnSize = adjustedBodySize;
        fnLead = Math.round(fnSize * TYPO_BASE.leadingRatio(fnSize) * 10) / 10;
      }
      // 보정된 글자 크기 기반 행간 재계산
      const adjustedBodyLead = Math.max(11, adjustedBodySize !== bodySize
        ? Math.round(adjustedBodySize * TYPO_BASE.leadingRatio(adjustedBodySize) * 10) / 10
        : bodyLead);
      setDisplayBodySize(adjustedBodySize);

      // ── Visual Element를 실제 적용값으로 업데이트 ───────────────
      // semanticRerank의 AI 추측 텍스트 대신 실제 수치로 덮어씀
      {
        const _colDesc = (() => {
          if (styleConfig.columnMode === 'variable') {
            const vg = styleConfig.variableGrid || { total:5, body:4, note:1 };
            return `가변 그리드 ${vg.total}열 (본문 ${vg.body}열 + 주석 ${vg.note}열)`;
          }
          if (styleConfig.columnMode === 'fixed') return `${styleConfig.fixedColumns || numCols}단 고정`;
          return numCols > 1 ? `${numCols}단 자동` : '1단 본문';
        })();
        const _fontDesc = (bodyIsSerif ? '명조 계열' : '고딕 계열') + ` 본문 서체 (${mainFont})`;
        const _alignDesc = alignResult.alignment === 'ragged' ? '좌측 정렬' : '양끝 정렬';
        const _actualVisualElements = [
          `${adjustedBodySize}pt 본문 / ${adjustedBodyLead}pt 행간`,
          `${p.f.w}×${p.f.h}mm 판형`,
          _colDesc,
          _fontDesc,
          `여백 상${corrections.margins.상}/하${corrections.margins.하}mm · 안${corrections.margins.안}/밖${corrections.margins.밖}mm`,
          _alignDesc,
          p.pn && p.pn !== '-' ? `쪽번호 ${p.pn}` : null,
        ].filter(Boolean);
        // ── 레퍼런스 원본 vs 적용값 diff ───────────────────────────
        const _ref = {
          bodySize:   p.b.크기,
          bodyLead:   p.b.행간,
          tracking:   p.b.자간 || 0,
          marginTop:  p.m.상,
          marginBottom: p.m.하,
          marginInner: p.m.안,
          marginOuter: p.m.밖,
        };
        const _applied = {
          bodySize:   adjustedBodySize,
          bodyLead:   adjustedBodyLead,
          tracking:   corrections.bt ?? _ref.tracking,
          marginTop:  corrections.margins.상,
          marginBottom: corrections.margins.하,
          marginInner: corrections.margins.안,
          marginOuter: corrections.margins.밖,
        };
        const _label = { bodySize:'본문 크기', bodyLead:'행간', tracking:'자간',
          marginTop:'상단 여백', marginBottom:'하단 여백', marginInner:'내측 여백', marginOuter:'외측 여백' };
        const _unit  = { bodySize:'pt', bodyLead:'pt', tracking:'', marginTop:'mm', marginBottom:'mm', marginInner:'mm', marginOuter:'mm' };
        const _modified = [], _kept = [];
        for (const k of Object.keys(_label)) {
          const rVal = Number(_ref[k] ?? 0);
          const aVal = Number(_applied[k] ?? 0);
          if (Math.abs(rVal - aVal) > 0.05) {
            // 수정된 항목 — typoAdj.reasons에서 이유 찾기
            const reason = typoAdj?.reasons?.find(r => r.variable === _label[k])?.reason || '';
            _modified.push({ label: _label[k], ref: `${rVal}${_unit[k]}`, applied: `${aVal}${_unit[k]}`, reason });
          } else {
            _kept.push(`${_label[k]} ${rVal}${_unit[k]}`);
          }
        }
        // 레이아웃·서체는 레퍼런스에서 그대로 가져온 항목으로 처리
        const _keptLayout = [
          `판형 ${p.f.w}×${p.f.h}mm`,
          `${bodyIsSerif ? '명조' : '고딕'} 계열 서체`,
          p.pn && p.pn !== '-' ? `쪽번호 ${p.pn}` : null,
          p.layout_type ? `레이아웃 ${p.layout_type}` : null,
        ].filter(Boolean);

        setStructuredReason(prev => prev ? {
          ...prev,
          visual_element: _actualVisualElements,
          style_diff: {
            kept: [..._keptLayout, ..._kept],
            modified: _modified,
          },
        } : prev);
      }

      // ── 위계별 글자 크기 + 행간 계산 ──────────────────────────────
      // 본문 크기 기반 기본값 + DB subheading 값이 있으면 h2/h3에 반영
      const hs = TYPO_BASE.headingSizes(adjustedBodySize);
      // DB의 subheading 크기가 유효하면 h2/h3에 반영 (h1은 항상 비례 계산)
      const dbSh = parseFloat(p.subheading);
      if (dbSh > 0 && dbSh < 40 && p.subheading !== '-') {
        hs.h2 = dbSh;
        hs.h3 = Math.round(dbSh * 0.85 * 2) / 2; // h3 = h2 × 0.85
      }
      // 피드백 학습 보정: heading_h1/h2/h3_size 규칙이 있으면 덮어씀
      hs.h1 = getLearnedDesignOverride('heading_h1_size', hs.h1);
      hs.h2 = getLearnedDesignOverride('heading_h2_size', hs.h2);
      hs.h3 = getLearnedDesignOverride('heading_h3_size', hs.h3);
      const h1Lead = getLearnedDesignOverride('heading_h1_leading', Math.round(hs.h1 * TYPO_BASE.leadingRatio(hs.h1) * 10) / 10);
      const h2Lead = getLearnedDesignOverride('heading_h2_leading', Math.round(hs.h2 * TYPO_BASE.leadingRatio(hs.h2) * 10) / 10);
      const h3Lead = getLearnedDesignOverride('heading_h3_leading', Math.round(hs.h3 * TYPO_BASE.leadingRatio(hs.h3) * 10) / 10);
      const headingGapPt = getLearnedDesignOverride('heading_gap', Math.round(adjustedBodyLead * 0.75 * 10) / 10);
      const rhLead = Math.round(pnAutoSize * TYPO_BASE.leadingRatio(pnAutoSize) * 10) / 10;

      // preamble에 heading 명령 정의 (AI가 반드시 이것을 사용하도록)
      // 혼합 서체(isMixedLayout): 제목은 sffamily(고딕), 본문은 rmfamily(명조)
      // heading 커맨드: 크기 + 굵기 + (혼합시) font family
      // 비혼합: \bfseries 로 소제목 구분 / 혼합: sffamily 전환으로 명조↔고딕 구분
      const hFont = isMixedLayout ? '\\sffamily' : '\\bfseries';
      const bFont = isMixedLayout ? '\\rmfamily'  : '\\normalfont';
      // 학습된 제목 정렬 방향 적용 (medium 이상 confidence일 때만)
      const _learnedHeadingLayout = getSystemHeadingLayout();
      const _learnedHeadingIndent = getSystemHeadingIndent();
      const _footnoteMarkerFormat = getSystemFootnoteMarkerFormat();
      const _headingAlign = _learnedHeadingLayout === 'center' ? '\\centering'
        : _learnedHeadingLayout === 'right' ? '\\raggedleft'
        : _learnedHeadingLayout === 'left' ? '\\raggedright'
        : '';
      const _ha = _headingAlign ? ' ' + _headingAlign : '';
      const headingCmdsBlock =
        '% Heading sizes — DO NOT OVERRIDE sizes or weights\n' +
        `\\newcommand{\\hone}{${hFont}\\fontsize{${hs.h1}pt}{${h1Lead}pt}\\selectfont${_ha}}   % title\n` +
        `\\newcommand{\\htwo}{${hFont}\\fontsize{${hs.h2}pt}{${h2Lead}pt}\\selectfont${_ha}}   % subtitle/chapter\n` +
        `\\newcommand{\\hthree}{${hFont}\\fontsize{${hs.h3}pt}{${h3Lead}pt}\\selectfont${_ha}} % section head\n` +
        `\\newcommand{\\bodyf}{${bFont}\\fontsize{${adjustedBodySize}pt}{${adjustedBodyLead}pt}\\selectfont} % body reset after heading\n`;

      const isMultiColLayout = numCols >= 2 || (bodyUnits && noteUnits);

      const _fw = (styleConfig.paperW && parseFloat(styleConfig.paperW) > 0) ? parseFloat(styleConfig.paperW) : p.f.w;
      const _fh = (styleConfig.paperH && parseFloat(styleConfig.paperH) > 0) ? parseFloat(styleConfig.paperH) : p.f.h;

      const preamble = [
        '\\documentclass[' + Math.max(9, p.b.크기) + 'pt]{memoir}',
        '% memoir stock size — must match paperwidth/height or Overleaf defaults to letter',
        '\\setstocksize{' + _fh + 'mm}{' + _fw + 'mm}',
        '\\settrimmedsize{\\stockheight}{\\stockwidth}{*}',
        '\\usepackage{kotex}',
        '\\usepackage{fontspec}',
        '\\usepackage[paperwidth=' + _fw + 'mm,paperheight=' + _fh + 'mm,' +
          'top=' + corrections.margins.상 + 'mm,bottom=' + corrections.margins.하 + 'mm,' +
          'inner=' + corrections.margins.안 + 'mm,outer=' + corrections.margins.밖 + 'mm,' +
          'includehead=true,includefoot=false]{geometry}',
        colPackages.trim(),
        // 수직 면주 \rotatebox 사용 시 graphicx 필요
        (styleConfig.rhPos === '외측-수직' || styleConfig.rhPos === '내측-수직') ? '\\usepackage{graphicx}' : '',
        '',
        fontBlock,
        '',
        headingCmdsBlock,
        '',
        '% 본문 크기 + 행간 직접 지정 (linespread 미사용)',
        '\\AtBeginDocument{\\fontsize{' + adjustedBodySize + 'pt}{' + adjustedBodyLead + 'pt}\\selectfont}',
        '',
        '% footnotes — v29: preamble fixed, no dead code (item 4)',
        '\\feetbelowfloat', // memoir: 각주를 float 아래 고정 (페이지별 배치 보장)
        '\\renewcommand{\\footnoterule}{}',
        hasFootnote ? `\\renewcommand{\\footnotesize}{\\fontsize{${fnSize}pt}{${fnLead}pt}\\selectfont}` : '',
        // \notef: 주석 컬럼용 서체 커맨드 (DB footnote 크기 기반, pn_font로 명조/고딕 결정)
        `\\newcommand{\\notef}{\\sffamily\\fontsize{${fnSize}pt}{${fnLead}pt}\\selectfont}`,
        `\\newcommand{\\ImpNoteLabel}[1]{${_footnoteMarkerFormat === 'bracket' ? '[#1]\\ ' : '#1.\\ '}}`,
        // 각주 N단 지원: fields.각주단 >= 2이면 bigfoot 패키지로 다단 각주 구성
        (() => {
          const fnCols = parseInt(fields.각주단 || '1', 10);
          if (fnCols >= 2) {
            // memoir 내장 다단 각주: \twocolumnfootnotes / \threecolumnfootnotes
            // bigfoot/manyfoot 불필요 — \footnote{} 직접 사용, memoir가 레이아웃 처리
            // \footnotelayout 은 footmisc 전용 포매팅 훅, 단 수와 무관 → 사용 금지
            const memoirCmd = fnCols >= 3 ? '\\threecolumnfootnotes' : '\\twocolumnfootnotes';
            const _rigidCols = fnCols >= 3 ? '\\thr@@' : '\\tw@';
            // 각주 컨테이너 폭 제한: \imprintnotewidth 가 정의 + 0pt 초과일 때만 적용
            // memoir 흐름: \mp@footgroupv@r → \m@mrigidbalance → \@@line = \hbox to \hsize
            // \hsize = \textwidth - \imprintnotewidth - \columnsep 로 설정
            //   = 판면너비 - 주석열폭 - 단간격 = 실제 본문 열 폭
            //   (body=12/total=12 오버플로우 상황에서도 올바른 본문 폭 산출)
            // \@ifundefined + \ifdim 이중 가드: variable 아닌 레이아웃 보호
            // 각주 컬럼 폭: (본문열폭 - gutter) / N
            // 본문열폭 = textwidth - notewidth - columnsep
            // gutter = columnsep (본문 단간격과 동일하게)
            // 2단: (body - columnsep) / 2,  3단: (body - 2*columnsep) / 3
            const _preamCmd = fnCols >= 3 ? '\\@preamthreefmt' : '\\@preamtwofmt';
            // 각주 단 폭 = (textwidth - columnsep*(N-1)) / N
            // → 본문 multicols{N}의 단 폭과 동일하게 맞춤 (imprintnotewidth 불사용)
            // 면주는 eso-pic으로 margin에 배치 — textwidth를 소비하지 않음
            const _preamFormula = fnCols >= 3
              ? '(\\textwidth-\\columnsep*2)/3'
              : '(\\textwidth-\\columnsep)/2';
            return [
              '% 각주 ' + fnCols + '단 설정 (memoir 내장)',
              '% memoir \\twocolumnfootnotes / \\threecolumnfootnotes 사용',
              memoirCmd,
              '\\makeatletter',
              '% Fix1: \\@preamtwofmt — 각주 컬럼 폭 = (textwidth - columnsep) / N',
              '% memoir \\m@make@twocol@footgroup이 이 값으로 각주를 재조판 후 균형 배치',
              '% \\leavevmode 금지 — 출력 루틴(V-mode)에서 호출되므로 모드 전환 불필요',
              '% \\@footgroupv@r 오버라이드 불필요: memoir 기본 \\m@make@twocol@footgroup이 재조판 담당',
              '\\renewcommand' + _preamCmd + '{%',
              '  \\hsize\\dimexpr' + _preamFormula + '\\relax',
              '  \\parindent\\z@',
              '  \\tolerance=9999\\relax',
              '  \\emergencystretch=2em',
              '  \\raggedright}%',
              '% Fix2: 각주 들여쓰기 제거 — \\noindent 명시',
              '\\renewcommand' + (fnCols >= 3 ? '\\@threecolfootfmt' : '\\@twocolfootfmt') + '[1]{%',
              '  \\noindent{\\footfootmark\\strut \\foottextfont #1\\strut\\par}\\allowbreak}%',
              '\\makeatother',
            ].join('\n');
          }
          // 1단: 기존 방식 + \thefootnote arabic 유지
          return [
            '\\renewcommand{\\thefootnote}{\\arabic{footnote}}',
            `\\setlength{\\footnotesep}{${Math.round(fnLead * 1.2 * 10) / 10}pt}`,
            '\\makeatletter',
            '\\renewcommand\\@makefntext[1]{%',
            '  \\parindent\\z@\\hangindent1.5em\\relax',
            '  \\noindent\\makebox[1.5em][l]{\\notef\\@thefnmark.}\\,{\\notef #1}}',
            '\\makeatother',
          ].join('\n');
        })(),
        '',
        colGap > 0 ? '\\setlength{\\columnsep}{' + colGap + 'mm}' : '',
        '',
        '% 헤더 높이 (면주/쪽번호 잘림 방지)',
        '\\setlength{\\headheight}{' + (pnAutoSize + 6) + 'pt}',
        '\\setlength{\\headsep}{4mm}',
        '',
        '% 과부·고아줄 방지 v29 (item 1)',
        '\\widowpenalty=10000',
        '\\clubpenalty=10000',
        '\\displaywidowpenalty=10000',
        '\\brokenpenalty=10000',
        // heading 뒤 본문 2줄 이상 묶음 방지 — Needspace로 heading 앞 최소 공간 확보
        '\\usepackage{needspace}',
        '% \\Needspace{4\\baselineskip} before each heading — use in body',
        '',
        '% 한국어 줄나눔: 엄격한 tolerance, 최후수단 emergencystretch',
        '\\pretolerance=100',
        '\\tolerance=400',
        '\\emergencystretch=3em',
      ].filter(s => s !== null && s !== undefined).join('\n');

      // AI에게 보내는 preamble 요약 (fontBlock 제외 — 길어서 토큰 낭비)
      // ── .sty 파일 생성 (결정론적 — Claude API 없음) ─────────────
      // ⚠️ JS template literal에서 \N \R \f \t 등은 escape로 처리됨 → 반드시 \\ 사용
      const _styDate = new Date().toISOString().slice(0,10).replace(/-/g,'/');
      // colPackages는 \usepackage → .sty에서는 \RequirePackage로 변환
      const styColPkgs = colPackages.trim()
        ? colPackages.trim().replace(/\\usepackage/g, '\\RequirePackage')
        : null;
      const styContent = [
        `% ============================================================`,
        `% imprint-style.sty`,
        `% Reference: ${p.t}`,
        `% Designer:  ${p.designer || '-'}`,
        `% Genre:     ${p.g} / ${p.pub_type}`,
        `% Generated: Imprint v${IMPRINT_VERSION} — ${new Date().toISOString().slice(0,10)}`,
        `% ============================================================`,
        `%`,
        `% 필요한 폰트 파일 (main.tex과 같은 폴더의 fonts/ 하위에 저장):`,
        ...[...new Set([mainFont, sansFont, fnFont].filter(Boolean))].flatMap(name => {
          const m = FONT_MANIFEST[name];
          if (!m) return [];
          return [m.upright, m.bold, m.italic, m.boldItalic]
            .filter(Boolean).map(f => `%   fonts/${f}${m.ext || '.ttf'}`);
        }),
        `%`,
        `\\NeedsTeXFormat{LaTeX2e}`,
        `\\ProvidesPackage{imprint-style}[${_styDate} Imprint generated style]`,
        ``,
        `% ── 이전 bigfoot 빌드 .aux 호환 — perpage \\pp@spagectr 미정의 오류 방지 ──`,
        `% bigfoot(perpage)가 이전 컴파일에서 .aux에 기록한 \\pp@spagectr를`,
        `% 이 sty에서 no-op으로 제공해 오류 루프를 끊는다. 다음 컴파일부터는 .aux에 없음.`,
        `\\providecommand{\\pp@spagectr}[4]{}`,
        ``,
        `% ── 필수 패키지 ───────────────────────────────────────────────`,
        `\\RequirePackage{fontspec}`,
        `\\RequirePackage{geometry}`,
        `\\RequirePackage{needspace}`,
        styColPkgs || null,
        alignResult.alignment === 'ragged' ? `\\RequirePackage{ragged2e}` : null,
        // 수직 면주 \rotatebox 사용 시 graphicx 필요 (sty 안에서 호출되므로 sty에서 로드)
        (styleConfig.rhPos === '외측-수직' || styleConfig.rhPos === '내측-수직') ? `\\RequirePackage{graphicx}` : null,
        ``,
        `% ── 판형 / 여백 ───────────────────────────────────────────────`,
        `% ${_fw}×${_fh}mm — ${p.why_dim || ''}`,
        `% 여백 의도: ${p.why_margin || ''}`,
        (() => {
          const pnIsBottom = !(p.pn || '').includes('상단');
          return [
            `\\geometry{`,
            `  paperwidth=${_fw}mm, paperheight=${_fh}mm,`,
            `  top=${corrections.margins.상}mm, bottom=${corrections.margins.하}mm,`,
            `  inner=${corrections.margins.안}mm, outer=${corrections.margins.밖}mm,`,
            `  includehead=true, includefoot=${pnIsBottom ? 'true' : 'false'},`,
            `  headheight=${pnAutoSize + 6}pt, headsep=4mm,`,
            pnIsBottom ? `  footskip=10mm,` : null,
            `}`,
          ].filter(Boolean).join('\n');
        })(),
        ``,
        `% ── 서체 ──────────────────────────────────────────────────────`,
        `% 서체 선택 이유: ${p.why_font || ''}`,
        `% XeLaTeX 전용 (fontspec) — pdfLaTeX 미지원`,
        fontBlock,
        ``,
        `% ── 본문 타이포그래피 ─────────────────────────────────────────`,
        `% ${adjustedBodySize}pt / 행간 ${adjustedBodyLead}pt / 자간 ${p.b.자간}`,
        `% 자간 이유: ${p.why_tracking || ''}`,
        `\\AtBeginDocument{\\fontsize{${adjustedBodySize}pt}{${adjustedBodyLead}pt}\\selectfont}`,
        `\\setlength{\\parindent}{1em}`,
        `\\setlength{\\parskip}{0pt}`,
        `\\widowpenalty=10000`,
        `\\clubpenalty=10000`,
        `\\displaywidowpenalty=10000`,
        `\\pretolerance=100`,
        `\\tolerance=400`,
        `\\emergencystretch=3em`,
        ``,
        `% ── 본문 정렬: ${p.align_body || '양쪽 정렬'} ────────────────────────────────`,
        alignResult.alignment === 'ragged' ? `\\AtBeginDocument{\\RaggedRight}` : `% 기본 양쪽 정렬 (LaTeX 기본값)`,
        ``,
        (() => {
          // 단 구성 설명: 가변단이면 사용자 설정 기준으로 표시 (DB 기본 설명과 섞지 않음)
          if (colMode === 'variable') {
            const vg = styleConfig.variableGrid || { total: 2, body: 1, note: 1 };
            const btc = Number(styleConfig.bodyTextColumns || 1);
            const ntc = Number(styleConfig.noteTextColumns || 1);
            return [
              `% ── 단 구성: 가변 그리드 (사용자 지정) ─────────────────────────────`,
              `% 총 ${vg.total}열 / 본문 ${vg.body}열 / 주석 ${vg.note}열 / 본문 내부 ${btc}단 / 주석 내부 ${ntc}단 / 간격 ${columnGapMm}mm`,
              `% 이 설정은 사용자가 스타일 지시에서 직접 지정한 값입니다.`,
              `% [원본 스타일 분석] 레이아웃 유형: ${p.layout_type || ''} — ${p.특 || ''}`,
            ].join('\n');
          }
          return [
            `% ── 단 구성: ${p.c.구성}${p.c.간격 ? ' / 간격 ' + p.c.간격 + 'mm' : ''} ──────────────────────────────────────`,
            `% 레이아웃 유형: ${p.layout_type || ''} — ${p.특 || ''}`,
          ].join('\n');
        })(),
        colMode === 'variable' ? `\\setlength{\\columnsep}{${columnGapMm}mm}` : (colGap > 0 ? `\\setlength{\\columnsep}{${colGap}mm}` : null),
        // 가변단: \ImpFN 매크로 + imprintnotearea 환경 정의 (imprintlayout 환경은 제거 — main.tex이 paracol 직접 사용)
        (() => {
          if (colMode !== 'variable') return null;
          const vg = styleConfig.variableGrid || { total: 2, body: 1, note: 1 };
          // bottom/top 모드: 본문이 전체 판면 사용 → vgEffective 적용
          const _styNotePos = styleConfig.notePosition || 'right';
          const _styIsTopBot = _styNotePos === 'top' || _styNotePos === 'bottom';
          const vgSty = _styIsTopBot ? { ...vg, body: vg.total } : vg;
          const vg2 = calcVariableGrid(vgSty, textW, columnGapMm);
          if (vg2.noteG <= 0 && !_styIsTopBot) return null;
          const { bodyW: bMm, noteW: nMm, gap } = vg2;
          const btc = Number(styleConfig.bodyTextColumns || 1);
          const ntc = Number(styleConfig.noteTextColumns || 1);
          return [
            `% ── 가변단 매크로 / 환경 ─────────────────────────────────────────`,
            `% 그리드: 총 ${vg2.totalG}열, 본문 ${vg2.bodyG}열(${bMm}mm), 주석 ${vg2.noteG}열(${nMm}mm), 본문내부 ${btc}단, 주석내부 ${ntc}단, 간격 ${gap}mm`,
            `% main.tex에서:`,
            `%   \\begin{paracol}{2}`,
            `%   \\setlength{\\columnsep}{${gap}mm}`,
            `%   \\setcolumnwidth{${bMm}mm,${nMm}mm}`,
            ``,
            `% 각주 참조 번호 매크로: \\ImpFN{N} → 본문 위첨자, \\ImpNoteLabel{N} → 주석 번호`,
            `\\newcommand{\\ImpFN}[1]{\\textsuperscript{#1}}`,
            `\\newcommand{\\ImpNoteLabel}[1]{${_footnoteMarkerFormat === 'bracket' ? '[#1]\\ ' : '#1.\\ '}}`,
            ``,
            `% 본문 폭 / 주석 폭 길이 변수 (치수 참조용)`,
            `\\newlength{\\imprintbodywidth}`,
            `\\setlength{\\imprintbodywidth}{${bMm}mm}`,
            `\\newlength{\\imprintnotewidth}`,
            `\\setlength{\\imprintnotewidth}{${nMm}mm}`,
            ``,
            `% 주석 블록 (상단/하단 배치용)`,
            `% 사용법: \\begin{imprintnotearea} ... \\end{imprintnotearea}`,
            `\\newenvironment{imprintnotearea}{%`,
            `  \\par\\vspace{0.3\\baselineskip}%`,
            `  \\begingroup%`,
            `  \\footnotesize%`,
            `  \\setlength{\\leftskip}{0pt}%`,
            `  \\noindent%`,
            `}{%`,
            `  \\endgroup%`,
            `  \\par\\vspace{0.3\\baselineskip}%`,
            `}`,
          ].join('\n');
        })(),
        ``,
        `% ── 위계별 글자 크기 명령 ─────────────────────────────────────`,
        `% 본문에서 \\hone \\htwo \\hthree \\bodyf 사용`,
        headingCmdsBlock.trim(),
        ``,
        `% ── 각주 ──────────────────────────────────────────────────────`,
        `% 크기: ${p.footnote || '-'} / 정렬: ${p.align_note || '-'}`,
        `\\feetbelowfloat`, // memoir: 각주를 float 아래 고정 (페이지별 배치 보장)
        `\\renewcommand{\\footnoterule}{}`,
        hasFootnote ? `\\renewcommand{\\footnotesize}{\\fontsize{${fnSize}pt}{${fnLead}pt}\\selectfont}` : null,
        `\\newcommand{\\notef}{\\sffamily\\fontsize{${fnSize}pt}{${fnLead}pt}\\selectfont}`,
        // 각주 N단: fields.각주단 >= 2이면 bigfoot(sty 내 \RequirePackage), 아니면 1단
        (() => {
          const fnCols = parseInt(fields.각주단 || '1', 10);
          if (fnCols >= 2) {
            // memoir 내장 다단 각주 명령 사용
            const memoirCmd2 = fnCols >= 3 ? `\\threecolumnfootnotes` : `\\twocolumnfootnotes`;
            const _rigidCols2 = fnCols >= 3 ? `\\thr@@` : `\\tw@`;
            // 각주 컨테이너 폭 제한: \imprintnotewidth 가 정의 + 0pt 초과일 때만 적용
            // memoir 흐름: \mp@footgroupv@r → \m@mrigidbalance → \@@line = \hbox to \hsize
            // \hsize = \textwidth - \imprintnotewidth - \columnsep 로 설정
            //   = 판면너비 - 주석열폭 - 단간격 = 실제 본문 열 폭
            // ⚠ .sty 파일은 @가 catcode 11(letter)이므로 \makeatletter/\makeatother 불필요
            //   (포함 시 \makeatother가 @ catcode를 12로 바꿔 이후 \c@page 등 파괴)
            const _preamCmd2 = fnCols >= 3 ? `\\@preamthreefmt` : `\\@preamtwofmt`;
            // 각주 단 폭 = (textwidth - columnsep*(N-1)) / N → 본문 multicols 단과 정렬
            const _preamFormula2 = fnCols >= 3
              ? `(\\textwidth-\\columnsep*2)/3`
              : `(\\textwidth-\\columnsep)/2`;
            return [
              `% 각주 ${fnCols}단 설정 (memoir 내장)`,
              `% memoir \\twocolumnfootnotes / \\threecolumnfootnotes 사용`,
              memoirCmd2,
              `% Fix1: \\@preamtwofmt — 각주 컬럼 폭 = (textwidth - columnsep) / N`,
              `% memoir \\m@make@twocol@footgroup이 이 값으로 각주를 재조판 후 균형 배치`,
              `% \\leavevmode 금지 — 출력 루틴(V-mode), \\@footgroupv@r 오버라이드 불필요`,
              `\\renewcommand${_preamCmd2}{%`,
              `  \\hsize\\dimexpr${_preamFormula2}\\relax`,
              `  \\parindent\\z@`,
              `  \\tolerance=9999\\relax`,
              `  \\emergencystretch=2em`,
              `  \\raggedright}%`,
              `% Fix2: 각주 들여쓰기 제거 — \\noindent 명시`,
              `\\renewcommand${fnCols >= 3 ? `\\@threecolfootfmt` : `\\@twocolfootfmt`}[1]{%`,
              `  \\noindent{\\footfootmark\\strut \\foottextfont #1\\strut\\par}\\allowbreak}%`,
            ].join('\n');
          }
          return [
            `\\renewcommand{\\thefootnote}{\\arabic{footnote}}`,
            `\\setlength{\\footnotesep}{${Math.round(fnLead * 1.2 * 10) / 10}pt}`,
            `\\makeatletter`,
            `\\renewcommand\\@makefntext[1]{%`,
            `  \\parindent\\z@\\hangindent1.5em\\relax`,
            `  \\noindent\\makebox[1.5em][l]{\\notef\\@thefnmark.}\\,{\\notef #1}}`,
            `\\makeatother`,
          ].join('\n');
        })(),
        ``,
        `% ── 면주 / 쪽번호 (memoir pagestyle) ─────────────────────────`,
        `% 쪽번호: ${p.pn || '하단-외측'} / 면주: ${styleConfig.rhPos || '자동'} / 크기: ${p.pn_size || pnAutoSize + 'pt'}`,
        buildMemoirPageStyle({
          pnPos: p.pn || '하단-외측',
          pnSizePt: (() => { const s = parseFloat(p.pn_size); const base = (s > 0 && s < 30) ? s : pnAutoSize; return getLearnedDesignOverride('folio_size', base); })(),
          hasRunningHead: !!effectiveRH(),
          rhPos: (() => {
            const rp = styleConfig.rhPos || '자동';
            if (rp !== '자동') return rp;
            // 자동: pn 위치 반대편에 면주 배치
            const pn = (p.pn || '하단-외측').toLowerCase();
            if (pn.includes('하단')) return '상단-외측';
            if (pn.includes('상단')) return '하단-외측';
            return '상단-외측';
          })(),
          rhVertPos: styleConfig.rhVertPos || 'auto',
        }),
        // 수직 면주 배치: eso-pic 절대좌표 — 상/중/하 모든 위치
        // \rotatebox{90} CCW → makebox 정렬: [r]=상단, [c]=중앙, [l]=하단
        (() => {
          const isVert = styleConfig.rhPos === '외측-수직' || styleConfig.rhPos === '내측-수직';
          if (!isVert || !effectiveRH()) return null;

          const vPos = styleConfig.rhVertPos || 'auto';
          const pnPos = (p.pn || '하단-외측');
          const resolved = vPos === 'auto' ? (pnPos.startsWith('상단') ? 'bottom' : 'top') : vPos;

          const pw      = _fw;   // paperWidth mm  (_fw: override 반영)
          const ph      = _fh;   // paperHeight mm (_fh: setstocksize와 동일)
          const topMm   = corrections.margins.상;
          const botMm   = corrections.margins.하;
          const outerMm = corrections.margins.밖;
          const innerMm = corrections.margins.안;
          const isOuter = styleConfig.rhPos === '외측-수직';

          // X 좌표: 홀수/짝수 여백 중앙 (page 좌측 기준 mm)
          const oddX  = isOuter
            ? (pw - outerMm / 2).toFixed(1)   // 외측-홀수: 오른쪽 여백 중앙
            : (innerMm / 2).toFixed(1);        // 내측-홀수: 왼쪽 여백 중앙
          const evenX = isOuter
            ? (outerMm / 2).toFixed(1)         // 외측-짝수: 왼쪽 여백 중앙
            : (pw - innerMm / 2).toFixed(1);   // 내측-짝수: 오른쪽 여백 중앙

          // Y 좌표 (page 하단 기준 mm) + makebox 정렬
          // \rotatebox{90} = CCW 90°: 기본 레퍼런스 포인트는 텍스트 하단에 있어 위로 확장
          // → top 위치에서 텍스트가 페이지 상단 밖으로 나가는 잘림 방지:
          //   \raisebox{-\height}로 텍스트를 아래 방향으로 전환 (레퍼런스=텍스트 상단)
          // center는 \raisebox{-0.5\height}로 중앙 정렬
          // bottom은 위로 확장이 올바른 방향 — raisebox 없음
          // Y 좌표 및 rotatebox 내부 makebox 정렬
          // \rotatebox{90} = CCW 90°: put 기준점에서 텍스트가 위로 뻗음
          // → 텍스트 시작점(top)이 put 기준: makebox[l] — Y = ph - topMm
          // → 텍스트 끝점(bottom)이 put 기준: makebox[r] — Y = botMm
          // → 텍스트 중앙이 put 기준: makebox[c] — Y = ph/2
          // \smash 제거: picture 컨텍스트에서 \smash + \raisebox 조합이 불안정
          const vertY  = resolved === 'top'    ? (ph - topMm).toFixed(1)
                       : resolved === 'bottom' ? botMm.toFixed(1)
                       :                         (ph / 2).toFixed(1);
          // rotatebox 내부 makebox 정렬 (l=텍스트 시작→위, r=텍스트 끝→아래, c=중앙)
          const innerAlign = resolved === 'top' ? 'l' : resolved === 'bottom' ? 'r' : 'c';

          // 최종 콘텐츠: \rotatebox 안에 \makebox → \raisebox 불필요
          const _rhContent = `\\rotatebox{90}{\\makebox[0pt][${innerAlign}]{\\runningheadf\\imprintrunninghead}}`;
          return [
            `% ── 수직 면주 배치 (eso-pic 절대좌표, 위치: ${resolved}) ──────`,
            `\\RequirePackage{eso-pic}`,
            `\\AddToShipoutPictureBG{%`,
            `  \\setlength{\\unitlength}{1mm}%`,
            `  \\ifodd\\c@page`,
            `    \\put(${oddX},${vertY}){${_rhContent}}%`,
            `  \\else`,
            `    \\put(${evenX},${vertY}){${_rhContent}}%`,
            `  \\fi}`,
          ].join('\n');
        })(),
        ``,
        `% ── 대화문 / 인용문 환경 ──────────────────────────────────────`,
        `% main.tex에서 \\begin{imprintdialogue}...\\end{imprintdialogue} 로 사용`,
        `\\newenvironment{imprintdialogue}{%`,
        `  \\par`,
        `  \\vspace{0.25\\baselineskip}`,
        `  \\begingroup`,
        `  \\bodyf`,
        `  \\setlength{\\leftskip}{1em}`,
        `  \\setlength{\\rightskip}{1em}`,
        `  \\noindent`,
        `}{%`,
        `  \\par`,
        `  \\endgroup`,
        `  \\vspace{0.25\\baselineskip}`,
        `}`,
        `% main.tex에서 \\begin{imprintquote}...\\end{imprintquote} 로 사용`,
        `\\newenvironment{imprintquote}{%`,
        `  \\par`,
        `  \\vspace{0.5\\baselineskip}`,
        `  \\begingroup`,
        `  \\bodyf`,
        `  \\setlength{\\leftskip}{1.5em}`,
        `  \\setlength{\\rightskip}{1.5em}`,
        `  \\noindent`,
        `}{%`,
        `  \\par`,
        `  \\endgroup`,
        `  \\vspace{0.5\\baselineskip}`,
        `}`,
        ``,
        `\\endinput`,
      ].filter(x => x !== null && x !== undefined).join('\n');

      // 사용된 폰트의 실제 파일 목록 수집 (확장자 포함)
      const usedFontNames = [...new Set([mainFont, sansFont, fnFont].filter(Boolean))];
      const _fontFiles = usedFontNames.flatMap(name => {
        const m = FONT_MANIFEST[name];
        if (!m) return [];
        return [m.upright, m.bold, m.italic, m.boldItalic]
          .filter(Boolean)
          .map(f => f + (m.ext || '.ttf'));
      });
      setRequiredFonts(_fontFiles);
      setStyCode(styContent);

      const preambleSummary =
        `\\documentclass[${Math.max(9, p.b.크기)}pt]{memoir} % ${p.f.w}×${p.f.h}mm\n` +
        `\\geometry{top=${corrections.margins.상}mm,bottom=${corrections.margins.하}mm,inner=${corrections.margins.안}mm,outer=${corrections.margins.밖}mm,includehead=true}\n` +
        `% Fonts:${mainFont}(main) ${sansFont}(sans)${isMixedLayout?' mixed:heading=sans body=serif':''}\n` +
        `% \\hone \\htwo \\hthree defined (heading cmds — see HEADING TYPOGRAPHY below)\n` +
        `% widowpenalty:10000 clubpenalty:10000 tolerance:400 headheight:${pnAutoSize+6}pt (set)`;

      // main.tex 헤더 (\usepackage{imprint-style} 사용)
      // _fw/_fh: 판형 override 반영 (styleConfig.paperW/H 우선, 없으면 DB 값)
      const mainTexHeader =
        `\\documentclass[${Math.max(9, p.b.크기)}pt]{memoir}\n` +
        `\\setstocksize{${_fh}mm}{${_fw}mm}\n` +
        `\\settrimmedsize{\\stockheight}{\\stockwidth}{*}\n` +
        `\\usepackage{kotex}\n` +
        `\\usepackage{imprint-style}\n\n` +
        `\\begin{document}\n` +
        `\\XeTeXlinebreaklocale "ko"\n` +
        `\\XeTeXlinebreakskip=0pt plus 1pt\n` +
        (effectiveRH()
          ? `\\renewcommand{\\imprintrunninghead}{${escapeLatex(effectiveRH())}}\n`
          : '') +
        `\\pagestyle{imprint}\n`;

            const latexPrompt =
        'XeLaTeX typesetter. Preamble is fixed — write ONLY \\begin{document}...\\end{document}.\n\n' +
        '# FIXED PREAMBLE\n' + preambleSummary + '\n\n' +
        '# DOC START (add these first lines after \\begin{document})\n' +
        '\\XeTeXlinebreaklocale "ko"\n\\XeTeXlinebreakskip=0pt plus 1pt\n' +
        (effectiveRH()
          ? '\\renewcommand{\\imprintrunninghead}{' + escapeLatex(effectiveRH()) + '}\n'
          : '') +
        '\\pagestyle{imprint}\n\n' +
        '# TYPOGRAPHY\n' +
        'Body:' + adjustedBodySize + 'pt/' + adjustedBodyLead + 'pt' +
        (hasFootnote ? ' Fn:' + fnSize + 'pt/' + fnLead + 'pt' : '') +
        ' RunHead:' + pnAutoSize + 'pt/' + rhLead + 'pt\n' +
        TYPO_BASE.promptGuard + '\n' +
        'No rules/lines.\n\n' +
        '# HEADING TYPOGRAPHY — MANDATORY\n' +
        // 비혼합: 크기+bold로 구분 / 혼합: font-family 전환
        '\\hone{}={' + (isMixedLayout?'sans':'bold') + ' ' + hs.h1 + '/' + h1Lead + 'pt}  \\htwo{}={' + (isMixedLayout?'sans':'bold') + ' ' + hs.h2 + '/' + h2Lead + 'pt}  \\hthree{}={' + (isMixedLayout?'sans':'bold') + ' ' + hs.h3 + '/' + h3Lead + 'pt}\n' +
        '\\bodyf{} resets to ' + (isMixedLayout?'serif+':'normal+') + adjustedBodySize + '/' + adjustedBodyLead + 'pt\n' +
        'HEADING PLACEMENT: \\Needspace{4\\baselineskip}\\par\\noindent{\\hthree 소제목}\\par\\vspace{' + headingGapPt + 'pt}\\bodyf{}\\noindent\n' +
        'RULE: ①always call \\bodyf{} after each heading. ②NEVER inline heading mid-paragraph. ③Use \\Needspace{4\\baselineskip} before EVERY \\hthree/\\htwo/\\hone. ④Never add \\indent, \\hspace, or \\leftskip before headings' + (_learnedHeadingIndent === 'none' ? ' (learned rule: heading indent none)' : '') + '.\n' +
        'LEADING RATIOS: ≤7pt→×1.75 ≤9pt→×1.65 ≤11pt→×1.60 ≤13pt→×1.55 ≤16pt→×1.40 ≤24pt→×1.25 25+pt→×1.15\n' +
        'Any custom \\fontsize{X}{Y}: Y = round(X × ratio above).\n\n' +
        '# CONTENT STRUCTURE ANALYSIS\n' +
        'Read the body text BEFORE generating LaTeX. Apply these rules:\n' +
        '1. 목차(TOC): If body has 3+ numbered list entries or a "목차/차례" label, output \\tableofcontents\\newpage at that location. Do NOT reproduce the TOC list manually.\n' +
        '2. 서문/머리말/들어가며: If there is a preface section label, use {\\htwo LABEL\\par}\\vspace{' + headingGapPt + 'pt} then {\\itshape\\bodyf\\noindent TEXT...\\par} to visually distinguish it.\n' +
        '3. 소제목(subheadings within body): Short standalone lines (≤30 chars, surrounded by blank lines) → use \\hthree. Longer section labels → \\htwo. Always \\Needspace{4\\baselineskip} before each.\n' +
        '4. Markdown headings (# ## ###): Convert exactly to \\hone / \\htwo / \\hthree with \\Needspace + \\bodyf reset.\n' +
        '5. Regular paragraphs: {\\bodyf\\noindent TEXT\\par}\\vspace{0.5\\baselineskip} for each.\n\n' +
        '# PAGE NUMBER: ' + p.pn +
        ' size=' + (p.pn_size || pnAutoSize + 'pt') +
        (effectiveRH() ? ' running="' + effectiveRH() + '"' : ' running=none') + '\n\n' +
        '# COLUMNS\n' + colSetupBlock +
        (corrections.layoutHint ? '# LAYOUT HINT: ' + corrections.layoutHint + '\n' : '') + '\n' +
        '# FOOTNOTES\n' +
        (needsLLMFootnotes
          ? 'Body contains footnote markers (¹²³, [1], ^1, *, †, ①, etc.) but NO footnote text was provided by the user. ' +
            'You MUST generate contextually appropriate footnote content for EACH marker found in the body. ' +
            'Write \\footnote{your generated content} inline at the marker position. Keep footnotes factual, concise (1–2 sentences).\n' +
            (isMultiColLayout ? 'Place \\footnote{} inside column. No \\footnotemark/\\footnotetext.\n' : '')
          : footnoteTextForClaude
            ? 'Footnote markers in the body have been converted to \\ImpFN{N} LaTeX commands (e.g. \\ImpFN{1}, \\ImpFN{2}). ' +
              'CRITICAL: Include ALL \\ImpFN{N} commands VERBATIM in your output at their exact positions. ' +
              'Do NOT remove, rename, or replace \\ImpFN{N} with \\footnote{}. JS will handle the conversion. ' +
              'Do NOT add any new \\footnote{} commands yourself.\n'
            : 'No footnotes in this document. Do NOT add any \\footnote{} commands.\n') + '\n' +
        '# ALIGNMENT — LOCKED (do NOT override)\n' +
        'selectedAlignment=' + alignResult.alignment + ' source=' + alignResult.source + '\n' +
        (alignResult.alignment === 'justified'
          ? 'Use \\justifying or default justified. Do NOT switch to ragged.\n'
          : 'Use \\RaggedRight (or \\raggedright). Do NOT switch to justified.\n') + '\n' +
        '# WIDOW/ORPHAN LOG\n' +
        'If you detect risk of heading at page bottom: add \\Needspace. ' +
        'If paragraph split risk: add \\nopagebreak[4] before critical lines.\n\n' +
        '# SEMANTIC STRUCTURE — MANDATORY\n' +
        'NEVER output the entire body as one {\\bodyf ...} block. Segment into separate LaTeX blocks.\n' +
        'Detect and separately style each of the following:\n' +
        '  • Work title (short, isolated line) → {\\noindent\\htwo TITLE\\par}\\vspace{' + Math.round(headingGapPt * 1.1 * 10) / 10 + 'pt}\n' +
        '  • Author name after "/" → {\\noindent\\hthree AUTHOR\\par}\\vspace{' + headingGapPt + 'pt}\n' +
        '  • Chapter/section heading (제N장, numbered, # markdown) → {\\htwo ...\\par} with \\Needspace{4\\baselineskip}\n' +
        '  • Sub-heading (##, ###, short isolated line ≤30 chars) → {\\hthree ...\\par}\n' +
        '  • Preface (서문/머리말/들어가며) label → {\\htwo ...\\par}, body in {\\itshape\\bodyf ...\\par}\n' +
        '  • Each paragraph → separate {\\bodyf\n\\noindent TEXT\\par\n} block\n' +
        '  • Dialogue (「...」, 『...』, "...") → \\begin{imprintdialogue}\\n TEXT\\n\\end{imprintdialogue}\n' +
        '  • Block quotation, letter, verse → \\begin{imprintquote}\\n TEXT\\n\\end{imprintquote}\n' +
        '  • Scene break (* * *, —, ※, double blank) → \\vspace{1\\baselineskip}\\begin{center}＊\\end{center}\\vspace{0.5\\baselineskip}\n' +
        'PARAGRAPH RULE: one {\\bodyf ...} per paragraph. Do NOT merge multiple paragraphs.\n' +
        'DIALOGUE RULE: when 「...」 or 『...』 appears inside a paragraph, split at the quote boundary — put surrounding text in {\\bodyf ...} and the dialogue in \\begin{imprintdialogue}.\n\n' +
        '# TEXT\n' + bodyBlock + '\n\n' +
        '# RULES\n' +
        'No preamble cmds in body. No \\hrule/\\rule. No microtype/polyglossia. No multicols>5. ' +
        'CRITICAL: Never output halfwidth CJK punctuation U+FF61–U+FF9F. ' +
        'Forbidden: ｢ ｣ ｡ ､ ･ (and all halfwidth katakana). ' +
        'Required replacements: ｢→「 ｣→」 ｡→。 ､→、 ･→・ ' +
        'No \\colorbox, no \\fbox, no \\color, no \\textcolor, no xcolor commands — these cause literal text output. ' +
        'Do NOT redeclare \\fontsize/\\linespread in body. ' +
        'OVERFLOW: never wrap body in minipage — use normal flow; insert \\newpage if needed. ' +
        (hasParacolSep ? 'PARACOL: Body contains %%PARACOL_SWITCHCOLUMN%% marker. Preserve it VERBATIM at the exact position — do NOT remove or rewrite it. JS will convert it to \\switchcolumn after. ' : '') +
        (needsLLMFootnotes
          ? 'FOOTNOTES: generate \\footnote{content} inline at each marker position. PAGE BOTTOM only. '
          : footnoteTextForClaude
            ? 'FOOTNOTES: body has \\ImpFN{N} markers — keep them VERBATIM, do NOT remove or convert to \\footnote{}. JS injects after. '
            : 'FOOTNOTES: none — do NOT add \\footnote{} commands. ') +
        'Title vspace MAX ' + Math.round(p.f.h * 0.15) + 'mm. ' +
        'Output \\begin{document}…\\end{document} only.'

      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 180000);
        const res = await fetch('/anthropic/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          signal: ctrl.signal,
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 16000,
            system: 'You are a XeLaTeX code generator. Output ONLY raw LaTeX code. No explanations, no comments in prose, no "Hmm", no "Actually", no thinking out loud. Your entire response must start with \\begin{document} and end with \\end{document}. Any character before \\begin{document} is forbidden.',
            messages: [{ role: 'user', content: [{ type: 'text', text: latexPrompt, cache_control: { type: 'ephemeral' } }] }],
          }),
        });
        clearTimeout(tid);
        const data = await res.json();
        const raw = (data.content || []).map(x => x.text || '').join('');
        let bodyRaw = raw.replace(/```latex\n?/g, '').replace(/```/g, '').trim();
        // Claude 출력에서 \begin{document}...\end{document} 사이 본문만 추출
        // → mainTex에서 직접 감쌀 것이므로 document 환경 제거
        let bodyContentOnly;
        const docStart = bodyRaw.indexOf('\\begin{document}');
        if (docStart >= 0) {
          let afterBegin = bodyRaw.slice(docStart + '\\begin{document}'.length);
          const docEnd = afterBegin.lastIndexOf('\\end{document}');
          if (docEnd >= 0) afterBegin = afterBegin.slice(0, docEnd);
          bodyContentOnly = afterBegin.trim();
        } else {
          bodyContentOnly = bodyRaw;
        }
        // 반각 CJK 문자 정규화 (UnBatang 폴백 폰트 누락 오류 방지)
        bodyContentOnly = sanitizeUnicodeForLatex(bodyContentOnly);

        // ── Claude 출력 후처리: 프리앰블 명령 제거 + 미정의 환경 수정 ──────────
        // (1) \usepackage / \RequirePackage — body에 있으면 LaTeX 오류
        bodyContentOnly = bodyContentOnly.replace(/^\\(?:use|Require)Package\{[^}]*\}[^\n]*\n?/gm, '');
        // (2) \documentclass — body에 있으면 오류
        bodyContentOnly = bodyContentOnly.replace(/^\\documentclass[^\n]*\n?/gm, '');
        // (3) \begin{imprintlayout}...\end{imprintlayout} → \begin{paracol} 구조로 교체
        //     imprintlayout 환경은 .sty에 정의되지 않음 → XeLaTeX 즉시 오류
        if (bodyContentOnly.includes('\\begin{imprintlayout}')) {
          bodyContentOnly = bodyContentOnly.replace(
            /\\begin\{imprintlayout\}([\s\S]*?)\\switchcolumn([\s\S]*?)\\end\{imprintlayout\}/g,
            (_, bodyPart, notePart) => {
              // 그리드 값: variable mode면 vGrid 사용, 아니면 기본값
              const _gap = (typeof columnGapMm === 'number' ? columnGapMm : 8);
              const _bMm = (typeof grid !== 'undefined' && grid.bodyW) ? grid.bodyW : Math.round(textW * 0.7 * 10) / 10;
              const _nMm = (typeof grid !== 'undefined' && grid.noteW) ? grid.noteW : Math.round(textW * 0.3 * 10) / 10;
              return [
                `\\setlength{\\columnsep}{${_gap}mm}`,
                `\\setcolumnwidth{${_bMm}mm,${_nMm}mm}`,
                `\\begin{paracol}{2}`,
                bodyPart.trim(),
                `\\switchcolumn`,
                notePart.trim(),
                `\\end{paracol}`,
              ].join('\n');
            }
          );
          // \begin{imprintlayout}만 열리고 닫히지 않은 경우 (비정상 출력)
          bodyContentOnly = bodyContentOnly
            .replace(/\\begin\{imprintlayout\}/g, '\\begin{paracol}{2}')
            .replace(/\\end\{imprintlayout\}/g, '\\end{paracol}');
        }

        // 미닫힌 환경 닫기
        if ((bodyContentOnly.includes('\\begin{multicols}') || bodyContentOnly.includes('\\begin{multicols*}')) &&
            !bodyContentOnly.includes('\\end{multicols}') && !bodyContentOnly.includes('\\end{multicols*}')) {
          bodyContentOnly += '\n\\end{multicols}';
        }
        if (bodyContentOnly.includes('\\begin{paracol}') &&
            !bodyContentOnly.includes('\\end{paracol}')) {
          bodyContentOnly += '\n\\end{paracol}';
        }

        // Claude output이 실질적으로 비어있으면 사용자 입력으로 직접 조립
        const claudeHasContent = bodyContentOnly.replace(/[\s\\%{}]/g, '').length > 30;
        const hasUserInput = !!(fields.제목?.trim() || fields.본문?.trim());

        let finalBodyContent;
        if (claudeHasContent) {
          finalBodyContent = bodyContentOnly;
        } else if (hasUserInput) {
          // side-note 여부를 미리 계산 (useSideNoteFootnote는 아래에서 정의되므로 inline 계산)
          const _willSideNote = hasFootnoteText
            && colMode === 'variable'
            && ['left', 'right', 'top', 'bottom'].includes(styleConfig.notePosition || 'right');
          // side-note 모드: processedBody(\ImpFN{N} 포함) + \footnote 주입 없음 + ImpFN escape 보존
          // 일반 모드: cleanBody(wrapping quote 제거) + 정상 각주 주입
          finalBodyContent = buildBodyContent({
            title: fields.제목,
            subtitle: fields.소제목,
            body: _willSideNote ? processedBody : cleanBody,
            footnote: _willSideNote ? '' : (fields.각주 || ''),
            runningHead: effectiveRH(),
            preserveImpFnMarkers: _willSideNote,
            alignTitle: chosen.p.align_title || '',
            alignSubtitle: chosen.p.align_title || '',
            headingGapPt,
          });
        } else {
          finalBodyContent = buildMissingBodyPlaceholder();
        }

        // 단 구성 보장: 고정단(사용자 지정) 또는 자동(DB layout_type/c.구성 수치) — JS가 직접 래핑
        if (colMode === 'fixed' && (styleConfig.fixedColumns || 1) > 1) {
          finalBodyContent = wrapFixedColumns(finalBodyContent, styleConfig.fixedColumns, p.c.간격 || 10);
        } else if (colMode === 'auto' && !isYeol && !noteUnits) {
          // 자동 모드 규칙:
          //   ① 열 표기(isYeol)는 모듈 그리드 — gap 없음, multicols 미적용
          //   ② noteUnits 있으면 paracol이 별도 처리 → 여기서 래핑하지 않음
          //   ③ 단 수는 layout_type의 bodyUnits 우선, 없으면 c.구성 baseN 사용
          //   ④ 실용 상한: 8단 (그 이상은 LaTeX 가독성 한계)
          const _autoCols = bodyUnits || baseN;
          if (_autoCols >= 2 && _autoCols <= 8) {
            finalBodyContent = wrapFixedColumns(finalBodyContent, _autoCols, p.c.간격 || 10);
            pushLog('layout', '단 구성 적용', 'info',
              `자동 ${_autoCols}단 (${bodyUnits ? 'layout_type 파싱' : 'c.구성 기본값'}: ${layoutType || 구성})`);
          }
        }

        // ── 각주 후처리 — wrapVariableLayout 전에 실행 (paracol 내에서 \footnote 동작 보장) ──
        // 가변단 left/right일 때 각주를 side column으로 라우팅할지 결정
        // 조건: variable 모드 + left/right 위치 + 각주 있음 + ===NOTE=== 구분자 없음
        const notePos = styleConfig.notePosition || 'right';
        // bottom 모드: PARACOL_MARKER가 있어도 inline \footnote 경로 사용 (사이드 note 블록 금지)
        const useSideNoteFootnote = hasFootnoteText
          && colMode === 'variable'
          && ['left', 'right', 'top', 'bottom'].includes(notePos)
          && (!finalBodyContent.includes(PARACOL_MARKER) || notePos === 'bottom');

        // parseFootnoteMap 캐싱 — run() 내 여러 경로에서 동일 fields.각주 반복 파싱 방지
        const _cachedFnMap = hasFootnoteText ? parseFootnoteMap(fields.각주).fnMap : {};
        // bottom 경로에서 처리된 각주 번호 추적 — fallback/anchor 중복 삽입 방지
        const _bottomProcessedFns = new Set();

        if (hasFootnoteText && !useSideNoteFootnote) {
          // latexEscNote: 모듈 상수 사용

          // 0단계: \ImpFN{N} → \footnote{내용} (preReplaceFnMarkers가 삽입한 마커)
          if (finalBodyContent.includes('\\ImpFN{')) {
            const fnMap = _cachedFnMap;
            finalBodyContent = finalBodyContent.replace(/\\ImpFN\{(\d+)\}/g, (_, n) => {
              const content = fnMap[n];
              return content ? `\\footnote{${latexEscNote(content)}}` : '';
            });
          }

          // 1단계: 원문 마커 ([1] ¹ ① 등) 직접 치환 (Claude가 \ImpFN을 [1]로 되돌린 경우 대비)
          if (!finalBodyContent.includes('\\footnote{')) {
            const afterInject = injectFootnotes(finalBodyContent, fields.각주);
            if (afterInject !== finalBodyContent) finalBodyContent = afterInject;
          }

          // 2단계: 여전히 \footnote{} 없음 → \par 또는 본문 말미에 강제 삽입
          if (!finalBodyContent.includes('\\footnote{')) {
            const fnMap = _cachedFnMap;
            const fnNums = Object.keys(fnMap);
            if (fnNums.length > 0) {
              const latexEscSimple = s => s
                .replace(/&/g,'\\&').replace(/%/g,'\\%')
                .replace(/#/g,'\\#').replace(/_/g,'\\_').replace(/\$/g,'\\$');
              const sorted = fnNums.sort((a,b) =>
                (isNaN(+a)||isNaN(+b)) ? a.localeCompare(b) : +a - +b);
              const parRe = /\\par\b/g;
              const parPositions = [];
              let pm;
              while ((pm = parRe.exec(finalBodyContent)) !== null) parPositions.push(pm.index);
              if (parPositions.length === 0) {
                finalBodyContent += '\n' + sorted.map(n => `\\footnote{${latexEscSimple(fnMap[n])}}`).join('');
              } else {
                const insertions = sorted.map((n, i) => {
                  const pi = Math.min(
                    Math.floor((i + 0.5) * parPositions.length / sorted.length),
                    parPositions.length - 1
                  );
                  return { at: parPositions[pi], cmd: `\\footnote{${latexEscSimple(fnMap[n])}}` };
                }).sort((a, b) => b.at - a.at);
                let result = finalBodyContent;
                for (const { at, cmd } of insertions) {
                  result = result.slice(0, at) + cmd + result.slice(at);
                }
                finalBodyContent = result;
              }
            }
          }
        }

        // 가변단 레이아웃 조립 — 각주 주입 후 실행 (JS 보장, Claude 의존 없음)
        if (colMode === 'variable') {
          const vg   = styleConfig.variableGrid || { total: 2, body: 1, note: 1 };
          // columnGapMm 우선순위: styleConfig > p.c.간격(DB 기본값) > 8mm 하드코딩
          const columnGapMm = Number(styleConfig.columnGapMm ?? p.c?.간격 ?? 8);
          const notePosition = styleConfig.notePosition || 'right';
          // top/bottom 위치: 본문이 전체 폭 사용 → body = total로 보정 (side 모드 잔여값 방지)
          const isTopBottom = notePosition === 'top' || notePosition === 'bottom';
          const vgEffective = isTopBottom ? { ...vg, body: vg.total } : vg;
          const grid = calcVariableGrid(vgEffective, textW, columnGapMm);
          const btc = Number(styleConfig.bodyTextColumns || 1); // 본문 내부 단 수

          if (grid.noteG > 0) {
            let bodyLatex = finalBodyContent;
            let noteLatex = '';
            if (finalBodyContent.includes(PARACOL_MARKER)) {
              const idx = finalBodyContent.indexOf(PARACOL_MARKER);
              bodyLatex = finalBodyContent.slice(0, idx).trim();
              noteLatex = finalBodyContent.slice(idx + PARACOL_MARKER.length).trim();
            }
            // 제목/소제목을 paracol 바깥으로 분리 — 본문 첫 줄과 주석 첫 줄 정렬
            const { prefix: _headPrefix, body: _bodyOnly } = extractHeadingPrefix(bodyLatex);
            if (_headPrefix) bodyLatex = _bodyOnly;

            const ntc = Number(styleConfig.noteTextColumns || 1); // 주석 내부 단 수
            const bcs = Number(styleConfig.bodyColumnStart || 1); // 본문 시작 열
            const bnfc = Number(styleConfig.bottomNoteFlowColumns || 1); // 하단 주석 단 수
            const bnw = styleConfig.bottomNoteWidth || 'full'; // 하단 주석 폭
            const gridComment = `% [가변단 그리드] 총 ${vgEffective.total}열 / 본문 ${vgEffective.body}열(시작:${bcs})=${grid.bodyW}mm / 주석 ${vgEffective.note}열=${grid.noteW}mm / 간격=${grid.gap}mm / 본문내부 ${btc}단 / 주석내부 ${ntc}단${notePosition==='bottom'&&bnfc>=2?' / 하단주석'+bnfc+'단('+bnw+')':''} / 판면너비=${textW}mm`;

            // ── Method A: 전체 본문 + 단일 switchcolumn + 전체 주석 ─────────────
            // \switchcolumn을 한 번만 사용 (paragraph interleave 제거)
            if (useSideNoteFootnote) {
              const fnMap = _cachedFnMap;
              const fnNums = Object.keys(fnMap);
              if (fnNums.length > 0) {
                // latexEscNote: 모듈 상수 사용
                const latexEscFn = latexEscNote;
                const sorted = fnNums.sort((a,b) => (isNaN(+a)||isNaN(+b)) ? a.localeCompare(b) : +a - +b);

                // 본문 마커 정규화: [N] / ¹²³ / ①②③ → \ImpFN{N} (sty 매크로가 compile-time에 처리)
                // \ImpFN{N}은 그대로 보존 (변환하지 않음 — LaTeX compile-time에 \textsuperscript로 해석됨)
                // NUM_TO_SUP / NUM_TO_CIRC: 모듈 상수 사용
                for (const n of sorted) {
                  bodyLatex = bodyLatex.replace(new RegExp('\\[' + n + '\\]', 'g'), `\\ImpFN{${n}}`);
                  if (NUM_TO_SUP[n])  bodyLatex = bodyLatex.split(NUM_TO_SUP[n]).join(`\\ImpFN{${n}}`);
                  if (NUM_TO_CIRC[n]) bodyLatex = bodyLatex.split(NUM_TO_CIRC[n]).join(`\\ImpFN{${n}}`);
                }
                // Claude가 \footnote{...}으로 직접 변환한 경우 bodyLatex에서 제거
                bodyLatex = bodyLatex.replace(/\\footnote\{(?:[^{}]|\{[^{}]*\})*\}/g, '');

                // ── 주석 마커 검증 ────────────────────────────────────────────
                // body에 \ImpFN{N}이 없는 번호 = 위치 불명 주석
                const missingMarkers = sorted.filter(n => !bodyLatex.includes(`\\ImpFN{${n}}`));

                if (missingMarkers.length > 0) {
                  // ── Hard Error: body에 \ImpFN{N} 없음 → 출력 불가 ──────────────────
                  // note column에 \textsuperscript{N}이 있으면 body column에 \ImpFN{N}이 반드시 있어야 함
                  // 위치 마커 없이 성공 처리하면 주석이 잘못된 위치에 배치되어 조판 오류
                  const missingList = missingMarkers.map(n => `[${n}]`).join(' ');
                  const errMsg = `side note 마커 누락: ${missingList} — 본문 안에 위치 마커를 삽입하세요 (예: 단어[1] 또는 단어¹)`;
                  setErr(errMsg);
                  pushLog('latex', 'LaTeX 생성', 'error', errMsg);
                  setLoading(false);
                  return;
                } else {
                  // ── 정상 경로: 모든 마커 확인됨 → side note 열 조립 ──────────────

                  // 주석 column 내용 조립 (wrapNoteTextColumns로 ntc 단 래핑)
                  // stripWrappingQuotes: 각주 텍스트가 "..." 로 감싸인 경우 제거
                  // noteW < 18mm または noteGridUnits === 1 → ragged right で justified 詰め防止
                  const noteNeedsRagged = grid.noteW < 18 || vgEffective.note === 1;
                  const noteLines = sorted.map(n =>
                    `{\\notef${noteNeedsRagged ? '\\raggedright' : ''}\\ImpNoteLabel{${n}}${latexEscFn(stripWrappingQuotes(fnMap[n]))}\\par\\smallskip}`
                  ).join('\n');
                  const allNotesLatex = wrapNoteTextColumns(noteLines, ntc);

                  // paracol 구조 조립 (Method B: interleaved switchcolumn)
                  // 각 주석이 마커가 있는 단락 옆에 수직 정렬되도록 \switchcolumn*로 동기화
                  const isLeft = notePosition === 'left';
                  const { bodyW, noteW, gap: actualGap } = grid;
                  const col1W = isLeft ? noteW : bodyW;
                  const col2W = isLeft ? bodyW : noteW;
                  const gapStr = `${actualGap.toFixed(1)}mm`;
                  const wrappedBody = wrapBodyTextColumns(bodyLatex.trim(), btc);

                  // ── 주석 마커 사전 검증 ───────────────────────────────────────────
                  try {
                    validateNoteMarkers(wrappedBody || '', allNotesLatex || '');
                  } catch (markerErr) {
                    pushLog('latex', '주석 마커 검증', 'error', markerErr.message);
                    setErr(markerErr.message);
                    return;
                  }

                  // top → adjustwidth + 주석 블록 위에 배치
                  // bottom → \ImpFN{N}을 \footnote{내용}으로 인라인 치환 (per-page 각주, 미주 방지)
                  if (notePosition === 'top') {
                    finalBodyContent = _headPrefix + gridComment + '\n' + wrapVariableLayout({
                      bodyLatex: wrappedBody,
                      noteLatex: allNotesLatex,
                      grid,
                      notePosition,
                      textW,
                      bodyColumnStart: bcs,
                      bottomNoteFlowColumns: bnfc,
                      bottomNoteWidth: bnw,
                    });
                    // top 처리 완료 — plines 조립 생략
                  } else if (notePosition === 'bottom') {
                    // \ImpFN{N} → \footnote{내용} 인라인 치환
                    // - btc=1: \footnote{}는 memoir 페이지 하단에 그대로 배치됨
                    // - btc≥2 (multicols): bigfoot(\let\footnote\footnoteA)가 multicols 안에서도
                    //   페이지 하단에 올바르게 처리하므로 \footnote{} 그대로 사용 가능
                    // ※ \footnotemark[N]/\footnotetext[N] 사용 금지:
                    //   bigfoot이 \footnotemark → \footnoteAmark 로 rename → undefined 컴파일 오류
                    let bottomBody = wrappedBody;
                    bottomBody = bottomBody.replace(/\\ImpFN\{(\d+)\}/g, (_, n) => {
                      const content = fnMap[n];
                      if (content) {
                        _bottomProcessedFns.add(String(n)); // fallback 중복 방지용 추적
                        return `\\footnote{${latexEscFn(stripWrappingQuotes(content))}}`;
                      }
                      return '';
                    });
                    // bodyColumnStart 적용: 왼쪽 indent 계산
                    // \leftskip/\rightskip 그룹 사용 — memoir에서 \footnote과 adjustwidth 충돌 방지
                    const _bcsB = Math.max(1, bcs);
                    const _leftIndB = (_bcsB > 1 && grid.unitW > 0)
                      ? Math.round((_bcsB - 1) * (grid.unitW + grid.gap) * 10) / 10
                      : 0;
                    const _rightIndB = Math.max(0, textW - grid.bodyW - _leftIndB);
                    const _needsIndent = _leftIndB > 0 || _rightIndB > 0;
                    const bottomLayout = _needsIndent
                      ? [
                          `\\begingroup`,
                          _leftIndB > 0  ? `\\setlength{\\leftskip}{${_leftIndB.toFixed(1)}mm}` : null,
                          _rightIndB > 0 ? `\\setlength{\\rightskip}{${_rightIndB.toFixed(1)}mm}` : null,
                          `\\noindent`,
                          bottomBody.trim(),
                          `\\par\\endgroup`,
                        ].filter(Boolean).join('\n')
                      : bottomBody.trim();
                    finalBodyContent = _headPrefix + gridComment + '\n' + bottomLayout;
                    // bottom 처리 완료 — plines 조립 생략
                  } else {

                  // ── 본문을 단락 경계로 분리 → 마커 있는 단락 뒤에 주석 삽입 ──
                  // \switchcolumn* = 동기화 스위치: 두 열이 이 지점에 도달할 때까지 기다린 후 진행
                  // 결과: 주석이 마커 단락과 같은 수직 위치에 배치됨
                  // 단락 구분자: \par 명령 OR 빈 줄(\n\n) — Claude 출력 방식 무관하게 처리
                  const rawParaParts = bodyLatex.trim().split(/(\\par\b|\n{2,})/);
                  const _rawChunks = [];
                  for (let pi = 0; pi < rawParaParts.length; pi += 2) {
                    const txt = rawParaParts[pi] || '';
                    const sep = rawParaParts[pi + 1] || '';
                    // \par 명령은 그대로 보존, 빈 줄은 \par로 정규화
                    const parCmd = sep.startsWith('\\par') ? sep : (sep.trim() === '' && sep.includes('\n') ? '\\par' : sep);
                    const full = txt + parCmd;
                    if (full.trim()) _rawChunks.push(full);
                  }
                  // TeX 그룹 경계 보정: {\bodyf ... \par} 처럼 그룹이 \par 분리선에 걸리면
                  // \end{multicols} 앞에서 그룹이 열린 채로 끊겨 LaTeX 오류 발생
                  // → 브레이스 불균형인 청크는 다음 청크와 합쳐 완전한 그룹 단위로 만듦
                  const _countOpen = (s) => {
                    let d = 0;
                    for (let i = 0; i < s.length; i++) {
                      if (s[i] === '\\') { i++; continue; } // \{ \} 이스케이프 건너뜀
                      if (s[i] === '{') d++;
                      else if (s[i] === '}') d--;
                    }
                    return d; // 양수=열기 초과, 음수=닫기 초과
                  };
                  const paraChunks = [];
                  let _pending = '';
                  for (const _rc of _rawChunks) {
                    _pending += (_pending ? '\n' : '') + _rc;
                    if (_countOpen(_pending) === 0) {
                      paraChunks.push(_pending);
                      _pending = '';
                    }
                    // 불균형이면 계속 합침
                  }
                  if (_pending.trim()) paraChunks.push(_pending);

                  const bodyLines = [];
                  const notesEmitted2 = new Set();
                  // ⚠️ multicols inside paracol 충돌:
                  // multicols는 내용을 버퍼링 후 \end{multicols}에서 한꺼번에 출력 →
                  // paracol의 \switchcolumn 타이밍이 어긋나 주석이 마지막에 몰리고,
                  // 열 높이 추적 실패로 body 열에 이상한 공백 발생.
                  // → interleaved paracol 경로에서는 btc 무시, 단일 열로 처리.

                  for (let chunkIdx = 0; chunkIdx < paraChunks.length; chunkIdx++) {
                    const chunk = paraChunks[chunkIdx];
                    bodyLines.push(chunk);

                    // 이 단락의 \ImpFN{N} 마커 수집 (등장 순서대로)
                    const chunkMarkerRe = /\\ImpFN\{(\d+)\}/g;
                    let chunkMk;
                    const chunkNoteNums = [];
                    while ((chunkMk = chunkMarkerRe.exec(chunk)) !== null) {
                      if (!notesEmitted2.has(chunkMk[1])) {
                        chunkNoteNums.push(chunkMk[1]);
                        notesEmitted2.add(chunkMk[1]);
                      }
                    }

                    if (chunkNoteNums.length > 0) {
                      // 마커 있는 단락 → 주석 열로 전환
                      const isLastChunk = chunkIdx === paraChunks.length - 1;
                      bodyLines.push('');
                      bodyLines.push('\\switchcolumn');
                      bodyLines.push('');
                      for (const noteN of chunkNoteNums) {
                        if (fnMap[noteN]) {
                          const nc = `{\\notef${noteNeedsRagged ? '\\raggedright' : ''}\\ImpNoteLabel{${noteN}}${latexEscFn(stripWrappingQuotes(fnMap[noteN]))}\\par\\smallskip}`;
                          bodyLines.push(ntc >= 2 ? wrapNoteTextColumns(nc, ntc) : nc);
                        }
                      }
                      bodyLines.push('');
                      if (!isLastChunk) {
                        // 동기화 복귀: 두 열을 이 지점에서 맞춘 뒤 본문 계속
                        bodyLines.push('\\switchcolumn*');
                        bodyLines.push('');
                      }
                    }
                  }

                  // 마커 없이 남은 주석 → 끝에 추가 (fallback)
                  const unemittedNotes = sorted.filter(n => fnMap[n] && !notesEmitted2.has(n));
                  if (unemittedNotes.length > 0) {
                    bodyLines.push('');
                    bodyLines.push('\\switchcolumn');
                    bodyLines.push('');
                    for (const noteN of unemittedNotes) {
                      const nc = `{\\notef${noteNeedsRagged ? '\\raggedright' : ''}\\ImpNoteLabel{${noteN}}${latexEscFn(stripWrappingQuotes(fnMap[noteN]))}\\par\\smallskip}`;
                      bodyLines.push(ntc >= 2 ? wrapNoteTextColumns(nc, ntc) : nc);
                    }
                  }

                  const interleavedBody = bodyLines.join('\n');

                  const plines = [];
                  plines.push(gridComment);
                  plines.push(`\\setlength{\\columnsep}{${gapStr}}`);
                  plines.push(`\\setcolumnwidth{${col1W}mm,${col2W}mm}`);
                  plines.push(`\\begin{paracol}{2}`);
                  plines.push('');
                  if (isLeft) {
                    // col0=주석, col1=본문 → 먼저 col1(본문)으로 이동 후 interleave
                    plines.push('\\switchcolumn');
                    plines.push('');
                  }
                  plines.push(interleavedBody);
                  plines.push('');
                  plines.push(`\\end{paracol}`);

                  finalBodyContent = plines.join('\n');
                  } // end else (left/right paracol)
                }
              } else {
                // 각주 없음 → 일반 가변 레이아웃 (bodyTextColumns 반영)
                const wrappedBody = wrapBodyTextColumns(bodyLatex, btc);
                // bottom 모드: noteLatex는 inline \footnote으로 처리됐으므로 블록 전달 금지
                const _noteLatex1 = notePosition === 'bottom' ? '' : noteLatex;
                finalBodyContent = _headPrefix + gridComment + '\n' + wrapVariableLayout({ bodyLatex: wrappedBody, noteLatex: _noteLatex1, grid, notePosition, textW, bodyColumnStart: bcs, bottomNoteFlowColumns: bnfc, bottomNoteWidth: bnw });
              }
            } else {
              // 상단/하단 위치 또는 비side 모드 (bodyTextColumns 반영)
              const wrappedBody2 = wrapBodyTextColumns(bodyLatex, btc);
              // bottom 모드: noteLatex 블록 전달 금지 (inline \footnote 사용)
              const _noteLatex2 = notePosition === 'bottom' ? '' : noteLatex;
              finalBodyContent = _headPrefix + gridComment + '\n' + wrapVariableLayout({ bodyLatex: wrappedBody2, noteLatex: _noteLatex2, grid, notePosition, textW, bodyColumnStart: bcs, bottomNoteFlowColumns: bnfc, bottomNoteWidth: bnw });
            }
          }
        }

        // 2-파일 아키텍처: main.tex = 헤더 + \usepackage{imprint-style} + 본문
        const mainTex = [
          `% !TeX program = XeLaTeX`,
          `% Compile: xelatex -interaction=nonstopmode main.tex`,
          `% Engine: XeLaTeX 필수 (\\XeTeXlinebreaklocale 사용) — pdfLaTeX 미지원`,
          ``,
          `\\documentclass[${Math.max(9, p.b.크기)}pt]{memoir}`,
          `\\setstocksize{${p.f.h}mm}{${p.f.w}mm}`,
          `\\settrimmedsize{\\stockheight}{\\stockwidth}{*}`,
          ``,
          `\\usepackage{kotex}`,
          `\\usepackage{imprint-style}`,
          ``,
          `\\begin{document}`,
          ``,
          `\\XeTeXlinebreaklocale "ko"`,
          `\\XeTeXlinebreakskip=0pt plus 1pt`,
          ``,
          effectiveRH()
            ? `\\renewcommand{\\imprintrunninghead}{${escapeLatex(effectiveRH())}}`
            : null,
          `\\pagestyle{imprint}`,
          ``,
          finalBodyContent,
          ``,
          `\\end{document}`,
        ].filter(x => x !== null && x !== undefined).join('\n');

        // 최종 export 직전 — 전체 sanitize (반각 CJK 완전 제거)
        let finalMainTex = sanitizeUnicodeForLatex(mainTex);
        let finalStyContent = sanitizeUnicodeForLatex(styContent);

        // ── 문단 간격 정리: Claude가 본문에 삽입한 불필요한 수직 공백 제거 ──────
        // \parskip=0pt임에도 \medskip/\bigskip/\vspace가 있으면 문단 간격이 넓어짐
        // \begin{document} 이후 body 부분만 처리 (preamble 건드리지 않음)
        {
          const _bodyStart = finalMainTex.indexOf('\\begin{document}');
          if (_bodyStart !== -1) {
            const _pre  = finalMainTex.slice(0, _bodyStart);
            let   _body = finalMainTex.slice(_bodyStart);
            // 단독 줄에 있는 \medskip, \bigskip, \smallskip 제거
            _body = _body.replace(/^[ \t]*\\(medskip|bigskip|smallskip)[ \t]*$/gm, '');
            // \vspace{...} 단독 줄 제거 (단, \vspace*는 섹션 간격용일 수 있으므로 유지)
            _body = _body.replace(/^[ \t]*\\vspace\{[^}]*\}[ \t]*$/gm, '');
            // 연속 빈 줄 3개 이상 → 2개로 (LaTeX에서 빈 줄=문단 구분, 2개 이상은 동일)
            _body = _body.replace(/\n{4,}/g, '\n\n\n');
            finalMainTex = _pre + _body;
          }
        }

        // ── multicols → multicols* 강제 치환 (post-processing 안전망) ──────────
        // Claude가 프롬프트 예시를 따라 \begin{multicols} 생성할 수 있으므로 최종 치환
        finalMainTex = finalMainTex
          .replace(/\\begin\{multicols\}(\{[^}]*\})/g, '\\begin{multicols*}$1')
          .replace(/\\end\{multicols\}(?!\*)/g, '\\end{multicols*}');

        // ── .sty 누락 패키지 자동 보완 ─────────────────────────────────────
        // main.tex에서 사용하는 패키지가 .sty에 없을 때 자동으로 추가
        // (Claude가 auto 모드에서 독자적으로 \begin{paracol}/\begin{multicols}를 생성한 경우 대비)
        {
          const _needPkg = [];
          if (/\\begin\{paracol\}/.test(finalMainTex) && !finalStyContent.includes('paracol'))
            _needPkg.push('\\RequirePackage{paracol}');
          if (/\\begin\{multicols\}/.test(finalMainTex) && !finalStyContent.includes('multicol'))
            _needPkg.push('\\RequirePackage{multicol}');
          if (_needPkg.length > 0) {
            // \RequirePackage{fontspec} 바로 앞에 삽입 (필수 패키지 블록 상단)
            finalStyContent = finalStyContent.replace(
              '\\RequirePackage{fontspec}',
              _needPkg.join('\n') + '\n\\RequirePackage{fontspec}'
            );
            pushLog('layout', '패키지 자동 보완', 'info', '누락 패키지 자동 추가: ' + _needPkg.join(', '));
          }
        }

        // ── \end{document} 뒤 stray character 제거 ────────────────────────
        // Claude 또는 문자열 조합 버그로 \end{document} 뒤에 문자가 붙는 경우 방지
        finalMainTex = finalMainTex.replace(/\\end\{document\}[\s\S]*$/, '\\end{document}\n');

        // ── 각주 최종 강제 치환 ────────────────────────────────────────
        // side-column 모드라도 \ImpFN{N} / [N]이 남아있으면 \footnote{}로 변환 (fallback 보장)
        if (fields.각주?.trim()) {
          const _finalFnMap = _cachedFnMap; // parseFootnoteMap 캐시 사용
          const _finalKeys = Object.keys(_finalFnMap);
          if (_finalKeys.length > 0) {
            const _fesc = latexEscNote; // 모듈 상수 사용
            // 큰 번호 먼저 처리 (10 → 1 순서로 해야 [1]이 [10]의 일부를 잘못 치환하지 않음)
            const _sorted = _finalKeys.sort((a, b) => (isNaN(+a)||isNaN(+b)) ? a.localeCompare(b) : +b - +a);
            for (const _n of _sorted) {
              // 이미 처리된 번호는 스킵:
              // - side column: \textsuperscript{N} 존재
              // - bottom 경로(btc≥1): _bottomProcessedFns에 등록됨
              if (useSideNoteFootnote && (
                finalMainTex.includes(`\\textsuperscript{${_n}}`) ||
                _bottomProcessedFns.has(String(_n))
              )) continue;
              const _fn = `\\footnote{${_fesc(_finalFnMap[_n])}}`;
              // \ImpFN{N} 형태 (preReplaceFnMarkers 삽입 후 Claude가 보존한 경우)
              finalMainTex = finalMainTex.replace(new RegExp('\\\\ImpFN\\{' + _n + '\\}', 'g'), _fn);
              // [N] 형태 — \footnotemark[N] / \footnotetext[N] 안의 [N]은 건드리지 않음
              finalMainTex = finalMainTex.replace(
                new RegExp('(?<!\\\\(?:footnotemark|footnotetext))\\[' + _n + '\\]', 'g'),
                _fn
              );
              // ¹²³ 위첨자 — NUM_TO_SUP 모듈 상수 사용
              if (NUM_TO_SUP[_n]) finalMainTex = finalMainTex.split(NUM_TO_SUP[_n]).join(_fn);
              // ①②③ 원문자 — NUM_TO_CIRC 모듈 상수 사용
              if (NUM_TO_CIRC[_n]) finalMainTex = finalMainTex.split(NUM_TO_CIRC[_n]).join(_fn);
            }

            // ── anchor 복원: Claude가 \ImpFN{N}을 완전히 삭제한 경우 ──────
            // 마커가 여전히 없는 번호를 찾아 원본 앞 텍스트(anchor)로 위치 복원
            const _anchorSorted = _finalKeys.sort((a,b) => (isNaN(+a)||isNaN(+b)) ? a.localeCompare(b) : +a - +b);
            for (const _n of _anchorSorted) {
              // side column 또는 bottom 경로에서 처리된 번호는 anchor 복원도 스킵
              if (useSideNoteFootnote && (
                finalMainTex.includes(`\\textsuperscript{${_n}}`) ||
                _bottomProcessedFns.has(String(_n))
              )) continue;
              const _fn = `\\footnote{${_fesc(_finalFnMap[_n])}}`;
              // 이미 주입됐으면 스킵
              if (finalMainTex.includes(_fn)) continue;
              const _anchor = fnAnchors[_n];
              if (!_anchor || _anchor.length < 4) continue;
              // anchor 텍스트를 이스케이프해서 검색
              const _anchorEsc = _anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const _anchorRe = new RegExp(_anchorEsc);
              const _match = _anchorRe.exec(finalMainTex);
              if (_match) {
                // anchor 바로 뒤에 각주 삽입
                const _pos = _match.index + _match[0].length;
                finalMainTex = finalMainTex.slice(0, _pos) + _fn + finalMainTex.slice(_pos);
              }
            }
          }
        }

        // LaTeX 구조 검증 (sanitize 후 검증)
        const { errors: _valErrors, warnings: _valWarnings } = validateLatexExport({ mainTex: finalMainTex, sty: finalStyContent, layoutConfig: styleConfig });

        if (_valErrors.length > 0) {
          setErr('LaTeX 검증 오류:\n' + _valErrors.join('\n'));
          pushLog('latex', 'LaTeX 생성', 'error', '검증 실패');
          return;
        }
        if (_valWarnings.length > 0) {
          setErr(_valWarnings.join('\n'));
        }
        setStyCode(finalStyContent);
        setLatex(finalMainTex);
        // ── Revision Trajectory: rev_000 초기 생성 기록 ──────────────────
        const _cmdMap0 = extractLatexCommandMap(finalMainTex || '');
        setRevisionLog([{
          id: 'rev_000',
          type: 'initial_generation',
          timestamp: new Date().toISOString(),
          userInput: {
            title: fields['제목'] || '',
            bodyHash: simpleHash(fields['본문'] || ''),
            styleInstruction: h || '자동',
          },
          selectedReference: {
            title: DB[rerank?.i ?? selIdx]?.t || '',
            designer: DB[rerank?.i ?? selIdx]?.designer || '',
            reason: structReason?.reference_reason || '',
          },
          interpretation: {
            designConcept: structReason?.design_concept || [],
            designTask: structReason?.design_task || [],
            visualElement: structReason?.visual_element || [],
          },
          variables: {
            bodySize: _cmdMap0.bodySize ? `${_cmdMap0.bodySize}pt` : '',
            leading: _cmdMap0.bodyLeading ? `${_cmdMap0.bodyLeading}pt` : '',
            marginBottom: _cmdMap0.marginBottom ? `${_cmdMap0.marginBottom}mm` : '',
            marginTop: _cmdMap0.marginTop ? `${_cmdMap0.marginTop}mm` : '',
            letterSpace: _cmdMap0.letterSpace || '',
          },
          files: {
            mainTexHash: simpleHash(finalMainTex || ''),
            styHash: simpleHash(finalStyContent || ''),
          },
          layoutConfigSnapshot: {
            mode: styleConfig.columnMode || 'auto',
            totalGridUnits: styleConfig.variableGrid?.total || 1,
            bodyGridUnits: styleConfig.variableGrid?.body || 1,
            noteGridUnits: styleConfig.variableGrid?.note || 0,
            bodyTextColumns: styleConfig.bodyTextColumns || 1,
            noteTextColumns: styleConfig.noteTextColumns || 1,
            notePosition: styleConfig.notePosition || 'right',
            columnGapMm: styleConfig.columnGapMm || 8,
          },
        }]);
        pushLog('latex', 'LaTeX 생성', 'done', '조판 완료');

        // ── 작업 의도 > Visual Element: 최종 LaTeX 실제값으로 덮어쓰기 ────
        // microAdjust 이후 값이 반영되도록 finalMainTex에서 직접 추출
        {
          const _fc = extractLatexCommandMap(finalMainTex || '');
          // _learnedCols가 있으면 학습 기반 고정단으로 표시
          const _colInfo = _learnedCols
            ? `${_learnedCols}단 고정 (학습 적용)`
            : styleConfig.columnMode === 'fixed'
            ? `${styleConfig.fixedColumns || 1}단 고정`
            : styleConfig.columnMode === 'variable'
            ? `가변단 (${styleConfig.variableGrid?.body || 1}본문+${styleConfig.variableGrid?.note || 1}주석)`
            : (numCols > 1 ? `${numCols}단 자동` : '1단 본문');
          const _actualVE = [
            _fc.bodySize    ? `${_fc.bodySize}pt 본문 / ${_fc.bodyLeading || ''}pt 행간` : null,
            p?.f             ? `${p.f.w}×${p.f.h}mm 판형` : null,
            _colInfo,
            ((bodyIsSerif ? '명조 계열' : '고딕 계열') + ` 본문 서체 (${mainFont})`),
            (_fc.marginTop && _fc.marginBottom && _fc.marginInner && _fc.marginOuter)
              ? `여백 상${_fc.marginTop}/하${_fc.marginBottom} · 안${_fc.marginInner}/밖${_fc.marginOuter}mm`
              : null,
            (alignResult?.alignment === 'ragged' ? '좌측 정렬' : '양끝 정렬'),
            p?.pn && p.pn !== '-' ? `쪽번호 ${p.pn}` : null,
          ].filter(Boolean);
          setStructuredReason(prev => prev ? { ...prev, visual_element: _actualVE } : prev);
        }

        setInputTab('experiment'); // 생성 완료 → 실험 탭으로 자동 이동

        // ── Generation Log 생성 (추가 API 호출 없음) ──────────────
        const _latexHash = simpleHash(mainTex);
        const _analyzePrompt = '텍스트 분석→JSON: ' + matchText.slice(0, 200);
        const _semanticPrompt = 'rerank ' + matchText.slice(0, 100);
        const _logId = makeGenerationId();
        const _fnCount = (fields.각주||'').split(/\n/).filter(l=>l.trim()).length;
        const _genLog = {
          id: _logId,
          created_at: new Date().toISOString(),
          version: 'SelectPaper_v30',
          model: 'claude-sonnet-4-6',

          input: {
            title: fields.제목 || '',
            subtitle: fields.소제목 || '',
            body_length: matchText.length,
            footnote_count: _fnCount,
            running_head_used: effectiveRH(),
            genre_hint: h,
            style_mode: styleConfig.columnMode || 'auto',
          },

          text_analysis: {
            topic: profile?.topic || '',
            textForm: profile?.textForm || '',
            detected_genre: profile?.topic || '',
            structure: profile?.structure || '',
            tone: profile?.tone || '',
            density: profile?.density || '',
            pub_type: profile?.pubType || '',
            layout_intent: profile?.layout || '',
            exhibit_evidence: profile?.exhibitEvidence ?? 0,
            risky_keywords: profile?.riskyKeywords || [],
          },

          matching: {
            match_mode: matchMethod,
            selected_reference_id: chosen.i,
            selected_reference_title: p.t,
            selected_reference_genre: p.g,
            selected_reference_pub_type: p.pub_type || '',
            top_candidates: ranked.slice(0, 5).map(r => ({
              id: r.i, title: DB[r.i]?.t, score: r.s,
              contentScore: r.p?._scores?.contentScore,
              genreScore: r.p?._scores?.genreScore,
            })),
            semantic_reason: structReason?.reference_reason || '',
            rejected: structReason?.rejected || [],
            prev_used_forced: structReason?.prevUsedForced || false,
            confidence: null,
          },

          style_features_used: {
            genre_filter: !!h,
            semantic_rerank: matchMethod === 'semantic',
            style_composition: (styleConfig.columnMode || 'auto') !== 'auto',
            TYPO_BASE: true,
            heading_system: true,
            mixed_typeface: isMixedLayout,
            body_size_correction: corrections.bs !== undefined && corrections.bs !== p.b.크기,
            alignment_policy: alignResult.alignment,
            alignment_source: alignResult.source,
            alignment_reason: alignResult.reason,
            ragged_fallback: alignResult.alignment === 'ragged',
            note_split_used: !!(styleConfig.bodyNoteSplit),
            note_split_downgraded: false, // bodyNoteSplit 다운그레이드 시 run()에서 업데이트
            refine_used: false,
            test_mode: testMode,
            style_locked: isLocked || isLengthCompare,
          },

          layout_spec: {
            page_width_mm: p.f.w,
            page_height_mm: p.f.h,
            margin_top_mm: corrections.margins.상,
            margin_bottom_mm: corrections.margins.하,
            margin_inner_mm: corrections.margins.안,
            margin_outer_mm: corrections.margins.밖,
            columns: numColsEst,
            column_gap_mm: colGap,
            body_size_pt: adjustedBodySize,
            body_leading_pt: adjustedBodyLead,
            tracking: p.b.자간,
            heading_h1: `${hs.h1}/${h1Lead}pt`,
            heading_h2: `${hs.h2}/${h2Lead}pt`,
            heading_h3: `${hs.h3}/${h3Lead}pt`,
            body_font: mainFont,
            heading_font: isMixedLayout ? sansFont : mainFont,
            page_number_position: p.pn,
          },

          output: {
            latex_code: finalMainTex, // LOG_FULL_LATEX 상수 제거 후 직접 삽입
            latex_length: finalMainTex.length,
            latex_hash: _latexHash,
            compile_status: 'not_tested',
            error_message: '',
          },

          prompts: {
            analyze_prompt_hash: simpleHash(_analyzePrompt),
            semantic_prompt_hash: simpleHash(_semanticPrompt),
            latex_prompt_hash: simpleHash(latexPrompt),
            refine_prompt_hash: '',
            prompt_summary: [
              h ? `genre_hint:${h}` : 'no_hint',
              'semantic_rerank_mixed_pool',
              'TYPO_BASE_guard_active',
              'heading_system_active',
              isMixedLayout ? 'mixed_typeface' : 'single_typeface',
              `alignment:${alignResult.alignment}(${alignResult.source})`,
              testMode !== 'normal' ? `testMode:${testMode}` : 'normal',
            ],
            // prompt 전문은 includeFullPrompts=true 일 때만 export에서 추가
          },

          diagnostics: {
            api_call_count: 2, // analyzeText + semanticRerank
            fallback_used: ranked.length < 5 && !h,
            fallback_reason: ranked.length < 5 && !h ? 'pool too small' : '',
            prev_style_id: runMeta?.selectedStyleId ?? null,
            selected_before_rerank: ranked[0]?.i ?? null,
            selected_after_rerank: chosen.i,
            semantic_drift_detected: ranked[0]?.i !== chosen.i,
            body_size_corrected: corrections.bs !== undefined && corrections.bs !== p.b.크기,
            warnings: [],
          },

          review: {
            user_rating: '',
            issue_tags: [],
            user_comment: '',
          },

          refine_history: [],
        };
        saveGenerationLog(_genLog);  // 인메모리 스토어
        setCurrentLog(_genLog);
        setAllLogs(prev => [_genLog, ...prev].slice(0, 100));
        // sendLogToGoogleSheet: 피드백 제출 시 sendToSheet로 처리 (analyzeExperiment 내부)
        pushLog('rationale', '레이아웃 해설', 'running', '편집 근거 생성 중');
        // rationale만 백그라운드 (semantic은 이미 foreground에서 완료)
        const cachedRat = rationaleCache.current[chosen.i];
        (cachedRat ? Promise.resolve(cachedRat) : generateRationale(p))
          .then(rat => {
            if (rat) { rationaleCache.current[chosen.i] = rat; setRationale(rat); pushLog('rationale', '레이아웃 해설', 'done'); }
          });
      } catch (e) {
        setErr(e.name === 'AbortError' ? 'LaTeX generation timed out (3min). Try splitting into smaller sections.' : 'Error: ' + e.message);
      } finally {
        setLoading(false);
      }

    } catch (e) {
      setErr('Failed: ' + (e.message || 'unknown error'));
      setMatching(false);
      setLoading(false);
    }
  }

  // ── Background semantic matching ──────────────────────────────

  // ── LaTeX 압축 (refine 전송 전 주석·빈줄 제거) ──────────────────
  function compressLatex(code) {
    return code
      .split('\n')
      .filter(line => !line.trim().startsWith('%'))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ── 판형 미세조정 인터셉터 ───────────────────────────────────────
  // 판형은 \setstocksize(main.tex) + \geometry(sty) 두 곳을 동시에 바꿔야 하므로
  // Claude Refine에 맡기지 않고 클라이언트에서 직접 두 state를 업데이트한다
  function detectPaperSizeRequest(msg) {
    if (/판형.{0,15}(넓게|크게|널널|더\s*크|키워|확장|늘려)|더\s*(넓|크|널).{0,8}판형/.test(msg)) return 'larger';
    if (/판형.{0,15}(좁게|작게|줄여|더\s*작|축소|좁혀)|더\s*(좁|작).{0,8}판형/.test(msg)) return 'smaller';
    return null;
  }

  // ── 구조적 변경 요청 감지 ──────────────────────────────────────
  // 리파인 채팅으로 처리 불가한 요청을 UI로 유도
  const STRUCTURAL_PATTERNS = [
    { re: /본문\s*내부\s*단|본문\s*\d+\s*단으로|body.*column|단\s*구성\s*변경/, label: '본문 내부 단', path: '왼쪽 패널 → 단 구성 → 본문 내부 단' },
    { re: /주석\s*내부\s*단|주석\s*\d+\s*단으로|note.*column/, label: '주석 내부 단', path: '왼쪽 패널 → 단 구성 → 주석 내부 단' },
    { re: /주석\s*위치|주석을?\s*(오른쪽|왼쪽|상단|하단|우측|좌측)/, label: '주석 위치', path: '왼쪽 패널 → 단 구성 → 주석 위치' },
    { re: /총\s*그리드|본문\s*열|주석\s*열|가변단|고정단/, label: '단 구성 그리드', path: '왼쪽 패널 → 단 구성' },
    { re: /각주\s*단\s*수|각주\s*\d+\s*단|주석\s*하단.*\d+\s*단|하단.*각주.*\d+\s*단/, label: '각주 단 수', path: '왼쪽 패널 → 단 구성 → 각주 단 수' },
  ];
  function detectStructuralRequest(msg) {
    for (const { re, label, path } of STRUCTURAL_PATTERNS) {
      if (re.test(msg)) return { label, path };
    }
    return null;
  }

  // ── 채팅 인텐트 분류 (API 호출 없이 클라이언트에서 즉시 판단) ────────────
  // 반환값: "question" | "modify" | "ambiguous"
  // "question" → LaTeX 수정 없이 설명만 제공
  // "modify"   → LaTeX 수정 필수 + 변경 내역 보고
  // "ambiguous" → Claude가 스스로 판단 (현재 동작 유지)
  function classifyChatIntent(msg) {
    const t = msg.trim().toLowerCase();

    // 명확한 질문 패턴: "왜", "어떻게", "뭐", "무엇", "?" 포함 OR 설명 요청
    const questionMarkers = [
      /^왜\b/, /왜\s/, /왜냐/, /왜요/, /왜죠/,
      /어떻게\s*(된|됐|돼|해야|하는|선택)/, /어떻게\s*해요/, /어떻게\s*하나요/,
      /무엇/, /뭐야/, /뭐에요/, /뭔가요/, /뭔지/, /뭐죠/,
      /어떤\s*(이유|기준|근거|방식|방법)/,
      /설명\s*(해줘|해주세요|해봐|해줘요)/, /알려\s*(줘|주세요)/,
      /이유\s*(가|는|를|를요)/, /기준\s*(이|은|이에요)/,
      /맞아\??$/, /맞나요\??$/, /맞죠\??$/, /맞는건가요/,
      /됐어\??$/, /됐나요\??$/, /됐죠\??$/,
      /무슨\s*(뜻|의미|역할|기능)/,
      /\?$/,  // 물음표로 끝나는 문장
    ];

    // 명확한 수정 패턴: 변경 동사 포함
    const modifyMarkers = [
      /바꿔\s*(줘|주세요|줘요)?$/, /바꿔봐/, /바꿔줘/, /바꿔주세요/,
      /수정\s*(해줘|해주세요|해봐|해줘요)/,
      /변경\s*(해줘|해주세요|해봐)/,
      /줄여\s*(줘|주세요|봐)/, /줄여줘/, /줄여주세요/,
      /키워\s*(줘|주세요|봐)/, /키워줘/, /키워주세요/,
      /크게\s*(해줘|만들어|바꿔)/, /작게\s*(해줘|만들어|바꿔)/,
      /크게\s*(줘|주세요)/, /작게\s*(줘|주세요)/,
      /늘려\s*(줘|주세요)/, /줄여\s*(줘|주세요)/,
      /넓혀\s*(줘|주세요)/, /좁혀\s*(줘|주세요)/,
      /올려\s*(줘|주세요)/, /내려\s*(줘|주세요)/,
      /맞춰\s*(줘|주세요)/, /맞춰봐/,
      /적용\s*(해줘|해주세요)/, /적용해봐/,
      /넣어\s*(줘|주세요)/, /빼\s*(줘|주세요)/,
      /제거\s*(해줘|해주세요)/, /추가\s*(해줘|해주세요)/,
      /만들어\s*(줘|주세요)/, /바꿔줘/,
      /으로\s*(바꿔|변경|수정|교체)/,
      /을?\s*더\s*(크게|작게|넓게|좁게)/,
      /을?\s*좀\s*(더|크게|작게)/,
      /pt로\s*(바꿔|변경|설정)/, /mm로\s*(바꿔|변경|설정)/,
      /\d+\s*pt/, /\d+\s*mm/,  // 수치 포함 = 수정 요청
      /조금\s*(더|크게|작게)/, /약간\s*(더|크게|작게)/,
      /동일하게\s*(맞춰|바꿔|설정)/, /같게\s*(해줘|만들어)/,
      /으로\s*(설정|통일)/, /으로\s*조정\s*(해줘|해주세요)/,
    ];

    // 질문 패턴 먼저 체크 (명확한 질문은 수정 마커보다 우선)
    const isQuestion = questionMarkers.some(re => re.test(t));
    const isModify = modifyMarkers.some(re => re.test(t));

    if (isQuestion && !isModify) return 'question';
    if (isModify && !isQuestion) return 'modify';
    // 둘 다 매칭되거나 둘 다 없으면 ambiguous → Claude가 판단
    return 'ambiguous';
  }

  // ── 현재 LaTeX에서 실제 수치 커맨드 맵 추출 ──────────────────────
  // Claude가 "어느 명령어를 얼마나 바꿔야 하는지" 정확히 알 수 있도록
  function extractLatexCommandMap(latexStr) {
    const map = {};
    // \fontsize{Xpt}{Ypt} — 본문 (첫 번째 등장)
    const bodyFont = latexStr.match(/\\fontsize\{([\d.]+)pt\}\{([\d.]+)pt\}\\selectfont/);
    if (bodyFont) { map.bodySize = bodyFont[1]; map.bodyLeading = bodyFont[2]; }
    // \notef 정의: \newcommand{\notef}{\rmfamily\fontsize{Xpt}{Ypt}\selectfont}
    // [^}]* 는 \fontsize{Xpt} 안의 } 에서 멈추므로, (?:\\[a-zA-Z]+)* 로 수정
    const notef = latexStr.match(/\\newcommand\{\\notef\}\{(?:\\[a-zA-Z]+)*\\fontsize\{([\d.]+)pt\}\{([\d.]+)pt\}/);
    if (notef) { map.noteSize = notef[1]; map.noteLeading = notef[2]; }
    // \geometry 여백
    const geo = latexStr.match(/top=([\d.]+)mm.*?bottom=([\d.]+)mm.*?inner=([\d.]+)mm.*?outer=([\d.]+)mm/s);
    if (geo) { map.marginTop=geo[1]; map.marginBottom=geo[2]; map.marginInner=geo[3]; map.marginOuter=geo[4]; }
    // LetterSpace (자간)
    const ls = latexStr.match(/LetterSpace=([-\d.]+)/);
    if (ls) map.letterSpace = ls[1];
    // \footnotemark / \footnotesize (일반 각주)
    const fnSize = latexStr.match(/\\renewcommand\{\\footnotesize\}\{\\fontsize\{([\d.]+)pt\}\{([\d.]+)pt\}/);
    if (fnSize) { map.footnoteSize = fnSize[1]; map.footnoteLeading = fnSize[2]; }
    // 쪽번호 위치 (makeoddfoot/makeoddhead)
    const pnFoot = latexStr.match(/\\makeoddfoot\{imprint\}\{([^}]*)\}\{([^}]*)\}\{([^}]*)\}/);
    const pnHead = latexStr.match(/\\makeoddhead\{imprint\}\{([^}]*)\}\{([^}]*)\}\{([^}]*)\}/);
    if (pnFoot) map.pnFoot = `{${pnFoot[1]}}{${pnFoot[2]}}{${pnFoot[3]}}`;
    if (pnHead) map.pnHead = `{${pnHead[1]}}{${pnHead[2]}}{${pnHead[3]}}`;
    return map;
  }

  // ── Evidence Map 백그라운드 생성 ─────────────────────────────────
  async function buildEvidenceMap(text, structReason, _apiKey) {
    if (!text || !_apiKey) return;
    const cacheKey = makeAiCacheKey('evidenceMap', [
      simpleHash(text), text.length,
      simpleHash(JSON.stringify({
        concept: structReason?.design_concept || [],
        task: structReason?.design_task || [],
      })),
    ]);
    const cached = getAiCache('evidenceMap', cacheKey);
    if (cached) { setEvidenceMap(cached); return; }
    setEvidenceMap([]); // 로딩 시작 (빈 배열 = 생성 중)
    try {
      const prompt = `입력 텍스트에서 조판 결정의 근거가 된 표현 3~5개를 추출하여 각각의 디자인 연결을 분석하라.
텍스트(앞300자):"${text.slice(0,300)}"
디자인개념:${(structReason?.design_concept||[]).join(',')} 과제:${(structReason?.design_task||[]).join(',')}
반환JSON배열:[{"textSpan":"<표현10~20자>","interpretation":"<해석10자>","designConcept":"<개념>","designTask":"<과제>","affectedVariables":["<변수1>","<변수2>"]}]
유효한JSON배열만반환.`;
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch('/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': _apiKey },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 500,
          system: 'Return ONLY valid JSON array, no other text.',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      clearTimeout(tid);
      if (!res.ok) { setEvidenceMap([]); return; }
      const data = await res.json();
      const raw = (data.content || []).map(x => x.text || '').join('');
      const parsed = JSON.parse(raw.replace(/^[^\[]*/, '').replace(/[^\]]*$/, ''));
      const result = Array.isArray(parsed) ? parsed : [];
      setAiCache('evidenceMap', cacheKey, result);
      setEvidenceMap(result);
    } catch (e) {
      console.warn('[EvidenceMap] 생성 실패:', e.message);
      setEvidenceMap([]);
    }
  }

  async function analyzeExperiment() {
    if (feedbackCorrections.length === 0 || satisfactionScore === null) return;
    setExperimentLoading(true);

    try {
      // 시스템 결과 요약 구성
      const systemIntent = [
        currentLog?.text_analysis?.layout_intent,
        currentLog?.matching?.semantic_reason,
      ].filter(Boolean).join(' / ') || '(의도 정보 없음)';

      const systemAction = [
        currentLog?.matching?.selected_reference_title
          ? `레퍼런스: ${currentLog.matching.selected_reference_title}`
          : null,
        currentLog?.text_analysis?.detected_genre
          ? `장르: ${currentLog.text_analysis.detected_genre}`
          : null,
      ].filter(Boolean).join(', ') || '(행동 정보 없음)';

      // 사용자 입력 corrections 사용
      const corrections = feedbackCorrections;
      const primary = corrections[0] || {};

      // difference: 사용자 선택 변수 요약
      const varNames = {'body_size':'본문크기','body_leading':'본문행간','heading_h1_size':'제목크기','heading_h1_leading':'제목행간','heading_h2_size':'소제목크기','heading_h2_leading':'소제목행간','heading_h3_size':'소소제목크기','heading_h3_leading':'소소제목행간','heading_gap':'제목간격','heading_layout':'제목정렬','margin_top':'상여백','margin_bottom':'하여백','margin_inner':'안여백','margin_outer':'밖여백','tracking':'자간','column_count':'단수','footnote_size':'각주크기','footnote_leading':'각주행간','column_gap':'단간격','folio_size':'쪽번호','font_style':'서체','paragraph_spacing':'문단간격'};
      const diffVars = corrections.map(c => `${varNames[c.target_variable] || c.target_variable} (${c.user_pct})`).join(', ');
      const difference = `사용자 요청: ${diffVars}. 만족도: ${satisfactionScore}/5`;

      // nextRule: 규칙 요약
      const nextRule = `${corrections.map(c => `${varNames[c.target_variable] || c.target_variable}: ${c.system_pct} → ${c.user_pct} (${c.direction_match ? '방향일치' : '미반영'})`).join('; ')}`;

      // ── 일치율 계산 ──
      function calcMatchRate(corrs) {
        // null = 비교 불가(미반영 등) → 제외하고 계산
        const comparable = corrs.filter(c => c.direction_match !== null && c.direction_match !== undefined);
        if (!comparable.length) return 0;
        const matched = comparable.filter(c => c.direction_match === true).length;
        return Math.round((matched / comparable.length) * 100);
      }
      const computedMatchRate = calcMatchRate(corrections);

      const analysis = {
        matchRate: computedMatchRate,
        difference,
        nextRule,
        corrections,
        targetVariable: primary.target_variable || '',
        directionMatch: primary.direction_match ?? true,
        systemPct: primary.system_pct || '',
        userPct: primary.user_pct || '',
      };
      setExperimentAnalysis(analysis);

      // 로그 저장
      const userFeedbackText = corrections.map(c => `${varNames[c.target_variable] || c.target_variable}: ${c.user_pct}`).join(', ');
      const exp = {
        experiment_id: `exp_${Date.now()}`,
        timestamp: new Date().toISOString(),
        system_intent: systemIntent,
        system_action: systemAction,
        user_correct_intent: userFeedbackText,
        satisfaction_score: satisfactionScore,
        match_rate: analysis.matchRate,
        difference: analysis.difference,
        next_rule: analysis.nextRule,
        target_variable: analysis.targetVariable || '',
        user_pct: analysis.userPct || '',
        system_pct: analysis.systemPct || '',
        corrections: analysis.corrections || [],
      };
      saveExperiment(exp);

      // ── System Rules 업데이트 ────────────────────────
      updateSystemRules(analysis.corrections, satisfactionScore, userFeedbackText);

      // ── Google Sheets 02-Feedback Test Log 로깅 ──────────────
      if (ENABLE_GOOGLE_SHEET_LOGGING) {
        const cl = currentLog;
        const sc = styleConfig;
        sendToSheet({
          sheet: 'feedback',
          date: cl?.created_at?.slice(0,10) || new Date().toISOString().slice(0,10),
          title: fields.제목 || '',
          subtitle: fields.소제목 || '',
          body: (fields.본문 || '').slice(0, 500),
          footnote: fields.각주 || '',
          running_head: fields.면주 || '',
          mode: selectionMode === 'auto' ? '자동 추천' : selectionMode === 'genre-forced' ? '장르 강제' : '레퍼런스 고정',
          genre: hint || '',
          col_auto: sc.columnMode === 'auto' ? '자동' : '',
          col_fixed: sc.columnMode === 'fixed' ? sc.fixedColumns : '',
          col_var_total: sc.columnMode === 'variable' ? (sc.variableGrid?.total ?? '') : '',
          col_body: sc.columnMode === 'variable' ? (sc.variableGrid?.body ?? '') : '',
          col_note: sc.columnMode === 'variable' ? (sc.variableGrid?.note ?? '') : '',
          col_gap_mm: sc.columnGapMm || '',
          note_position: sc.notePosition || '',
          body_columns: sc.bodyTextColumns || 1,
          note_columns: sc.noteTextColumns || 1,
          select_mode: cl?.matching?.match_mode || '',
          reference: cl?.matching?.selected_reference_title || '',
          content_match: (cl?.matching?.top_candidates || []).slice(0,3).map(c => c.title).filter(Boolean).join(', '),
          design_concept: (structuredReason?.design_concept || []).join(', '),
          design_task: (structuredReason?.design_task || []).join(', '),
          visual_element: (structuredReason?.visual_element || []).join(', ') || cl?.text_analysis?.layout_intent || '',
          ref_detail: cl?.matching?.semantic_reason || '',
          body_reason: Array.isArray(evidenceMap) && evidenceMap.length > 0
            ? evidenceMap.map(e => `"${e.textSpan}"\n→ ${e.interpretation}`).join('\n')
            : cl?.text_analysis?.topic || '',
          font_choice: DB[cl?.matching?.selected_reference_id]?.why_font || '',
          margin_design: DB[cl?.matching?.selected_reference_id]?.why_margin || '',
          tracking: DB[cl?.matching?.selected_reference_id]?.why_tracking || '',
          rejected: (cl?.matching?.rejected || []).slice(0,3)
            .map(r => typeof r === 'object' ? `${DB[r.i]?.t?.slice(0,20) || r.i} — ${r.reason}` : String(r))
            .join(' / '),
          user_feedback: userFeedbackText,
          satisfaction: satisfactionScore,
          target_variable: (analysis.corrections||[]).map(c=>c.target_variable).filter(Boolean).join(', '),
          system_action: (analysis.corrections||[]).map(c=>c.system_pct).filter(Boolean).join(', '),
          user_correct_action: (analysis.corrections||[]).map(c=>c.user_pct).filter(Boolean).join(', '),
          direction_match: (analysis.corrections||[]).every(c => c.direction_match) ? 'Y' : 'N',
          match_rate: analysis.matchRate,
          difference: analysis.difference,
          next_rule: analysis.nextRule,
          csv_flag: [exp.experiment_id, exp.timestamp?.slice(0,10), userFeedbackText, satisfactionScore, analysis.matchRate + '%'].join(' | '),
          md_flag: [`# ${exp.experiment_id}`, `날짜: ${exp.timestamp?.slice(0,10)}`, `피드백: ${userFeedbackText}`, `만족도: ${satisfactionScore}/5`, `일치율: ${analysis.matchRate}%`].join('\n'),
          design_rules: (buildDesignRules() || '(아직 규칙 없음)').slice(0, 5000),
          json_flag: JSON.stringify({
            experiment_id: exp.experiment_id,
            timestamp: exp.timestamp,
            satisfaction: satisfactionScore,
            feedback: userFeedbackText,
            corrections: analysis.corrections,
            match_rate: analysis.matchRate,
            direction_match: (analysis.corrections||[]).every(c => c.direction_match),
            next_rule: analysis.nextRule,
            system_rules_snapshot: (() => { try { return JSON.parse(localStorage.getItem('imprint_system_rules') || '{}'); } catch { return {}; } })(),
          }, null, 2).slice(0, 45000),
        });
      }

      // 피드백 폼 초기화
      setFeedbackCorrections([]);
      setFeedbackCurrentSystemPct('');
      setFeedbackCurrentUserPct('');
      setFeedbackCurrentVar('body_leading');
    } catch (err) {
      setExperimentAnalysis({ matchRate: 0, difference: `오류: ${err.message}`, nextRule: '' });
    } finally {
      setExperimentLoading(false);
    }
  }

  async function refine() {
    if (!refineInput.trim() || !latex) return;
    if (!apiKey) {
      setRefineHistory(h => [...h,
        { role: 'user', content: refineInput.trim() },
        { role: 'assistant', chatContent: 'API 키가 없습니다. 우상단 "API 연결" 버튼에서 키를 입력해주세요.', content: '', changes: '', codeChanged: false, isError: true },
      ]);
      setRefineInput('');
      return;
    }
    const p = DB[selIdx];
    const userMsg = refineInput.trim();

    // ── 구조적 변경 요청이면 API 호출 없이 안내 ─────────────────
    const structural = detectStructuralRequest(userMsg);
    if (structural) {
      setRefineInput('');
      setRefineHistory(h => [...h,
        { role: 'user', content: userMsg },
        {
          role: 'assistant',
          chatContent: `"${structural.label}" 변경은 채팅으로 처리할 수 없습니다. ${structural.path} 값을 바꾼 뒤 [조판 스타일 생성하기]를 다시 누르세요.`,
          content: '',
          changes: '',
          isStructural: true,
          codeChanged: false,
        }
      ]);
      return;
    }

    // ── 판형 크기 조정 인터셉터 ─────────────────────────────────
    const paperDir = detectPaperSizeRequest(userMsg);
    if (paperDir) {
      const currW = parseFloat(styleConfig.paperW) || p.f.w;
      const currH = parseFloat(styleConfig.paperH) || p.f.h;
      // ±10mm 단순 조정 (비율 유지)
      const step = 10;
      const newW = paperDir === 'larger' ? currW + step : Math.max(80, currW - step);
      const newH = Math.round(newW * (currH / currW));

      // styleConfig 업데이트 (다음 재생성에 반영)
      setStyleConfig(s => ({ ...s, paperW: String(newW), paperH: String(newH) }));

      // latex(main.tex)의 \setstocksize 즉시 패치
      const newLatex = latex
        .replace(/\\setstocksize\{[\d.]+mm\}\{[\d.]+mm\}/, `\\setstocksize{${newH}mm}{${newW}mm}`);
      if (newLatex !== latex) setLatex(newLatex);

      // styCode의 geometry paperwidth/paperheight 즉시 패치
      const newSty = styCode
        .replace(/(paperwidth\s*=\s*)[\d.]+mm/, `$1${newW}mm`)
        .replace(/(paperheight\s*=\s*)[\d.]+mm/, `$1${newH}mm`);
      if (newSty !== styCode) setStyCode(newSty);

      setRefineInput('');
      setRefineHistory(h => [...h,
        { role: 'user', content: userMsg },
        {
          role: 'assistant',
          chatContent: `판형을 ${newW}×${newH}mm로 조정했습니다 (기존 ${currW}×${currH}mm). main.tex과 sty 모두 반영됐습니다.`,
          content: '',
          changes: `- 판형: ${currW}×${currH}mm → ${newW}×${newH}mm`,
          codeChanged: true,
        }
      ]);
      return;
    }

    // ── 인텐트 분류 (API 호출 전) ────────────────────────────────
    const intent = classifyChatIntent(userMsg); // "question" | "modify" | "ambiguous"

    setRefineInput('');
    setRefineLoading(true);
    setStreamingText('');
    setRefineHistory(h => [...h, { role: 'user', content: userMsg, intent }]);

    // ── 현재 LaTeX 수치 스냅샷 (수정 전) ─────────────────────────
    const cmdMap = extractLatexCommandMap(latex);
    const compressedLatex = compressLatex(latex);

    // ── 커맨드 맵 요약 (시스템 프롬프트용) ───────────────────────
    const cmdMapStr = [
      cmdMap.bodySize     && `본문: ${cmdMap.bodySize}pt / 행간 ${cmdMap.bodyLeading}pt`,
      cmdMap.noteSize     && `주석(\\notef): ${cmdMap.noteSize}pt / 행간 ${cmdMap.noteLeading}pt  ← "각주/주석/옆 글씨" 요청 시 여기 수정`,
      cmdMap.footnoteSize && `하단각주(\\footnotesize): ${cmdMap.footnoteSize}pt / 행간 ${cmdMap.footnoteLeading}pt`,
      cmdMap.letterSpace  && `자간(LetterSpace): ${cmdMap.letterSpace}`,
      cmdMap.marginTop    && `여백: 상${cmdMap.marginTop} 하${cmdMap.marginBottom} 내${cmdMap.marginInner} 외${cmdMap.marginOuter}mm`,
    ].filter(Boolean).join('\n');

    // ── 레퍼런스 컨텍스트 (question 모드에서 답변 근거로 사용) ──────
    const refCtx = p ? [
      `선택된 레퍼런스: "${p.title || p.t}" (${p.designer || '-'})`,
      `장르: ${Array.isArray(p.g) ? p.g.join(', ') : (p.g || '-')}`,
      `판형: ${p.f.w}×${p.f.h}mm`,
      `레이아웃: ${p.layout_type || '-'}`,
      p.why_font   ? `서체 이유: ${p.why_font}` : null,
      p.why_margin ? `여백 이유: ${p.why_margin}` : null,
      p.why_tracking ? `자간 이유: ${p.why_tracking}` : null,
    ].filter(Boolean).join('\n') : '(레퍼런스 정보 없음)';

    // ── 인텐트별 출력 규칙 ────────────────────────────────────────
    const outputRules = intent === 'question'
      ? `출력 규칙 (질문 모드):
1. 한국어로 질문에 답변한다.
2. 현재 수치, 선택된 레퍼런스, 조판 설계 이유를 근거로 설명한다.
3. <latex_update> 태그를 절대 출력하지 않는다 — 코드를 수정하지 않는다.
4. 수정을 원한다면 어떻게 요청하면 되는지 짧게 안내해도 된다.`
      : intent === 'modify'
      ? `출력 규칙 (수정 모드):
1. 먼저 아래 형식으로 디자인 해석을 출력한다:
<interpretation>
designConcept: <개념 한 줄>
designTask: <과제 한 줄>
visualElement: <수치/스타일 한 줄>
</interpretation>
2. 한국어로 무엇을 어떻게 바꾸는지 1~2문장으로 설명한다.
3. LaTeX 수정이 필요하면 설명 뒤에 <latex_update> 태그 안에 수정된 전체 LaTeX를 출력한다.
4. <latex_update> 태그 안에는 마크다운(backtick) 없이 순수 LaTeX만 넣는다.
5. 핵심 스타일(판형·정렬·레퍼런스)은 절대 변경하지 않는다.`
      : /* ambiguous */
      `출력 규칙:
1. 먼저 한국어로 무엇을 어떻게 바꾸는지 1~2문장으로 설명한다.
2. LaTeX 수정이 필요하면 설명 뒤에 <latex_update> 태그 안에 수정된 전체 LaTeX를 출력한다.
3. 수정이 없으면 <latex_update> 태그를 출력하지 않고 대화만 한다.
4. <latex_update> 태그 안에는 마크다운(backtick) 없이 순수 LaTeX 코드만 넣는다.`;

    // ── 시스템 프롬프트 ───────────────────────────────────────────
    const systemPrompt = `너는 Imprint 조판 시스템의 스타일 어시스턴트다. 한국어로 자연스럽게 대화한다.

현재 스타일 수치:
${cmdMapStr || '(수치 추출 실패 — LaTeX 직접 참고)'}
판형: ${p.f.w}×${p.f.h}mm (절대 불변)
본문 정렬: ${runMeta?.selectedAlignment||'justified'} (고정)

레퍼런스 정보:
${refCtx}

수치 없는 자연어 변환 기준:
"조금/약간" = ±10%,  "좀/더" = ±15%,  "크게/많이" = ±25%,  "훨씬/아주" = ±35%

LaTeX 커맨드 라우팅 규칙:
${cmdMap.noteSize
  ? `- "각주", "주석", "사이드노트", "옆 글씨", "여백 텍스트" → \\notef 안의 \\fontsize만 수정 (현재 ${cmdMap.noteSize}pt)`
  : `- 이 레이아웃에는 여백 주석(\\notef)이 없음`}
${cmdMap.footnoteSize
  ? `- 하단 각주 → \\renewcommand{\\footnotesize}{\\fontsize{X}{Y}\\selectfont}`
  : `- 이 레이아웃에는 하단 각주 정의 없음 → 관련 요청은 "불가" 안내`}
- 자간 → \\setmainfont 의 LetterSpace= 만 수정
- 여백 → \\geometry 의 top/bottom/inner/outer 만 수정
- 쪽번호 → \\makeoddfoot / \\makeoddhead / \\makeevenfoot / \\makeevenhead

${outputRules}

현재 LaTeX:
${intent === 'question' ? '(질문 모드: LaTeX 참고용, 수정 금지)\n' : ''}${compressedLatex}`;

    // ── 멀티턴 대화 히스토리 구성 ────────────────────────────────
    // assistant 메시지는 chatContent(자연어 부분)만 전달 — LaTeX 코드 제외
    const messages = [
      ...refineHistory.map(m => ({
        role: m.role,
        content: m.role === 'user'
          ? m.content
          : (m.chatContent || '').trim() || '(이전 수정 완료)',
      })).filter(m => m.content),
      { role: 'user', content: userMsg },
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetch('/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 6000,
          stream: true,
          system: systemPrompt,
          messages,
        }),
      });


      if (!res.ok) {
        let errMsg = res.statusText;
        try {
          const errData = await res.json();
          errMsg = errData.error?.message || errMsg;
        } catch {
          try { errMsg = await res.text(); } catch { /* 무시 */ }
        }

        throw new Error(`API 오류 ${res.status}: ${errMsg}`);
      }

      // ── SSE 스트리밍 파싱 ─────────────────────────────────────
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 마지막 불완전한 라인은 다음 청크에

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]' || !data) continue;
          try {
            const ev = JSON.parse(data);
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            if (ev.type === 'error') throw new Error(ev.error?.message || 'API 스트림 오류');
              fullText += ev.delta.text;
              // 실시간 표시: <latex_update> 태그 이전 자연어만 표시
              // <latex_update> 감지되면 "LaTeX 수정 중…" 상태 표시
              const hasLatexTag = /<latex_update>/i.test(fullText);
              const hasClosingTag = /<\/latex_update>/i.test(fullText);
              const naturalPart = fullText.replace(/<latex_update>[\s\S]*/i, '').trim();
              if (hasLatexTag && !hasClosingTag) {
                setStreamingText(naturalPart ? naturalPart + '\n\nLaTeX 수정 중…' : 'LaTeX 수정 중…');
              } else {
                setStreamingText(naturalPart);
              }
            }
          } catch { /* JSON 파싱 오류 무시 */ }
        }
      }

      // ── 스트리밍 완료 후 처리 ─────────────────────────────────
      setStreamingText('');

      // <latex_update> 태그 추출
      const latexMatch = fullText.match(/<latex_update>([\s\S]+?)<\/latex_update>/i);
      const chatContent = fullText.replace(/<latex_update>[\s\S]+?<\/latex_update>/i, '').trim();

      // ── interpretation 태그 파싱 ─────────────────────────────────────
      const interpretMatch = fullText.match(/<interpretation>([\s\S]+?)<\/interpretation>/i);
      let parsedInterp = null;
      if (interpretMatch) {
        const interpText = interpretMatch[1];
        const getField = (key) => {
          const m = interpText.match(new RegExp(`${key}:\\s*(.+)`));
          return m ? m[1].trim() : '';
        };
        parsedInterp = {
          designConcept: getField('designConcept'),
          designTask: getField('designTask'),
          visualElement: getField('visualElement'),
        };
      }
      // interpretation 제거한 자연어 부분
      const chatContentClean = chatContent.replace(/<interpretation>[\s\S]*?<\/interpretation>/i, '').trim();

      let directDiffs = [];
      let finalLatex = latex;
      let codeChanged = false;

      if (latexMatch) {
        const extracted = latexMatch[1].trim()
          .replace(/^```latex\n?/i, '').replace(/\n?```$/i, '').trim();

        if (extracted.length > 80 && extracted.includes('\\documentclass')) {
          const sanitized = sanitizeUnicodeForLatex(extracted);

          // 전/후 cmdMap 직접 비교
          const cmdMapAfter = extractLatexCommandMap(sanitized);
          const cmLabel = {
            bodySize:'본문 크기', bodyLeading:'본문 행간',
            noteSize:'주석 크기', noteLeading:'주석 행간',
            footnoteSize:'각주 크기', footnoteLeading:'각주 행간',
            letterSpace:'자간',
            marginTop:'상단 여백', marginBottom:'하단 여백',
            marginInner:'내측 여백', marginOuter:'외측 여백',
          };
          const cmUnit = { marginTop:'mm', marginBottom:'mm', marginInner:'mm', marginOuter:'mm' };
          for (const key of Object.keys(cmLabel)) {
            const before = cmdMap[key], after = cmdMapAfter[key];
            if (after !== undefined && before !== after) {
              const unit = cmUnit[key] || 'pt';
              const fromStr = before !== undefined ? `${before}${unit}` : '(없음)';
              directDiffs.push(`- ${cmLabel[key]}: ${fromStr} → ${after}${unit}`);
            }
          }

          finalLatex = sanitized;
          codeChanged = sanitized.trim() !== latex.trim();
          if (codeChanged) {
            setLatex(sanitized);
            setTab('final');
          }
        }
      }

      // ── 변경 요약 메시지 ──────────────────────────────────────
      // directDiffs: 수치 비교 결과 (예: "본문 크기: 9pt → 8pt")
      // 【변경】/【유지】 형식 패턴도 파싱
      let changesSummary = directDiffs.join('\n');

      // Claude가 【변경】 형식으로 보고한 경우 추가 수집
      const claudeChanges = [...chatContentClean.matchAll(/【변경】([^\n]+)/g)].map(m => `- ${m[1].trim()}`);
      if (claudeChanges.length > 0 && directDiffs.length === 0) {
        changesSummary = claudeChanges.join('\n');
      }

      if (!changesSummary && intent === 'modify' && !codeChanged) {
        changesSummary = '- 수정 내용이 기존과 동일하거나 적용 불가한 항목입니다.';
      }
      if (!changesSummary && intent === 'question') {
        changesSummary = ''; // 질문 모드에서는 변경 요약 없음
      }

      setRefineHistory(h => [...h, {
        role: 'assistant',
        chatContent: chatContentClean,   // 자연어 응답 (다음 턴 히스토리에도 사용)
        content: chatContentClean,
        changes: changesSummary, // 수치 변경 요약
        codeChanged,
        intent,                  // question | modify | ambiguous
      }]);

      // ── revisionLog에 user_refinement 기록 ───────────────────────────
      if (codeChanged) {
        const _cmdMapAfter = extractLatexCommandMap(finalLatex);
        const cmLabel = {
          bodySize:'본문 크기', bodyLeading:'본문 행간',
          noteSize:'주석 크기', noteLeading:'주석 행간',
          footnoteSize:'각주 크기', footnoteLeading:'각주 행간',
          letterSpace:'자간',
          marginTop:'상단 여백', marginBottom:'하단 여백',
          marginInner:'내측 여백', marginOuter:'외측 여백',
        };
        const patchItems = Object.keys(cmLabel)
          .filter(k => _cmdMapAfter[k] !== undefined && cmdMap[k] !== _cmdMapAfter[k])
          .map(k => ({
            target: cmLabel[k],
            before: cmdMap[k] !== undefined ? String(cmdMap[k]) : '(없음)',
            after: String(_cmdMapAfter[k]),
            reason: '',
          }));
        setRevisionLog(prev => {
          const newId = `rev_${String(prev.length).padStart(3, '0')}`;
          return [...prev, {
            id: newId,
            type: 'user_refinement',
            timestamp: new Date().toISOString(),
            userRequest: userMsg,
            systemInterpretation: parsedInterp || {},
            patch: patchItems,
            userDecision: 'accepted',
          }];
        });
      }

      // ── Google Sheets 01-Revision 로깅 ───────────────────────
      if (ENABLE_GOOGLE_SHEET_LOGGING && intent !== 'question') {
        sendToSheet({
          sheet: 'revision',
          user_request: userMsg,
          ai_result: [
            chatContentClean,
            changesSummary ? '\n변경 수치:\n' + changesSummary : '',
          ].filter(Boolean).join(''),
        });
      }

      // ── 로그 업데이트 ─────────────────────────────────────────
      setCurrentLog(prev => {
        if (!prev) return prev;
        const refineEntry = {
          at: new Date().toISOString(),
          user_request: userMsg,
          changed_summary: directDiffs.slice(0,5).join(' / '),
          latex_hash_before: simpleHash(latex),
          latex_hash_after: simpleHash(finalLatex),
        };
        const updated = {
          ...prev,
          output: { ...prev.output, latex_code: finalLatex, latex_length: finalLatex.length, latex_hash: simpleHash(finalLatex) },
          style_features_used: { ...prev.style_features_used, refine_used: true },
          prompts: { ...prev.prompts, refine_prompt_hash: simpleHash(userMsg) },
          refine_history: [...(prev.refine_history||[]), refineEntry],
        };
        saveGenerationLog(updated);
        setAllLogs(all => [updated, ...all.filter(l => l.id !== updated.id)].slice(0, 100));
        return updated;
      });

    } catch (e) {
      setStreamingText('');
      if (e.name === 'AbortError') {
        setRefineHistory(h => [...h, {
          role: 'assistant',
          chatContent: '요청 시간이 초과됩니다. 다시 시도해주세요.',
          content: '',
          changes: '',
          codeChanged: false,
          isError: true,
        }]);
        return;
      }
      setRefineHistory(h => [...h, {
        role: 'assistant',
        chatContent: `오류가 발생했습니다: ${e.message}`,
        content: '',
        changes: '',
        codeChanged: false,
        isError: true,
      }]);
    } finally {
      setRefineLoading(false);
      clearTimeout(timeoutId);
    }
  }

  function _fallbackCopy(str) {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
  }
  function copy() {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(latex).then(done).catch(() => { _fallbackCopy(latex); done(); });
    } else { _fallbackCopy(latex); done(); }
  }
  function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  const pkg = DB[selIdx];
  const matchText = (fields["본문"] || [fields["제목"], fields["소제목"]].filter(Boolean).join(" ")).trim();
  const isDone = !!latex;
  const isRunning = matching || loading;
  const [showLogs, setShowLogs] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('imprint_api_key') || '');
  const [showApiInput, setShowApiInput] = useState(false);

  function saveApiKey(key) {
    setApiKey(key);
    localStorage.setItem('imprint_api_key', key);
    setShowApiInput(false);
  }

  // ── 장르 선택지 (g 필드 기준, 출판형태 제외) ─────────────────────
  const GENRE_OPTIONS = [
    "","건축·공간","그래픽디자인","문학","사진","시각문화·매체",
    "아트이론·비평","인문·사회","전시·큐레이션","타이포그래피","현대미술","기타",
  ];

  // ── Refine quick hints ──────────────────────────────────────────
  const REFINE_HINTS = ["여백을 더 넓게", "2단 구성으로", "글자 크기 줄여줘", "각주 스타일 추가", "행간 넓혀줘"];

  // ── 공통 인풋 스타일 ────────────────────────────────────────────
  const inputCls = (focused) => ({
    width: "100%", boxSizing: "border-box",
    padding: "9px 12px", fontSize: 13, lineHeight: 1.65,
    fontFamily: T.sans, color: T.ink,
    background: T.surface,
    border: `1.5px solid ${focused ? "#888" : T.border}`,
    borderRadius: 6, outline: "none", resize: "vertical",
    transition: "border-color 120ms",
  });

  const [focusedField, setFocusedField] = useState(null);

  return (
    <div style={{ height:"100vh", background:T.bg, fontFamily:T.sans, color:T.ink, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:#CCCCCC; border-radius:2px; }
        textarea, input { outline:none; resize:none; font-family:inherit; }
        button { font-family:inherit; }
      `}</style>

      {/* ══ 헤더 ══════════════════════════════════════════════════════ */}
      <header style={{ height:48, display:"flex", alignItems:"center", gap:12, padding:"0 24px",
        borderBottom:`1px solid ${T.border}`, background:T.surface, flexShrink:0, zIndex:100 }}>
        <span style={{ fontSize:16, fontWeight:700, letterSpacing:"-0.03em" }}>Imprint</span>
        <span style={{ fontSize:10, fontFamily:T.mono, color:T.muted,
          background:T.tagBg, padding:"2px 5px", borderRadius:2 }}>v{IMPRINT_VERSION}</span>
        <div style={{ flex:1 }} />
        <span style={{ fontSize:11, color:T.muted }}>{DB.length}개 스타일 패키지</span>

        {/* API 키 */}
        <div style={{ position:"relative" }}>
          {showApiInput ? (
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <input type="password" placeholder="sk-ant-api03-..."
                defaultValue={apiKey} autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') saveApiKey(e.target.value.trim());
                  if (e.key === 'Escape') setShowApiInput(false);
                }}
                style={{ width:200, padding:"5px 10px", fontSize:12, fontFamily:T.mono,
                  border:`1.5px solid ${T.ink}`, borderRadius:3, background:T.surface, color:T.ink }}
              />
              <button onClick={e => saveApiKey(e.target.closest('div').querySelector('input').value.trim())}
                style={{ padding:"5px 12px", fontSize:12, fontWeight:600, border:"none",
                  borderRadius:3, background:T.ink, color:"#fff", cursor:"pointer" }}>저장</button>
              <button onClick={() => setShowApiInput(false)}
                style={{ padding:"5px 8px", fontSize:12, border:`1px solid ${T.border}`,
                  borderRadius:3, background:"transparent", cursor:"pointer", color:T.muted }}>✕</button>
            </div>
          ) : (
            <button onClick={() => setShowApiInput(true)}
              style={{ padding:"5px 12px", fontSize:11, fontWeight:500,
                border:`1px solid ${T.border}`, borderRadius:3,
                background:T.surface, color: apiKey ? T.ink : T.muted,
                cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ width:6, height:6, borderRadius:"50%",
                background: apiKey ? "#444" : "#BBBBBB", display:"inline-block" }} />
              {apiKey ? "API 연결됨" : "API 키 입력"}
            </button>
          )}
        </div>
      </header>

      {/* ══ 3칼럼 본문 ════════════════════════════════════════════════ */}
      <div style={{ flex:1, display:"grid", gridTemplateColumns:"clamp(260px,25vw,380px) 1fr clamp(220px,22vw,320px)",
        overflow:"hidden", minHeight:0, minWidth:0 }}>

        {/* ── 좌: 텍스트 입력 ──────────────────────────────────────── */}
        <div style={{ borderRight:`1px solid ${T.border}`, display:"flex",
          flexDirection:"column", background:T.surface, overflow:"hidden" }}>

          {/* 입력 탭 */}
          <div style={{ display:"flex", borderBottom:`1px solid ${T.border}`, padding:"0 20px", flexShrink:0 }}>
            {[["text","텍스트 입력"],["experiment","실험"]].map(([k,label]) => (
              <button key={k} onClick={() => setInputTab(k)}
                style={{ padding:"11px 14px", fontSize:12,
                  fontWeight: inputTab === k ? 700 : 400,
                  border:"none", borderBottom: inputTab === k
                    ? `2px solid ${T.ink}` : "2px solid transparent",
                  background:"transparent", color: inputTab === k ? T.ink : T.muted,
                  cursor:"pointer", marginBottom:-1 }}>
                {label}
              </button>
            ))}
          </div>

          <div style={{ flex:1, overflowY:"auto", padding:"18px 20px", display:"flex", flexDirection:"column", gap:14 }}>
            {inputTab === 'text' ? (
              <>
                {[
                  { key:"제목", label:"제목", rows:2, placeholder:"출판물 제목" },
                  { key:"소제목", label:"소제목", rows:1, placeholder:"부제 · 챕터 제목 (선택)" },
                  { key:"본문", label:"본문", rows:10, placeholder:`본문 텍스트를 입력하세요\n\n각주 마커: ¹²³ 또는 [1] 또는 ^1` },
                  { key:"각주", label:"각주", rows:3, placeholder:"1. 첫 번째 각주\n2. 두 번째 각주" },
                ].map(({ key, label, rows, placeholder }) => (
                  <div key={key}>
                    <label style={{ display:"block", fontSize:11, fontWeight:600,
                      color:T.ink, marginBottom:5 }}>
                      {label}
                    </label>
                    <textarea value={fields[key]} rows={rows} placeholder={placeholder}
                      onChange={e => setFields(f => ({ ...f, [key]: e.target.value }))}
                      style={{ width:"100%", padding:"9px 11px", fontSize:13,
                        border:`1px solid ${T.border}`, borderRadius:3,
                        background:T.bg, color:T.ink, lineHeight:1.6,
                        transition:"border 150ms" }}
                      onFocus={e => e.target.style.borderColor = T.ink}
                      onBlur={e => e.target.style.borderColor = T.border}
                    />
                  </div>
                ))}
                {/* 면주 */}
                <div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
                    <label style={{ fontSize:11, fontWeight:600, color:T.ink }}>면주</label>
                    {/* 위치 드롭다운 */}
                    <select value={styleConfig.rhPos || '자동'}
                      onChange={e => setStyleConfig(s => ({ ...s, rhPos: e.target.value }))}
                      style={{ padding:"3px 6px", fontSize:11,
                        border:`1px solid ${T.border}`, borderRadius:3,
                        background:T.bg, color:T.ink, cursor:"pointer" }}>
                      <option value="자동">자동 (DB 기반)</option>
                      <option value="상단-외측">상단 · 외측</option>
                      <option value="상단-내측">상단 · 내측</option>
                      <option value="상단-중앙">상단 · 중앙</option>
                      <option value="하단-외측">하단 · 외측</option>
                      <option value="하단-내측">하단 · 내측</option>
                      <option value="하단-중앙">하단 · 중앙</option>
                      <option value="외측-수직">외측 여백 (세로)</option>
                      <option value="내측-수직">내측 여백 (세로)</option>
                    </select>
                  </div>
                  {/* 수직 면주 선택 시: 상단/하단 위치 sub-option */}
                  {(styleConfig.rhPos === '외측-수직' || styleConfig.rhPos === '내측-수직') && (
                    <div style={{ display:"flex", gap:4, marginBottom:6 }}>
                      <span style={{ fontSize:10, color:T.muted, paddingTop:4, marginRight:2 }}>세로 위치</span>
                      {[['auto','자동'],['top','상단'],['center','중앙'],['bottom','하단']].map(([val, lbl]) => {
                        const active = (styleConfig.rhVertPos || 'auto') === val;
                        return (
                          <button key={val}
                            onClick={() => setStyleConfig(s => ({ ...s, rhVertPos: val }))}
                            style={{ padding:"3px 9px", fontSize:11, fontWeight: active?600:400,
                              border:`1px solid ${active ? T.ink : T.border}`,
                              borderRadius:3, background: active ? T.ink : "transparent",
                              color: active ? "#fff" : T.ink, cursor:"pointer" }}>
                            {lbl}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <textarea value={fields["면주"]} rows={1}
                    placeholder="면주 텍스트 입력 (비우면 면주 없음)"
                    onChange={e => setFields(f => ({ ...f, 면주: e.target.value }))}
                    style={{ width:"100%", padding:"9px 11px", fontSize:13,
                      border:`1px solid ${T.border}`, borderRadius:3,
                      background:T.bg, color:T.ink, lineHeight:1.6,
                      transition:"border 150ms" }}
                    onFocus={e => e.target.style.borderColor = T.ink}
                    onBlur={e => e.target.style.borderColor = T.border}
                  />
                </div>
                {/* ── 스타일 설정 ── */}
                <div>
                  {/* 스타일 선택 모드 */}
                  <label style={{ display:"block", fontSize:11, fontWeight:600,
                    color:T.ink, marginBottom:6 }}>
                    스타일 선택 모드
                  </label>
                  <div style={{ display:"flex", gap:4, marginBottom:10 }}>
                    {[
                      ['auto',         '자동 추천'],
                      ['genre-forced', '장르 강제'],
                      ['ref-locked',   '레퍼런스 고정'],
                    ].map(([mode, label]) => {
                      const active = selectionMode === mode;
                      return (
                        <button key={mode} onClick={() => {
                          setSelectionMode(mode);
                          if (mode === 'auto') { setHint(''); setLockedStyleId(null); }
                          if (mode === 'genre-forced') { setLockedStyleId(null); }
                          if (mode === 'ref-locked') { setHint(''); }
                        }} style={{
                          flex:1, padding:"5px 8px", fontSize:11, fontWeight: active ? 600 : 400,
                          border:`1px solid ${active ? T.ink : T.border}`,
                          borderRadius:3,
                          background: active ? T.ink : 'transparent',
                          color: active ? '#fff' : T.ink,
                          cursor:"pointer",
                        }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* 장르 강제 모드: 장르 드롭다운 표시 */}
                  {selectionMode === 'genre-forced' && (
                    <div style={{ marginBottom:8 }}>
                      <label style={{ display:"block", fontSize:11, fontWeight:600,
                        color:T.ink, marginBottom:6 }}>
                        장르 / 출판 형태 직접 지정
                      </label>
                      <select value={hint} onChange={e => setHint(e.target.value)}
                        style={{ width:"100%", padding:"9px 11px", fontSize:13,
                          border:`1px solid ${T.border}`, borderRadius:3,
                          background:T.bg, color:T.ink, cursor:"pointer" }}>
                        {GENRE_OPTIONS.map(g => (
                          <option key={g} value={g}>{g || "— 장르를 선택하세요 —"}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* 레퍼런스 고정 모드: 현재 고정된 레퍼런스 표시 */}
                  {selectionMode === 'ref-locked' && (
                    <div style={{ padding:"8px 10px", background:T.bg,
                      border:`1px solid ${T.border}`, borderRadius:3,
                      fontSize:12, color:T.ink, marginBottom:8 }}>
                      {lockedStyleId !== null
                        ? <>
                            <span style={{ fontWeight:600 }}>{DB[lockedStyleId]?.t?.slice(0,30)}</span>
                            <span style={{ color:T.muted }}> 고정됨</span>
                            <button onClick={() => { setLockedStyleId(null); setSelectionMode('auto'); }}
                              style={{ marginLeft:8, fontSize:10, color:T.muted, background:"none",
                                border:"none", cursor:"pointer", textDecoration:"underline" }}>
                              해제
                            </button>
                          </>
                        : <span style={{ color:T.muted }}>스타일 생성 후 "이 스타일 고정" 버튼으로 고정하세요</span>
                      }
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ display:"block", fontSize:11, fontWeight:600,
                    color:T.ink, marginBottom:6 }}>
                    단 구성
                  </label>
                  {/* 1행: 모드 선택 */}
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:6 }}>
                    {[["auto","자동"],["fixed","고정단"],["variable","가변단"]].map(([val,label]) => {
                      const active = (styleConfig.columnMode || 'auto') === val;
                      return (
                        <button key={val}
                          onClick={() => setStyleConfig(s => ({ ...s, columnMode: val }))}
                          style={{ padding:"5px 12px", fontSize:12, fontWeight: active?600:400,
                            border:`1px solid ${active ? T.ink : T.border}`,
                            borderRadius:3, background: active ? T.ink : "transparent",
                            color: active ? "#fff" : T.ink, cursor:"pointer" }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {/* 고정단: 단 수 선택 (1~10) */}
                  {styleConfig.columnMode === 'fixed' && (
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:4 }}>
                      {[1,2,3,4,5,6,7,8,9,10].map(n => {
                        const active = (styleConfig.fixedColumns || 1) === n;
                        return (
                          <button key={n}
                            onClick={() => setStyleConfig(s => ({ ...s, fixedColumns: n }))}
                            style={{ padding:"4px 10px", fontSize:11, fontWeight: active?600:400,
                              border:`1px solid ${active ? T.ink : T.border}`,
                              borderRadius:3, background: active ? T.ink : "transparent",
                              color: active ? "#fff" : T.ink, cursor:"pointer", minWidth:32 }}>
                            {n}단
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {/* 가변단: 4개 그룹으로 구조화 */}
                  {styleConfig.columnMode === 'variable' && (() => {
                    const vg = styleConfig.variableGrid || { total:5, body:4, note:1 };
                    const pos = styleConfig.notePosition || 'right';
                    const isSide = pos === 'left' || pos === 'right';
                    const isBottom = pos === 'bottom';
                    const isTop = pos === 'top';
                    const vgTotal = vg.total;
                    const vgBody  = vg.body;
                    const overflow = isSide && (vg.body + vg.note) > vg.total;
                    const canIndent = !isSide && vgTotal > vgBody;

                    // ── 공유 스타일 ──────────────────────────────────
                    const ni = { width:46, padding:"5px 6px", fontSize:12,
                      border:`1px solid ${T.border}`, borderRadius:3,
                      background:T.bg, color:T.ink, textAlign:"center" };
                    // 각 행: 레이블(왼) + 컨트롤(오)
                    const row = { display:"flex", alignItems:"flex-start", gap:10, marginTop:12 };
                    // 왼쪽 레이블 — 고정폭, 컨트롤의 입력값 높이에 맞게 수직 중앙
                    const rowLbl = { fontSize:11, fontWeight:500, color:T.muted,
                      width:46, flexShrink:0, paddingTop:17, lineHeight:1.2 };
                    // 입력 필드 위의 작은 레이블
                    const fieldLbl = { fontSize:10, color:T.muted, marginBottom:2, display:'block' };
                    const fld = { display:"flex", flexDirection:"column" };
                    // 위치/옵션 버튼 공통
                    const posBtn = (active) => ({
                      padding:"4px 10px", fontSize:11, fontWeight: active ? 600 : 400,
                      border:`1px solid ${active ? T.ink : T.border}`,
                      borderRadius:3, background: active ? T.ink : "transparent",
                      color: active ? "#fff" : T.ink, cursor:"pointer"
                    });

                    return (
                      <div style={{ marginTop:8 }}>

                        {/* 행 1: 그리드 — 전체 / (주석이 옆일 때만: 본문 + 주석) / 간격 */}
                        <div style={row}>
                          <span style={rowLbl}>그리드</span>
                          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"flex-end" }}>
                            {/* 전체 열 */}
                            <div style={fld}>
                              <span style={fieldLbl}>전체 열</span>
                              <input type="number" min={1} max={20}
                                value={vg.total || ''}
                                onChange={e => {
                                  const v = Math.max(1, parseInt(e.target.value) || 1);
                                  setStyleConfig(s => {
                                    const prev = s.variableGrid || { total:5, body:4, note:1 };
                                    const next = { ...prev, total: v };
                                    // body는 total 초과 방지 (최소 clamp), note는 독립 유지
                                    if (next.body > v) next.body = v;
                                    return { ...s, variableGrid: next };
                                  });
                                }}
                                style={ni} />
                            </div>

                            {/* 주석이 좌/우일 때만: 본문 + 주석 */}
                            {isSide && (<>
                              <div style={{ fontSize:12, color:T.muted, paddingBottom:7, userSelect:'none' }}>=</div>
                              <div style={fld}>
                                <span style={{ ...fieldLbl, color: overflow ? '#e05' : T.muted }}>본문 열</span>
                                <input type="number" min={1} max={vg.total}
                                  value={vg.body || ''}
                                  onChange={e => {
                                    const v = Math.max(1, parseInt(e.target.value) || 1);
                                    setStyleConfig(s => {
                                      const prev = s.variableGrid || { total:5, body:4, note:1 };
                                      // 본문 열은 독립적으로 조정 — 주석 열 자동 변경 없음
                                      return { ...s, variableGrid: { ...prev, body: Math.min(v, prev.total) } };
                                    });
                                  }}
                                  style={{ ...ni, borderColor: overflow ? '#e05' : T.border }} />
                              </div>
                              <div style={{ fontSize:12, color:T.muted, paddingBottom:7, userSelect:'none' }}>+</div>
                              <div style={fld}>
                                <span style={{ ...fieldLbl, color: overflow ? '#e05' : T.muted }}>주석 열</span>
                                <input type="number" min={1} max={vg.total - 1}
                                  value={vg.note || ''}
                                  onChange={e => {
                                    const v = Math.max(1, parseInt(e.target.value) || 1);
                                    setStyleConfig(s => {
                                      const prev = s.variableGrid || { total:5, body:4, note:1 };
                                      // 주석 열은 독립적으로 조정 — 본문 열 자동 변경 없음
                                      return { ...s, variableGrid: { ...prev, note: Math.min(v, prev.total - 1) } };
                                    });
                                  }}
                                  style={{ ...ni, borderColor: overflow ? '#e05' : T.border }} />
                              </div>
                            </>)}

                            {/* 열 간격 */}
                            <div style={fld}>
                              <span style={fieldLbl}>간격 mm</span>
                              <input type="number" min={2} max={20} step={1}
                                value={styleConfig.columnGapMm ?? 8}
                                onChange={e => setStyleConfig(s => ({
                                  ...s, columnGapMm: Math.min(20, Math.max(2, parseFloat(e.target.value) || 8))
                                }))}
                                style={ni} />
                            </div>
                          </div>
                        </div>

                        {/* 관계식 힌트: 전체 N열 ÷ 본문 M단 = K열/단 */}
                        {(() => {
                          const bodyCols = isSide ? vg.body : vg.total;
                          const bodyColsLabel = isSide ? vg.body : vg.total;
                          const bCols = styleConfig.bodyTextColumns || 1;
                          const perCol = bCols > 1 ? (bodyCols / bCols).toFixed(1) : null;
                          return (
                            <div style={{ fontSize:11, color:T.muted, marginTop:4, paddingLeft:56, lineHeight:1.5 }}>
                              {isSide
                                ? `본문 ${vg.body}열 + 주석 ${vg.note}열 = 전체 ${vg.total}열`
                                : `본문 ${vg.total}열 전체 사용`}
                              {perCol && ` · ${bodyCols}열 ÷ ${bCols}단 = ${perCol}열/단`}
                              {overflow && <span style={{ color:'#e05' }}>  ⚠ {vg.body}+{vg.note}={vg.body+vg.note} › {vg.total}</span>}
                            </div>
                          );
                        })()}

                        {/* 행 2: 주석 위치 */}
                        <div style={row}>
                          <span style={rowLbl}>주석</span>
                          <div style={{ display:"flex", gap:4, flexWrap:"wrap", paddingTop:1 }}>
                            {[['right','오른쪽'],['left','왼쪽'],['top','상단'],['bottom','하단']].map(([val, label]) => (
                              <button key={val}
                                onClick={() => setStyleConfig(s => {
                                  const isNewSide = val === 'right' || val === 'left';
                                  const _vg = s.variableGrid || { total:5, body:4, note:1 };
                                  const safeNote = isNewSide
                                    ? Math.min(_vg.note, Math.max(1, _vg.total - _vg.body))
                                    : _vg.note;
                                  // top/bottom으로 전환 시 body = total로 리셋
                                  // (이전 side 모드의 좁은 body 값이 남아 본문이 극히 좁아지는 버그 방지)
                                  const safeBody = isNewSide ? _vg.body : _vg.total;
                                  return { ...s, notePosition: val, variableGrid: { ..._vg, body: safeBody, note: safeNote } };
                                })}
                                style={posBtn(pos === val)}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* 행 3: 본문 단 — isSide일 때 btc는 현재 경로에서 미적용 */}
                        <div style={{ ...row, opacity: isSide ? 0.38 : 1, pointerEvents: isSide ? 'none' : 'auto' }}>
                          <span style={rowLbl}>본문 단</span>
                          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                            <div style={fld}>
                              <span style={fieldLbl}>단 수</span>
                              <input type="number" min={1} max={isSide ? vgBody : vgTotal}
                                value={styleConfig.bodyTextColumns || 1}
                                onChange={e => setStyleConfig(s => ({
                                  ...s, bodyTextColumns: (() => {
                                    const _pos = s.notePosition || 'right';
                                    const _side = _pos === 'left' || _pos === 'right';
                                    const _maxCols = _side ? (s.variableGrid?.body || 1) : (s.variableGrid?.total || 1);
                                    return Math.min(Math.max(1, parseInt(e.target.value)||1), _maxCols);
                                  })()
                                }))}
                                style={ni} />
                            </div>
                            {canIndent && (
                              <div style={fld}>
                                <span style={fieldLbl}>시작 열</span>
                                <input type="number" min={1} max={Math.max(1, vgTotal - vgBody + 1)}
                                  value={styleConfig.bodyColumnStart || 1}
                                  onChange={e => setStyleConfig(s => {
                                    const maxS = Math.max(1, (s.variableGrid?.total||5) - (s.variableGrid?.body||4) + 1);
                                    return { ...s, bodyColumnStart: Math.min(Math.max(1, parseInt(e.target.value)||1), maxS) };
                                  })}
                                  style={ni} />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 행 4: 주석 단 — 위치별 조건부 */}
                        {isSide && (
                          <div style={row}>
                            <span style={rowLbl}>주석 단</span>
                            <div style={fld}>
                              <span style={fieldLbl}>단 수</span>
                              <input type="number" min={1} max={vg.note}
                                value={styleConfig.noteTextColumns || 1}
                                onChange={e => setStyleConfig(s => ({
                                  ...s, noteTextColumns: Math.min(Math.max(1, parseInt(e.target.value)||1), s.variableGrid?.note || 1)
                                }))}
                                style={ni} />
                            </div>
                          </div>
                        )}
                        {isTop && (
                          <div style={row}>
                            <span style={rowLbl}>주석 단</span>
                            <div style={fld}>
                              <span style={fieldLbl}>단 수</span>
                              <input type="number" min={1} max={4}
                                value={fields.각주단 || 1}
                                onChange={e => setFields(f => ({ ...f, 각주단: String(Math.min(4, Math.max(1, parseInt(e.target.value)||1))) }))}
                                style={ni} />
                            </div>
                          </div>
                        )}
                        {isBottom && (
                          <>
                            {/* ── 각주 (번호 달린 전통 각주 / 텍스트 입력 탭 "각주" 칸) ── */}
                            <div style={{ ...row }}>
                              <span style={{ ...rowLbl, lineHeight:1.2 }}>각주</span>
                              <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"flex-end" }}>
                                <div style={fld}>
                                  <span style={fieldLbl}>단 수</span>
                                  <input type="number" min={1} max={4}
                                    value={fields.각주단 || 1}
                                    onChange={e => setFields(f => ({ ...f, 각주단: String(Math.min(4, Math.max(1, parseInt(e.target.value)||1))) }))}
                                    style={ni} />
                                </div>
                                {(fields.각주단 || 1) >= 2 && (
                                  <span style={{ fontSize:10, color:T.muted, paddingBottom:4 }}>※ Overleaf에서 bigfoot 패키지 설치 필요</span>
                                )}
                              </div>
                            </div>
                          </>
                        )}

                      </div>
                    );
                  })()}
                </div>
              </>
            ) : null}
            {inputTab === 'experiment' && (
              /* ── 실험 탭 ──────────────────────────────────────────── */
              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                {!isDone ? (
                  /* 생성 전: 전체 비활성화 안내 */
                  <div style={{ padding:"20px 16px", textAlign:"center" }}>
                    <div style={{ fontSize:13, color:T.muted, lineHeight:1.8 }}>
                      아직 생성 전입니다.<br/>
                      <strong style={{ color:T.ink }}>텍스트 입력 탭</strong>에서 본문을 넣고<br/>
                      <strong style={{ color:T.ink }}>조판 스타일 생성하기</strong>를 클릭하세요.
                    </div>
                    <div style={{ marginTop:20, opacity:0.35, pointerEvents:'none', display:'flex', flexDirection:'column', gap:12 }}>
                      <div style={{ padding:"10px 12px", background:T.bg, border:`1px solid ${T.border}`,
                        borderRadius:3, fontSize:12, color:T.muted, textAlign:'left' }}>
                        정답 피드백을 입력하세요…
                      </div>
                      <div style={{ display:'flex', gap:6, justifyContent:'center' }}>
                        {[1,2,3,4,5].map(n => (
                          <div key={n} style={{ width:36, height:36, borderRadius:3,
                            border:`1px solid ${T.border}`, background:T.bg,
                            display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize:14, color:T.muted }}>{n}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* 생성 후: 피드백 활성화 */
                  <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'4px 0' }}>
                    {/* 정답 피드백: 구조화 폼 */}
                    <div>
                      <label style={{ display:'block', fontSize:11, fontWeight:600,
                        color:T.ink, marginBottom:8 }}>
                        변수별 수정 요청
                      </label>

                      {/* 변수 선택 + 입력 */}
                      <div style={{ display:'flex', flexDirection:'column', gap:8,
                        padding:'10px', background:T.bg, borderRadius:3,
                        border:`1px solid ${T.border}` }}>
                        <div style={{ display:'flex', gap:8 }}>
                          <select value={feedbackCurrentVar} onChange={e => setFeedbackCurrentVar(e.target.value)}
                            style={{ flex:1, padding:'6px 8px', fontSize:11, border:`1px solid ${T.border}`,
                              borderRadius:3, background:T.surface }}>
                            <option value="body_size">본문 크기</option>
                            <option value="body_leading">본문 행간</option>
                            <option value="heading_h1_size">제목 크기</option>
                            <option value="heading_h1_leading">제목 행간 (복수줄)</option>
                            <option value="heading_h2_size">소제목 크기</option>
                            <option value="heading_h2_leading">소제목 행간 (복수줄)</option>
                            <option value="heading_h3_size">소소제목 크기</option>
                            <option value="heading_h3_leading">소소제목 행간 (복수줄)</option>
                            <option value="heading_gap">제목↔소제목 간격</option>
                            <option value="heading_layout">제목 정렬</option>
                            <option value="margin_top">상 여백</option>
                            <option value="margin_bottom">하 여백</option>
                            <option value="margin_inner">안쪽 여백</option>
                            <option value="margin_outer">바깥쪽 여백</option>
                            <option value="tracking">자간</option>
                            <option value="column_count">단 수</option>
                            <option value="footnote_size">각주 크기</option>
                            <option value="footnote_leading">각주 행간</option>
                            <option value="column_gap">단 간격</option>
                            <option value="folio_size">쪽번호 크기</option>
                            <option value="font_style">서체 스타일</option>
                            <option value="paragraph_spacing">문단 간격</option>
                          </select>
                        </div>

                        <div style={{ display:'flex', gap:8, fontSize:11 }}>
                          <div style={{ flex:1 }}>
                            <label style={{ display:'block', fontSize:10, color:T.muted, marginBottom:3 }}>
                              시스템이 적용한 값 (예: +8%, 3단)
                            </label>
                            <input type="text" value={feedbackCurrentSystemPct}
                              onChange={e => setFeedbackCurrentSystemPct(e.target.value)}
                              placeholder="미반영"
                              style={{ width:'100%', padding:'6px 8px', border:`1px solid ${T.border}`,
                                borderRadius:3, fontSize:11 }}
                            />
                          </div>
                          <div style={{ flex:1 }}>
                            <label style={{ display:'block', fontSize:10, color:T.muted, marginBottom:3 }}>
                              원하는 값 (예: +15%, 2단)
                            </label>
                            <input type="text" value={feedbackCurrentUserPct}
                              onChange={e => setFeedbackCurrentUserPct(e.target.value)}
                              placeholder="필수"
                              style={{ width:'100%', padding:'6px 8px', border:`1px solid ${T.border}`,
                                borderRadius:3, fontSize:11 }}
                            />
                          </div>
                        </div>

                        <button onClick={() => {
                          if (!feedbackCurrentUserPct.trim()) return;
                          const newCorr = {
                            target_variable: feedbackCurrentVar,
                            system_pct: feedbackCurrentSystemPct.trim() || '미반영',
                            user_pct: feedbackCurrentUserPct.trim(),
                            direction_match: (() => {
                              const s = feedbackCurrentSystemPct.trim();
                              const u = feedbackCurrentUserPct.trim();
                              if (!s || /미반영|not applied/i.test(s)) return null;
                              const sSign = s.match(/[+-]/)?.[0];
                              const uSign = u.match(/[+-]/)?.[0];
                              if (!sSign || !uSign) return null;
                              return sSign === uSign;
                            })(),
                          };
                          setFeedbackCorrections([...feedbackCorrections, newCorr]);
                          setFeedbackCurrentSystemPct('');
                          setFeedbackCurrentUserPct('');
                        }}
                          style={{ padding:'6px 10px', fontSize:11, fontWeight:600,
                            background:T.ink, color:'#fff', border:'none', borderRadius:3,
                            cursor:'pointer' }}>
                          + 변수 추가
                        </button>
                      </div>

                      {/* 추가된 변수 리스트 */}
                      {feedbackCorrections.length > 0 && (
                        <div style={{ marginTop:8, padding:'8px 10px', background:T.bg,
                          borderRadius:3, border:`1px solid ${T.border}` }}>
                          <div style={{ fontSize:10, fontWeight:600, color:T.muted, marginBottom:6 }}>
                            추가된 항목 ({feedbackCorrections.length})
                          </div>
                          {feedbackCorrections.map((c, i) => (
                            <div key={i} style={{ display:'flex', justifyContent:'space-between',
                              alignItems:'center', fontSize:11, padding:'4px 0',
                              borderBottom: i < feedbackCorrections.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                              <div style={{ flex:1 }}>
                                <span style={{ fontWeight:600, color:T.ink }}>{
                                  {'body_size':'본문크기','body_leading':'본문행간','heading_h1_size':'제목크기','heading_h1_leading':'제목행간','heading_h2_size':'소제목크기','heading_h2_leading':'소제목행간','heading_h3_size':'소소제목크기','heading_h3_leading':'소소제목행간','heading_gap':'제목간격','heading_layout':'제목정렬','margin_top':'상여백','margin_bottom':'하여백','margin_inner':'안여백','margin_outer':'밖여백','tracking':'자간','column_count':'단수','footnote_size':'각주크기','footnote_leading':'각주행간','column_gap':'단간격','folio_size':'쪽번호','font_style':'서체','paragraph_spacing':'문단간격'}[c.target_variable] || c.target_variable
                                }</span>
                                <span style={{ color:T.muted, marginLeft:8 }}>
                                  {c.system_pct} → {c.user_pct}
                                </span>
                              </div>
                              <button onClick={() => setFeedbackCorrections(feedbackCorrections.filter((_, j) => i !== j))}
                                style={{ padding:'2px 8px', fontSize:10, border:`1px solid ${T.border}`,
                                  background:T.surface, color:T.muted, borderRadius:2, cursor:'pointer' }}>
                                삭제
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* 만족도 5단계 */}
                    <div>
                      <label style={{ display:'block', fontSize:11, fontWeight:600,
                        color:T.ink, marginBottom:8 }}>
                        만족도
                      </label>
                      <div style={{ display:'flex', gap:6 }}>
                        {[
                          [1, '매우\n불일치'],
                          [2, '불일치'],
                          [3, '일부\n일치'],
                          [4, '일치'],
                          [5, '매우\n일치'],
                        ].map(([n, lbl]) => {
                          const active = satisfactionScore === n;
                          return (
                            <button key={n} onClick={() => setSatisfactionScore(n)}
                              style={{ flex:1, padding:'8px 4px', borderRadius:3,
                                border:`1px solid ${active ? T.ink : T.border}`,
                                background: active ? T.ink : T.bg,
                                color: active ? '#fff' : T.muted,
                                cursor:'pointer', fontSize:10, lineHeight:1.4,
                                whiteSpace:'pre-line', textAlign:'center' }}>
                              <div style={{ fontSize:16, fontWeight:700,
                                color: active ? '#fff' : T.ink, marginBottom:2 }}>{n}</div>
                              {lbl}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {/* 피드백 전송 버튼 */}
                    {(() => {
                      const canSubmit = feedbackCorrections.length > 0 && satisfactionScore !== null && !experimentLoading;
                      return (
                        <button
                          onClick={analyzeExperiment}
                          disabled={!canSubmit}
                          style={{ padding:'10px', fontSize:12, fontWeight:600,
                            border:'none', borderRadius:3,
                            background: canSubmit ? T.ink : T.border,
                            color: canSubmit ? '#fff' : T.muted,
                            cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
                          {experimentLoading ? '분석 중…' : '피드백 적용하기'}
                        </button>
                      );
                    })()}
                    {experimentAnalysis && (
                      <div style={{ padding:'12px', background:T.bg,
                        border:`1px solid ${T.border}`, borderRadius:3,
                        fontSize:12, color:T.ink, display:'flex', flexDirection:'column', gap:10 }}>
                        {/* 일치율 */}
                        <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
                          <span style={{ fontWeight:700, fontSize:20, color:T.ink }}>
                            {experimentAnalysis.matchRate}%
                          </span>
                          <span style={{ color:T.muted }}>일치율</span>
                        </div>
                        {/* 비교 테이블 */}
                        {experimentAnalysis.targetVariable && (
                          <div style={{ background:T.surface, border:`1px solid ${T.border}`,
                            borderRadius:3, padding:'8px 10px', fontFamily:T.mono, fontSize:11 }}>
                            <div style={{ marginBottom:4, fontFamily:T.sans, fontWeight:600, fontSize:11, color:T.ink }}>
                              비교: {experimentAnalysis.targetVariable}
                            </div>
                            <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'2px 8px', color:T.muted }}>
                              <span>시스템</span>
                              <span style={{ color: experimentAnalysis.directionMatch ? '#2a7' : '#c44' }}>
                                {experimentAnalysis.systemPct || '—'}
                              </span>
                              <span>정답</span>
                              <span style={{ color:T.ink, fontWeight:600 }}>
                                {experimentAnalysis.userPct || '—'}
                              </span>
                              <span>방향</span>
                              <span style={{ color: experimentAnalysis.directionMatch ? '#2a7' : '#c44' }}>
                                {experimentAnalysis.directionMatch ? '✓ 일치' : '✗ 불일치'}
                              </span>
                            </div>
                          </div>
                        )}
                        {/* 차이점 */}
                        {experimentAnalysis.difference && (
                          <div>
                            <div style={{ fontSize:10, fontWeight:600, color:T.muted,
                              letterSpacing:1, marginBottom:3 }}>차이점</div>
                            <div style={{ lineHeight:1.6, color:T.ink }}>
                              {experimentAnalysis.difference}
                            </div>
                          </div>
                        )}
                        {/* 다음 규칙 */}
                        {experimentAnalysis.nextRule && (
                          <div style={{ padding:'8px 10px', background:'#f0f7f0',
                            border:'1px solid #c8e6c8', borderRadius:3 }}>
                            <div style={{ fontSize:10, fontWeight:600, color:'#2a7',
                              letterSpacing:1, marginBottom:3 }}>다음 생성 반영 규칙</div>
                            <div style={{ lineHeight:1.6, color:T.ink }}>
                              {experimentAnalysis.nextRule}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {experimentAnalysis !== null && (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>

            {/* ── 기존 실험 로그 → 새 학습 시스템 마이그레이션 ── */}
            {(() => {
              const expCount = loadExperiments().length;
              const sr = loadSystemRules();
              const hasRules = Object.values(sr.rules).some(r => r.confidence !== 'none');
              if (expCount === 0) return null;
              return (
                <button onClick={() => {
                  const exps = loadExperiments();
                  let migrated = 0;
                  for (const e of exps) {
                    const corrList = Array.isArray(e.corrections) && e.corrections.length > 0
                      ? e.corrections
                      : (e.target_variable ? [{ target_variable: e.target_variable, user_pct: e.user_pct }] : []);
                    if (corrList.length > 0) {
                      updateSystemRules(corrList, e.satisfaction_score || 3, e.user_correct_intent || e.user_feedback || e.next_rule || '');
                      migrated++;
                    }
                  }
                  alert(`마이그레이션 완료: ${migrated}개 실험 → 학습 규칙 반영됨\n페이지를 새로고침하면 반영된 규칙이 표시됩니다.`);
                  window.location.reload();
                }} style={{ width:'100%', padding:'9px', fontSize:11, fontWeight:600,
                  border:`1px solid #a0c4e8`, borderRadius:3,
                  background: hasRules ? '#f5f5f5' : '#eef5fc',
                  color: hasRules ? T.muted : '#1a6fa8', cursor:'pointer' }}>
                  {hasRules
                    ? `↺ 기존 실험 ${expCount}개 재학습 (현재 규칙 덮어쓰기)`
                    : `▶ 기존 실험 ${expCount}개로 학습 규칙 생성`}
                </button>
              );
            })()}

            {/* ── 현재 학습된 시스템 규칙 패널 ── */}
            {(() => {
              const sr = loadSystemRules();
              const activeRules = Object.entries(sr.rules).filter(([, r]) => r.confidence !== 'none' && r.value !== null);
              const confColor = { high:'#c8440a', medium:'#b07c00', low:'#888' };
              const confLabel = { high:'강함 ●●●', medium:'중간 ●●○', low:'약함 ●○○' };
              const varLabel  = {
                column_count:'단 수', font_style:'서체 스타일', paragraph_spacing:'문단 간격',
                body_size:'글자 크기', body_leading:'행간', tracking:'자간',
                heading_h1_size:'제목 크기', heading_h1_leading:'제목 행간',
                heading_h2_size:'부제목 크기', heading_h2_leading:'부제목 행간',
                heading_h3_size:'소제목 크기', heading_h3_leading:'소제목 행간',
                footnote_size:'각주 크기', footnote_leading:'각주 행간',
                margin_top:'상 여백', margin_bottom:'하 여백', margin_inner:'안 여백', margin_outer:'밖 여백',
              };
              return (
                <div style={{ marginTop:12, border:`1px solid ${T.border}`, borderRadius:4, overflow:'hidden' }}>
                  <div style={{ padding:'8px 12px', background:T.bg, borderBottom:`1px solid ${T.border}`,
                    display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:11, fontWeight:700, color:T.ink }}>
                      현재 학습된 규칙 {activeRules.length > 0 ? `(${activeRules.length}개 활성)` : '(없음)'}
                    </span>
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={() => {
                        const blob = new Blob([JSON.stringify(sr, null, 2)], { type:'application/json' });
                        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                        a.download = 'system_rules.json'; document.body.appendChild(a);
                        a.click(); document.body.removeChild(a);
                      }} style={{ padding:'3px 8px', fontSize:10, border:`1px solid ${T.border}`,
                        borderRadius:3, background:T.surface, color:T.muted, cursor:'pointer' }}>
                        JSON 저장
                      </button>
                      <button onClick={() => {
                        if (window.confirm('모든 학습 규칙을 초기화하시겠습니까?')) {
                          saveSystemRules(_defaultSystemRules());
                          window.location.reload();
                        }
                      }} style={{ padding:'3px 8px', fontSize:10, border:'1px solid #fcc',
                        borderRadius:3, background:'#fff8f8', color:'#c44', cursor:'pointer' }}>
                        초기화
                      </button>
                    </div>
                  </div>
                  {activeRules.length === 0 ? (
                    <div style={{ padding:'10px 12px', fontSize:11, color:T.muted }}>
                      아직 학습된 규칙이 없습니다. 피드백을 분석하면 여기에 쌓입니다.
                    </div>
                  ) : (
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                      <thead>
                        <tr style={{ background:T.bg }}>
                          {['항목','학습값','강도','누적횟수'].map(h => (
                            <th key={h} style={{ padding:'5px 10px', textAlign:'left', fontWeight:600,
                              color:T.muted, borderBottom:`1px solid ${T.border}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeRules.map(([key, rule]) => (
                          <tr key={key} style={{ borderBottom:`1px solid ${T.bg}` }}>
                            <td style={{ padding:'5px 10px', color:T.ink, fontWeight:500 }}>
                              {varLabel[key] || key}
                            </td>
                            <td style={{ padding:'5px 10px', color:T.ink, fontFamily:T.mono }}>
                              {key === 'font_style' ? (rule.value === 'gothic' ? '고딕' : '명조')
                               : key === 'column_count' ? `${rule.value}단`
                               : typeof rule.value === 'number' ? `${rule.value > 0 ? '+' : ''}${Math.round(rule.value)}%`
                               : String(rule.value)}
                            </td>
                            <td style={{ padding:'5px 10px', color: confColor[rule.confidence], fontWeight:600 }}>
                              {confLabel[rule.confidence]}
                            </td>
                            <td style={{ padding:'5px 10px', color:T.muted }}>
                              {rule.history?.length || 0}회
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })()}
            </div>
          )}

          {/* 실행 버튼 */}
          <div style={{ padding:"16px 20px", borderTop:`1px solid ${T.border}`, flexShrink:0 }}>
            {!apiKey && (
              <div style={{ marginBottom:10, fontSize:12, color:T.muted, padding:"8px 12px",
                background:T.bg, borderRadius:3, border:`1px solid ${T.border}`, lineHeight:1.6 }}>
                우측 상단 <strong style={{ color:T.ink }}>API 키 입력</strong>을 먼저 완료하세요.<br/>
                <span style={{ fontSize:11 }}>console.anthropic.com에서 발급 (claude.ai 계정으로 로그인)</span>
              </div>
            )}
            <button onClick={run} disabled={isRunning || !matchText || !apiKey}
              style={{ width:"100%", padding:"12px", fontSize:13, fontWeight:600,
                border:"none", borderRadius:3,
                background: (isRunning || !matchText || !apiKey) ? T.border : T.ink,
                color: (isRunning || !matchText || !apiKey) ? T.muted : "#fff",
                cursor: (isRunning || !matchText || !apiKey) ? "not-allowed" : "pointer",
                display:"flex", alignItems:"center", justifyContent:"center", gap:10,
                transition:"all 150ms" }}>
              {isRunning ? (
                <>
                  <div style={{ width:14, height:14, border:"2px solid rgba(255,255,255,0.3)",
                    borderTopColor:"#fff", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
                  분석 및 스타일 생성 중…
                </>
              ) : "조판 스타일 생성하기"}
            </button>
            {err && (
              <div style={{ marginTop:8, fontSize:12, color:"#555", padding:"7px 10px",
                background:T.bg, borderRadius:3, border:`1px solid ${T.border}` }}>
                {err}
              </div>
            )}
          </div>
        </div>

        {/* ── 중앙: 결과 패널 ─────────────────────────────────────── */}
        <div style={{ display:"flex", flexDirection:"column", overflow:"hidden", background:T.bg }}>

          {/* 진행 상태 */}
          {isRunning && runLog.length > 0 && (
            <div style={{ padding:"12px 24px", borderBottom:`1px solid ${T.border}`,
              background:T.surface, flexShrink:0 }}>
              <div style={{ display:"flex", gap:20, alignItems:"center" }}>
                {runLog.map((entry, i) => (
                  <div key={entry.id} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12 }}>
                    {entry.status === "running" ? (
                      <div style={{ width:8, height:8, border:"1.5px solid #CCC",
                        borderTopColor:T.ink, borderRadius:"50%",
                        animation:"spin 0.8s linear infinite", flexShrink:0 }} />
                    ) : entry.status === "done" ? (
                      <div style={{ width:8, height:8, borderRadius:"50%", background:T.ink }} />
                    ) : (
                      <div style={{ width:8, height:8, borderRadius:"50%", background:T.muted }} />
                    )}
                    <span style={{ color: entry.status === "running" ? T.ink : T.muted,
                      fontWeight: entry.status === "running" ? 600 : 400 }}>
                      {entry.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isDone && !isRunning ? (
            /* ── 빈 상태 ── */
            <div style={{ flex:1, display:"flex", flexDirection:"column",
              alignItems:"center", justifyContent:"center", gap:20, padding:48 }}>
              <div style={{ width:40, height:40, border:`1px solid ${T.border}`,
                borderRadius:4, opacity:0.4 }} />
              <div style={{ lineHeight:1.8, width:"100%" }}>
                <div style={{ fontSize:15, fontWeight:600, color:T.ink, marginBottom:8 }}>
                  텍스트를 입력하고 조판 스타일 생성하기를 클릭하세요
                </div>
                <div style={{ fontSize:12, color:T.muted, lineHeight:1.8 }}>
                  본문을 분석해 253개 편집 디자인 레퍼런스 중 가장 적합한 스타일을 선택하고, XeLaTeX 조판 파일을 자동으로 만들어 드립니다.
                </div>
              </div>
              <div style={{ padding:"16px 24px", background:T.surface, borderRadius:3,
                border:`1px solid ${T.border}`, fontSize:12, color:T.muted, lineHeight:2, width:"100%" }}>
                <strong style={{ color:T.ink, display:"block", marginBottom:4 }}>작동 방식</strong>
                ① 입력한 텍스트의 장르·형태 분석<br/>
                ② 253개 레퍼런스에서 최적 스타일 선택<br/>
                ③ 판형·여백·서체·단 구성 자동 결정<br/>
                ④ TeXworks·TeX Live·Overleaf용 LaTeX 파일 생성 (XeLaTeX)
              </div>
            </div>
          ) : isDone && (
            <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>

              {/* ── 선택된 패키지 카드 ── */}
              <div style={{ padding:"18px 24px 16px", borderBottom:`1px solid ${T.border}`,
                background:T.surface, flexShrink:0 }}>

                {/* 패키지명 + 복사 버튼 */}
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:16 }}>
                  <div>
                    <div style={{ fontSize:15, fontWeight:600, color:T.ink, lineHeight:1.3, marginBottom:3 }}>
                      {pkg.t}
                    </div>
                    <div style={{ fontSize:11, color:T.muted }}>
                      {pkg.g} · {pkg.pub_type}
                      {pkg.designer && pkg.designer !== '-' &&
                        <span style={{ color:T.ink }}> · {pkg.designer}</span>}
                    </div>
                  </div>
                  <button onClick={() => {
                    setLockedStyleId(selIdx);
                    setSelectionMode('ref-locked');
                  }} style={{ padding:"6px 12px", fontSize:11, fontWeight:500, whiteSpace:"nowrap",
                    border:`1px solid ${T.border}`, borderRadius:3,
                    background: selectionMode === 'ref-locked' && lockedStyleId === selIdx ? T.ink : T.surface,
                    color: selectionMode === 'ref-locked' && lockedStyleId === selIdx ? '#fff' : T.ink,
                    cursor:"pointer", transition:"all 150ms", flexShrink:0 }}>
                    {selectionMode === 'ref-locked' && lockedStyleId === selIdx ? '고정됨 ✓' : '이 스타일 고정'}
                  </button>
                  <button onClick={copy}
                    style={{ padding:"6px 12px", fontSize:11, fontWeight:500, whiteSpace:"nowrap",
                      border:`1px solid ${T.border}`, borderRadius:3,
                      background:copied ? T.ink : T.surface,
                      color:copied ? "#fff" : T.ink, cursor:"pointer", transition:"all 150ms",
                      flexShrink:0 }}>
                    {copied ? "복사됨 ✓" : "전체 복사"}
                  </button>
                </div>

                {/* 스펙 칩 — 전체 동일 스타일 */}
                <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:10 }}>
                  {[
                    ["판형", `${pkg.f.w}×${pkg.f.h}mm`],
                    ["본문", `${displayBodySize || pkg.b.크기}pt / ${pkg.b.행간}pt`],
                    ["단", (() => {
                      const lt = pkg.layout_type || '';
                      const bodyM = lt.match(/본문\s*(\d+)[단열]/);
                      const noteM = lt.match(/주석\s*(\d+)[단열]/);
                      if (bodyM && noteM) return `본문 ${bodyM[1]}단 + 주석 ${noteM[1]}단`;
                      if (bodyM) return `본문 ${bodyM[1]}단`;
                      return pkg.c.구성;
                    })()],
                    ["서체", pkg.ty.분류?.split(' ')[0] || null],
                    ["정렬", pkg.align_body?.replace(' 정렬','') || null],
                    ["여백", `${pkg.m.상}/${pkg.m.하} · ${pkg.m.안}/${pkg.m.밖}`],
                    ["면주", pkg.running !== '-' ? pkg.running : null],
                    ["각주", pkg.footnote !== '-' ? pkg.footnote : null],
                    ["쪽번호", pkg.pn || null],
                    ["소제목", pkg.subheading !== '-' ? pkg.subheading : null],
                    ["자간", (() => { const v = String(pkg.b.자간); return v && v !== '0' ? v : null; })()],
                  ].filter(([,v]) => v).map(([label, value]) => (
                    <div key={label} style={{
                      display:"inline-flex", alignItems:"center", gap:4,
                      padding:"4px 8px", borderRadius:3,
                      border:`1px solid ${T.border}`, background:T.bg,
                    }}>
                      <span style={{ fontSize:10, fontWeight:500, color:T.muted }}>{label}</span>
                      <span style={{ fontSize:11, fontWeight:600, color:T.ink,
                        fontFamily:T.mono }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── 출력 탭 ── */}
              <div style={{ display:"flex", borderBottom:`1px solid ${T.border}`,
                padding:"0 24px", background:T.surface, flexShrink:0 }}>
                {[
                  ["intent","작업 의도"],
                  ["revlog","수정 기록"],
                  ["final","최종 파일"],
                  ["sty","스타일 파일"],
                ].map(([key,label]) => (
                  <button key={key} onClick={() => setTab(key)}
                    style={{ padding:"10px 16px", fontSize:13, fontWeight:tab===key?700:400,
                      border:"none", borderBottom:`2px solid ${tab===key ? T.ink : "transparent"}`,
                      background:"transparent", color:tab===key ? T.ink : T.muted,
                      cursor:"pointer", marginBottom:-1 }}>
                    {label}
                  </button>
                ))}
              </div>

              {/* 탭 콘텐츠 */}
              <div style={{ flex:1, overflowY:"auto" }}>

                {/* 작업 의도 */}
                {tab === "intent" && (
  <div style={{ padding:"20px 24px" }}>
    {!structuredReason && !pkg ? (
      <div style={{ color:T.muted, fontSize:13 }}>스타일을 먼저 생성하세요.</div>
    ) : (() => {
      const sr = structuredReason || {};
      const SectionLabel = ({ text }) => (
        <div style={{ fontSize:9, fontWeight:700, color:T.muted,
          textTransform:"uppercase", letterSpacing:"0.09em", marginBottom:6 }}>
          {text}
        </div>
      );
      const Divider = () => (
        <div style={{ borderTop:`1px solid ${T.border}`, margin:"14px 0" }} />
      );
      return (
        <div style={{ display:"flex", flexDirection:"column" }}>

          {/* 0. 선택 모드 배지 */}
          {(() => {
            const modeLabel = selectionMode === 'genre-forced'
              ? `장르 강제${hint ? ` (${hint})` : ''}`
              : selectionMode === 'ref-locked'
              ? `레퍼런스 고정${lockedStyleId !== null ? ` — ${DB[lockedStyleId]?.t?.slice(0,20)}` : ''}`
              : '자동 추천';
            const modeColor = selectionMode === 'auto'
              ? { bg:'#f0f4ff', text:'#3b5bdb' }
              : selectionMode === 'genre-forced'
              ? { bg:'#fff4e6', text:'#d9480f' }
              : { bg:'#f3fce4', text:'#2f9e44' };
            return (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:9, fontWeight:700, color:T.muted,
                  textTransform:"uppercase", letterSpacing:"0.09em", marginBottom:6 }}>
                  선택 모드
                </div>
                <span style={{ display:"inline-block", padding:"3px 10px", borderRadius:12,
                  fontSize:12, fontWeight:600,
                  background: modeColor.bg, color: modeColor.text }}>
                  {modeLabel}
                </span>
              </div>
            );
          })()}
          <Divider />

          {/* 1. 레퍼런스 선정 */}
          {sr.reference_reason && <>
            <SectionLabel text="레퍼런스 선정" />
            <div style={{ fontSize:13, color:T.ink, lineHeight:1.75, paddingBottom:14 }}>{sr.reference_reason}</div>
            <Divider />
          </>}

          {/* 2. 내용 매칭 */}
          {sr.content_match && <>
            <SectionLabel text="내용 매칭" />
            <div style={{ fontSize:13, color:T.ink, lineHeight:1.75, paddingBottom:14 }}>{sr.content_match}</div>
            <Divider />
          </>}

          {/* 3. Design Concept */}
          {sr.design_concept?.length > 0 && <>
            <SectionLabel text="Design Concept / 디자인 개념" />
            <ul style={{ margin:"0 0 14px 0", padding:"0 0 0 16px" }}>
              {sr.design_concept.map((c, i) => (
                <li key={i} style={{ fontSize:13, color:T.ink, lineHeight:1.75 }}>{c}</li>
              ))}
            </ul>
            <Divider />
          </>}

          {/* 4. Design Task */}
          {sr.design_task?.length > 0 && <>
            <SectionLabel text="Design Task / 디자인 과제" />
            <ul style={{ margin:"0 0 14px 0", padding:"0 0 0 16px" }}>
              {sr.design_task.map((t, i) => (
                <li key={i} style={{ fontSize:13, color:T.ink, lineHeight:1.75 }}>{t}</li>
              ))}
            </ul>
            <Divider />
          </>}

          {/* 5. Visual Element */}
          {sr.visual_element?.length > 0 && <>
            <SectionLabel text="Visual Element / 시각 요소" />
            <ul style={{ margin:"0 0 14px 0", padding:"0 0 0 16px" }}>
              {sr.visual_element.map((v, i) => (
                <li key={i} style={{ fontSize:13, color:T.ink, lineHeight:1.75 }}>{v}</li>
              ))}
            </ul>
            <Divider />
          </>}

          {/* 5b. 레퍼런스 반영 내역 */}
          {sr.style_diff && <>
            <SectionLabel text="레퍼런스 반영 내역" />
            <div style={{ display:'flex', flexDirection:'column', gap:4, marginBottom:14 }}>
              {/* 수정된 항목 */}
              {sr.style_diff.modified?.map((r, i) => (
                <div key={`m${i}`} style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:12, lineHeight:1.65 }}>
                  <span style={{ flexShrink:0, color:'#d9480f', fontWeight:700, marginTop:1 }}>→</span>
                  <div>
                    <span style={{ fontWeight:600, color:T.ink }}>{r.label}</span>
                    <span style={{ fontFamily:T.mono, fontSize:11, color:T.muted, marginLeft:6 }}>
                      {r.ref} → {r.applied}
                    </span>
                    {r.reason && <span style={{ color:T.muted }}> — {r.reason}</span>}
                  </div>
                </div>
              ))}
              {/* 유지된 항목 */}
              {sr.style_diff.kept?.length > 0 && (
                <div style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:12, lineHeight:1.65, marginTop: sr.style_diff.modified?.length > 0 ? 4 : 0 }}>
                  <span style={{ flexShrink:0, color:'#2f9e44', fontWeight:700, marginTop:1 }}>✓</span>
                  <span style={{ color:T.muted }}>유지: {sr.style_diff.kept.join(' · ')}</span>
                </div>
              )}
            </div>
            <Divider />
          </>}

          {/* 6. Evidence Map */}
          {evidenceMap && evidenceMap.length > 0 && <>
            <SectionLabel text="본문 근거 / Evidence Map" />
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:14 }}>
              {evidenceMap.map((e, i) => (
                <div key={i} style={{ background:T.bg, border:`1px solid ${T.border}`,
                  borderRadius:3, padding:"10px 12px" }}>
                  <div style={{ fontSize:12, color:T.ink, fontStyle:"italic",
                    marginBottom:4 }}>"{e.textSpan}"</div>
                  <div style={{ fontSize:11, color:T.muted, lineHeight:1.6 }}>
                    → {e.interpretation} → {e.affectedVariables?.join(' / ')}
                  </div>
                </div>
              ))}
            </div>
            <Divider />
          </>}
          {evidenceMap === null && latex && (
            <div style={{ marginBottom:14 }}>
              <SectionLabel text="본문 근거 / Evidence Map" />
              <div style={{ fontSize:12, color:T.muted }}>분석 중…</div>
            </div>
          )}

          {/* 7. DB 기반 설계 근거 */}
          {[
            ["서체 선택", pkg?.why_font],
            ["여백 설계", pkg?.why_margin],
            ["자간 설정", pkg?.why_tracking],
          ].filter(([,v]) => v).map(([label, value], i, arr) => (
            <div key={label}>
              <SectionLabel text={label} />
              <div style={{ fontSize:13, color:T.ink, lineHeight:1.75,
                paddingBottom: i < arr.length - 1 ? 14 : 0 }}>{value}</div>
              {i < arr.length - 1 && <Divider />}
            </div>
          ))}

          {/* 탈락 패키지 */}
          {sr.rejected?.length > 0 && (
            <div style={{ paddingTop:14, marginTop:4, borderTop:`1px solid ${T.border}` }}>
              <SectionLabel text="검토 후 제외" />
              {sr.rejected.map((r, i) => (
                <div key={i} style={{ fontSize:12, color:T.muted, lineHeight:1.7 }}>
                  <span style={{ color:T.ink, fontWeight:600 }}>{DB[r.i]?.t?.slice(0,20)}</span>
                  {" — "}{r.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    })()}
  </div>
)}

                {/* 수정 기록 탭 */}
                {tab === "revlog" && (
                  <div style={{ padding:"20px 24px" }}>
                    {revisionLog.length === 0 ? (
                      <div style={{ color:T.muted, fontSize:13 }}>스타일을 먼저 생성하세요.</div>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                        {revisionLog.map((rev, ri) => (
                          <div key={rev.id} style={{ border:`1px solid ${T.border}`, borderRadius:4,
                            padding:"14px 16px", background:T.bg }}>
                            <div style={{ display:"flex", justifyContent:"space-between",
                              alignItems:"flex-start", marginBottom:10 }}>
                              <div>
                                <span style={{ fontSize:11, fontWeight:700, color:T.ink }}>
                                  Revision {ri}
                                </span>
                                <span style={{ fontSize:10, color:T.muted, marginLeft:8 }}>
                                  {rev.type === 'initial_generation' ? '초기 생성' : '사용자 수정'}
                                </span>
                              </div>
                              <span style={{ fontSize:10, color:T.muted }}>
                                {rev.timestamp ? new Date(rev.timestamp).toLocaleTimeString('ko-KR') : ''}
                              </span>
                            </div>
                            {rev.type === 'initial_generation' && (
                              <div style={{ fontSize:12, lineHeight:1.7, color:T.ink }}>
                                {rev.selectedReference?.title && (
                                  <div><span style={{ color:T.muted }}>레퍼런스</span> {rev.selectedReference.title}</div>
                                )}
                                {rev.interpretation?.designConcept?.length > 0 && (
                                  <div><span style={{ color:T.muted }}>개념</span> {rev.interpretation.designConcept.join(' / ')}</div>
                                )}
                                {rev.interpretation?.designTask?.length > 0 && (
                                  <div><span style={{ color:T.muted }}>과제</span> {rev.interpretation.designTask.join(' / ')}</div>
                                )}
                                {rev.variables?.bodySize && (
                                  <div><span style={{ color:T.muted }}>본문</span> {rev.variables.bodySize} / {rev.variables.leading} 행간</div>
                                )}
                              </div>
                            )}
                            {rev.type === 'user_refinement' && (
                              <div style={{ fontSize:12, lineHeight:1.7 }}>
                                {rev.userRequest && (
                                  <div style={{ fontStyle:"italic", color:T.ink, marginBottom:6 }}>"{rev.userRequest}"</div>
                                )}
                                {rev.systemInterpretation?.designTask && (
                                  <div style={{ color:T.muted, marginBottom:6 }}>해석: {rev.systemInterpretation.designTask}</div>
                                )}
                                {rev.patch?.map((p, pi) => (
                                  <div key={pi} style={{ display:"flex", gap:6, alignItems:"center", marginBottom:3 }}>
                                    <span style={{ color:T.muted, fontSize:11 }}>{p.target}</span>
                                    <span style={{ color:'#c44', fontSize:11 }}>{p.before}</span>
                                    <span style={{ color:T.muted, fontSize:11 }}>→</span>
                                    <span style={{ color:'#2d7', fontSize:11 }}>{p.after}</span>
                                  </div>
                                ))}
                                <div style={{ marginTop:6 }}>
                                  <span style={{
                                    fontSize:10, padding:"2px 8px", borderRadius:2,
                                    background: rev.userDecision === 'accepted' ? '#e6f4ea' : '#f5f5f5',
                                    color: rev.userDecision === 'accepted' ? '#2d7d46' : T.muted,
                                  }}>
                                    {rev.userDecision === 'accepted' ? '수락됨' : '검토 중'}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                        <button onClick={() => {
                          const blob = new Blob([JSON.stringify(revisionLog, null, 2)], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `revision_log_${new Date().toISOString().slice(0,10)}.json`;
                          document.body.appendChild(a); a.click();
                          document.body.removeChild(a); URL.revokeObjectURL(url);
                        }} style={{ padding:"8px 16px", fontSize:12, fontWeight:600,
                          border:`1px solid ${T.border}`, borderRadius:3,
                          background:T.surface, color:T.ink, cursor:"pointer",
                          alignSelf:"flex-start" }}>
                          수정 기록 Export (JSON)
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 최종 파일 */}
                {tab === "final" && latex && (
                  <div style={{ padding:"20px 24px" }}>
                    {/* 검증 패널 */}
                    {(() => {
                      const { errors: ve, warnings: vw } = validateLatexExport({ mainTex: latex, sty: styCode || '', layoutConfig: styleConfig });
                      const hasParacol = /\\begin\{paracol\}/.test(latex);
                      const switchCount = (latex.match(/\\switchcolumn(?!\*)/g) || []).length;
                      const noteNums = [...latex.matchAll(/\\textsuperscript\{(\d+)\}/g)].map(m => m[1]);
                      const allMarkersPresent = noteNums.length === 0 || noteNums.every(n => latex.includes(`\\ImpFN{${n}}`));
                      const hasPageNum = /\\thepage/.test(latex) || /\\pagestyle\{imprint\}/.test(latex);
                      const hasRevLog = revisionLog.length > 0;

                      const groups = [
                        {
                          label: '파일 구조',
                          items: [
                            { ok: true, label: 'main.tex 생성됨' },
                            { ok: !!styCode, label: 'imprint-style.sty 생성됨' },
                            { ok: (latex.match(/\\documentclass/g)||[]).length === 1, label: '\\documentclass 1회' },
                            { ok: (latex.match(/\\begin\{document\}/g)||[]).length === 1, label: '\\begin{document} 1회' },
                            { ok: (latex.match(/\\end\{document\}/g)||[]).length === 1, label: '\\end{document} 1회' },
                          ]
                        },
                        {
                          label: '레이아웃',
                          items: [
                            { ok: !hasParacol || switchCount >= 1, label: hasParacol ? `가변 그리드 적용됨 (switchcolumn ${switchCount}회)` : '전체 폭 레이아웃' },
                            { ok: allMarkersPresent, warn: noteNums.length > 0 && !allMarkersPresent, label: noteNums.length === 0 ? '주석 없음' : allMarkersPresent ? `주석 마커 연결됨 (${noteNums.length}개)` : `주석 마커 불일치 (${noteNums.length}개)` },
                            { ok: hasPageNum, label: '쪽번호 생성됨' },
                          ]
                        },
                        {
                          label: '검증 오류',
                          items: ve.length === 0
                            ? [{ ok: true, label: '오류 없음' }]
                            : ve.map(e => ({ ok: false, label: e })),
                        },
                        {
                          label: '경고',
                          items: vw.length === 0
                            ? [{ ok: true, label: '경고 없음' }]
                            : vw.map(w => ({ ok: true, warn: true, label: w })),
                        },
                        {
                          label: '수정 기록',
                          items: [
                            { ok: hasRevLog, label: hasRevLog ? `수정 기록 저장됨 (Revision ${revisionLog.length - 1}까지)` : '수정 기록 없음 (스타일 재생성 후 생성됨)' },
                          ]
                        },
                      ];

                      return (
                        <div style={{ marginBottom:14, padding:"12px 16px", background:T.bg,
                          borderRadius:3, border:`1px solid ${T.border}`, fontSize:12 }}>
                          <div style={{ fontWeight:600, color:T.ink, marginBottom:10 }}>Export 검증</div>
                          {groups.map(g => (
                            <div key={g.label} style={{ marginBottom:8 }}>
                              <div style={{ fontSize:10, fontWeight:700, color:T.muted,
                                textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>
                                {g.label}
                              </div>
                              <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                                {g.items.map((c, i) => (
                                  <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:6 }}>
                                    <span style={{ flexShrink:0, color: c.warn ? '#b45309' : c.ok ? '#166534' : '#991b1b', fontWeight:700 }}>
                                      {c.warn ? '⚠' : c.ok ? '✅' : '❌'}
                                    </span>
                                    <span style={{ color: c.warn ? '#b45309' : c.ok ? T.ink : '#991b1b', lineHeight:1.5 }}>
                                      {c.label}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:T.ink }}>
                          main.tex
                        </div>
                        <div style={{ fontSize:12, color:T.muted, marginTop:2, lineHeight:1.7 }}>
                          <strong style={{ color:T.ink }}>XeLaTeX 전용</strong> — pdfLaTeX 미지원 (fontspec 사용)<br/>
                          imprint-style.sty와 함께 같은 폴더에 두고 컴파일하세요.
                        </div>
                      </div>
                      <div style={{ marginLeft:"auto", display:"flex", gap:6, flexShrink:0 }}>
                        <button onClick={() => downloadFile(latex, 'main.tex')}
                          style={{ padding:"7px 14px", fontSize:12, fontWeight:600,
                            border:`1px solid ${T.border}`, borderRadius:3, whiteSpace:"nowrap",
                            background:T.surface, color:T.ink, cursor:"pointer",
                            transition:"all 150ms" }}>
                          ⬇ 다운로드
                        </button>
                        <button onClick={copy}
                          style={{ padding:"7px 14px", fontSize:12, fontWeight:600,
                            border:`1px solid ${T.border}`, borderRadius:3, whiteSpace:"nowrap",
                            background:copied ? T.ink : T.surface,
                            color:copied ? "#fff" : T.ink, cursor:"pointer",
                            transition:"all 150ms" }}>
                          {copied ? "복사됨 ✓" : "전체 복사"}
                        </button>
                      </div>
                    </div>
                    <pre style={{ fontFamily:T.mono, fontSize:12, lineHeight:1.65,
                      background:T.surface, padding:"16px 20px", borderRadius:3,
                      border:`1px solid ${T.border}`, whiteSpace:"pre-wrap",
                      wordBreak:"break-all", color:T.ink, margin:0 }}>
                      {latex}
                    </pre>
                    <div style={{ marginTop:12, padding:"12px 16px", background:T.surface,
                      borderRadius:3, border:`1px solid ${T.border}`, fontSize:12,
                      color:T.muted, lineHeight:2 }}>
                      <strong style={{ color:T.ink, display:"block", marginBottom:2 }}>로컬 LaTeX (TeXworks / TeX Live)</strong>
                      폴더 구조: <code style={{ fontFamily:T.mono, background:T.bg, padding:"1px 4px", borderRadius:3, fontSize:11 }}>작업폴더/ main.tex · imprint-style.sty · fonts/</code><br/>
                      1) main.tex + imprint-style.sty → 작업 폴더<br/>
                      2) 필요한 폰트 파일(.ttf/.otf) → <strong style={{ color:T.ink }}>fonts/</strong> 하위 폴더<br/>
                      3) TeXworks에서 main.tex 열기 → <strong style={{ color:T.ink }}>XeLaTeX</strong> → 컴파일
                      <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${T.border}`, color:T.muted }}>
                        <strong style={{ display:"block", marginBottom:2 }}>Missing character 경고가 계속되면</strong>
                        기존 <code style={{ fontFamily:T.mono, background:T.bg, padding:"1px 4px", borderRadius:3, fontSize:11 }}>main.aux · main.toc · main.out · main.log</code> 파일을 삭제한 뒤 XeLaTeX으로 다시 컴파일하세요.
                      </div>
                      <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${T.border}` }}>
                        <strong style={{ color:T.ink, display:"block", marginBottom:2 }}>Overleaf</strong>
                        1) 새 프로젝트 → main.tex + imprint-style.sty + 폰트 파일 업로드<br/>
                        2) 컴파일러 설정: <strong style={{ color:T.ink }}>XeLaTeX</strong>
                      </div>
                    </div>
                    {requiredFonts.length > 0 && (
                      <div style={{ marginTop:10, padding:"12px 16px", background:T.bg,
                        borderRadius:3, border:`1px solid ${T.border}`, fontSize:12, lineHeight:1.9 }}>
                        <strong style={{ color:T.ink, display:"block", marginBottom:4 }}>
                          필요한 폰트 파일 — <code style={{ fontFamily:T.mono, background:T.surface, padding:"1px 4px", borderRadius:3 }}>fonts/</code> 하위 폴더에 저장
                        </strong>
                        <div style={{ fontFamily:T.mono, fontSize:11, color:T.muted }}>
                          {requiredFonts.map(f => <div key={f}>{f}</div>)}
                        </div>
                        <div style={{ marginTop:6, fontSize:11, color:T.ink }}>
                          폰트 파일이 없으면 XeLaTeX이 "cannot be found" 오류를 냅니다.
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 스타일 파일 */}
                {tab === "sty" && styCode && (
                  <div style={{ padding:"20px 24px" }}>
                    <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:10 }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:T.ink }}>
                          스타일 파일 (imprint-style.sty)
                        </div>
                        <div style={{ fontSize:12, color:T.muted, marginTop:2, lineHeight:1.6 }}>
                          판형·여백·서체·단 구성 등 모든 디자인 규칙이 정의된 패키지 파일입니다.<br/>
                          이 파일 하나로 본문 길이와 관계없이 동일한 스타일이 유지됩니다.<br/>
                          <strong style={{ color:T.ink }}>사용법:</strong> main.tex과 같은 폴더에 저장.
                          main.tex에 <code style={{ fontFamily:T.mono, background:T.bg, padding:"1px 5px", borderRadius:3 }}>{"\\usepackage{imprint-style}"}</code> 이미 포함됨.<br/>
                          <span style={{ color:T.ink, fontWeight:600 }}>XeLaTeX 전용</span> — fontspec 기반, pdfLaTeX 미지원
                        </div>
                      </div>
                      <div style={{ marginLeft:"auto", display:"flex", gap:6, flexShrink:0 }}>
                        <button onClick={() => downloadFile(styCode, 'imprint-style.sty')}
                          style={{ padding:"7px 14px", fontSize:12, fontWeight:600,
                            border:`1px solid ${T.border}`, borderRadius:3, whiteSpace:"nowrap",
                            background:T.surface, color:T.ink, cursor:"pointer",
                            transition:"all 150ms" }}>
                          ⬇ 다운로드
                        </button>
                        <button onClick={() => {
                            const done = () => { setCopiedSty(true); setTimeout(() => setCopiedSty(false), 2000); };
                            if (navigator.clipboard && window.isSecureContext) {
                              navigator.clipboard.writeText(styCode).then(done).catch(() => { _fallbackCopy(styCode); done(); });
                            } else { _fallbackCopy(styCode); done(); }
                          }}
                          style={{ padding:"7px 14px", fontSize:12, fontWeight:600,
                            border:`1px solid ${T.border}`, borderRadius:3, whiteSpace:"nowrap",
                            background:copiedSty ? T.ink : T.surface,
                            color:copiedSty ? "#fff" : T.ink, cursor:"pointer", transition:"all 150ms" }}>
                          {copiedSty ? "복사됨 ✓" : "복사"}
                        </button>
                      </div>
                    </div>
                    <pre style={{ fontFamily:T.mono, fontSize:12, lineHeight:1.65,
                      background:T.surface, padding:"16px 20px", borderRadius:3,
                      border:`1px solid ${T.border}`, whiteSpace:"pre-wrap",
                      wordBreak:"break-all", color:T.ink, margin:0 }}>
                      {styCode}
                    </pre>
                  </div>
                )}

                {tab === "final" && !latex && (
                  <div style={{ padding:32, color:T.muted, fontSize:13 }}>아직 생성된 파일이 없습니다.</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── 우: 채팅 (스타일 조정) ──────────────────────────────── */}
        <div style={{ borderLeft:`1px solid ${T.border}`, display:"flex",
          flexDirection:"column", background:T.surface, overflow:"hidden" }}>

          <div style={{ padding:"14px 16px", borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
            <div style={{ fontSize:12, fontWeight:600, color:T.ink }}>스타일 조정</div>
            <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>
              생성 결과를 자연어로 수정 요청하세요
            </div>
          </div>

          {/* 빠른 수정 버튼 — 제거됨 */}

          {/* 채팅 메시지 */}
          <div style={{ flex:1, overflowY:"auto", padding:"12px 16px",
            display:"flex", flexDirection:"column", gap:10 }}>
            {refineHistory.length === 0 ? (
              <div style={{ fontSize:12, color:T.muted, textAlign:"center",
                paddingTop:24, lineHeight:1.8 }}>
                {isDone
                  ? "스타일 생성 완료.\n수정이 필요하면 아래에 입력하세요."
                  : "조판 스타일을 먼저 생성하세요."}
              </div>
            ) : refineHistory.map((msg, i) => (
              <div key={i} style={{
                padding:"10px 12px", borderRadius:3, fontSize:12, lineHeight:1.6,
                background: msg.role === "user" ? T.ink : T.bg,
                color: msg.role === "user" ? "#fff" : T.ink,
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                maxWidth:"92%",
                border: msg.role === "user" ? "none" : `1px solid ${T.border}`,
              }}>
                {msg.role === 'user' && msg.intent && msg.intent !== 'ambiguous' && (
                  <div style={{
                    display:'inline-block', fontSize:9, fontWeight:700,
                    padding:'1px 5px', borderRadius:2, marginBottom:4,
                    background: msg.intent === 'question' ? '#1a5276' : '#1a4a1a',
                    color: '#fff', letterSpacing:'0.05em',
                  }}>
                    {msg.intent === 'question' ? '질문' : '수정'}
                  </div>
                )}
                {msg.role === 'assistant' ? (
                  <div>
                    {msg.isStructural ? (
                      // 구조 변경 안내
                      <span style={{color:'#e67e22', fontSize:12}}>{msg.chatContent}</span>
                    ) : msg.isError ? (
                      // 오류
                      <span style={{color:'#c0392b', fontSize:12}}>{msg.chatContent}</span>
                    ) : (
                      <>
                        {/* 인텐트 레이블 (assistant 응답 상단) */}
                        {msg.intent && !msg.isStructural && !msg.isError && (
                          <div style={{
                            display:'inline-block', fontSize:9, fontWeight:700,
                            padding:'1px 5px', borderRadius:2, marginBottom:6,
                            background: msg.intent === 'question'
                              ? T.border
                              : (msg.codeChanged ? '#1a4a1a' : T.border),
                            color: msg.intent === 'question'
                              ? T.muted
                              : (msg.codeChanged ? '#6fcf97' : T.muted),
                            letterSpacing:'0.05em',
                          }}>
                            {msg.intent === 'question'
                              ? '답변'
                              : msg.codeChanged ? '✓ 수정 완료' : '수정 불가'}
                          </div>
                        )}
                        {/* 자연어 응답 */}
                        {msg.chatContent && (
                          <div style={{fontSize:12, lineHeight:1.7, whiteSpace:'pre-wrap', marginBottom: msg.changes ? 8 : 0}}>
                            {msg.chatContent}
                          </div>
                        )}
                        {/* 수치 변경 요약 (directDiffs) */}
                        {msg.changes && (
                          <div style={{borderTop: msg.chatContent ? `1px solid ${T.border}` : 'none',
                            paddingTop: msg.chatContent ? 7 : 0}}>
                            {msg.changes.split('\n').filter(l => l.trim()).map((line, li) => {
                              const raw = line.replace(/^[-•]\s*/, '');
                              const parts = raw.split(/\s*→\s*/);
                              if (parts.length >= 2) {
                                const colonIdx = parts[0].lastIndexOf(':');
                                const label = colonIdx >= 0 ? parts[0].slice(0, colonIdx).trim() : parts[0].trim();
                                const oldVal = colonIdx >= 0 ? parts[0].slice(colonIdx+1).trim() : '';
                                const newVal = parts[1].trim();
                                return (
                                  <div key={li} style={{fontSize:11, lineHeight:1.7, marginTop: li > 0 ? 3 : 0}}>
                                    <span style={{color:T.muted}}>{label}</span>
                                    <span style={{color:'#bbb', margin:'0 3px'}}>:</span>
                                    {oldVal && <span style={{color:'#c0392b', textDecoration:'line-through', marginRight:4}}>{oldVal}</span>}
                                    <span style={{color:'#888', marginRight:3}}>→</span>
                                    <span style={{color:'#2d7d46', fontWeight:700}}>{newVal}</span>
                                  </div>
                                );
                              }
                              return <div key={li} style={{fontSize:11, color:T.muted, marginTop: li > 0 ? 3 : 0}}>{raw}</div>;
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : msg.content}
              </div>
            ))}
            {/* 스트리밍 중 실시간 말풍선 */}
            {refineLoading && (
              <div style={{ padding:"10px 12px", borderRadius:3, fontSize:12, lineHeight:1.7,
                background:T.bg, border:`1px solid ${T.border}`, color:T.ink,
                alignSelf:"flex-start", maxWidth:"92%", whiteSpace:"pre-wrap" }}>
                {streamingText
                  ? <>{streamingText}<span style={{
                      display:"inline-block", width:2, height:'1em',
                      background:T.ink, marginLeft:2, verticalAlign:'text-bottom',
                      animation:"blink 1s step-end infinite",
                    }} /></>
                  : <span style={{color:T.muted, display:'flex', alignItems:'center', gap:6}}>
                      <span style={{ width:8, height:8, border:"1.5px solid #ccc",
                        borderTopColor:T.ink, borderRadius:"50%", display:'inline-block',
                        animation:"spin 0.8s linear infinite" }} />
                      생각 중…
                    </span>
                }
              </div>
            )}
          </div>

          {/* 입력창 */}
          <div style={{ padding:"12px", borderTop:`1px solid ${T.border}`, flexShrink:0 }}>
            <div style={{ display:"flex", gap:6 }}>
              <textarea
                value={refineInput} rows={2}
                onChange={e => setRefineInput(e.target.value)}
                disabled={!isDone || loading || refineLoading}
                placeholder={isDone ? "수정 사항을 입력하세요…" : "먼저 조판 스타일을 생성하세요"}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (refineInput.trim() && !refineLoading) refine();
                  }
                }}
                style={{ flex:1, padding:"8px 10px", fontSize:12,
                  border:`1px solid ${T.border}`, borderRadius:3,
                  background: (!isDone || loading || refineLoading) ? T.bg : T.surface,
                  color:T.ink, lineHeight:1.5, resize:"none" }}
              />
              <button onClick={refine} disabled={!isDone || loading || refineLoading || !refineInput.trim()}
                style={{ padding:"0 14px", fontSize:12, fontWeight:600,
                  border:"none", borderRadius:3,
                  background: (!isDone || loading || refineLoading || !refineInput.trim()) ? T.border : T.ink,
                  color: (!isDone || loading || refineLoading || !refineInput.trim()) ? T.muted : "#fff",
                  cursor: (!isDone || loading || refineLoading || !refineInput.trim()) ? "not-allowed" : "pointer" }}>
                {refineLoading ? "처리 중…" : "전송"}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

# Imprint 실험 탭 Plan E-B: Claude API 분석 + CSV/MD 다운로드

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실험 탭 "피드백 분석하기" 버튼에 Claude API 호출을 연결하고, 일치율·차이점·다음 규칙을 UI에 표시한 뒤 CSV/MD로 다운로드한다.

**Architecture:** `src/App.jsx` 단일 파일. 기존 `experimentAnalysis` state에 분석 결과 저장. `_EXPERIMENT_STORE` (module-level 객체)에 실험 로그 누적. 다운로드는 브라우저 Blob API. API 호출은 기존 `/anthropic/v1/messages` 프록시 재사용.

**Tech Stack:** React 19, Vite 8, inline CSS (T 토큰), Anthropic Messages API (claude-sonnet-4-6)

---

## 현황 (Plan E-A 완료 기준)

| 항목 | 상태 |
|------|------|
| `experimentFeedback`, `satisfactionScore`, `experimentAnalysis` 상태 | ✅ 있음 (line 1569~1571) |
| 실험 탭 피드백 textarea + 만족도 5단계 | ✅ 있음 (line 5225~5330) |
| "피드백 분석하기" 버튼 | ✅ 있음 (line 5308) — onClick 없음 |
| 분석 결과 UI | ❌ 플레이스홀더만 있음 (line 5320~5327) |
| 시스템 결과 요약 표시 | ❌ 없음 |
| `_EXPERIMENT_STORE` | ❌ 없음 |
| CSV/MD 다운로드 | ❌ 없음 |

---

## 파일 구조

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `src/App.jsx` | Modify | 전체 변경 대상 — 4개 위치에 추가/수정 |

변경 위치:
- **~line 37** (module-level): `_EXPERIMENT_STORE` 추가
- **~line 1571** (state 선언부): `experimentLoading` state 추가
- **~line 5225** (실험 탭 생성 후 UI): 시스템 결과 요약 + 분석 결과 UI 교체
- **~line 5308** (피드백 버튼): `onClick={analyzeExperiment}` 추가
- **~line 2040** (run() 초기화): `setExperimentLoading(false)` 리셋 추가

---

## Task 1: `_EXPERIMENT_STORE` 및 `experimentLoading` 상태 추가

**파일:** `src/App.jsx`

- [ ] **Step 1: module-level `_EXPERIMENT_STORE` 추가**

  `_LOG_STORE` 정의 바로 아래 (~line 38):
  ```js
  const _EXPERIMENT_STORE = { experiments: [] };
  function saveExperiment(exp) {
    _EXPERIMENT_STORE.experiments = [..._EXPERIMENT_STORE.experiments, exp];
  }
  function loadExperiments() { return _EXPERIMENT_STORE.experiments; }
  ```

- [ ] **Step 2: `experimentLoading` state 추가**

  `experimentAnalysis` 상태 바로 아래 (~line 1571):
  ```js
  const [experimentLoading, setExperimentLoading] = useState(false); // 분석 API 호출 중
  ```

- [ ] **Step 3: run() 초기화 블록에 리셋 추가**

  `setExperimentFeedback('')`, `setSatisfactionScore(null)`, `setExperimentAnalysis(null)` 이 있는 블록 (~line 2047) 바로 뒤에:
  ```js
  setExperimentLoading(false);
  ```

- [ ] **Step 4: 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | Select-String "built|error"
  ```
  Expected: `✓ built`

- [ ] **Step 5: Commit**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git add src/App.jsx
  git commit -m "feat: 실험 탭 E-B — _EXPERIMENT_STORE 및 experimentLoading 상태 추가"
  ```

---

## Task 2: `analyzeExperiment` 함수 작성

**파일:** `src/App.jsx` — `refine` 함수 근처 (~line 4400)

- [ ] **Step 1: `analyzeExperiment` 함수 삽입**

  `async function refine()` 선언 바로 위에 아래 함수를 추가한다:

  ```js
  async function analyzeExperiment() {
    if (!experimentFeedback.trim() || satisfactionScore === null || !apiKey) return;
    setExperimentLoading(true);

    // 시스템 결과 요약 구성 (본문 전체 미전송, 의도+매칭만)
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

    const prompt = `시스템 결과:
- 의도: ${systemIntent}
- 행동: ${systemAction}

사용자 피드백: ${experimentFeedback}
만족도: ${satisfactionScore}/5

아래 JSON만 반환하라 (다른 텍스트 없이):
{"match_rate":0~100정수,"difference":"차이점 1~2문장","next_rule":"다음 생성 시 반영할 규칙 1문장"}`;

    try {
      const res = await fetch('/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json();
      const raw = data?.content?.[0]?.text?.trim() || '{}';
      // JSON 파싱 (마크다운 코드블록 제거 후)
      const jsonStr = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(jsonStr);

      const analysis = {
        matchRate: typeof parsed.match_rate === 'number' ? parsed.match_rate : 0,
        difference: parsed.difference || '',
        nextRule: parsed.next_rule || '',
      };
      setExperimentAnalysis(analysis);

      // 로그 저장
      const exp = {
        experiment_id: `exp_${Date.now()}`,
        timestamp: new Date().toISOString(),
        system_intent: systemIntent,
        system_action: systemAction,
        user_correct_intent: experimentFeedback,
        satisfaction_score: satisfactionScore,
        match_rate: analysis.matchRate,
        difference: analysis.difference,
        next_rule: analysis.nextRule,
      };
      saveExperiment(exp);
    } catch (err) {
      setExperimentAnalysis({ matchRate: 0, difference: `분석 오류: ${err.message}`, nextRule: '' });
    } finally {
      setExperimentLoading(false);
    }
  }
  ```

- [ ] **Step 2: 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | Select-String "built|error"
  ```
  Expected: `✓ built`

- [ ] **Step 3: Commit**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git add src/App.jsx
  git commit -m "feat: 실험 탭 E-B — analyzeExperiment 함수 (Claude API 일치율 분석)"
  ```

---

## Task 3: 버튼 onClick 연결 + 시스템 결과 요약 UI

**파일:** `src/App.jsx` — 실험 탭 생성 후 UI (~line 5252)

- [ ] **Step 1: 시스템 결과 요약 섹션 추가**

  `/* 생성 후: 피드백 활성화 */` 블록 최상단 (`<div style={{ display:'flex', flexDirection:'column', gap:14, padding:'4px 0' }}>` 바로 안) 에 추가:

  ```jsx
  {/* 시스템 결과 요약 */}
  {currentLog && (
    <div style={{ padding:'10px 12px', background:T.bg,
      border:`1px solid ${T.border}`, borderRadius:3, fontSize:11 }}>
      <div style={{ fontWeight:600, color:T.ink, marginBottom:4 }}>시스템 결과 요약</div>
      {currentLog.text_analysis?.layout_intent && (
        <div style={{ color:T.muted, lineHeight:1.6 }}>
          의도: {currentLog.text_analysis.layout_intent}
        </div>
      )}
      {currentLog.matching?.selected_reference_title && (
        <div style={{ color:T.muted, lineHeight:1.6 }}>
          레퍼런스: {currentLog.matching.selected_reference_title}
        </div>
      )}
    </div>
  )}
  ```

- [ ] **Step 2: "피드백 분석하기" 버튼에 onClick 연결**

  기존 (~line 5308):
  ```jsx
  <button
    disabled={!experimentFeedback.trim() || satisfactionScore === null}
  ```
  교체:
  ```jsx
  <button
    onClick={analyzeExperiment}
    disabled={!experimentFeedback.trim() || satisfactionScore === null || experimentLoading}
  ```

  그리고 버튼 텍스트 (~line 5318) 교체:
  ```jsx
  {experimentLoading ? '분석 중…' : '피드백 분석하기'}
  ```

- [ ] **Step 3: 분석 결과 플레이스홀더를 실제 UI로 교체**

  기존 (~line 5320~5327):
  ```jsx
  {/* 분석 결과 (Plan E-B에서 채움) */}
  {experimentAnalysis && (
    <div style={{ padding:'12px', background:T.bg,
      border:`1px solid ${T.border}`, borderRadius:3,
      fontSize:12, color:T.ink }}>
      분석 결과 (Plan E-B에서 구현)
    </div>
  )}
  ```

  교체:
  ```jsx
  {experimentAnalysis && (
    <div style={{ padding:'12px', background:T.bg,
      border:`1px solid ${T.border}`, borderRadius:3,
      fontSize:12, color:T.ink, display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
        <span style={{ fontWeight:700, fontSize:20, color:T.ink }}>
          {experimentAnalysis.matchRate}%
        </span>
        <span style={{ color:T.muted }}>일치율</span>
      </div>
      {experimentAnalysis.difference && (
        <div>
          <div style={{ fontSize:10, fontWeight:600, color:T.muted,
            textTransform:'uppercase', letterSpacing:1, marginBottom:3 }}>
            차이점
          </div>
          <div style={{ lineHeight:1.6, color:T.ink }}>
            {experimentAnalysis.difference}
          </div>
        </div>
      )}
      {experimentAnalysis.nextRule && (
        <div>
          <div style={{ fontSize:10, fontWeight:600, color:T.muted,
            textTransform:'uppercase', letterSpacing:1, marginBottom:3 }}>
            다음 규칙
          </div>
          <div style={{ lineHeight:1.6, color:T.ink }}>
            {experimentAnalysis.nextRule}
          </div>
        </div>
      )}
    </div>
  )}
  ```

- [ ] **Step 4: 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | Select-String "built|error"
  ```

- [ ] **Step 5: 브라우저 동작 확인**

  - 본문 입력 후 생성 → 실험 탭 자동 이동
  - 시스템 결과 요약 표시 확인
  - 피드백 입력 + 만족도 선택 → "피드백 분석하기" 활성화
  - 클릭 후 "분석 중…" 텍스트 → 완료 후 일치율/차이점/다음 규칙 표시

- [ ] **Step 6: Commit**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git add src/App.jsx
  git commit -m "feat: 실험 탭 E-B — 분석 결과 UI + 시스템 요약 + 버튼 연결"
  ```

---

## Task 4: CSV / MD 다운로드

**파일:** `src/App.jsx` — 분석 결과 UI 아래 (~line 5327 이후)

- [ ] **Step 1: CSV/MD 다운로드 버튼 블록 추가**

  `experimentAnalysis && (...)` 블록 바로 아래에 추가:

  ```jsx
  {/* CSV / MD 다운로드 */}
  {loadExperiments().length > 0 && (
    <div style={{ display:'flex', gap:8 }}>
      <button onClick={() => {
        const exps = loadExperiments();
        const headers = [
          'experiment_id','timestamp','system_intent','system_action',
          'user_correct_intent','satisfaction_score','match_rate',
          'difference','next_rule'
        ];
        const rows = exps.map(e =>
          headers.map(h => `"${String(e[h] ?? '').replace(/"/g, '""')}"`).join(',')
        );
        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `imprint_experiments_${Date.now()}.csv`;
        a.click(); URL.revokeObjectURL(url);
      }} style={{ flex:1, padding:'8px', fontSize:11, fontWeight:600,
        border:`1px solid ${T.border}`, borderRadius:3,
        background:T.surface, color:T.ink, cursor:'pointer' }}>
        CSV 다운로드
      </button>
      <button onClick={() => {
        const exps = loadExperiments();
        const md = exps.map(e => `# Experiment Log: ${e.experiment_id}
## Timestamp
${e.timestamp}
## System Intent
${e.system_intent}
## System Action
${e.system_action}
## User Feedback
${e.user_correct_intent}
## Satisfaction: ${e.satisfaction_score}/5
## Match Rate: ${e.match_rate}%
## Difference
${e.difference}
## Next Rule
${e.next_rule}`).join('\n\n---\n\n');
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `imprint_experiments_${Date.now()}.md`;
        a.click(); URL.revokeObjectURL(url);
      }} style={{ flex:1, padding:'8px', fontSize:11, fontWeight:600,
        border:`1px solid ${T.border}`, borderRadius:3,
        background:T.surface, color:T.ink, cursor:'pointer' }}>
        MD 다운로드
      </button>
    </div>
  )}
  ```

- [ ] **Step 2: 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | Select-String "built|error"
  ```

- [ ] **Step 3: CSV 다운로드 동작 확인**

  - 피드백 분석 완료 후 CSV/MD 버튼 표시 확인
  - CSV 다운로드 후 Excel에서 열어 컬럼·내용 확인
  - MD 다운로드 후 형식 확인

- [ ] **Step 4: Final commit + push**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git add src/App.jsx
  git commit -m "feat: 실험 탭 E-B — CSV/MD 다운로드"
  git push origin main
  ```

---

## 구현 완료 후 테스트 체크리스트

- [ ] 생성 전 실험 탭 → 비활성 안내
- [ ] 생성 완료 → 실험 탭 자동 이동
- [ ] 시스템 결과 요약 (의도 + 레퍼런스) 표시
- [ ] 피드백 textarea 입력 가능
- [ ] 만족도 5단계 선택 가능
- [ ] 피드백 + 만족도 입력 전 버튼 disabled
- [ ] "피드백 분석하기" 클릭 → "분석 중…" → 일치율/차이점/다음 규칙 표시
- [ ] CSV 다운로드 → 내용 검증
- [ ] MD 다운로드 → 내용 검증
- [ ] 두 번째 생성 후 피드백 → 두 번째 실험 로그 CSV에 누적 확인

---

## 다음 단계

Plan E-B 완료 후:
- **Plan E-C** — 학습 규칙 누적 요약 (`user_design_rules.md` 생성), 다음 생성 프롬프트에 규칙 자동 반영

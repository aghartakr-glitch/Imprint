# Imprint 실험 탭 Plan E-C: localStorage 영구 저장 + 학습 규칙 자동 반영

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실험 로그를 새로고침/재시작 후에도 유지하고, 누적된 피드백 규칙을 다음 조판 생성 시 자동 반영한다.

**Architecture:** `_EXPERIMENT_STORE`에 localStorage 동기화 추가. `buildDesignRules()` 함수로 만족도 ≥ 4 실험의 `next_rule`을 요약. `microAdjust` 프롬프트에 규칙 주입 (토큰 최소화).

**Tech Stack:** React 19, Vite 8, Web Storage API (localStorage), inline CSS (T 토큰)

---

## 현황 (Plan E-B 완료 기준)

| 항목 | 상태 |
|------|------|
| `_EXPERIMENT_STORE` | ✅ 메모리에만 있음 — 새로고침 시 소멸 |
| `saveExperiment()` | ✅ 메모리만 씀 |
| `loadExperiments()` | ✅ 메모리만 읽음 |
| 규칙 → 프롬프트 반영 | ❌ 없음 |

---

## 파일 구조

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `src/App.jsx` | Modify | 3개 위치 수정 |

변경 위치:
- **~line 40** (module-level `_EXPERIMENT_STORE` 초기화): localStorage에서 읽어 초기화
- **~line 41** (`saveExperiment` 함수): localStorage 동기화 추가
- **~line 44** 아래 (새 함수): `buildDesignRules()` 추가
- **~line 1914** (`microAdjust` 프롬프트): 규칙 주입

---

## Task 1: localStorage 영구 저장

**파일:** `src/App.jsx` — module-level (~line 40)

- [ ] **Step 1: `_EXPERIMENT_STORE` 초기화를 localStorage에서 읽도록 변경**

  기존 (~line 40):
  ```js
  const _EXPERIMENT_STORE = { experiments: [] };
  function saveExperiment(exp) {
    _EXPERIMENT_STORE.experiments = [..._EXPERIMENT_STORE.experiments, exp];
  }
  function loadExperiments() { return _EXPERIMENT_STORE.experiments; }
  ```

  교체:
  ```js
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
  git commit -m "feat: 실험 탭 E-C — 실험 로그 localStorage 영구 저장"
  ```

---

## Task 2: `buildDesignRules()` 함수 추가

**파일:** `src/App.jsx` — `loadExperiments()` 바로 아래 (~line 45)

- [ ] **Step 1: `buildDesignRules()` 함수 삽입**

  `function loadExperiments() { ... }` 바로 아래에 추가:

  ```js
  function buildDesignRules() {
    const exps = loadExperiments();
    // 만족도 4~5 또는 일치율 70%+ 실험의 next_rule만 추출
    const rules = exps
      .filter(e => (e.satisfaction_score >= 4 || e.match_rate >= 70) && e.next_rule?.trim())
      .map(e => e.next_rule.trim());
    if (rules.length === 0) return '';
    // 중복 제거 (앞 40자 기준)
    const seen = new Set();
    const unique = rules.filter(r => {
      const key = r.slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    // 최대 5개, 토큰 절약
    return unique.slice(0, 5).map(r => `- ${r}`).join('\n');
  }
  ```

- [ ] **Step 2: 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | Select-String "built|error"
  ```

- [ ] **Step 3: Commit**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git add src/App.jsx
  git commit -m "feat: 실험 탭 E-C — buildDesignRules() 함수 추가"
  ```

---

## Task 3: microAdjust 프롬프트에 규칙 주입

**파일:** `src/App.jsx` — `microAdjust` 함수 내부 (~line 1914)

`microAdjust` 함수는 조판 수치(글자크기, 행간, 자간, 여백)를 텍스트 분석 기반으로 미세조정하는 API 호출이다. 여기에 사용자 학습 규칙을 주입하면 토큰 비용이 낮으면서도 실질적인 반영이 된다.

- [ ] **Step 1: 프롬프트 앞에 규칙 주입**

  현재 프롬프트 시작 (~line 1914):
  ```js
  const prompt = `편집 디자인 조판 전문가. 입력 텍스트의 성격을 보고 레퍼런스 수치를 미세조정하라.
  텍스트(앞200자):"${text.slice(0,200)}"
  ...`;
  ```

  교체 (프롬프트 생성 전에 규칙 구성 추가):
  ```js
  const _designRules = buildDesignRules();
  const prompt = `편집 디자인 조판 전문가. 입력 텍스트의 성격을 보고 레퍼런스 수치를 미세조정하라.${_designRules ? `\n[사용자 디자인 규칙 — 이전 피드백 기반, 우선 반영]\n${_designRules}` : ''}
  텍스트(앞200자):"${text.slice(0,200)}"
  성격: 장르/주제:${profile?.topic||'-'} 문체:${profile?.textForm||'-'} 톤:${profile?.tone||'-'}
  디자인개념:${(structReason?.design_concept||[]).join(',')} 과제:${(structReason?.design_task||[]).join(',')}
  기본수치: 크기${base.bodySize}pt 행간${base.bodyLeading}pt 자간${base.tracking} 여백${base.marginTop}/${base.marginBottom}/${base.marginInner}/${base.marginOuter}mm
  한도:크기±1.5pt(최소7pt),행간±3pt(최소크기×1.3),자간±20,여백±5mm. 불필요하면기본값유지.
  반환JSON:{"bodySize":<n>,"bodyLeading":<n>,"tracking":<n>,"marginTop":<n>,"marginBottom":<n>,"marginInner":<n>,"marginOuter":<n>,"reasons":[{"variable":"<항목>","base":"<기본>","adjusted":"<조정>","reason":"<이유10자>"}]}
  reasons는변경항목만.`;
  ```

  > **주의:** 기존 프롬프트 문자열의 들여쓰기/백틱 구조를 그대로 유지할 것. `_designRules`가 빈 문자열이면 아무것도 추가되지 않음.

- [ ] **Step 2: 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | Select-String "built|error"
  ```

- [ ] **Step 3: 동작 확인 (규칙 없을 때)**

  `localStorage.removeItem('imprint_experiments')` 후 생성 → 규칙 없이 정상 동작 확인.

- [ ] **Step 4: Commit + push**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git add src/App.jsx
  git commit -m "feat: 실험 탭 E-C — 학습 규칙을 microAdjust 프롬프트에 자동 반영"
  git push origin main
  ```

---

## 완료 후 동작 흐름

```
피드백 입력 (만족도 4~5)
  → saveExperiment() → localStorage 저장
  → 브라우저 닫아도 유지

다음 생성 시
  → buildDesignRules() → 만족도 4+ 규칙 최대 5개 추출
  → microAdjust 프롬프트에 [사용자 디자인 규칙] 섹션 추가
  → Claude가 규칙 반영해 수치 조정
```

---

## 다음 단계 (Plan E-D, 선택)

- 실험 탭에 누적 규칙 미리보기 표시
- 규칙 개별 삭제/비활성화 UI
- localStorage 용량 초과 시 오래된 로그 자동 정리 (현재 미구현)

# Imprint 실험 탭 — 1단계 설계 문서

**날짜:** 2026-06-08  
**버전:** 1단계 (피드백 UI + 일치율 분석 + CSV/MD 저장)  
**대상 파일:** `src/App.jsx`

---

## 1. 목표

조판 결과에 대한 사용자 피드백을 수집하고, Claude API로 시스템 결과와 사용자 의도의 일치율을 분석해 CSV/MD 로그로 저장한다. 기존 생성 흐름은 변경하지 않는다.

---

## 2. 탭 구조 변경

### 현재
- 텍스트 입력 탭: 제목 / 소제목 / 본문 / 각주 / 면주
- 실험 탭: 스타일 선택 모드 + 단 구성

### 변경 후
- **텍스트 입력 탭**: 제목 / 소제목 / 본문 / 각주 / 면주 / **스타일 설정 (이동)**
- **실험 탭**: 피드백 UI (완전 교체)

스타일 선택 모드와 단 구성은 삭제하지 않고 텍스트 입력 탭 면주 아래 "스타일 설정" 섹션으로 이동한다.

---

## 3. 실험 탭 상태별 UI

### 3-1. 생성 전 (비활성)

```
┌─────────────────────────────────────┐
│  아직 생성 전입니다.                    │
│  텍스트 입력 탭에서 본문을 넣고           │
│  조판 스타일 생성하기를 클릭하세요.        │
│                                     │
│  [정답 피드백 textarea — disabled]   │
│  [만족도 1 2 3 4 5 — disabled]       │
│  [피드백 보내기 — disabled]           │
└─────────────────────────────────────┘
```

- `opacity: 0.4`, `pointer-events: none`
- 생성 완료 여부: `result !== null` 조건

### 3-2. 생성 후 (활성)

```
┌─────────────────────────────────────┐
│  ── 시스템 결과 요약 ──               │
│  의도: [시스템이 추정한 의도 1줄]       │
│  변경: footnote_size -12%           │
│        footnote_spacing +60%        │
│                                     │
│  ── 정답 피드백 ──                   │
│  [textarea: 사용자가 원한 것은...]     │
│                                     │
│  ── 만족도 ──                        │
│  매우불일치 [1] [2] [3] [4] [5] 매우일치│
│                                     │
│  [피드백 보내기]                      │
└─────────────────────────────────────┘
```

### 3-3. 피드백 전송 후

```
┌─────────────────────────────────────┐
│  일치율: 72%                         │
│  차이점: "..."                        │
│  다음 생성 규칙: "..."                 │
│                                     │
│  [CSV 다운로드] [MD 다운로드]         │
│                                     │
│  ── 이전 실험 로그 ──                 │
│  [exp_001] 2026-06-08  만족도 3/5    │
│  [exp_002] 2026-06-08  만족도 4/5    │
└─────────────────────────────────────┘
```

---

## 4. 일치율 분석 API 호출

생성 완료 후 "피드백 보내기" 클릭 시 Claude API 호출.

**프롬프트 구조 (토큰 최소화):**
```
시스템 결과:
- 의도: {system_intent}
- 행동: {system_action_summary}

사용자 피드백: {user_feedback}
만족도: {score}/5

다음을 JSON으로 반환:
{
  "match_rate": 0~100,
  "difference": "차이점 1-2문장",
  "next_rule": "다음 생성 시 반영할 규칙 1문장"
}
```

본문 전체는 전송하지 않고, 시스템 의도와 행동 요약만 전송해 토큰을 줄인다.

---

## 5. 로그 구조

### CSV 컬럼
```
experiment_id, timestamp, user_expression, system_intent,
user_correct_intent, system_action, satisfaction_score,
match_rate, next_rule
```

### MD 포맷
```md
# Experiment Log: {experiment_id}
## System Intent
{system_intent}
## System Action
{system_action}
## User Feedback
{user_correct_intent}
## Satisfaction: {score}/5
## Match Rate: {match_rate}%
## Next Rule
{next_rule}
```

로그는 React state(`_EXPERIMENT_STORE`)에 누적 저장. 다운로드 시 브라우저 Blob으로 파일 생성.

---

## 6. 생성 완료 후 실험 탭 자동 이동

`generateStyle()` 완료 시 `setInputTab('experiment')` 호출.

---

## 7. 범위 외 (2단계)

- 로그를 다음 생성 프롬프트에 자동 반영
- 학습 규칙 파일 누적/요약 관리 (`user_design_rules.md`)
- 토큰 절약용 fixed_text 파일 재사용 구조

---

## 8. 영향 범위

| 항목 | 변경 여부 |
|------|-----------|
| 기존 텍스트 입력 기능 | 유지 (이동만) |
| 기존 생성 버튼 동작 | 유지 |
| 기존 Refine 채팅 | 유지 |
| `inputTab` state | `'text' \| 'experiment'` (기존 값 유지) |
| 신규 state | `experimentFeedback`, `satisfactionScore`, `experimentLogs`, `analysisResult` |

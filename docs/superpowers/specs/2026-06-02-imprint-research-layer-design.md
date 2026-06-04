# Imprint Research Layer — Design Spec
> 작성일: 2026-06-02  
> 대상 파일: `src/App.jsx` (현재 ~5,300줄)  
> 구현 단계: A (해석 가시화) → B (기술 안정성) → C (UX/모드)

---

## 배경 및 목표

Imprint는 **편집 디자인 암묵지를 LLM이 처리 가능한 디자인 언어로 변환하는 연구 시스템**이다.  
현재 PDF 생성까지는 작동하지만, 논문 핵심 주장인 "왜 그 결과가 나왔는가"의 추적이 부족하다.

이 스펙은 다음을 구현한다:
1. **작업 의도 탭 구조화** — Design Concept / Task / Visual Element 3단계
2. **Evidence Map** — 본문 문장 → 디자인 결정 추적
3. **Revision Trajectory** — 수정 과정 전체 기록 + JSON Export
4. **Patch + Report 방식** — 자연어 수정 시 변수 단위 변경 및 보고
5. **Variable Grid JSON** — 가변 그리드 중간 표현
6. **주석 마커 검증** — `\ImpFN{N}` ↔ `\textsuperscript{N}` 쌍 검증
7. **장르 선택 모드 분리** — 자동 / 장르 강제 / 레퍼런스 고정
8. **Export Validation** — LaTeX 구조 검증 패널

---

## A 레이어: 해석 가시화 (1·2·3번)

### A-1. 작업 의도 탭 구조 개편

**변경 대상:** `semanticRerank()` API 프롬프트 + `structuredReason` 상태

`semanticRerank()`의 Claude API 응답 JSON에 3개 필드 추가:

```js
{
  // 기존
  reference_reason: "string",
  content_match: "string",
  layout_reason: "string",
  rejected: [{ i: number, reason: "string" }],

  // 신규
  design_concept: ["string", ...],   // 본문 정서/분위기 해석 (2~4개)
  design_task: ["string", ...],      // 조판 과제 목록 (2~4개)
  visual_element: ["string", ...]    // 실제 수치/스타일 구현 (3~6개)
}
```

**작업 의도 탭 표시 순서:**
1. 레퍼런스 선정 (`reference_reason`)
2. 내용 매칭 (`content_match`)
3. **Design Concept** (`design_concept[]` — 불릿 리스트)
4. **Design Task** (`design_task[]` — 불릿 리스트)
5. **Visual Element** (`visual_element[]` — 불릿 리스트)
6. 본문 근거 (Evidence Map — 별도 섹션)
7. DB 기반 설계 근거 (서체 선택 / 여백 설계 / 자간 설정)

**예시 출력:**
```
Design Concept
• 조용한 회고
• 기억의 회복
• 정적인 독서 분위기

Design Task
• 독서 속도를 낮춘다
• 여백과 행간으로 정적 분위기를 만든다

Visual Element
• 120×192mm 판형
• 본문 8.5pt / 행간 16pt
• 넓은 하단 여백
• 명조 중심 서체
• 하단 외측 쪽번호
```

---

### A-2. Evidence Map (본문 근거)

**방식:** 스타일 생성 완료 후 **백그라운드 API 호출** (생성 속도에 영향 없음)

**데이터 구조:**
```js
const evidenceMap = [
  {
    textSpan: "오랜만에 고향으로 돌아와",
    interpretation: "회고적 시간성",
    designConcept: "기억의 회복",
    designTask: "느린 독서 리듬 만들기",
    affectedVariables: ["긴 행간", "작은 판형", "넓은 하단 여백"]
  }
]
```

**React 상태:** `const [evidenceMap, setEvidenceMap] = useState(null)`

**백그라운드 호출 시점:** `setLatex()`로 LaTeX 설정 직후, `useEffect`로 트리거

**UI (작업 의도 탭 하단 "본문 근거" 섹션):**
```
본문 근거
"오랜만에 고향으로 돌아와"
  → 회고적 시간성 → 긴 행간 / 작은 판형

"버려진 기차역"
  → 정적 장소성 → 넓은 여백 / 명조 본문
```
각 항목은 접기/펼치기 가능 (기본: 펼침)

---

### A-3. Revision Trajectory

**데이터 구조:**
```js
// rev_000: 초기 생성
{
  id: "rev_000",
  type: "initial_generation",
  timestamp: "ISO8601",
  userInput: { title, bodyHash, styleInstruction },
  selectedReference: { title, designer, reason },
  interpretation: { designConcept[], designTask[], visualElement[] },
  variables: { bodySize, leading, marginBottom, pageNumberPosition, ... },
  files: { mainTexHash, styHash }
}

// rev_001+: 사용자 수정
{
  id: "rev_001",
  type: "user_refinement",
  timestamp: "ISO8601",
  userRequest: "string",
  systemInterpretation: { designConcept, designTask, visualElement },
  patch: [{ target, before, after, reason }],
  userDecision: "accepted" | "pending"
}
```

**React 상태:** `const [revisionLog, setRevisionLog] = useState([])`

**저장 방식:** 세션 내 메모리 + **"수정 기록 Export" 버튼** → `revision_log.json` 다운로드

**UI: 수정 기록 탭 (우측 패널에 추가)**

탭 순서: `작업 의도 | 수정 기록 | 최종 파일 | 스타일 파일`

각 revision 카드:
```
Revision 0 — 초기 생성
레퍼런스: 플라톤의 위염
개념: 조용한 회고 / 기억의 회복
설정: 120×192mm, 8.5pt/16pt, 하단 외측 쪽번호

Revision 1 — "각주를 더 조용하게 해줘"
해석: 각주 위계 낮추기
· footnote_size: 6.5pt → 5.8pt
· footnote_leading: 11.4pt → 10pt
상태: accepted
```

---

## B 레이어: 기술 안정성 (4·5·6·8번)

### B-4. Patch + Report 방식 자연어 수정

**현재 문제:** Claude가 전체 LaTeX를 재생성하지만 무엇이 바뀌었는지 보고 부족.

**변경:**
1. `refine()` 시스템 프롬프트에 "patch 방식으로 응답" 지시 강화
2. 응답에서 `systemInterpretation` 블록 추출 (`<interpretation>...</interpretation>` 태그)
3. `refine()` 완료 시 revisionLog에 rev_N 항목 자동 추가

**응답 형식 (Claude 지시):**
```
<interpretation>
designConcept: 본문 중심성 강화
designTask: 각주 위계 낮추기
visualElement: 각주 크기와 행간 축소
</interpretation>

수정 완료:
- 각주 크기를 6.5pt에서 5.8pt로 줄였습니다.
- 이유: 각주의 존재감을 낮추고 본문 흐름을 우선하기 위해서입니다.

<latex_update>
... (수정된 전체 LaTeX)
</latex_update>
```

---

### B-5. Variable Grid JSON 중간 표현

**`layoutConfig` 구조:**
```js
{
  mode: "variable" | "fixed",
  totalGridUnits: number,
  bodyGridUnits: number,
  noteGridUnits: number,
  bodyTextColumns: number,
  noteTextColumns: number,
  notePosition: "right" | "left" | "bottom",
  columnGapMm: number
}
```

**LaTeX 생성 규칙 (`buildMainTex` 내):**
- `bodyW = (printableWidth - columnGapMm) * bodyGridUnits / totalGridUnits`
- `noteW = (printableWidth - columnGapMm) * noteGridUnits / totalGridUnits`
- gap은 반드시 `\setlength{\columnsep}{Xmm}` 별도 처리
- `\setcolumnwidth{bodyW,noteW}` — gap 포함하지 않음

**금지:**
```tex
\setcolumnwidth{65.6mm,8mm,10.4mm}  % 잘못된 예: gap이 column width 안에 포함됨
```

---

### B-6. 주석 마커 검증

**`validateNoteMarkers(bodyLatex, noteLatex)` 함수 추가:**
```js
function extractNoteNumbers(noteLatex) {
  return [...String(noteLatex || '').matchAll(/\\textsuperscript\{(\d+)\}/g)]
    .map(m => m[1]);
}

function validateNoteMarkers(bodyLatex, noteLatex) {
  const nums = extractNoteNumbers(noteLatex);
  const missing = nums.filter(n =>
    !new RegExp(`\\\\ImpFN\\{${n}\\}`).test(bodyLatex)
  );
  if (missing.length) {
    throw new Error(
      `본문 마커 누락: ${missing.map(n => `\\ImpFN{${n}}`).join(', ')}`
    );
  }
}
```

**`imprint-style.sty`에 추가:**
```tex
\newcommand{\ImpFN}[1]{\textsuperscript{#1}}
```

**호출 위치:** `buildMainTex()` 완료 후, LaTeX 상태 저장 전

---

### B-8. Export Validation

**`validateExport(mainTex, styCode, layoutConfig)` 함수:**

검증 항목:
1. `\documentclass` 1회, `\begin{document}` 1회, `\end{document}` 1회
2. `\end{document}` 뒤에 내용 없음
3. `layoutConfig.mode === 'variable'` → `\begin{paracol}{2}` 존재
4. `\switchcolumn` 1회 이하
5. `\setlength{\columnsep}` 존재 (가변 그리드 시)
6. `bodyTextColumns === 1` → `\begin{multicols}` 없음
7. `bodyTextColumns > 1` → `\RequirePackage{multicol}` 존재
8. `\setmainhangulfont` / `\setsanshangulfont` 없음 (kotex 구조 유지)
9. `\noindent "` 없음, `"\par` 없음

**UI (최종 파일 탭 하단 Validation 패널):**
```
✅ main.tex 구조 정상
✅ 가변 그리드 적용됨
✅ 주석 마커 연결됨
✅ 한글 폰트 구조 정상
⚠️ multicol 패키지 누락
```

---

## C 레이어: UX/모드 (7·9번)

### C-7. 장르 선택 모드 분리

**3가지 모드:**
- `auto` — 본문 분석으로 자동 추천 (현재 방식)
- `genre-forced` — 사용자 선택 장르 안에서만 추천
- `ref-locked` — 특정 레퍼런스 고정, 수정 후에도 유지

**UI:** 기존 장르 드롭다운 옆에 모드 토글 추가  
**작업 의도 탭에 표시:** "선택 모드: 장르 강제 (문학)"

### C-9. UI 개선

- **스타일 패키지 상단:** 표 형태 → chip grid 형태
- **수정 기록 탭:** 위 A-3 설계 참조
- **Validation 패널:** 위 B-8 설계 참조

---

## 구현 순서 (우선순위)

| 순서 | 항목 | 예상 난이도 |
|------|------|------------|
| 1 | A-1: Design Concept/Task/Visual Element | 낮음 (프롬프트 + UI) |
| 2 | A-3: Revision Trajectory (초기 생성 기록) | 중간 |
| 3 | B-4: Patch + Report + revisionLog 연결 | 중간 |
| 4 | A-2: Evidence Map (백그라운드 API) | 중간 |
| 5 | B-5: Variable Grid JSON | 높음 |
| 6 | B-6: 주석 마커 검증 | 낮음 |
| 7 | B-8: Export Validation UI | 낮음 |
| 8 | C-7: 장르 선택 모드 | 중간 |
| 9 | C-9: UI 개선 (chip grid 등) | 낮음 |

---

## 파일 분리 고려사항

현재 App.jsx ~5,300줄. 이 스펙 구현 후 ~8,000줄 예상.  
단일 파일 유지 vs 분리 결정은 구현 중 판단.  
분리 시 후보: `lib/evidenceMap.js`, `lib/revisionLog.js`, `lib/validateExport.js`

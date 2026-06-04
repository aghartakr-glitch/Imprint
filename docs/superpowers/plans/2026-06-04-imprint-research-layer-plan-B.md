# Imprint Research Layer — Plan B: 기술 안정성

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Variable Grid 폭 계산 검증 + layoutConfig Export, 주석 마커 사전 검증 함수 분리, Export Validation 패널 강화

**Architecture:** 모든 변경은 단일 파일 `src/App.jsx`에 집중. `calcVariableGrid()` 공식 검증 및 layoutConfig 스냅샷 추가, 독립 `validateNoteMarkers()` 함수 신설 및 generation 파이프라인에 연결, "최종 파일" 탭 검증 패널을 스펙 요구사항으로 확장.

**Tech Stack:** React 19 + Vite 8 + inline CSS (테마 객체 `T`)

---

## 현황 분석 (작업 전 파악된 내용)

- `calcVariableGrid(vg, textW, colGap)` — 이미 존재. 타이포그래피 모듈 그리드 공식 사용.
- `validateLatexExport()` — 이미 존재. G1~G5 포함. 하지만 UI 패널 표시가 최소화됨.
- `\ImpFN` 매크로 — `.sty` 생성 시 이미 삽입됨 (line 2787). G5 검증도 존재.
- `validateNoteMarkers()` 독립 함수 — 미존재. G5가 이미 동일 로직을 하지만 `mainTex` 조립 후에만 실행됨.
- `layoutConfig` JSON 스냅샷 Export — 미존재.

## 파일 구조

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `src/App.jsx` | Modify | 전체 변경 대상 (단일 파일) |

변경 위치:
- **~990줄** 근처: `calcVariableGrid()` 공식 검증 (수정 필요 시)
- **~665줄** 근처: `validateNoteMarkers()` 신규 함수 추가
- **~2387줄** 근처: `run()` 내 가변 그리드 생성 시 `validateNoteMarkers()` 호출
- **~3675줄** 근처: `run()` 완료 후 `layoutConfigSnapshot` revisionLog에 추가
- **~5329줄** 근처: "최종 파일" 탭 검증 패널 확장

---

## Task 1: calcVariableGrid 공식 검증 및 layoutConfig 스냅샷

**파일:** `src/App.jsx` — `calcVariableGrid()` 함수 (약 977줄) + `run()` rev_000 기록 블록 (약 3675줄)

스펙에서 요구하는 column width 공식이 현재 구현과 일치하는지 검증하고, rev_000에 layoutConfig 스냅샷을 추가한다.

- [ ] **Step 1: calcVariableGrid 공식 일치 확인**

  `src/App.jsx` 약 977줄의 `calcVariableGrid` 함수를 읽어 공식 확인:
  - 현재: `unitW = (textW - gap * (totalG - 1)) / totalG`
  - 스펙: `bodyW = (printableWidth - columnGapMm) * bodyGridUnits / totalGridUnits`

  두 공식을 `total=5, body=4, note=1, textW=84, gap=8` 예시로 검산:
  - 현재: `unitW = (84 - 8*4) / 5 = 52/5 = 10.4`, `bodyW = 10.4*4 + 8*3 = 65.6mm`, `noteW = 10.4mm`
  - 스펙 단순: `bodyW = (84 - 8) * 4/5 = 60.8mm` ← 다름

  현재 구현이 타이포그래피적으로 올바른 방식(단위 간격 모두 포함)이므로 **현재 공식 유지**. 주석으로 스펙과의 차이를 명시한다.

  `calcVariableGrid` 함수 위 주석 블록에 한 줄 추가:
  ```js
  // 스펙 단순화 공식(spec: bodyW=(textW-gap)*body/total)과 다름 — 타이포그래피 모듈 그리드 방식이 정확함
  ```

- [ ] **Step 2: rev_000에 layoutConfigSnapshot 추가**

  `src/App.jsx` 약 3675줄의 `setRevisionLog([{...}])` 호출에서 `files` 필드 뒤에 `layoutConfigSnapshot` 추가:

  기존:
  ```js
  files: {
    mainTexHash: simpleHash(finalMainTex || ''),
    styHash: simpleHash(finalStyContent || ''),
  },
  ```

  교체:
  ```js
  files: {
    mainTexHash: simpleHash(finalMainTex || ''),
    styHash: simpleHash(finalStyContent || ''),
  },
  layoutConfigSnapshot: {
    mode: styleConfig.columnMode,
    totalGridUnits: styleConfig.variableGrid?.total || 1,
    bodyGridUnits: styleConfig.variableGrid?.body || 1,
    noteGridUnits: styleConfig.variableGrid?.note || 0,
    bodyTextColumns: styleConfig.bodyTextColumns || 1,
    noteTextColumns: styleConfig.noteTextColumns || 1,
    notePosition: styleConfig.notePosition || 'right',
    columnGapMm: styleConfig.columnGapMm || 8,
  },
  ```

- [ ] **Step 3: 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | tail -5
  ```
  Expected: no errors

- [ ] **Step 4: Commit**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git add src/App.jsx
  git commit -m "feat: layoutConfigSnapshot을 rev_000에 추가"
  ```

---

## Task 2: validateNoteMarkers() 독립 함수 신설

**파일:** `src/App.jsx` — `escapeLatexPreservingImpFN()` 함수 근처 (약 664줄)

독립적인 `validateNoteMarkers(bodyLatex, noteLatex)` 함수를 추가하고, generation 파이프라인에서 호출한다.

- [ ] **Step 1: validateNoteMarkers() 함수를 escapeLatexPreservingImpFN 바로 앞에 추가**

  `src/App.jsx`에서 `function escapeLatexPreservingImpFN` 줄을 찾아 그 바로 앞에 삽입:

  ```js
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
  ```

- [ ] **Step 2: wrapVariableLayout 호출 직전에 validateNoteMarkers 호출 추가**

  `src/App.jsx` 에서 `wrapVariableLayout({` 호출 부분을 찾는다. 약 2395줄 근처.
  패턴: `const mainTex = wrapVariableLayout({` 또는 `wrapVariableLayout({`

  그 호출 바로 앞에 삽입:
  ```js
  // ── 주석 마커 사전 검증 ───────────────────────────────────────────
  try {
    validateNoteMarkers(bodyLatex || '', noteLatex || '');
  } catch (markerErr) {
    pushLog('latex', '주석 마커 검증', 'error', markerErr.message);
    setErr(markerErr.message);
    return;
  }
  ```

  > **주의:** `bodyLatex`와 `noteLatex`는 `wrapVariableLayout`에 전달되는 인수와 동일한 변수명을 사용해야 한다. 파일 내 해당 위치의 실제 변수명을 확인하고 맞춰서 삽입할 것.

- [ ] **Step 3: 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | tail -5
  ```

- [ ] **Step 4: Commit**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git add src/App.jsx
  git commit -m "feat: validateNoteMarkers() 독립 함수 신설 및 generation 파이프라인 연결"
  ```

---

## Task 3: Export Validation 패널 강화

**파일:** `src/App.jsx` — "최종 파일" 탭 검증 패널 (약 5329~5356줄)

현재 패널은 기본 4개 항목만 표시한다. 스펙 요구사항대로 전체 항목을 표시하도록 확장한다.

- [ ] **Step 1: 검증 패널 블록 전체 교체**

  기존 (약 5331~5356줄):
  ```jsx
  {/* 검증 체크리스트 */}
  {(() => {
    const { errors: ve, warnings: vw } = validateLatexExport({ mainTex: latex, sty: styCode || '' });
    const checks = [
      { ok: true, label: 'main.tex 생성됨' },
      { ok: !!styCode, label: 'imprint-style.sty 생성됨' },
      { ok: true, label: 'XeLaTeX 필수 (% !TeX program = XeLaTeX 포함)' },
      { ok: (latex.match(/\\documentclass/g)||[]).length === 1, label: '\\documentclass 1회' },
      { ok: (latex.match(/\\begin\{document\}/g)||[]).length === 1, label: '\\begin{document} 1회' },
      { ok: (latex.match(/\\end\{document\}/g)||[]).length === 1, label: '\\end{document} 1회' },
      { ok: vw.length === 0, label: vw.length > 0 ? '⚠ document body에 본문 내용 없음' : 'document body에 본문 있음', warn: vw.length > 0 },
    ];
    return (
      <div style={{ marginBottom:14, padding:"10px 14px", background:T.bg,
        borderRadius:3, border:`1px solid ${T.border}`, fontSize:12 }}>
        <div style={{ fontWeight:600, color:T.ink, marginBottom:6 }}>LaTeX 검증</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 16px" }}>
          {checks.map((c,i) => (
            <span key={i} style={{ color: c.warn ? '#888' : c.ok ? '#444' : '#888' }}>
              {c.warn ? '⚠' : c.ok ? '✓' : '✗'} {c.label}
            </span>
          ))}
        </div>
      </div>
    );
  })()}
  ```

  교체:
  ```jsx
  {/* 검증 패널 */}
  {(() => {
    const { errors: ve, warnings: vw } = validateLatexExport({ mainTex: latex, sty: styCode || '', layoutConfig: styleConfig });
    const hasParacol = /\\begin\{paracol\}/.test(latex);
    const switchCount = (latex.match(/\\switchcolumn(?!\*)/g) || []).length;
    const noteNums = [...latex.matchAll(/\\textsuperscript\{(\d+)\}/g)].map(m => m[1]);
    const allMarkersPresent = noteNums.every(n => latex.includes(`\\ImpFN{${n}}`));
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
          { ok: noteNums.length === 0 || allMarkersPresent, label: noteNums.length === 0 ? '주석 없음' : `주석 마커 연결됨 (${noteNums.length}개)`, warn: noteNums.length > 0 && !allMarkersPresent },
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
          : vw.map(w => ({ ok: true, label: w, warn: true })),
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
  ```

- [ ] **Step 2: 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | tail -5
  ```
  Expected: no errors

- [ ] **Step 3: Commit**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git add src/App.jsx
  git commit -m "feat: Export Validation 패널 확장 (5개 그룹, 스펙 전체 항목)"
  ```

---

## Task 4: GitHub push 및 Plan B 마무리

- [ ] **Step 1: 전체 변경 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git log --oneline -5
  npx vite build --mode development 2>&1 | tail -3
  ```

- [ ] **Step 2: 자동 커밋 squash 후 push**

  최근 Plan B 작업의 자동 커밋들을 하나의 의미 있는 커밋으로 squash:

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git log --oneline -10
  ```

  Plan A 마지막 커밋(`04b44a7`) 이후 커밋들을 soft reset:
  ```
  git reset --soft 04b44a7
  git add src/App.jsx
  git commit -m "$(cat <<'EOF'
  feat: Research Layer B — 기술 안정성 구현

  - layoutConfigSnapshot을 rev_000 Revision Trajectory에 추가
  - validateNoteMarkers() 독립 함수 신설 (ImpFN ↔ textsuperscript 검증)
  - generation 파이프라인에 주석 마커 사전 검증 연결
  - Export Validation 패널 강화 (5개 그룹: 파일구조/레이아웃/오류/경고/수정기록)
  EOF
  )"
  ```

- [ ] **Step 3: Force push**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git push --force origin main
  git log --oneline -3
  ```

---

## 다음 단계

Plan B 완료 후:
- **Plan C** — UX/모드: 장르 선택 모드 분리 (자동/장르강제/레퍼런스고정), chip grid UI

# Imprint Research Layer — Plan C: UX/모드

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스타일 선택 방식을 자동/장르강제/레퍼런스고정 3모드 토글로 명시화하고, 작업 의도 탭에 선택 모드를 표시한다.

**Architecture:** 단일 파일 `src/App.jsx`. 기존 `hint`(장르강제)·`lockedStyleId`(레퍼런스고정) 상태를 유지하면서, 그 위에 `selectionMode` ('auto'|'genre-forced'|'ref-locked') 상태를 추가해 3개 버튼 토글 UI로 노출한다. chip grid는 이미 구현 완료(lines 5100-5132) — 추가 작업 없음.

**Tech Stack:** React 19 + Vite 8 + inline CSS (테마 객체 `T`)

---

## 현황 확인 (작업 전 파악)

| 항목 | 현재 상태 |
|------|-----------|
| `hint` state | 장르 강제 값 (빈문자열 = 자동) — 이미 존재 |
| `lockedStyleId` state | 레퍼런스 고정 인덱스 — 이미 존재 |
| 장르 드롭다운 | `hint` 직접 설정하는 select — 이미 존재 (~line 4703) |
| chip grid | lines 5100-5132에 이미 구현됨 ✅ |
| 3모드 토글 UI | **없음** — 신규 추가 필요 |
| 작업 의도 탭 모드 표시 | **없음** — 신규 추가 필요 |

## 파일 구조

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `src/App.jsx` | Modify | 전체 변경 대상 |

변경 위치:
- **~1669줄** 근처: `selectionMode` 상태 추가
- **~4698줄** 근처: 장르 드롭다운 앞에 3모드 토글 버튼 추가
- **~5008줄** 근처: 작업 의도 탭 상단에 선택 모드 배지 추가

---

## Task 1: selectionMode 상태 추가 및 3모드 토글 UI

**파일:** `src/App.jsx` — 상태 선언(~1669줄) + 장르 드롭다운 영역(~4698줄)

- [ ] **Step 1: selectionMode 상태를 hint 상태 바로 뒤에 추가한다**

  기존 (약 1669줄):
  ```js
  const [hint, setHint] = useState("");
  ```

  교체:
  ```js
  const [hint, setHint] = useState("");
  const [selectionMode, setSelectionMode] = useState('auto'); // 'auto'|'genre-forced'|'ref-locked'
  ```

- [ ] **Step 2: 장르 드롭다운 앞에 3모드 토글 버튼 블록을 삽입한다**

  `src/App.jsx`에서 아래 코드를 찾는다 (약 4698줄):
  ```jsx
  <div>
    <label style={{ display:"block", fontSize:11, fontWeight:600,
      color:T.ink, marginBottom:6 }}>
      장르 / 출판 형태 직접 지정
    </label>
    <select value={hint} onChange={e => setHint(e.target.value)}
  ```

  그 블록 전체를 아래로 교체한다:
  ```jsx
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
  ```

- [ ] **Step 3: "이 스타일 고정" 버튼을 선택된 패키지 카드에 추가한다**

  선택된 패키지 카드의 복사 버튼 근처(약 5090줄)에서 `<button onClick={copy}` 버튼 바로 앞에 삽입:
  ```jsx
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
  ```

- [ ] **Step 4: run() 내 장르 강제 모드 반영 확인**

  `run()` 함수는 이미 `const h = hint;` 패턴으로 `hint`를 사용한다. `selectionMode`가 `genre-forced`일 때 `hint`가 설정되어 있으므로 추가 수정 불필요. 단, `ref-locked` 모드에서 `lockedStyleId` 처리는 이미 `run()` 내부에 `forceIdx` 로직으로 있다. 확인만 한다:
  
  `src/App.jsx` 에서 아래를 찾아 존재 여부 확인:
  ```js
  const isLocked = testMode === 'lockedStyle' && lockedStyleId !== null;
  ```
  
  이 로직이 `testMode`에 의존하므로 `selectionMode === 'ref-locked'` 일 때도 동작하도록 조건을 수정한다. 기존:
  ```js
  const isLocked = testMode === 'lockedStyle' && lockedStyleId !== null;
  ```
  
  교체:
  ```js
  const isLocked = (testMode === 'lockedStyle' || selectionMode === 'ref-locked') && lockedStyleId !== null;
  ```

- [ ] **Step 5: 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | tail -5
  ```

- [ ] **Step 6: Commit**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git add src/App.jsx
  git commit -m "feat: 스타일 선택 3모드 토글 UI (자동/장르강제/레퍼런스고정)"
  ```

---

## Task 2: 작업 의도 탭에 선택 모드 배지 추가

**파일:** `src/App.jsx` — 작업 의도 탭 상단(~5150줄, `sr.reference_reason` 섹션 위)

선택된 모드와 그 근거를 작업 의도 탭 최상단에 표시한다.

- [ ] **Step 1: 작업 의도 탭 첫 번째 섹션 앞에 모드 배지 삽입**

  `src/App.jsx`에서 작업 의도 탭 내부 IIFE의 return 블록 시작 부분을 찾는다:
  ```jsx
  return (
    <div style={{ display:"flex", flexDirection:"column" }}>

      {/* 1. 레퍼런스 선정 */}
      {sr.reference_reason && <>
  ```

  그 바로 안에 `{/* 1. 레퍼런스 선정 */}` 위에 삽입:
  ```jsx
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
  ```

- [ ] **Step 2: 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | tail -5
  ```

- [ ] **Step 3: Commit**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git add src/App.jsx
  git commit -m "feat: 작업 의도 탭에 선택 모드 배지 표시"
  ```

---

## Task 3: GitHub push 및 Plan C 마무리

- [ ] **Step 1: 전체 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | tail -3
  git log --oneline -5
  ```

- [ ] **Step 2: auto-commit squash 후 push**

  Plan B 마지막 커밋 `abb5052` 이후의 모든 커밋을 하나로 squash:

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git reset --soft abb5052
  git add src/App.jsx docs/
  git commit -m "$(cat <<'EOF'
  feat: Research Layer C — 스타일 선택 모드 UI

  - selectionMode 상태 추가 (auto/genre-forced/ref-locked)
  - 3모드 토글 버튼 UI (장르 드롭다운 앞에 위치)
  - 레퍼런스 고정 모드: run()의 isLocked 조건 연결
  - "이 스타일 고정" 버튼 선택 패키지 카드에 추가
  - 작업 의도 탭 상단에 선택 모드 배지 표시
  EOF
  )"
  ```

- [ ] **Step 3: Force push**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git push --force origin main
  git log --oneline -4
  git status
  ```

  Expected: 3개의 clean 커밋 (Plan A + Plan B + Plan C), working tree clean.

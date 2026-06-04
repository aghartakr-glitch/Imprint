# Imprint Research Layer — Plan A: 해석 가시화

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `semanticRerank()` 응답에 Design Concept/Task/Visual Element 추가, Revision Trajectory 기록, Evidence Map 백그라운드 생성, refine() patch+report 연동

**Architecture:** 모든 변경은 단일 파일 `src/App.jsx`에 집중. 새 React 상태 2개(`revisionLog`, `evidenceMap`) 추가. `semanticRerank()` 프롬프트 확장, 작업 의도 탭 UI 재구성, 수정 기록 탭 신설. refine() 완료 시 revisionLog 자동 기록.

**Tech Stack:** React 19 + Vite 8 + Anthropic Claude API (claude-sonnet-4-6) + inline CSS (테마 객체 `T`)

---

## 파일 구조

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `src/App.jsx` | Modify | 전체 변경 대상 (단일 파일) |

변경 위치 요약:
- **1711줄** 근처: `structuredReason` 상태 주석 업데이트 + `revisionLog`, `evidenceMap` 상태 추가
- **1891줄** 근처: `semanticRerank()` max_tokens 450→600, 반환 JSON 스키마 확장
- **2090줄** 근처: `run()` 완료 후 `revisionLog` rev_000 항목 추가
- **3955줄** 근처: `refine()` 함수 — `<interpretation>` 태그 파싱 + revisionLog rev_N 추가
- **4966줄** 근처: 탭 목록에 "수정 기록" 추가 (4개 탭)
- **4987줄** 근처: 작업 의도 탭 UI 전면 재구성
- **신규**: 수정 기록 탭 UI 컴포넌트
- **신규**: `buildEvidenceMap()` 비동기 함수 + useEffect 트리거

---

## Task 1: semanticRerank 프롬프트 확장

**파일:** `src/App.jsx` — `semanticRerank()` 함수 (약 1891줄)

`semanticRerank()`의 Claude 응답 JSON 스키마에 `design_concept`, `design_task`, `visual_element` 3개 배열 필드를 추가한다. max_tokens도 450→700으로 늘린다.

- [ ] **Step 1: 현재 semanticRerank 프롬프트의 반환 JSON 스키마 줄을 찾는다**

  `src/App.jsx` 약 1899줄:
  ```js
  '반환 JSON:\n{"i":<index>,"reference_reason":"<20자>","content_match":"<20자>","layout_reason":"<20자>","typography_reason":"<20자>","margin_reason":"<20자>","rejected":[{"i":<idx>,"reason":"<15자>"},{"i":<idx>,"reason":"<15자>"},{"i":<idx>,"reason":"<15자>"}],"prevUsedForced":<true|false>,"prevUsedReason":"<이유 or empty>"}'
  ```

- [ ] **Step 2: 반환 JSON 스키마 줄을 수정한다**

  기존:
  ```js
  '반환 JSON:\n{"i":<index>,"reference_reason":"<20자>","content_match":"<20자>","layout_reason":"<20자>","typography_reason":"<20자>","margin_reason":"<20자>","rejected":[{"i":<idx>,"reason":"<15자>"},{"i":<idx>,"reason":"<15자>"},{"i":<idx>,"reason":"<15자>"}],"prevUsedForced":<true|false>,"prevUsedReason":"<이유 or empty>"}'
  ```

  교체:
  ```js
  '반환 JSON:\n{"i":<index>,"reference_reason":"<20자>","content_match":"<20자>","layout_reason":"<20자>","typography_reason":"<20자>","margin_reason":"<20자>","design_concept":["<개념1>","<개념2>"],"design_task":["<과제1>","<과제2>"],"visual_element":["<요소1>","<요소2>","<요소3>"],"rejected":[{"i":<idx>,"reason":"<15자>"},{"i":<idx>,"reason":"<15자>"},{"i":<idx>,"reason":"<15자>"}],"prevUsedForced":<true|false>,"prevUsedReason":"<이유 or empty>"}\n\ndesign_concept: 본문 정서/분위기 2~4개 (예: ["조용한 회고","기억의 회복"])\ndesign_task: 조판 과제 2~4개 (예: ["읽기 속도 낮추기","정적 분위기 만들기"])\nvisual_element: 실제 수치/스타일 3~6개 (예: ["120×192mm 판형","8.5pt/16pt","넓은 하단 여백"])'
  ```

- [ ] **Step 3: max_tokens를 450→700으로 수정한다**

  기존:
  ```js
  model: 'claude-sonnet-4-6', max_tokens: 450,
  ```

  교체:
  ```js
  model: 'claude-sonnet-4-6', max_tokens: 700,
  ```

- [ ] **Step 4: 개발 서버를 실행하고 스타일 생성 테스트**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npm run dev
  ```
  브라우저 Console에서 `structuredReason` 확인:
  ```js
  // 생성 완료 후 브라우저 콘솔에서
  // Network 탭 → anthropic/v1/messages 응답에 design_concept 배열이 있어야 함
  ```

- [ ] **Step 5: Commit**

  ```
  git add src/App.jsx
  git commit -m "feat: semanticRerank에 design_concept/task/visual_element 필드 추가"
  ```

---

## Task 2: 작업 의도 탭 UI 재구성

**파일:** `src/App.jsx` — 작업 의도 탭 렌더링 (약 4987~5044줄)

기존 flat 리스트를 Design Concept / Design Task / Visual Element 섹션으로 분리한다.

- [ ] **Step 1: 작업 의도 탭 전체 블록을 교체한다**

  기존 (`{tab === "intent" && (` 블록 전체):
  ```jsx
  {tab === "intent" && (
    <div style={{ padding:"20px 24px" }}>
      {(() => {
        const reason = structuredReason || (pkg ? {
          reference_reason: pkg.summary || null,
          content_match: null,
          layout_reason: pkg.c?.구성 ? `${pkg.c.구성} 레이아웃 — ${pkg.layout_type || ''}` : null,
          typography_reason: pkg.why_font || null,
          margin_reason: pkg.why_margin || null,
        } : null);
        return reason ? (
        <div style={{ display:"flex", flexDirection:"column" }}>
          {[
            ["레퍼런스 선정", reason.reference_reason],
            ["내용 매칭", reason.content_match],
            ["레이아웃 판단", reason.layout_reason],
            ["서체 선택", reason.typography_reason || pkg?.why_font],
            ["여백 설계", reason.margin_reason || pkg?.why_margin],
            ["자간 설정", pkg?.why_tracking],
          ].filter(([,v]) => v).map(([label, value], idx, arr) => (
            <div key={label} style={{
              padding:"14px 0",
              borderBottom: idx < arr.length - 1 ? `1px solid ${T.border}` : "none",
            }}>
              <div style={{
                fontSize:9, fontWeight:700, color:T.muted,
                textTransform:"uppercase", letterSpacing:"0.09em", marginBottom:6,
              }}>
                {label}
              </div>
              <div style={{ fontSize:13, color:T.ink, lineHeight:1.75 }}>{value}</div>
            </div>
          ))}

          {/* 탈락 패키지 */}
          {structuredReason?.rejected?.length > 0 && (
            <div style={{ paddingTop:14, marginTop:4, borderTop:`1px solid ${T.border}` }}>
              <div style={{
                fontSize:9, fontWeight:700, color:T.muted,
                textTransform:"uppercase", letterSpacing:"0.09em", marginBottom:8,
              }}>
                검토 후 제외
              </div>
              {structuredReason.rejected.map((r, i) => (
                <div key={i} style={{ fontSize:12, color:T.muted, lineHeight:1.7 }}>
                  <span style={{ color:T.ink, fontWeight:600 }}>{DB[r.i]?.t?.slice(0,20)}</span>
                  {" — "}{r.reason}
                </div>
              ))}
            </div>
          )}
        </div>
        ) : (
          <div style={{ color:T.muted, fontSize:13 }}>스타일을 먼저 생성하세요.</div>
        );
      })()}
    </div>
  )}
  ```

  교체 (아래 전체로):
  ```jsx
  {tab === "intent" && (
    <div style={{ padding:"20px 24px" }}>
      {!structuredReason && !pkg ? (
        <div style={{ color:T.muted, fontSize:13 }}>스타일을 먼저 생성하세요.</div>
      ) : (() => {
        const sr = structuredReason || {};
        // 섹션 레이블 렌더 헬퍼
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
  ```

- [ ] **Step 2: 개발 서버에서 시각 확인**

  스타일 생성 후 "작업 의도" 탭에서:
  - Design Concept / Design Task / Visual Element 섹션이 순서대로 표시되어야 함
  - DB 기반 설계 근거(서체/여백/자간)는 하단에 위치해야 함
  - evidenceMap은 "분석 중…" 상태로 표시되어야 함

- [ ] **Step 3: Commit**

  ```
  git add src/App.jsx
  git commit -m "feat: 작업 의도 탭 Design Concept/Task/Visual Element 구조 재편"
  ```

---

## Task 3: Revision Trajectory 상태 및 초기 생성 기록

**파일:** `src/App.jsx` — 상태 선언부(약 1711줄) + `run()` 완료 처리(약 2090줄)

- [ ] **Step 1: revisionLog 및 evidenceMap 상태를 상태 선언 블록에 추가한다**

  기존 (약 1711줄):
  ```js
  const [structuredReason, setStructuredReason] = useState(null); // {reference_reason, content_match, layout_reason, typography_reason, margin_reason}
  ```

  교체:
  ```js
  const [structuredReason, setStructuredReason] = useState(null); // {reference_reason, content_match, layout_reason, design_concept[], design_task[], visual_element[], ...}
  const [revisionLog, setRevisionLog] = useState([]); // Revision Trajectory [{id, type, ...}]
  const [evidenceMap, setEvidenceMap] = useState(null); // null=미생성, []=생성중, [...]=완료
  ```

- [ ] **Step 2: run() 초기화 블록에서 revisionLog와 evidenceMap을 리셋한다**

  기존 `run()` 함수의 초기화 블록(약 1929줄):
  ```js
  setStructuredReason(null);
  setTextProfile(null);
  setRunLog([]);
  ```

  교체:
  ```js
  setStructuredReason(null);
  setTextProfile(null);
  setRunLog([]);
  setRevisionLog([]);
  setEvidenceMap(null);
  ```

- [ ] **Step 3: run() 완료 후 rev_000 항목을 revisionLog에 추가한다**

  `run()` 함수에서 `setLatex(finalMainTex)` 또는 `setLatex(result)` 이후 `setLoading(false)` 직전에 삽입. 약 3750줄 근처 (현재 `setLatex`, `setStyCode`, `setLoading(false)` 순서로 있는 위치).

  삽입할 코드:
  ```js
  // ── Revision Trajectory: rev_000 초기 생성 기록 ──────────────────
  const _cmdMap0 = extractLatexCommandMap(finalMainTex || latex || '');
  setRevisionLog([{
    id: 'rev_000',
    type: 'initial_generation',
    timestamp: new Date().toISOString(),
    userInput: {
      title: fields.제목 || '',
      bodyHash: simpleHash(fields.본문 || ''),
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
      styHash: simpleHash(styContent || ''),
    },
  }]);
  ```

  > **주의:** `finalMainTex`, `styContent`, `rerank`, `structReason`은 `run()` 함수 내 지역 변수. 정확한 변수명은 해당 위치 코드 확인 필요. `setLatex()` 직전에 사용되는 변수명 그대로 사용할 것.

- [ ] **Step 4: 브라우저 콘솔에서 revisionLog 상태 확인**

  스타일 생성 후 React DevTools 또는 임시 `console.log`:
  ```js
  // run() 완료 후 콘솔 확인용 (Task 완료 후 제거)
  console.log('[rev_000]', revisionLog);
  ```
  rev_000 항목에 `interpretation.designConcept` 배열이 채워져 있어야 함.

- [ ] **Step 5: Commit**

  ```
  git add src/App.jsx
  git commit -m "feat: revisionLog 상태 추가 및 rev_000 초기 생성 기록"
  ```

---

## Task 4: 수정 기록 탭 UI

**파일:** `src/App.jsx` — 탭 목록(약 4969줄) + 탭 콘텐츠 블록

- [ ] **Step 1: 탭 목록에 "수정 기록" 추가**

  기존:
  ```jsx
  {[
    ["intent","작업 의도"],
    ["final","최종 파일"],
    ["sty","스타일 파일"],
  ].map(...)
  ```

  교체:
  ```jsx
  {[
    ["intent","작업 의도"],
    ["revlog","수정 기록"],
    ["final","최종 파일"],
    ["sty","스타일 파일"],
  ].map(...)
  ```

- [ ] **Step 2: 수정 기록 탭 콘텐츠를 작업 의도 탭 블록 바로 뒤에 삽입**

  `{tab === "intent" && (...)}` 블록 바로 뒤에 삽입:
  ```jsx
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

              {/* 헤더 */}
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

              {/* 초기 생성 */}
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

              {/* 사용자 수정 */}
              {rev.type === 'user_refinement' && (
                <div style={{ fontSize:12, lineHeight:1.7 }}>
                  {rev.userRequest && (
                    <div style={{ fontStyle:"italic", color:T.ink,
                      marginBottom:6 }}>"{rev.userRequest}"</div>
                  )}
                  {rev.systemInterpretation?.designTask && (
                    <div style={{ color:T.muted, marginBottom:6 }}>
                      해석: {rev.systemInterpretation.designTask}
                    </div>
                  )}
                  {rev.patch?.map((p, pi) => (
                    <div key={pi} style={{ display:"flex", gap:6, alignItems:"center",
                      marginBottom:3 }}>
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

          {/* Export 버튼 */}
          <button onClick={() => {
            const blob = new Blob([JSON.stringify(revisionLog, null, 2)],
              { type: 'application/json' });
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
  ```

- [ ] **Step 3: 브라우저에서 수정 기록 탭 시각 확인**

  스타일 생성 후 "수정 기록" 탭 클릭 → Revision 0 카드가 표시되어야 함.  
  "수정 기록 Export (JSON)" 클릭 → `revision_log_YYYY-MM-DD.json` 다운로드 확인.

- [ ] **Step 4: Commit**

  ```
  git add src/App.jsx
  git commit -m "feat: 수정 기록 탭 추가 및 revision_log.json Export 기능"
  ```

---

## Task 5: refine() — interpretation 파싱 + revisionLog 연결

**파일:** `src/App.jsx` — `refine()` 함수 (약 3960줄~)

refine() 완료 시 `<interpretation>` 태그를 파싱하고 revisionLog에 rev_N 항목을 추가한다.

- [ ] **Step 1: refine() 시스템 프롬프트에 interpretation 지시를 추가한다**

  `refine()` 함수 내 `outputRules` 변수의 `intent === 'modify'` 분기를 찾는다. 약 4070줄:
  ```js
  `출력 규칙 (수정 모드):
  1. 한국어로 무엇을 어떻게 바꾸는지 1~2문장으로 설명한다.
  2. 설명 앞에 <interpretation> 태그로 디자인 해석을 먼저 출력한다:
  ```

  기존 `intent === 'modify'` 분기의 출력 규칙 문자열에 다음을 추가:
  ```
  출력 규칙 (수정 모드):
  1. 먼저 <interpretation>designConcept: ...\ndesignTask: ...\nvisualElement: ...</interpretation> 태그로 해석을 출력한다.
  2. 한국어로 무엇을 어떻게 바꾸는지 1~2문장으로 설명한다.
  3. ...
  ```

  정확히 교체할 문자열을 찾아 다음으로 교체:
  ```js
  `출력 규칙 (수정 모드):
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
  ```

- [ ] **Step 2: refine() 스트리밍 완료 후 interpretation 파싱 코드를 추가한다**

  `setRefineHistory(h => [...h, {` 직전 (약 4240줄)에 삽입:
  ```js
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
  ```

- [ ] **Step 3: revisionLog에 rev_N 항목을 추가하는 코드를 삽입한다**

  `setRefineHistory(...)` 호출 바로 뒤에 삽입:
  ```js
  // ── revisionLog에 user_refinement 기록 ───────────────────────────
  if (codeChanged) {
    const _cmdMapBefore = cmdMap; // 수정 전 (refine() 시작 시 이미 추출됨)
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
      .filter(k => _cmdMapAfter[k] !== undefined && _cmdMapBefore[k] !== _cmdMapAfter[k])
      .map(k => ({
        target: cmLabel[k],
        before: _cmdMapBefore[k] !== undefined ? String(_cmdMapBefore[k]) : '(없음)',
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
  ```

- [ ] **Step 4: chatContent 렌더링을 chatContentClean으로 교체한다**

  `setRefineHistory` 호출에서 `chatContent` → `chatContentClean` 교체:
  ```js
  setRefineHistory(h => [...h, {
    role: 'assistant',
    chatContent: chatContentClean,   // ← chatContent → chatContentClean
    content: chatContentClean,       // ← 동일
    changes: changesSummary,
    codeChanged,
    intent,
  }]);
  ```

- [ ] **Step 5: 수정 테스트**

  채팅에 "각주 조금 작게" 입력 후:
  - 채팅 말풍선에 `<interpretation>` 태그가 노출되지 않아야 함
  - "수정 기록" 탭에 rev_001 카드가 추가되어야 함
  - patch 배열에 footnoteSize 변경이 before/after로 표시되어야 함

- [ ] **Step 6: Commit**

  ```
  git add src/App.jsx
  git commit -m "feat: refine() interpretation 파싱 + revisionLog 자동 기록"
  ```

---

## Task 6: Evidence Map 백그라운드 생성

**파일:** `src/App.jsx` — `buildEvidenceMap()` 함수 신설 + `useEffect` 트리거

- [ ] **Step 1: buildEvidenceMap() 함수를 refine() 함수 바로 앞에 추가한다**

  ```js
  // ── Evidence Map 백그라운드 생성 ─────────────────────────────────
  async function buildEvidenceMap(text, structReason, latexStr, _apiKey) {
    if (!text || !_apiKey) return;
    setEvidenceMap([]); // 로딩 시작 (빈 배열 = 생성 중)
    try {
      const prompt = `아래 입력 텍스트와 선택된 디자인 개념/과제를 보고,
  본문에서 중요한 근거 문장/표현 3~5개를 추출하여 각각이 어떤 조판 결정과 연결되는지 분석하라.

  입력 텍스트(앞 400자):
  "${text.slice(0, 400)}"

  선택된 디자인 개념: ${(structReason?.design_concept || []).join(', ')}
  선택된 디자인 과제: ${(structReason?.design_task || []).join(', ')}

  반환 JSON (배열):
  [
    {
      "textSpan": "<본문에서 추출한 실제 표현 (10~25자)>",
      "interpretation": "<그 표현의 디자인적 해석 (10~20자)>",
      "designConcept": "<관련 디자인 개념 (10자 이내)>",
      "designTask": "<관련 디자인 과제 (15자 이내)>",
      "affectedVariables": ["<조판 변수1>", "<조판 변수2>"]
    }
  ]
  반드시 유효한 JSON 배열만 반환하라. 다른 텍스트 없음.`;

      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch('/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': _apiKey },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 800,
          system: 'Return ONLY valid JSON array, no other text.',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      clearTimeout(tid);
      if (!res.ok) { setEvidenceMap([]); return; }
      const data = await res.json();
      const raw = (data.content || []).map(x => x.text || '').join('');
      const parsed = JSON.parse(raw.replace(/^[^\[]*/, '').replace(/[^\]]*$/, ''));
      setEvidenceMap(Array.isArray(parsed) ? parsed : []);
    } catch (e) {
      console.warn('[EvidenceMap] 생성 실패:', e.message);
      setEvidenceMap([]); // 실패해도 UI 블록은 빈 상태로 처리
    }
  }
  ```

- [ ] **Step 2: latex 변경 시 buildEvidenceMap을 트리거하는 useEffect를 추가한다**

  컴포넌트 내 다른 `useEffect` 근처(약 1730줄 이후 첫 useEffect 위치)에 추가:
  ```js
  // Evidence Map: latex 생성 완료 시 백그라운드 실행
  useEffect(() => {
    if (!latex || !apiKey) return;
    const bodyText = (fields.본문 || '').trim();
    if (!bodyText || !structuredReason) return;
    buildEvidenceMap(bodyText, structuredReason, latex, apiKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latex]);
  ```

  > **주의:** `buildEvidenceMap`은 `useEffect` 안에서 호출되므로 의존성 배열에 넣지 않는다. `apiKey`와 `fields.본문`은 `latex`가 설정될 때 이미 정해진 값.

- [ ] **Step 3: 브라우저에서 Evidence Map 확인**

  스타일 생성 후:
  - 작업 의도 탭에 "분석 중…" 표시 → 수초 후 Evidence Map 항목들이 나타나야 함
  - 각 항목: 인용구(이탤릭) + 해석 + 영향 변수 표시
  - 생성 실패 시 항목이 사라지고 아무것도 표시 안 됨 (에러 없이 조용하게)

- [ ] **Step 4: Commit**

  ```
  git add src/App.jsx
  git commit -m "feat: Evidence Map 백그라운드 생성 및 작업 의도 탭 표시"
  ```

---

## Task 7: GitHub push 및 최종 확인

- [ ] **Step 1: 전체 변경사항 최종 확인**

  ```
  npm run dev
  ```

  체크리스트:
  - [ ] 작업 의도 탭: 레퍼런스 선정 → Design Concept → Design Task → Visual Element → Evidence Map → DB 설계 근거 순서 표시
  - [ ] Design Concept/Task/Visual Element: 불릿 리스트로 표시
  - [ ] Evidence Map: 백그라운드 생성 후 본문 인용 → 해석 → 변수 카드 표시
  - [ ] 수정 기록 탭: Revision 0 카드 (초기 생성 정보)
  - [ ] 채팅 수정 후: 수정 기록 탭에 Revision 1 카드 추가
  - [ ] "수정 기록 Export" 버튼 → revision_log.json 다운로드
  - [ ] `<interpretation>` 태그가 채팅 말풍선에 노출되지 않음

- [ ] **Step 2: GitHub push**

  ```
  git push origin main
  ```

---

## 다음 단계

Plan A 완료 후:
- **Plan B** (`2026-06-02-imprint-research-layer-plan-B.md`) — 기술 안정성: Variable Grid JSON, 주석 마커 검증, Export Validation, Patch Report
- **Plan C** (`2026-06-02-imprint-research-layer-plan-C.md`) — UX/모드: 장르 선택 모드 분리, chip grid UI

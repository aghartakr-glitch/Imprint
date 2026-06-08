# Imprint 실험 탭 — Plan E-A: 탭 재구조화 + 실험 탭 UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 왼쪽 패널의 "스타일 지시" 탭을 "실험 탭"으로 교체하고, 생성 전/후 상태에 따른 피드백 입력 UI를 구현한다.

**Architecture:** 단일 파일 `src/App.jsx`. `inputTab` 상태를 `'text' | 'experiment'`로 변경. 실험 탭은 `isDone`(생성 완료 여부)에 따라 활성/비활성 UI를 전환. 피드백·만족도 상태 추가. 생성 완료 시 자동으로 실험 탭으로 이동.

**Tech Stack:** React 19 + Vite 8 + inline CSS (테마 객체 `T`)

---

## 현황 분석

| 항목 | 현재 상태 |
|------|----------|
| `inputTab` 상태 | `0` (텍스트입력) / `1` (스타일지시) |
| "스타일 지시" 탭 내용 | 현재 **빈 화면** — `inputTab===1`에 아무것도 렌더링 안됨 |
| 스타일 설정 위치 | 이미 텍스트 입력 탭(inputTab===0) 안에 있음 |
| `isDone` 상태 | `!!latex` — LaTeX 생성됐으면 true |
| 실험 탭 관련 상태 | 없음 — 신규 추가 필요 |

---

## 파일 구조

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `src/App.jsx` | Modify | 전체 변경 대상 (단일 파일) |

변경 위치:
- **~1568줄**: `inputTab` 초기값 `0` → `'text'`
- **~4784줄**: 탭 목록 `["text","텍스트 입력"],["style","스타일 지시"]` → `["text","텍스트 입력"],["experiment","실험"]`
- **~4798줄**: `inputTab === 0` → `inputTab === 'text'`
- **신규**: `experimentFeedback`, `satisfactionScore`, `experimentAnalysis` 상태 추가
- **신규**: 실험 탭 콘텐츠 블록 (피드백 textarea + 만족도 + 비활성화 overlay)
- **~3810줄**: `run()` 완료 후 `setInputTab('experiment')` 추가

---

## Task 1: inputTab 상태 타입 변경 + 탭 목록 교체

**파일:** `src/App.jsx`

- [ ] **Step 1: `inputTab` 초기값을 문자열로 변경**

  기존 (`~line 1568`):
  ```js
  const [inputTab, setInputTab] = useState(0);
  ```
  교체:
  ```js
  const [inputTab, setInputTab] = useState('text'); // 'text' | 'experiment'
  ```

- [ ] **Step 2: 탭 목록을 새로 교체**

  기존 (`~line 4784`):
  ```jsx
  {[["text","텍스트 입력"],["style","스타일 지시"]].map(([k,label]) => (
    <button key={k} onClick={() => setInputTab(k === "text" ? 0 : 1)}
      style={{ ...
        fontWeight: (k === "text" ? inputTab===0 : inputTab===1) ? 700 : 400,
        border:"none", borderBottom: (k === "text" ? inputTab===0 : inputTab===1)
          ? `2px solid ${T.ink}` : "2px solid transparent",
        background:"transparent", color: (k === "text" ? inputTab===0 : inputTab===1)
          ? T.ink : T.muted, cursor:"pointer", marginBottom:-1 }}>
      {label}
    </button>
  ))}
  ```

  교체:
  ```jsx
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
  ```

- [ ] **Step 3: 텍스트 입력 탭 조건 수정**

  기존 (`~line 4798`):
  ```jsx
  {inputTab === 0 ? (
  ```
  교체:
  ```jsx
  {inputTab === 'text' ? (
  ```

- [ ] **Step 4: 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | grep -E "built|error"
  ```

- [ ] **Step 5: Commit**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git add src/App.jsx
  git commit -m "feat: 왼쪽 패널 탭 재구조화 (스타일지시→실험탭)"
  ```

---

## Task 2: 실험 탭 신규 상태 추가

**파일:** `src/App.jsx` — 상태 선언부 (~line 1568 근처)

- [ ] **Step 1: 실험 탭 관련 상태를 `inputTab` 상태 바로 뒤에 추가**

  기존:
  ```js
  const [inputTab, setInputTab] = useState('text');
  ```

  교체:
  ```js
  const [inputTab, setInputTab] = useState('text'); // 'text' | 'experiment'
  const [experimentFeedback, setExperimentFeedback] = useState(''); // 사용자 정답 피드백
  const [satisfactionScore, setSatisfactionScore] = useState(null); // 1~5 또는 null
  const [experimentAnalysis, setExperimentAnalysis] = useState(null); // 분석 결과 {matchRate, diff, nextRule}
  ```

- [ ] **Step 2: `run()` 초기화 블록에 실험 상태 리셋 추가**

  기존 초기화 블록에 `setRevisionLog([])`, `setEvidenceMap(null)` 등이 있는 곳 (~line 2045):
  ```js
  setRevisionLog([]);
  setEvidenceMap(null);
  ```

  그 뒤에 추가:
  ```js
  setExperimentFeedback('');
  setSatisfactionScore(null);
  setExperimentAnalysis(null);
  ```

- [ ] **Step 3: run() 완료 후 실험 탭으로 자동 이동**

  `setLoading(false)` 호출 직전 (~line 3810 근처, `pushLog('latex', 'LaTeX 생성', 'done', ...)` 이후)에 추가:
  ```js
  // 생성 완료 → 실험 탭으로 자동 이동
  setInputTab('experiment');
  ```

  > **주의:** `setLoading(false)`가 호출되는 정확한 위치를 파일에서 확인 후 그 직전에 삽입할 것. `run()` 함수 내에서 `setLoading(false)`는 `finally` 블록이 아닌 정상 완료 시점에 있음.

- [ ] **Step 4: 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | grep -E "built|error"
  ```

- [ ] **Step 5: Commit**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git add src/App.jsx
  git commit -m "feat: 실험 탭 상태 추가 및 생성 완료 후 자동 이동"
  ```

---

## Task 3: 실험 탭 UI — 비활성화 상태 (생성 전)

**파일:** `src/App.jsx` — 텍스트 입력 탭 콘텐츠 블록 끝 (~line 5217)

`{inputTab === 'text' ? ( <> ... </> ) : null}` 의 null 부분을 실험 탭 UI로 교체한다.

- [ ] **Step 1: null을 실험 탭 UI 블록으로 교체**

  기존 (`inputTab === 'text' ? ( <> ... </> )}` 의 닫는 부분):
  ```jsx
              </>
            )}
          </div>
  ```

  교체:
  ```jsx
              </>
            ) : (
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
                    {/* 비활성화된 미리보기 */}
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

                    {/* 정답 피드백 */}
                    <div>
                      <label style={{ display:'block', fontSize:11, fontWeight:600,
                        color:T.ink, marginBottom:5 }}>
                        정답 피드백
                      </label>
                      <div style={{ fontSize:11, color:T.muted, marginBottom:6, lineHeight:1.5 }}>
                        시스템의 결과가 의도와 얼마나 맞았는지, 어떤 부분이 달랐는지 작성하세요.
                      </div>
                      <textarea
                        value={experimentFeedback}
                        onChange={e => setExperimentFeedback(e.target.value)}
                        rows={5}
                        placeholder={"예: 각주 크기는 맞게 줄었지만, 내가 원한 건 크기보다 본문과 각주 사이 간격을 넓히는 것이었다."}
                        style={{ width:'100%', padding:'9px 11px', fontSize:12,
                          border:`1px solid ${T.border}`, borderRadius:3,
                          background:T.bg, color:T.ink, lineHeight:1.6,
                          resize:'vertical' }}
                        onFocus={e => e.target.style.borderColor = T.ink}
                        onBlur={e => e.target.style.borderColor = T.border}
                      />
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
                    <button
                      disabled={!experimentFeedback.trim() || satisfactionScore === null}
                      style={{ padding:'10px', fontSize:12, fontWeight:600,
                        border:'none', borderRadius:3,
                        background: (!experimentFeedback.trim() || satisfactionScore === null)
                          ? T.border : T.ink,
                        color: (!experimentFeedback.trim() || satisfactionScore === null)
                          ? T.muted : '#fff',
                        cursor: (!experimentFeedback.trim() || satisfactionScore === null)
                          ? 'not-allowed' : 'pointer' }}>
                      피드백 분석하기
                    </button>

                    {/* 분석 결과 플레이스홀더 (Plan E-B에서 채움) */}
                    {experimentAnalysis && (
                      <div style={{ padding:'12px', background:T.bg,
                        border:`1px solid ${T.border}`, borderRadius:3,
                        fontSize:12, color:T.ink }}>
                        분석 결과 (Plan E-B에서 구현)
                      </div>
                    )}

                  </div>
                )}
              </div>
            )}
          </div>
  ```

- [ ] **Step 2: 빌드 확인**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  npx vite build --mode development 2>&1 | grep -E "built|error"
  ```
  Expected: `✓ built`

- [ ] **Step 3: 브라우저에서 시각 확인**

  - 실험 탭 클릭 → "아직 생성 전입니다" 안내 + 흐린 피드백 미리보기
  - 생성 완료 후 → 실험 탭 자동 이동 + 피드백 textarea + 만족도 버튼 활성화
  - 피드백 미입력 또는 만족도 미선택 시 "피드백 분석하기" 버튼 비활성

- [ ] **Step 4: Commit**

  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git add src/App.jsx
  git commit -m "feat: 실험 탭 UI — 피드백 입력 + 만족도 5단계"
  ```

---

## Task 4: GitHub push 및 Plan E-A 마무리

- [ ] **Step 1: auto-commit squash + push**

  최근 Plan E-A 커밋들을 squash (기준: 직전 clean commit 해시 확인 후):
  ```
  cd C:\Users\mjungpk\Desktop\Imprint
  git log --oneline -5
  git reset --soft <직전_clean_commit_hash>
  git add src/App.jsx
  git commit -m "$(cat <<'EOF'
  feat: 실험 탭 E-A — 탭 재구조화 + 피드백 UI

  - 왼쪽 패널 스타일지시 탭 → 실험 탭으로 교체
  - 생성 전: 비활성화 안내 + 흐린 미리보기
  - 생성 후: 피드백 textarea + 만족도 5단계 (리커트) 활성화
  - 생성 완료 시 실험 탭 자동 이동
  - experimentFeedback, satisfactionScore, experimentAnalysis 상태 추가
  EOF
  )"
  git push --force origin main
  git log --oneline -4
  ```

---

## 다음 단계

Plan E-A 완료 후:
- **Plan E-B** — Claude API 분석: 일치율 계산, 차이점 도출, 다음 규칙 생성, 분석 결과 UI
- **Plan E-C** — CSV/MD 로그 export, 학습 규칙 요약 저장

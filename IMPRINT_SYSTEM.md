# Imprint v1.3.0 — 시스템 설명서
> 편집 디자인 조판 스타일 생성 앱 (React + XeLaTeX)
> 파일: `C:\Users\mjungpk\Desktop\Imprint\src\App.jsx` (약 4,300줄, 단일 파일)

---

## 1. 앱 개요

사용자가 텍스트를 붙여넣으면, 실제 출판물 레퍼런스 DB에서 내용과 가장 잘 맞는 조판 스타일을 찾아 **XeLaTeX `.sty` 파일**로 출력하는 앱이다. 출력된 `.sty`를 TeXworks 같은 LaTeX 에디터에 넣으면 바로 인쇄 가능한 편집 디자인이 나온다.

```
사용자 텍스트 입력
    ↓
[analyzeText] — Claude API로 텍스트 분석 (장르/주제/출판형태 추론)
    ↓
[scoreKw] — DB 253개 항목에 점수 매기기 (키워드·장르 매칭)
    ↓
[semanticRerank] — Claude API로 상위 10개 중 최적 선택
    ↓
[inferAlignment] — 본문 정렬 방식 자동 결정
    ↓
[buildStyleFile + buildMainTex] — XeLaTeX 코드 생성
    ↓
출력: imprint-style.sty + main.tex
    ↓
[refine 채팅] — 생성 결과를 자연어로 실시간 수정
```

---

## 2. 기술 스택

| 항목 | 내용 |
|------|------|
| 프레임워크 | React + Vite (SPA, 단일 파일 `App.jsx`) |
| 스타일링 | 인라인 CSS (테마 객체 `T`) |
| LaTeX 엔진 | XeLaTeX (`fontspec`, `geometry`, `memoir`) |
| AI | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| API 연결 | Vite dev proxy `/anthropic` → `https://api.anthropic.com` |
| 상태 관리 | React `useState` / `useRef` 전용 |
| 데이터 저장 | `localStorage` (API 키, 로그) |

---

## 3. 핵심 데이터 구조

### DB (253개 스타일 패키지)
각 항목은 실제 한국 출판물 레퍼런스:

```js
{
  id: "sulki_min_massstudies",
  title: "매스스터디스 건축하기 전/후",
  designer: "슬기와 민 (Sulki and Min)",
  g: ["건축·공간", "전시·큐레이션"],   // 장르 (필터링 기준)
  pub_type: "전시도록",                 // 출판 형태 (필터링에 미사용, 참고용)
  kw: ["건축", "공간", "구조", ...],    // 키워드 (scoreKw용)
  f: { w: 186, h: 243 },               // 판형 (mm)
  layout_type: "side-note-right",      // 레이아웃 유형
  body_cols: 2,                        // 본문 단수
  note_cols: 1,                        // 주석 단수
  pn: "하단-외측",                      // 쪽번호 위치
  pn_font: "고딕",                      // 쪽번호 서체
  // ... 기타 타이포 파라미터
}
```

**layout_type 종류:**
- `side-note-right` / `side-note-left` — 오른쪽/왼쪽 주석 열
- `full-width` — 전체 너비 본문
- `multi-col` — 다단 구성

### 장르 목록 (g 필드 기준)
```
건축·공간 / 그래픽디자인 / 문학 / 사진 / 시각문화·매체
아트이론·비평 / 인문·사회 / 전시·큐레이션 / 타이포그래피 / 현대미술 / 기타
```

---

## 4. 핵심 함수 파이프라인

### 4-1. `analyzeText(text, apiKey)`
Claude API 호출 → 텍스트에서 JSON 추출
```js
{ topic, textForm, pubType, exhibitEvidence, riskyKeywords }
```

### 4-2. `scoreKw(p, text, hint)`
DB 항목 하나에 점수 계산:
- **kwScore**: DB의 `kw` 배열과 입력 텍스트 키워드 매칭 (TF-IDF 유사)
- **genreScore**: 선택된 장르와 `p.g` 일치 여부
- pubTypeScore/layoutScore 제거됨 (v1.3.0에서 바이어스 제거)

### 4-3. `semanticRerank(text, profile, ranked, hint, testCtx)`
Claude API 호출 → 상위 10개 중 내용적으로 가장 잘 맞는 것 선택
- 이전에 선택된 항목은 감점 처리 (중복 방지)

### 4-4. `inferAlignment(p, numCols)`
- 장르/레이아웃 기반으로 본문 정렬 자동 결정
- 문학 → ragged right / 기타 → justified

### 4-5. `wrapVariableLayout({ bodyLatex, noteLatex, grid, notePosition })`
- **side**: 본문+주석을 `minipage` 또는 `multicol`로 배치
- **bottom**: `\ImpFN{N}` 마커를 `\footnote{...}`로 인라인 변환

### 4-6. `buildStyleFile(p, fields, grid, runMeta)`
XeLaTeX `.sty` 파일 전체 생성:
- `\RequirePackage` 목록
- `\geometry` (판형·여백)
- `\setmainfont` (Pretendard, LetterSpace 자간)
- `\fontsize{Xpt}{Ypt}\selectfont` (본문 크기/행간)
- `\newcommand{\notef}{...}` (사이드노트 서체·크기)
- `\renewcommand{\footnotesize}{...}` (하단 각주 크기)
- memoir pagestyle (쪽번호 위치·크기)

### 4-7. `buildMainTex(p, fields, grid, ...)`
실제 조판 본문 LaTeX 생성:
- 본문 → `\begin{adjustwidth}` + minipage 구조
- 주석 → `{\notef ... \textsuperscript{N} ...}`
- 각주(하단) → `\footnote{...}`

---

## 5. Refine 채팅 (핵심 기능)

생성된 스타일을 자연어로 수정하는 Claude 기반 내장 채팅.

### 구조
```
사용자: "각주 좀 작게"
    ↓
[extractLatexCommandMap(현재 LaTeX)] — 수정 전 수치 스냅샷
    ↓
[Claude API 스트리밍 호출]
 - stream: true (SSE)
 - 멀티턴 히스토리 누적
 - 시스템 프롬프트: 현재 수치 + 커맨드 라우팅 규칙
    ↓
실시간 텍스트 스트리밍 (ReadableStream + TextDecoder)
    ↓
응답 파싱:
 - 자연어 부분 → 채팅 말풍선 표시
 - <latex_update>...</latex_update> → 새 LaTeX 추출
    ↓
[extractLatexCommandMap(새 LaTeX)] — 수정 후 수치 스냅샷
    ↓
전/후 직접 비교 → "주석 크기: 8.5pt → 6pt" 표시
```

### `extractLatexCommandMap(latexStr)` — 수치 추출기
```js
{
  bodySize, bodyLeading,      // 본문 fontsize
  noteSize, noteLeading,      // \notef fontsize  
  footnoteSize, footnoteLeading, // \footnotesize
  letterSpace,                // LetterSpace=
  marginTop, marginBottom, marginInner, marginOuter, // \geometry
  pnFoot, pnHead,             // 쪽번호 위치
}
```

### 커맨드 라우팅 규칙 (프롬프트 내)
- `\notef` 있는 레이아웃에서 "각주/주석/사이드노트/옆 글씨" → `\notef` 수정
- 하단 각주 → `\renewcommand{\footnotesize}`
- 자간 → `LetterSpace=`
- 여백 → `\geometry` top/bottom/inner/outer

### 자연어 크기 기준
```
"조금/약간" = ±10%
"좀/더"     = ±15%
"크게/많이" = ±25%
"훨씬/아주" = ±35%
```

---

## 6. 주요 LaTeX 커맨드 구조

```latex
% 본문 크기
{\fontsize{8.5pt}{14pt}\selectfont ...}

% 사이드노트 (주석 열)
\newcommand{\notef}{\rmfamily\fontsize{6pt}{10pt}\selectfont}
% 사용: {\notef\textsuperscript{1}~주석 내용\par\smallskip}

% 하단 각주
\renewcommand{\footnotesize}{\fontsize{7pt}{11pt}\selectfont}

% 판형 + 여백
\geometry{paperwidth=186mm, paperheight=243mm,
          top=18mm, bottom=15mm, inner=12mm, outer=15mm}

% 자간
\setmainfont[LetterSpace=-20]{Pretendard}

% 본문+주석 레이아웃 (side-note-right)
\begin{minipage}[t]{84mm}  % 본문
  ...
\end{minipage}\hspace{5mm}
\begin{minipage}[t]{33mm}  % 주석
  {\notef ...}
\end{minipage}

% 쪽번호
\makeoddfoot{imprint}{}{}{\thepage}
```

---

## 7. 알려진 이슈 / 미해결 항목

| 이슈 | 상태 |
|------|------|
| `multicol` 패키지 누락 오류 (실험출판 장르) | 미해결 |
| bottom 모드에서 `[N]` 마커 없을 때 export 차단 | 미해결 |
| Anthropic API 크레딧 별도 구매 필요 (Claude.ai 구독과 별개) | 사용자 확인 필요 |

---

## 8. 파일 구조

```
C:\Users\mjungpk\Desktop\Imprint\
├── src/
│   └── App.jsx          ← 전체 앱 (단일 파일, ~4,300줄)
├── vite.config.js       ← Vite + Anthropic API 프록시 설정
├── index.html
├── package.json
└── dist/                ← 빌드 결과물
```

### vite.config.js (API 프록시)
```js
proxy: {
  '/anthropic': {
    target: 'https://api.anthropic.com',
    changeOrigin: true,
    rewrite: path => path.replace(/^\/anthropic/, ''),
    headers: {
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  },
},
```

---

## 9. 개발 환경 실행

```bash
cd C:\Users\mjungpk\Desktop\Imprint
npm run dev        # 개발 서버 (localhost:5173)
npm run build      # 프로덕션 빌드
```

API 키는 앱 우상단 "API 연결" 버튼에서 입력 → `localStorage`에 저장됨.

---

## 10. 이번 세션(0523)에서 작업한 내용

### 버그 수정
- **`\notef` 파싱 정규식 버그**: `[^}]*` → `(?:\\[a-zA-Z]+)*` 수정 (중간 `}` 조기 종료 문제)
- **`각주` → `\notef` 라우팅 누락**: `\notef` 있는 레이아웃에서 "각주/주석" 요청이 `\footnotesize`로 잘못 라우팅되던 문제 수정
- **`diffLatex()` 재작성**: `\notef` 전용 패턴 추가, 한국어 레이블, 신규 추가값 감지

### Refine 채팅 전면 재설계
- **스트리밍 도입**: `stream: true` + `ReadableStream` + `TextDecoder` SSE 파싱
- **`<latex_update>` 태그 방식**: `%%CHANGES%%` 블록 → 자연어 + LaTeX 분리
- **멀티턴 히스토리**: 이전 대화 누적해서 Claude API에 전달
- **수치 변경 표시**: API 전/후 `extractLatexCommandMap()` 직접 비교
- **추천 버튼 제거**: 하드코딩된 버튼 삭제

### UI 변경
- 채팅 말풍선: 스트리밍 중 커서 깜빡임 + 실시간 텍스트
- 완료 후: 자연어 설명 + 수치 변경 요약 (항목: 이전값 → 새값)

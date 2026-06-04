# Codex 작업 지시서 — Imprint Refine 채팅 수정

## 대상 파일
- `C:\Users\mjungpk\Desktop\Imprint\src\App.jsx` (약 5,300줄, 단일 파일)
- `C:\Users\mjungpk\Desktop\Imprint\vite.config.js`

---

## 문제 요약

Refine 채팅에서 수정 지시를 입력하면 "생각 중…"만 뜨고 결과가 없음.

### 원인 1 — 모델명 오류 (즉시 수정)

`App.jsx` 약 4119번째 줄:
```js
model: 'claude-sonnet-4-20250514',
```
→ 존재하지 않는 모델 ID. Anthropic API가 400 오류를 반환하지만 UI에서 보이지 않음.

**수정:**
```js
model: 'claude-sonnet-4-6',
```

### 원인 2 — Preview 서버에서 Vite 프록시 없음 (즉시 수정)

`vite.config.js`의 proxy 설정은 `server` (dev 서버, 포트 5173)에만 적용됨.  
빌드된 결과물을 보여주는 preview 서버(포트 4173)에서는 `/anthropic/v1/messages` 요청이 실패함.

**수정 — vite.config.js에 preview proxy 추가:**
```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const anthropicProxy = {
  '/anthropic': {
    target: 'https://api.anthropic.com',
    changeOrigin: true,
    rewrite: path => path.replace(/^\/anthropic/, ''),
    headers: {
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  },
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: anthropicProxy },
  preview: { proxy: anthropicProxy },
})
```

### 원인 3 — API 오류가 UI에 표시되지 않음 (즉시 수정)

`App.jsx`의 `refine()` 함수, fetch 직후 에러 처리 부분:
```js
if (!res.ok) {
  const errData = await res.json().catch(() => ({}));
  throw new Error(`API 오류 ${res.status}: ${errData.error?.message || res.statusText}`);
}
```
→ `res.json()`이 스트리밍 응답에서 실패하면 오류 메시지가 빈 문자열이 됨.

**수정 — 에러 파싱 강화:**
```js
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
```

---

## 목표 기능 (현재 구조 유지)

수정 후 Refine 채팅이 다음과 같이 동작해야 함:

```
사용자 입력 (자연어): "각주 조금 작게"
    ↓
채팅 의도 분류 (classifyIntent): "modify"
    ↓
Claude API 스트리밍 호출 (/anthropic/v1/messages)
    ↓
실시간 텍스트 표시 (setStreamingText)
    ↓
완료 후:
  - <latex_update>...</latex_update> 태그에서 새 LaTeX 추출
  - 수치 비교 (extractLatexCommandMap 전/후)
  - 채팅 말풍선에 자연어 응답 + 변경 요약 표시
  - setLatex()로 스타일 파일 업데이트
```

---

## 수정 범위 (이것만 변경)

1. `vite.config.js` — preview proxy 추가 (위 코드 그대로)
2. `App.jsx` 모델명 1곳 — `claude-sonnet-4-20250514` → `claude-sonnet-4-6`
3. `App.jsx` 에러 파싱 1곳 — 위 수정 코드 적용

**건드리지 말 것:**
- `refine()` 함수의 전체 로직 (스트리밍 파싱, `<latex_update>` 추출, `extractLatexCommandMap`, `diffLatex` 등)
- DB[], GENRE_KW, 파이프라인 함수들 (`analyzeText`, `scoreKw`, `semanticRerank` 등)
- UI 컴포넌트 구조 및 스타일링

---

## 검증 방법

1. `npm run dev` 실행 (포트 5173, 프록시 있음)
2. API 키 입력 후 텍스트 붙여넣고 "조판 스타일 생성하기" 클릭
3. 생성 완료 후 채팅 입력창에 "각주 조금 작게" 입력 → 전송
4. 기대 결과:
   - "생각 중…" 스피너 표시 → 실시간 텍스트 스트리밍 → 완료
   - 채팅 말풍선에 자연어 응답 출력
   - "각주 크기: Xpt → Ypt" 형식의 변경 요약 표시
   - 오른쪽 LaTeX 패널이 수정된 버전으로 업데이트
5. 오류 시: 에러 메시지가 채팅 말풍선에 표시되어야 함 (빈 화면 X)

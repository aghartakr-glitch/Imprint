// Imprint 디자인 시스템 — 공용 테마 토큰
// 자매 시스템(Imprint(Cover), Imprint(Image+Text))에도 동일한 내용을 복사해서 씁니다.
// 색/폰트 등을 바꿀 땐 이 파일을 고친 뒤, 다른 두 앱의 theme.js에도 같은 내용을 반영하세요.

export const T = {
  bg:      "#F7F7F5",
  surface: "#FFFFFF",
  border:  "#E3E3DF",
  muted:   "#6B6B6B",
  ink:     "#111111",
  accent:  "#F2612B",
  error:   "#C0392B",
  warning: "#B45309",
  code:    "#F2F2EF",
  tagBg:   "#F2F2EF",
  mono:    "'JetBrains Mono','Fira Code',monospace",
  sans:    "'42dot Sans',system-ui,-apple-system,sans-serif",
};

// 타이포 스케일 — 위계용 5단계 (라벨 → 본문 → 소제목 → 제목 → 헤드라인)
export const FS = { xs:10, sm:12, base:13, md:16, lg:22 };

// 전역 CSS — hover/focus-visible/placeholder/스크롤바/폰트 상속.
// <style>{GLOBAL_CSS}</style> 형태로 최상위 컨테이너 안에 넣어서 사용.
export const GLOBAL_CSS = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  * { box-sizing: border-box; }
  ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:#D4D4D0; border-radius:2px; }
  textarea, input, select { outline:none; resize:none; font-family:inherit; }
  textarea:focus-visible, input:focus-visible, select:focus-visible {
    outline: 2px solid #111111; outline-offset: 1px;
  }
  button { font-family:inherit; transition: opacity 120ms; }
  button:not(:disabled):hover { opacity: 0.75; }
  button:not(:disabled):active { opacity: 0.6; }
  button:focus-visible {
    outline: 2px solid #111111; outline-offset: 1px;
  }
  ::placeholder { color: #6B6B6B; opacity: 0.7; }
`;

// index.html <head>에 넣을 폰트 링크(42dot Sans, Google Fonts):
// <link rel="preconnect" href="https://fonts.googleapis.com" />
// <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
// <link href="https://fonts.googleapis.com/css2?family=42dot+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

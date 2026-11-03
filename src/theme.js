// Imprint 디자인 시스템 — 공용 테마 토큰
// 자매 시스템(Imprint(Cover), Imprint(Image+Text))에도 동일한 내용을 복사해서 씁니다.
// 색/폰트 등을 바꿀 땐 이 파일을 고친 뒤, 다른 두 앱의 theme.js에도 같은 내용을 반영하세요.

export const T = {
  bg:      "#EAF0EB",
  surface: "#FFFFFF",
  border:  "#DCE5DF",
  muted:   "#5E6F65",
  ink:     "#10261C",
  accent:  "#0B3B2C",
  deep:    "#0B3B2C",
  lime:    "#CDEE7A",
  glass:   "rgba(255,255,255,0.07)",
  glassLine: "rgba(255,255,255,0.14)",
  soft:    "#8FB3A1",
  error:   "#C0392B",
  warning: "#B45309",
  code:    "#F1F5F2",
  tagBg:   "#E2EBE5",
  mono:    "'JetBrains Mono','Fira Code',monospace",
  sans:    "'Spoqa Han Sans Neo',system-ui,-apple-system,sans-serif",
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
  ::-webkit-scrollbar-thumb { background:#C3D1C8; border-radius:2px; }
  textarea, input, select { outline:none; resize:none; font-family:inherit; }
  textarea:focus-visible, input:focus-visible, select:focus-visible {
    outline: 2px solid #14573F; outline-offset: 1px;
  }
  button { font-family:inherit; border-radius:0; transition: opacity 120ms; }
  button:not(:disabled):hover { opacity: 0.75; }
  button:not(:disabled):active { opacity: 0.6; }
  button:focus-visible {
    outline: 2px solid #14573F; outline-offset: 1px;
  }

  @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:none} }
  @keyframes floaty { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-9px)} }
  @keyframes tilt { 0%,100%{transform:rotateX(58deg) rotateZ(-34deg)} 50%{transform:rotateX(58deg) rotateZ(-28deg)} }
  @keyframes pulse { 0%,100%{opacity:.45;transform:scale(1)} 50%{opacity:1;transform:scale(1.25)} }
  .rv { animation: fadeUp .8s cubic-bezier(.2,.7,.2,1) both; }
  .chip { animation: floaty 7s ease-in-out infinite; }
  .stack { animation: tilt 10s ease-in-out infinite; }
  .glass-btn { transition: background .2s; cursor:pointer; }
  .glass-btn:hover { background: rgba(255,255,255,.16) !important; }
  .cta { transition: transform .25s, box-shadow .25s; }
  .cta:not(:disabled):hover { transform: translateY(-2px); box-shadow: 0 14px 30px rgba(5,35,27,.28); opacity:1; }
  .cta:not(:disabled):hover .arw { transform: translateX(3px) scale(1.06); }
  .arw { transition: transform .25s; }
  textarea, input, select { transition: border-color .2s, box-shadow .2s; }
  textarea:focus, input:focus { box-shadow: 0 0 0 4px rgba(20,87,63,.12); }
  @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
  ::placeholder { color: #5E6F65; opacity: 0.7; }
`;

// index.html <head>에 넣을 폰트 링크(Spoqa Han Sans Neo, jsDelivr):
// <link rel="preconnect" href="https://fonts.googleapis.com" />
// <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />

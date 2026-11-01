// 하단 면주·쪽번호와 각주가 겹치지 않게 \geometry의 footskip(본문 하단~푸터 거리)을 보장한다.
// 쪽번호가 상단이던 문서는 footskip 줄이 아예 없어(geometry 기본값은 매우 작다) 면주를 하단으로 내리면 푸터가 마지막 각주 줄 위에 포개진다.
export function ensureFootskip(sty, minMm = 10) {
  const s = String(sty);
  const m = s.match(/footskip\s*=\s*([\d.]+)\s*mm/);
  if (m) return Number(m[1]) >= minMm ? s : s.replace(/(footskip\s*=\s*)[\d.]+\s*mm/, `$1${minMm}mm`);
  // geometry 블록 안에 includefoot 줄이 있으면 그 뒤에, 없으면 블록 시작 직후에 넣는다
  if (/includefoot\s*=\s*true\s*,?/.test(s)) return s.replace(/(includefoot\s*=\s*true\s*,?)/, `$1\n  footskip=${minMm}mm,`);
  if (/\\geometry\{/.test(s)) return s.replace(/(\\geometry\{)/, `$1\n  includefoot=true, footskip=${minMm}mm,`);
  return s;
}

export const readFootskip = sty => { const m = String(sty).match(/footskip\s*=\s*([\d.]+)\s*mm/); return m ? Number(m[1]) : undefined; };

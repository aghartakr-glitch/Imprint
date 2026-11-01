// 서체 선택 — 명조(\rmfamily)·고딕(\sffamily) 두 계열 안에서 실제 폰트를 바꾼다.
// 폰트 파일은 fonts/ 폴더 것(Path=./fonts/)과 TeX Live 기본 한글 폰트(un-fonts, baekmuk)만 쓴다. 목록 밖 폰트는 값 검증에서 걸러진다.
// 한글 명조는 kotex가 UnBatang을 따로 붙이므로 \setmainhangulfont로 직접 지정해야 바뀐다. (자간 줄과 같은 줄을 쓰므로 styTracking이 이 모듈을 쓴다.)
export const SERIF_FONTS = {
  batang:      { label: '바탕(기본)',        aliases: ['바탕', '바탕체', '언바탕', '기본 명조'], hangul: ['UnBatang.ttf', 'BoldFont=UnBatangBold.ttf'] },
  nanum:       { label: '나눔명조',          aliases: ['나눔명조', '나눔 명조', '나눔'], path: { name: 'NanumMyeongjo', ext: '.ttf', up: 'NanumMyeongjo', bold: 'NanumMyeongjoBold' } },
  noto:        { label: '본명조(Noto Serif KR)', aliases: ['본명조', '노토 세리프', '노토세리프', '노토 명조', '소스 명조'], path: { name: 'NotoSerifKR', ext: '.ttf', up: 'NotoSerifKR-Regular', bold: 'NotoSerifKR-Bold' } },
  notolight:   { label: '본명조 가는 굵기',  aliases: ['가는 명조', '얇은 명조', '본명조 라이트', '라이트 명조'], path: { name: 'NotoSerifKR', ext: '.ttf', up: 'NotoSerifKR-Light', bold: 'NotoSerifKR-SemiBold' } },
  notomedium:  { label: '본명조 중간 굵기',  aliases: ['본명조 미디엄', '미디엄 명조', '중간 명조'], path: { name: 'NotoSerifKR', ext: '.ttf', up: 'NotoSerifKR-Medium', bold: 'NotoSerifKR-ExtraBold' } },
  notosemibold:{ label: '본명조 세미볼드',   aliases: ['본명조 세미볼드', '세미볼드 명조', '굵은 명조', '두꺼운 명조'], path: { name: 'NotoSerifKR', ext: '.ttf', up: 'NotoSerifKR-SemiBold', bold: 'NotoSerifKR-Black' } },
  shinmun:     { label: '신문명조',          aliases: ['신문 명조', '신문체', '신문'], hangul: ['UnShinmun.ttf', ''] },
  baekmuk:     { label: '백묵바탕',          aliases: ['백묵 바탕', '백묵바탕', '백묵'], hangul: ['batang.ttf', ''] },
  gungseo:     { label: '궁서',              aliases: ['궁서', '궁서체'], hangul: ['UnGungseo.ttf', ''] },
  pilgi:       { label: '필기체',            aliases: ['필기체', '손글씨 명조', '손글씨체', '붓글씨', '캘리'], hangul: ['UnPilgi.ttf', 'BoldFont=UnPilgiBold.ttf'] },
  pen:         { label: '펜글씨',            aliases: ['펜글씨', '펜체'], hangul: ['UnPen.ttf', ''] },
  yetgul:      { label: '옛글',              aliases: ['옛글', '옛한글', '고어체'], hangul: ['UnYetgul.ttf', ''] },
};

export const SANS_FONTS = {
  pretendard:  { label: '프리텐다드(기본)',  aliases: ['프리텐다드', '프리텐다드 레귤러', '기본 고딕'], path: { name: 'Pretendard', ext: '.otf', up: 'Pretendard-Regular', bold: 'Pretendard-Bold' } },
  prelight:    { label: '프리텐다드 가는 굵기', aliases: ['가는 고딕', '얇은 고딕', '프리텐다드 라이트', '라이트 고딕'], path: { name: 'Pretendard', ext: '.otf', up: 'Pretendard-Light', bold: 'Pretendard-SemiBold' } },
  premedium:   { label: '프리텐다드 중간 굵기', aliases: ['미디엄 고딕', '중간 고딕', '프리텐다드 미디엄'], path: { name: 'Pretendard', ext: '.otf', up: 'Pretendard-Medium', bold: 'Pretendard-ExtraBold' } },
  presemibold: { label: '프리텐다드 세미볼드', aliases: ['세미볼드 고딕', '굵은 고딕', '두꺼운 고딕', '프리텐다드 세미볼드'], path: { name: 'Pretendard', ext: '.otf', up: 'Pretendard-SemiBold', bold: 'Pretendard-Black' } },
  dotum:       { label: '돋움',              aliases: ['돋움', '돋움체', '언돋움'], hangul: ['UnDotum.ttf', 'BoldFont=UnDotumBold.ttf'] },
  gulim:       { label: '백묵굴림',          aliases: ['굴림', '굴림체', '백묵굴림'], hangul: ['gulim.ttf', ''] },
  headline:    { label: '백묵헤드라인',      aliases: ['헤드라인', '헤드라인체', '제목체'], hangul: ['hline.ttf', ''] },
  graphic:     { label: '그래픽체',          aliases: ['그래픽체', '그래픽'], hangul: ['UnGraphic.ttf', 'BoldFont=UnGraphicBold.ttf'] },
  dinaru:      { label: '디나루(둥근 고딕)', aliases: ['디나루', '둥근 고딕', '둥근체', '라운드 고딕'], hangul: ['UnDinaru.ttf', 'BoldFont=UnDinaruBold.ttf'] },
};

export const FONT_TABLES = { serif: SERIF_FONTS, sans: SANS_FONTS };
export const DEFAULT_FONT = { serif: 'batang', sans: 'pretendard' };

const MARK = '% imprintFonts';
const SANS_MARK = '% imprintSansHangul';

export const fontIds = role => Object.keys(FONT_TABLES[role]);
export const isFontId = (role, id) => Object.prototype.hasOwnProperty.call(FONT_TABLES[role] || {}, id);

// fontspec 옵션 문자열 — fonts/ 폴더 폰트
const pathOpts = p => `Path=./fonts/,Extension=${p.ext},UprightFont=${p.up},BoldFont=${p.bold}`;

// 현재 선택(주석 줄에서 읽음) — 없으면 기본값
export function readFonts(sty) {
  const m = String(sty).match(/% imprintFonts serif=(\w+) sans=(\w+)/);
  const serif = m && isFontId('serif', m[1]) ? m[1] : DEFAULT_FONT.serif;
  const sans = m && isFontId('sans', m[2]) ? m[2] : DEFAULT_FONT.sans;
  return { serif, sans };
}

// 명조 한글 줄 — 자간(InterHangul)과 같은 줄에 들어간다
export function serifHangulLine(id, em, mark) {
  const f = SERIF_FONTS[id] || SERIF_FONTS[DEFAULT_FONT.serif];
  const inter = `InterHangul=${em}em`;
  const body = f.path
    ? `{${f.path.name}}[${pathOpts(f.path)},Script=Hangul,Language=Korean,${inter}]`
    : `{${f.hangul[0]}}[${f.hangul[1] ? f.hangul[1] + ',' : ''}Script=Hangul,Language=Korean,${inter}]`;
  return `\\ifdefined\\setmainhangulfont\\setmainhangulfont${body}\\fi ${mark}`;
}

// 고딕 한글 줄 — 프리텐다드 계열은 \setsansfont에 한글이 들어 있어 따로 줄이 필요 없다
function sansHangulLine(id) {
  const f = SANS_FONTS[id];
  if (!f || f.path) return null;
  return `\\ifdefined\\setsanshangulfont\\setsanshangulfont{${f.hangul[0]}}[${f.hangul[1] ? f.hangul[1] + ',' : ''}Script=Hangul,Language=Korean]\\fi ${SANS_MARK}`;
}

// \setmainfont / \setsansfont 블록 — 라틴 글자 폰트. 한글 전용 폰트일 땐 기본 라틴 폰트로 둔다.
function latinBlock(role, id, letterSpace) {
  const cmd = role === 'serif' ? 'setmainfont' : 'setsansfont';
  const f = FONT_TABLES[role][id];
  const p = f.path || (role === 'serif'
    ? { name: 'NotoSerif', ext: '.ttf', up: 'NotoSerif-Regular', bold: 'NotoSerif-Bold' }
    : SANS_FONTS.pretendard.path);
  const ls = letterSpace !== undefined ? `\n  LetterSpace=${letterSpace},` : '';
  return `\\${cmd}{${p.name}}[\n  Path=./fonts/,${ls}\n  Extension=${p.ext},\n  UprightFont=${p.up},\n  BoldFont=${p.bold}\n]`;
}

function appendBeforeEndinput(sty, text) {
  if (/\\endinput\s*$/.test(sty)) return sty.replace(/\\endinput\s*$/, `${text}\n\\endinput\n`);
  return sty + '\n' + text + '\n';
}

// role('serif'|'sans')의 서체를 id로 바꾼다. 알 수 없는 id면 그대로 돌려준다.
// 자간 줄(% imprintTrack)은 호출 쪽(App)에서 applyTracking으로 다시 만든다 — 한글 명조 줄이 거기에 있다.
export function applyFont(sty, role, id) {
  if (!isFontId(role, id)) return sty;
  const cur = readFonts(sty);
  const next = { ...cur, [role]: id };
  let out = String(sty);
  const cmd = role === 'serif' ? 'setmainfont' : 'setsansfont';
  const re = new RegExp(`\\\\${cmd}\\{[^}]*\\}\\[[^\\]]*\\]`);
  const hadSans = /\\setsansfont\{/.test(out);
  if (re.test(out)) {
    const old = out.match(re)[0];
    const ls = (old.match(/LetterSpace=([-\d.]+)/) || [])[1];
    out = out.replace(re, () => latinBlock(role, id, ls));
  } else {
    // 단일 서체군 문서(\setmainfont만 있음)라 해당 명령이 없으면 새로 넣는다
    out = appendBeforeEndinput(out, latinBlock(role, id));
  }
  // 고딕 하나뿐이던 문서의 명조 전환 — 고딕(\sffamily)이 사라지지 않게 원래 고딕을 \setsansfont로 남긴다
  if (role === 'serif' && !hadSans) out = appendBeforeEndinput(out, latinBlock('sans', next.sans));
  out = out.replace(/^.*% imprintFonts.*\r?\n?/gm, '').replace(/^.*% imprintSansHangul.*\r?\n?/gm, '');
  const lines = [`${MARK} serif=${next.serif} sans=${next.sans}`];
  const sl = sansHangulLine(next.sans);
  if (sl) lines.push(sl);
  return appendBeforeEndinput(out, lines.join('\n'));
}

// 한글로 부른 서체 이름 → { role, id }. 이름이 없으면 null.
export function findFontByName(text) {
  const t = String(text).replace(/\s+/g, '');
  let best = null;
  for (const role of ['serif', 'sans']) {
    for (const [id, f] of Object.entries(FONT_TABLES[role])) {
      for (const a of [f.label, ...f.aliases]) {
        const k = a.replace(/\s+/g, '').replace(/\(.*\)/, '');
        if (k && t.includes(k) && (!best || k.length > best.len)) best = { role, id, len: k.length };
      }
    }
  }
  return best ? { role: best.role, id: best.id } : null;
}

// "다른 명조" — 지금 것 다음 서체. 기본 명조/고딕 계열(굵기 변형 제외) 안에서 돈다.
const ROTATION = { serif: ['batang', 'nanum', 'noto', 'shinmun', 'baekmuk'], sans: ['pretendard', 'dotum', 'headline', 'dinaru', 'gulim'] };
export function nextFont(role, curId) {
  const list = ROTATION[role];
  const i = list.indexOf(curId);
  return list[(i + 1) % list.length];
}

// \setmainfont가 고딕 서체인가 — 이 경우 \rmfamily도 고딕으로 나와 명조↔고딕 전환이 보이지 않는다
export const mainIsSans = sty => /\\setmainfont\{(?:Pretendard|NotoSans[^}]*)\}/.test(String(sty));

// 단일 서체군 문서(\setmainfont만 있고 고딕이 따로 없음)는 \sffamily가 기본 고딕(LM Sans·UnDotum)으로 나와
// 제목·각주 등이 본문과 다른 글꼴로 보인다 — 주서체와 같은 폰트를 \setsansfont로 남겨 \sffamily도 같은 글꼴이 되게 한다.
export function ensureSansFont(sty) {
  const s = String(sty);
  if (/\\setsansfont\{/.test(s)) return s;
  const m = s.match(/\\setmainfont\{[^}]*\}\[[^\]]*\]/);
  if (!m) return s;
  // 주서체가 명조면 같은 폰트를 복제하면 고딕이 안 되므로 기본 고딕(프리텐다드)을 넣는다
  if (!mainIsSans(s)) return s.replace(m[0], () => m[0] + '\n' + latinBlock('sans', readFonts(s).sans));
  return s.replace(m[0], () => m[0] + '\n' + m[0].replace('\\setmainfont', '\\setsansfont'));
}

// 요소별 서식 명령 — "각주 서체를 부제랑 같게" 같은 말에 쓴다
export const STYLE_CMDS = { body: 'bodyf', h1: 'hone', h2: 'htwo', h3: 'hthree', note: 'notef', rh: 'runningheadf', pn: 'foliof' };

// target 명령의 서체 계열·굵기 토큰(\fontsize 앞)을 source 명령의 것으로 맞춘다. 크기·행간은 건드리지 않는다.
export function applyFontLike(sty, targetEl, sourceEl) {
  const t = STYLE_CMDS[targetEl]; const src = STYLE_CMDS[sourceEl];
  if (!t || !src || t === src) return sty;
  const def = c => new RegExp('(\\\\newcommand\\{\\\\' + c + '\\}\\{)((?:\\\\(?:rmfamily|sffamily|normalfont|bfseries|mdseries))*)(\\\\fontsize)');
  const sm = String(sty).match(def(src));
  if (!sm) return sty;
  return String(sty).replace(def(t), (m, pre, _old, fs) => pre + sm[2] + fs);
}

export const fontChoicesText = role => Object.entries(FONT_TABLES[role]).map(([id, f]) => `${id}(${f.label})`).join(' / ');

// ENUM_PATCH용 — id·한글 이름·별칭 모두 정식 id로
export function fontEnumMap(role) {
  const m = {};
  for (const [id, f] of Object.entries(FONT_TABLES[role])) {
    m[id] = id;
    m[f.label.replace(/\(.*\)/, '')] = id;
    for (const a of f.aliases) m[a] = id;
  }
  return m;
}

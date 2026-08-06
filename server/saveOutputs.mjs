// server/saveOutputs.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, copyFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT } from './env.mjs'

const FONTS_SRC = join(ROOT, 'fonts')

// YYYY-MM-DD
function dateFolderName(date = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
// HHmmss
function timeSuffix(date = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

// 파일시스템에 쓸 수 없는 문자 제거
function sanitizeFolderName(str) {
  const cleaned = (str || '').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
  return cleaned || '제목없음'
}

// Imprint-Data/<날짜>/<책제목>_<시간>/ 폴더 생성 (App.jsx의 downloadToBookFolder와 동일한 경로 규칙)
export function createRunFolder(outputsRoot, bookTitle, date = new Date()) {
  const dayDir = join(outputsRoot, dateFolderName(date))
  const folder = `${sanitizeFolderName(bookTitle)}_${timeSuffix(date)}`
  const runDir = join(dayDir, folder)
  mkdirSync(runDir, { recursive: true })
  return runDir
}

// fonts/ 폴더를 매 실행마다 복사하면 106MB×N으로 용량이 폭증하므로, 루트의 공용 fonts/를
// Windows 디렉터리 정션(junction)으로 연결한다. 관리자 권한 없이도 생성 가능.
export function linkFontsInto(runDir) {
  const dest = join(runDir, 'fonts')
  if (existsSync(dest)) return
  if (!existsSync(FONTS_SRC)) return
  if (process.platform === 'win32') {
    execSync(`mklink /J "${dest}" "${FONTS_SRC}"`, { shell: 'cmd.exe' })
  } else {
    symlinkSync(FONTS_SRC, dest, 'dir')
  }
}

export function writeGenerationFiles(runDir, { mainTex, styContent, log }) {
  writeFileSync(join(runDir, 'main.tex'), mainTex, 'utf-8')
  writeFileSync(join(runDir, 'imprint-style.sty'), styContent, 'utf-8')
  if (log) writeFileSync(join(runDir, 'generation-log.json'), JSON.stringify(log, null, 2), 'utf-8')
}

// 스타일 조정 채팅으로 수정할 때: main.tex/sty는 덮어쓰지만, 수정 이력은
// revision-log.json에 계속 누적한다 (배열에 append, 절대 덮어쓰지 않음).
// 덮어쓰기 전 기존 내용을 반환 — 컴파일이 실패하면 호출자가 복원할 수 있게 함
// (2026-08-03: LLM이 main.tex을 통째로 잘못 재작성해 컴파일이 깨지고, 그 깨진
// 내용이 작업 파일에 그대로 남아 다음 수정까지 오염시킨 실제 사고 이후 추가).
export function overwriteGenerationFiles(runDir, { mainTex, styContent }) {
  if (!existsSync(runDir)) throw new Error(`대상 폴더 없음: ${runDir}`)
  const texPath = join(runDir, 'main.tex');
  const styPath = join(runDir, 'imprint-style.sty');
  const previous = {
    mainTex: existsSync(texPath) ? readFileSync(texPath, 'utf-8') : null,
    styContent: existsSync(styPath) ? readFileSync(styPath, 'utf-8') : null,
  };
  if (mainTex != null) writeFileSync(texPath, mainTex, 'utf-8')
  if (styContent != null) writeFileSync(styPath, styContent, 'utf-8')
  return previous;
}

// 컴파일 성공 후 main.pdf/tex/sty를 v{n} 접미사 붙여 별도 스냅샷으로 복사.
// main.pdf(작업본)는 덮어쓰기 유지, 버전 스냅샷은 덮어쓰지 않고 계속 쌓인다.
// 카운터는 클라이언트(React state)가 관리하며 새로고침 시에만 초기화됨.
export function snapshotVersion(runDir, version) {
  const pairs = [
    ['main.pdf', `main_v${version}.pdf`],
    ['main.tex', `main_v${version}.tex`],
    ['imprint-style.sty', `imprint-style_v${version}.sty`],
  ];
  for (const [src, dest] of pairs) {
    const srcPath = join(runDir, src);
    if (existsSync(srcPath)) copyFileSync(srcPath, join(runDir, dest));
  }
}

export function appendRevisionLog(runDir, entry) {
  const logPath = join(runDir, 'revision-log.json')
  let list = []
  if (existsSync(logPath)) {
    try { list = JSON.parse(readFileSync(logPath, 'utf-8')) } catch { list = [] }
    if (!Array.isArray(list)) list = []
  }
  list.push({ at: new Date().toISOString(), ...entry })
  writeFileSync(logPath, JSON.stringify(list, null, 2), 'utf-8')
  return list.length
}

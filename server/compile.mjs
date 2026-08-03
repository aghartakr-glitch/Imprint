// server/compile.mjs
// Imprint(Image+Text)의 compile.mjs와 동일한 패턴 — xelatex 존재 확인 후 컴파일, aux 파일 정리
import { exec } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(exec)

export async function hasXelatex() {
  try {
    await run(process.platform === 'win32' ? 'where xelatex' : 'which xelatex')
    return true
  } catch {
    return false
  }
}

export function cleanupAuxFiles(dir, basename) {
  for (const ext of ['aux', 'log', 'synctex.gz', 'out', 'toc']) {
    const p = join(dir, `${basename}.${ext}`)
    try {
      if (existsSync(p)) unlinkSync(p)
    } catch {
      // best-effort cleanup; a locked/missing aux file must not mask a successful compile
    }
  }
}

// main.tex을 candidateDir에서 두 번 컴파일한다 (쪽번호/목차 상호참조 안정화를 위해 XeLaTeX 관행상 2-pass 권장).
// 실패해도 첫 pass 로그를 반환해 원인 파악 가능하게 한다.
export async function compileMainTex(candidateDir) {
  const tex = join(candidateDir, 'main.tex')
  if (!existsSync(tex)) throw new Error(`main.tex 없음: ${candidateDir}`)
  if (!(await hasXelatex())) {
    return { ok: false, reason: 'xelatex 미설치', hint: 'TeX(XeLaTeX)를 설치하면 PDF가 자동 생성됩니다.' }
  }
  const cmd = 'xelatex -interaction=nonstopmode -halt-on-error "main.tex"'
  try {
    await run(cmd, { cwd: candidateDir, timeout: 120000 }).catch(() => {}) // 1st pass — 상호참조 채우기, 실패해도 계속
    const { stdout, stderr } = await run(cmd, { cwd: candidateDir, timeout: 120000 })
    const producedPdf = join(candidateDir, 'main.pdf')
    if (!existsSync(producedPdf)) {
      return { ok: false, reason: '컴파일은 됐으나 PDF 없음', log: stdout.slice(-1500) }
    }
    cleanupAuxFiles(candidateDir, 'main')
    return { ok: true, pdf: producedPdf, log: stdout.slice(-800) + (stderr ? `\n[stderr]\n${stderr.slice(-500)}` : '') }
  } catch (e) {
    if (e.killed && e.signal === 'SIGTERM') {
      return { ok: false, reason: '컴파일 시간 초과(120초)', log: String(e.stdout || '').slice(-1500) }
    }
    const combinedLog = `${e.stdout || ''}\n${e.stderr || ''}`.trim() || e.message
    return { ok: false, reason: '컴파일 오류', log: String(combinedLog).slice(-1500) }
  }
}

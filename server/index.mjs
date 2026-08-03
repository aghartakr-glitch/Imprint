// server/index.mjs
// 생성된 main.tex/imprint-style.sty를 받아 날짜별 폴더에 저장하고, xelatex로 컴파일해
// 같은 폴더에 PDF까지 넣어주는 로컬 전용 서버. App.jsx의 downloadToBookFolder()가 만드는
// 브라우저 다운로드 경로(Imprint-Data/<날짜>/<책제목>_<시간>/)와 동일한 규칙을 서버 파일시스템에도 만든다.
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { extname, join } from 'node:path'
import { compileMainTex } from './compile.mjs'
import {
  createRunFolder, linkFontsInto, writeGenerationFiles,
  overwriteGenerationFiles, appendRevisionLog, snapshotVersion,
} from './saveOutputs.mjs'
import { OUTPUTS_DIR } from './env.mjs'

// 같은 폴더(runDir)에 대한 컴파일 요청이 겹치면 xelatex가 main.aux/main.log를 동시에
// 써서 충돌한다 (생성 직후 곧바로 채팅 수정을 보내는 경우 실제로 재현됨 — 2026-08-03 확인).
// 폴더별 프로미스 체인으로 직렬화해 항상 이전 컴파일이 끝난 뒤에 다음 컴파일이 시작되게 한다.
const compileQueues = new Map()
function enqueueCompile(runDir, task) {
  const prev = compileQueues.get(runDir) || Promise.resolve()
  const next = prev.then(task, task) // 이전 작업이 실패해도 다음 작업은 계속 진행
  compileQueues.set(runDir, next.catch(() => {}))
  return next
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(data)) } catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

async function handleSaveAndCompile(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: '잘못된 JSON 본문: ' + String(err.message || err) })
  }
  const { mainTex, styContent, bookTitle, log } = body || {}
  if (!mainTex || !styContent) {
    return sendJson(res, 400, { ok: false, error: 'mainTex, styContent는 필수입니다' })
  }
  try {
    const runDir = createRunFolder(OUTPUTS_DIR, bookTitle || '제목없음')
    writeGenerationFiles(runDir, { mainTex, styContent, log })
    linkFontsInto(runDir)
    const compileResult = await enqueueCompile(runDir, () => compileMainTex(runDir))
    const folderName = runDir.split(/[\\/]/).slice(-2).join('/')
    return sendJson(res, 200, {
      ok: true,
      folder: folderName,
      compileOk: compileResult.ok,
      compileReason: compileResult.reason || null,
      compileLog: compileResult.ok ? null : compileResult.log,
      pdfUrl: compileResult.ok ? `/outputs/${folderName}/main.pdf` : null,
    })
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: String(err.message || err) })
  }
}

// 스타일 조정 채팅에서 수정 적용 시 호출 — 같은 폴더의 main.tex/sty를 덮어쓰고 재컴파일,
// 수정 이력은 revision-log.json에 계속 append (덮어쓰지 않음)
async function handleUpdateAndCompile(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: '잘못된 JSON 본문: ' + String(err.message || err) })
  }
  const { folder, mainTex, styContent, logEntry, version } = body || {}
  if (!folder) return sendJson(res, 400, { ok: false, error: 'folder는 필수입니다' })
  const runDir = join(OUTPUTS_DIR, folder)
  if (!existsSync(runDir)) return sendJson(res, 404, { ok: false, error: `대상 폴더 없음: ${folder}` })
  try {
    overwriteGenerationFiles(runDir, { mainTex, styContent })
    linkFontsInto(runDir)
    const compileResult = await enqueueCompile(runDir, () => compileMainTex(runDir))
    let versionedPdfUrl = null
    if (compileResult.ok && version != null) {
      snapshotVersion(runDir, version)
      versionedPdfUrl = `/outputs/${folder}/main_v${version}.pdf`
    }
    const revisionCount = logEntry
      ? appendRevisionLog(runDir, { ...logEntry, version: version ?? null })
      : null
    return sendJson(res, 200, {
      ok: true,
      folder,
      version: version ?? null,
      revisionCount,
      compileOk: compileResult.ok,
      compileReason: compileResult.reason || null,
      compileLog: compileResult.ok ? null : compileResult.log,
      pdfUrl: compileResult.ok ? `/outputs/${folder}/main.pdf` : null,
      versionedPdfUrl,
    })
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: String(err.message || err) })
  }
}

const MIME_TYPES = { '.pdf': 'application/pdf', '.tex': 'text/plain', '.sty': 'text/plain', '.json': 'application/json' }

function serveStatic(req, res, urlPath) {
  let relative
  try {
    relative = decodeURIComponent(urlPath.replace(/^\/outputs\//, '').split('?')[0])
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: '잘못된 경로: ' + String(err.message || err) })
  }
  if (relative.includes('..')) return sendJson(res, 400, { ok: false, error: '잘못된 경로' })
  const filePath = join(OUTPUTS_DIR, relative)
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return sendJson(res, 404, { ok: false, error: '파일 없음' })
  const ext = extname(filePath)
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
}

export function createApp() {
  return createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    try {
      if (req.method === 'POST' && req.url.startsWith('/api/save-and-compile')) {
        return handleSaveAndCompile(req, res)
      }
      if (req.method === 'POST' && req.url.startsWith('/api/update-and-compile')) {
        return handleUpdateAndCompile(req, res)
      }
      if (req.method === 'GET' && req.url.startsWith('/outputs/')) {
        return serveStatic(req, res, req.url)
      }
      return sendJson(res, 404, { ok: false, error: 'Not found' })
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: `서버 오류: ${String(err.message || err)}` })
      return undefined
    }
  })
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const app = createApp()
  const port = process.env.PORT ? Number(process.env.PORT) : 8789
  app.listen(port, () => {
    console.log(`Imprint compile server listening on http://localhost:${port}`)
  })
}

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
import { recordDocument, recordRevision, recordExperiment } from './supabase.mjs'

// runDir(폴더 경로) → Supabase documents.id 매핑. 이 서버는 단일 로컬 프로세스로만
// 돌아가는 개발 도구라 인메모리로 충분하다 (재시작하면 기존 문서는 새 수정 시
// documents 테이블에 다시 upsert되면서 자연히 다시 채워짐).
const documentIdByRunDir = new Map()

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
    // Supabase 저장은 best-effort — 실패해도 로컬 저장/컴파일 흐름은 그대로 진행
    recordDocument({
      runDir, runId: folderName, bookTitle: bookTitle || null, mainTex, styContent,
      compileOk: compileResult.ok, compileReason: compileResult.reason || null,
    }).then(id => { if (id) documentIdByRunDir.set(runDir, id) })
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
// 실험 탭의 만족도/피드백 데이터를 Supabase experiments 테이블에 저장.
// folder를 넘겨받으면 documentIdByRunDir에서 연결된 document_id를 찾아 같이 저장한다.
async function handleExperiment(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: '잘못된 JSON 본문: ' + String(err.message || err) })
  }
  const { folder, experimentId, targetVariable, customText, systemPct, userPct, directionMatch, satisfactionScore, notes } = body || {}
  const runDir = folder ? join(OUTPUTS_DIR, folder) : null
  const documentId = runDir ? documentIdByRunDir.get(runDir) : null
  await recordExperiment({
    documentId, experimentId, targetVariable, customText, systemPct, userPct, directionMatch, satisfactionScore, notes,
  })
  return sendJson(res, 200, { ok: true })
}

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
    const previous = overwriteGenerationFiles(runDir, { mainTex, styContent })
    linkFontsInto(runDir)
    const compileResult = await enqueueCompile(runDir, () => compileMainTex(runDir))
    let versionedPdfUrl = null
    let rolledBack = false
    if (compileResult.ok && version != null) {
      snapshotVersion(runDir, version)
      versionedPdfUrl = `/outputs/${folder}/main_v${version}.pdf`
    } else if (!compileResult.ok) {
      // 컴파일 실패 시 작업 파일을 이전(마지막으로 성공했던) 상태로 되돌린다.
      // 안 그러면 깨진 내용이 main.tex/sty에 그대로 남아 다음 수정까지 오염시킨다
      // (2026-08-03 실제 사고: LLM이 문서를 통째로 잘못 재작성 → 컴파일 실패 →
      //  깨진 main.tex가 작업 파일로 남음).
      overwriteGenerationFiles(runDir, previous)
      rolledBack = true
    }
    const revisionCount = logEntry
      ? appendRevisionLog(runDir, { ...logEntry, version: version ?? null, compileFailed: !compileResult.ok, rolledBack })
      : null
    if (logEntry) {
      const documentId = documentIdByRunDir.get(runDir)
      recordRevision({
        runDir, documentId, version: version ?? null,
        userRequest: logEntry.user_request, changes: logEntry.changes, intent: logEntry.intent,
        mainTex, styContent, compileFailed: !compileResult.ok, rolledBack,
      })
    }
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
      rolledBack,
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
      if (req.method === 'POST' && req.url.startsWith('/api/experiment')) {
        return handleExperiment(req, res)
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

// server/supabase.mjs
// Supabase 연동 — 환경변수(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)가 없으면
// 조용히 비활성화된다. 로컬 개발 중 Supabase 없이도 기존처럼 동작해야 하므로,
// 여기서 던지는 에러는 절대 컴파일/저장 흐름을 막지 않고 콘솔 경고로만 남긴다.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY // 서버 전용 — 절대 브라우저로 보내지 말 것

export const supabase = (url && key) ? createClient(url, key) : null

if (!supabase) {
  console.log('[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정 — Supabase 저장 비활성화 (로컬 파일 저장만 동작)')
}

const PDF_BUCKET = 'imprint-pdfs'

async function uploadPdf(runDir, fileName, storagePath) {
  if (!supabase) return null
  const filePath = join(runDir, fileName)
  if (!existsSync(filePath)) return null
  try {
    const bytes = readFileSync(filePath)
    const { error } = await supabase.storage.from(PDF_BUCKET).upload(storagePath, bytes, {
      contentType: 'application/pdf', upsert: true,
    })
    if (error) { console.warn('[supabase] PDF 업로드 실패:', error.message); return null }
    return storagePath
  } catch (err) {
    console.warn('[supabase] PDF 업로드 예외:', String(err.message || err))
    return null
  }
}

// 최초 생성 시 documents 행을 만들고 id를 반환 (실패해도 null만 반환, 흐름 안 막음)
export async function recordDocument({ runDir, runId, bookTitle, mainTex, styContent, compileOk, compileReason }) {
  if (!supabase) return null
  try {
    const pdfPath = compileOk ? await uploadPdf(runDir, 'main.pdf', `${runId}/main.pdf`) : null
    const { data, error } = await supabase.from('documents')
      .upsert({
        run_id: runId, book_title: bookTitle || null, main_tex: mainTex, sty_content: styContent,
        pdf_path: pdfPath, compile_ok: !!compileOk, compile_reason: compileReason || null,
      }, { onConflict: 'run_id' })
      .select('id').single()
    if (error) { console.warn('[supabase] documents 저장 실패:', error.message); return null }
    return data?.id || null
  } catch (err) {
    console.warn('[supabase] documents 저장 예외:', String(err.message || err))
    return null
  }
}

// 채팅 수정마다 revisions 행 append (documentId는 recordDocument가 반환한 값).
// mainTex/styContent는 "이 자연어 입력이 적용된 직후"의 전체 코드 스냅샷 —
// 롤백된 턴이면 호출 쪽에서 롤백 이전(실패한) 코드를 그대로 넘겨서, 어떤 시도가
// 왜 실패했는지도 코드 레벨로 남긴다.
export async function recordRevision({ runDir, documentId, version, userRequest, changes, intent, mainTex, styContent, compileFailed, rolledBack }) {
  if (!supabase || !documentId) return
  try {
    const pdfPath = (!compileFailed && version != null)
      ? await uploadPdf(runDir, `main_v${version}.pdf`, `revisions/${documentId}/main_v${version}.pdf`)
      : null
    const { error } = await supabase.from('revisions').insert({
      document_id: documentId, version: version ?? null, user_request: userRequest || null,
      changes: changes || null, intent: intent || null,
      main_tex: mainTex || null, sty_content: styContent || null,
      compile_failed: !!compileFailed, rolled_back: !!rolledBack, pdf_path: pdfPath,
    })
    if (error) console.warn('[supabase] revisions 저장 실패:', error.message)
  } catch (err) {
    console.warn('[supabase] revisions 저장 예외:', String(err.message || err))
  }
}

// 만족도/피드백 실험 데이터 1건 저장
export async function recordExperiment(entry) {
  if (!supabase) return
  try {
    const { error } = await supabase.from('experiments').insert({
      document_id: entry.documentId || null,
      experiment_id: entry.experimentId || null,
      target_variable: entry.targetVariable || null,
      custom_text: entry.customText || null,
      system_pct: entry.systemPct || null,
      user_pct: entry.userPct || null,
      direction_match: entry.directionMatch ?? null,
      satisfaction_score: entry.satisfactionScore ?? null,
      notes: entry.notes || null,
    })
    if (error) console.warn('[supabase] experiments 저장 실패:', error.message)
  } catch (err) {
    console.warn('[supabase] experiments 저장 예외:', String(err.message || err))
  }
}

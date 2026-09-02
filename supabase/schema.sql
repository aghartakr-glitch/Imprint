-- Imprint Supabase 스키마
-- Supabase 대시보드 → SQL Editor에서 이 파일 내용을 그대로 실행하세요.

-- ── 1. 생성된 문서 (main.tex / imprint-style.sty / PDF) ──────────────
create table if not exists documents (
  id            uuid primary key default gen_random_uuid(),
  run_id        text not null,                -- server/saveOutputs.mjs가 만드는 폴더명 (날짜/책제목_시간)
  book_title    text,
  main_tex      text,
  sty_content   text,
  pdf_path      text,                          -- Supabase Storage 안의 경로 (버킷: imprint-pdfs)
  compile_ok    boolean,
  compile_reason text,
  created_at    timestamptz not null default now()
);
create unique index if not exists documents_run_id_idx on documents(run_id);

-- ── 2. 채팅 수정 이력 — 자연어 입력 → 조판 변수 변환을 한 행에 기록 ──────
-- 채팅 한 턴(자연어 메시지 하나)당 행 하나. 10분짜리 연속 대화도 document_id로
-- 묶어서 created_at/version 순으로 재구성하면 전체 세션 타임라인이 됨.
create table if not exists revisions (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents(id) on delete cascade,
  version       integer,
  user_request  text,                          -- 사용자가 채팅에 입력한 자연어 원문
  changes       text,                          -- 파싱된 변수 변화 요약 ("본문 크기: 9.5pt → 9.0pt")
  intent        text,                          -- 'modify' | 'question' | 'ambiguous' 등
  main_tex      text,                          -- 이 턴 적용 직후의 main.tex 전체 스냅샷
  sty_content   text,                          -- 이 턴 적용 직후의 imprint-style.sty 전체 스냅샷
  compile_failed boolean not null default false,
  rolled_back   boolean not null default false,
  pdf_path      text,                          -- 버전 스냅샷 PDF (main_v{n}.pdf)의 Storage 경로
  created_at    timestamptz not null default now()
);
create index if not exists revisions_document_id_idx on revisions(document_id);
create index if not exists revisions_created_at_idx on revisions(created_at);

-- 이미 revisions 테이블을 만든 뒤라면 위 create table은 무시되므로, 아래 두 줄만 따로 실행하세요.
alter table revisions add column if not exists main_tex text;
alter table revisions add column if not exists sty_content text;

-- ── 3. 사용자 피드백 / 만족도 실험 데이터 (구조화 폼, "실험" 탭 전용 — 선택사항) ──
create table if not exists experiments (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid references documents(id) on delete set null,
  experiment_id       text,                    -- 클라이언트에서 생성하는 exp_YYYYMMDD_HHMMSS 형식 ID
  target_variable     text,                    -- body_size, heading_h1_size 등
  custom_text         text,                    -- target_variable = '__custom__'일 때 직접 입력한 텍스트
  system_pct          text,                    -- 시스템이 적용한 값 (예: "+8%, 3단")
  user_pct            text,                    -- 사용자가 원한 값
  direction_match     boolean,                 -- 방향 일치 여부 (null = 판단 불가)
  satisfaction_score  integer check (satisfaction_score between 1 and 5),
  notes               text,
  created_at          timestamptz not null default now()
);
create index if not exists experiments_document_id_idx on experiments(document_id);
create index if not exists experiments_experiment_id_idx on experiments(experiment_id);

-- ── Row Level Security ────────────────────────────────────────────
-- 서버(service role key)는 RLS를 우회하므로 아래는 기본적으로 잠가둔 상태입니다.
-- 브라우저에서 anon key로 직접 읽기가 필요해지면 그때 select policy를 추가하세요.
alter table documents   enable row level security;
alter table revisions   enable row level security;
alter table experiments enable row level security;

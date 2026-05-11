# Imprint Changelog

## [1.1.0] — 2026-05-11

### 핵심 변경
- **DB 확장**: 106개 → 253개 편집 디자인 레퍼런스
- **장르 체계**: 11개 장르 (타이포그래피 / 그래픽디자인 / 아트이론·비평 / 현대미술 / 전시·큐레이션 / 인문·사회 / 문학 / 건축·공간 / 시각문화·매체 / 사진 / 기타)
- **출판형태**: 6개 (전시도록 / 단행본 / 잡지·저널 / 실험출판 / 아카이브 / 기관출판)
- **새 필드**: `designer` (디자이너명), `align_body`/`align_title`/`align_note` (정렬 방식), `subheading` (소제목 크기), `src`/`img` (원본 자료·이미지)

### UI 개선
- 패키지 카드에 디자이너명 표시
- 스펙 그리드 8개 → 12개 항목 (본문 정렬, 소제목, 면주, 각주 추가)
- 장르 힌트 선택지 11개 장르 + 6개 출판형태로 전면 업데이트

### AI 파이프라인 개선
- `GENRE_KW`: 장르별 대표 키워드 사전 추가 → `scoreKw` 장르 매칭 정밀도 향상
- `alignScore`: 정렬 방식 매칭 스코어 신설
- `analyzeText` 스키마에 `genre` 필드 추가 → 힌트 없을 때 자동 장르 추론 활용

### 데이터 소스
- `Editorial_Style_Data.xlsx` (슬기와 민 큐레이션, 253개 레퍼런스)
- Google Sheets 연동 준비: https://docs.google.com/spreadsheets/d/1QRKFaqSmphdJt7g1kOv32f2V6D3iufyyF_HQ5QnnVb4/

## [1.0.0] — 2026-05-11

### 개요
SelectPaper v30을 기반으로 Imprint 1.0.0 첫 시안 완성.

### 핵심 변경
- **프로젝트 이름**: SelectPaper → Imprint
- **버전 체계**: v숫자 → 1.x.y (Semantic Versioning)
- **UI 레이아웃**: 2-Step 네비게이션 → Split-panel (Left: 입력 / Right: 출력)
- **디자인 토큰**: 종이색 배경(#F8F7F3), 청색 강조(#2B5BFF)
- **개념**: 각 DB 항목을 LaTeX `.sty` 패키지처럼 "Style Package"로 명명

### 보존된 핵심 로직
- DB[] 106개 편집 디자인 레퍼런스
- analyzeText → scoreKw → semanticRerank → inferAlignment → LaTeX 생성 파이프라인
- Generation Log 시스템 (인메모리, 접이식)
- Refine 채팅

### 알려진 이슈
- `step` state가 코드에 남아있음 (새 UI에서 미사용, 동작 영향 없음)
- Overleaf 폰트 파일명 매핑 미완성

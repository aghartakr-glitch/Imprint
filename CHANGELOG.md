# Imprint Changelog

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

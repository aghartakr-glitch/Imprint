# Imprint

**편집 디자인 타이포그래피 스타일 패키지 선택기**

LaTeX `.sty` 패키지처럼 각 레퍼런스를 "스타일 패키지"로 취급합니다.  
텍스트를 입력하면 253개 편집 디자인 레퍼런스 중 최적 패키지를 AI가 선택하여 XeLaTeX 조판 코드를 자동 생성합니다.

```
텍스트 입력 → 스타일 패키지 매칭 → XeLaTeX 생성 → Overleaf 조판
```

## 버전

| 버전 | 날짜 | 내용 |
|------|------|------|
| 1.1.0 | 2026-05-11 | DB 253개 확장, 11개 장르, designer/alignment 필드, GENRE_KW 스코어링 |
| 1.0.0 | 2026-05-11 | 첫 시안: Split-panel UI, Style Package 개념 도입 |

## 파일 구조

```
Imprint_1.x.y.jsx   — 현재 작업 파일 (React single-file component)
CHANGELOG.md        — 버전별 변경 이력
```

## 로드맵

- **1.1** — Package 브라우저 (DB 탐색 UI) + 미리보기 강화
- **1.2** — 커스텀 Package 정의 + `.sty` 직접 export
- **1.3** — Google Sheets 연동 + 세션 간 로그 지속성
- **1.4** — Overleaf 폰트 매핑 완성 + 자동 컴파일 링크

## 실행 방법

Claude.ai 아티팩트 또는 로컬 React 개발 환경에서 실행.  
Anthropic API Key 필요 (`REACT_APP_ANTHROPIC_KEY` 환경변수).

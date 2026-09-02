# Imprint 컴파일 서버 — XeLaTeX(kotex/memoir 포함) + Node
# Railway/Render 같은 곳에 이 Dockerfile 그대로 올리면 됩니다.
FROM node:20-slim

# XeLaTeX + 한국어(kotex/xetexko) + memoir 클래스 + 기본 폰트
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-xetex \
    texlive-lang-korean \
    texlive-latex-extra \
    texlive-fonts-recommended \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 의존성 먼저 설치 (레이어 캐시 활용)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# 서버 코드 + Imprint 자체 폰트(fonts/)까지 이미지에 포함
# (Imprint-Data, node_modules, .git 등은 .dockerignore로 제외됨)
COPY server ./server
COPY fonts ./fonts

ENV PORT=8789
EXPOSE 8789

# Supabase 키 등은 .env 파일이 아니라 호스팅 플랫폼(Railway/Render)의
# 환경변수 설정 화면에서 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY로 직접 주입하세요.
CMD ["node", "server/index.mjs"]

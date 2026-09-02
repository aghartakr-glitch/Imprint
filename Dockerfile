# Imprint 컴파일 서버 — XeLaTeX(kotex/memoir 포함) + Node
# Railway/Render 같은 곳에 이 Dockerfile 그대로 올리면 됩니다.
#
# texlive/texlive 베이스는 TeX Live 전체가 이미 미리 빌드되어 들어있는 이미지라,
# apt-get으로 texlive-* 패키지를 직접 설치하지 않는다 — 그 설치 과정(수천 개
# 폰트 압축 해제 + texhash 재생성)이 Railway 빌드 서버 메모리를 초과해서
# "container process is already dead"로 빌드가 죽는 문제가 실제로 있었음.
# 여기서는 Node.js만 추가로 설치한다.
FROM texlive/texlive:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
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

# Dockerfile — the API server and the two bots.
#
# The frontend is a Vite build and is not in this image: `bun run build` writes
# it to dist/, which nginx or any static host can serve. This image is the
# process that talks to PostgreSQL, to LED, to กรมธนารักย์ and to กรมที่ดิน.
#
#   docker build -t field-scrapper .
#   docker run --rm -p 8787:8787 --env-file .env field-scrapper
#
# The bots are in the image because they are the point of it:
#   docker run --rm --env-file .env field-scrapper bun test/backfillProvinces.js 83
#   docker run --rm --env-file .env field-scrapper bun test/resolveCoordsCLI.js
#
# Chrome is installed because the กรมที่ดิน lookup drives a browser: it reads an
# access token out of sessionStorage on a page the site only hands to a real
# browser. Puppeteer's own Chrome download is not in the image, so the bot finds
# the system one - dolLookup.js looks for /usr/bin/google-chrome and
# /usr/bin/chromium, and PUPPETEER_EXECUTABLE_PATH overrides both.

FROM oven/bun:1.3-debian

ENV DEBIAN_FRONTEND=noninteractive

# Chrome and the shared libraries it needs to run headless in a container.
# curl is for the healthcheck below.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-thai-tlwg \
      curl \
      dumb-init \
    && rm -rf /var/lib/apt/lists/*

# The bots live in test/ and have their own dependencies - puppeteer among them.
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY test/package.json ./test/
RUN cd test && bun install

COPY . .

# Build the frontend so the image carries a static bundle as well. Not served
# from here, but it keeps the image self-contained and makes the build a
# fail-fast check that the whole thing still compiles.
RUN bun run build

# Puppeteer's cache is not used - the system chromium is - but pointing the
# cache at a writable directory keeps it from complaining.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
RUN mkdir -p "$PUPPETEER_CACHE_DIR" && chown -R bun:bun "$PUPPETEER_CACHE_DIR"

USER bun
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8787}/api/status" > /dev/null || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["bun", "server/index.js"]
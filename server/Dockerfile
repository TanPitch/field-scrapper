# Field Scrapper app image: builds the frontend with Bun/Vite, then serves the
# built dist/ and the API from server/index.js in one container.
#   DB (fs-db) and the image store stay OUT of the image on purpose: DATABASE_URL
#   points at fs-db's host port and the NAS image share is bind-mounted as
#   /app/data (see docker/portainer-stack.yml).
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/server server
COPY --from=build /app/dist dist
EXPOSE 8787
CMD ["bun", "server/index.js"]

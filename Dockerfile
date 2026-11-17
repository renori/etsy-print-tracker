# Builds the web frontend and the Fastify server into one image: the server
# serves the built frontend's static files alongside its own /api routes, so
# the NAS only needs to expose a single port.
#
# Debian slim rather than Alpine: Prisma's engines need OpenSSL, which Alpine
# doesn't ship, and Prisma's Debian support is the most reliable.

FROM node:22-bookworm-slim AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server-build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/ ./
RUN npx prisma generate
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production

# Full node_modules (including the Prisma CLI) so `prisma migrate deploy`
# can run at container start without reaching out to the network.
COPY --from=server-build /app/server/node_modules ./node_modules
COPY --from=server-build /app/server/package.json ./package.json
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/prisma ./prisma
COPY --from=web-build /app/web/dist ./dist/public

ENV PORT=9999
EXPOSE 9999
VOLUME ["/app/data"]

# Which build this is (set by the GitHub workflow; shown in the app's menu).
# Last so a new commit doesn't invalidate the cached layers above.
ARG GIT_SHA=dev
ARG BUILD_TIME=
ARG BUILD_SUBJECT=
ENV APP_VERSION=$GIT_SHA APP_BUILT_AT=$BUILD_TIME APP_CHANGE=$BUILD_SUBJECT

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]

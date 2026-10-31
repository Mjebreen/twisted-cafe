# Twisted Cafe: build the web app, then run the API + static files in one small image.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json ./web/
RUN npm ci --ignore-scripts && npm --prefix web ci
COPY . .
RUN npm run build

FROM node:24-alpine
LABEL org.opencontainers.image.source="https://github.com/Mjebreen/twisted-cafe" \
      org.opencontainers.image.description="Twisted Cafe POS: counter, room QR orders, barista board"
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TZ_CAFE=Asia/Riyadh
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server ./server
COPY --from=build /app/web/dist ./web/dist
# Run as the unprivileged "node" user; /data holds the database, session secret and backups.
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
ARG GIT_REVISION=unknown
LABEL org.opencontainers.image.title="Stratum Dashboard" \
      org.opencontainers.image.description="JSON-driven dashboards with Prometheus-backed metric panels" \
      org.opencontainers.image.source="https://github.com/someone6783/Stratum-Dashboard" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${GIT_REVISION}"
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O - http://127.0.0.1:8787/api/health || exit 1
CMD ["npm", "start"]

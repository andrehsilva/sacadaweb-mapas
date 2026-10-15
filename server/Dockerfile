# Contexto de build: a raiz do repositório (o renderer vive em resources/app/out/renderer).
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server/src ./server/src
COPY resources/app/out/renderer ./public
ENV WEB_DIR=/app/public PORT=3000 NODE_ENV=production
USER node
EXPOSE 3000
# Mesma checagem do compose: o Easypanel/Swarm passam a mostrar o estado do container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server/src/index.js"]

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
CMD ["node", "server/src/index.js"]

FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY api ./api
COPY public ./public

RUN mkdir -p /app/data/uploads && chown -R node:node /app/data

ENV PORT=4599 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

USER node
EXPOSE 4599

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4599)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server/index.js"]

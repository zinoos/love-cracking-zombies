# Container fuer Cloud Run: liefert Client UND WebSocket-Server aus einem Prozess.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Erst nur die Manifeste -> Layer-Cache bleibt bei Codeaenderungen erhalten
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY server ./server
COPY shared ./shared
COPY public ./public

# Cloud Run setzt PORT selbst; lokal ist 8080 der Standard
ENV PORT=8080
EXPOSE 8080

# Nicht als root laufen
USER node

CMD ["node", "server.js"]

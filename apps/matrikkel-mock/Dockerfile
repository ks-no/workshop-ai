FROM node:22-alpine

WORKDIR /app

COPY apps/matrikkel-mock/package.json ./package.json
COPY apps/matrikkel-mock/src ./src
COPY data/matrikkel.seed.json ./data/matrikkel.seed.json

ENV PORT=8085

EXPOSE 8085

CMD ["node", "src/server.js"]


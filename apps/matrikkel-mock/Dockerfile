# Standalone image for running the mock without the rest of the sandbox.
#
# docker-compose.yml does NOT use this file. It used to, and that was a trap: the
# matrikkel is baked in below, so `docker compose up -d` reused a stale layer and
# served the four-street fixture for two weeks after the 221-street extract landed.
# Compose now mounts the working tree like every other service. Anything you change
# in data/matrikkel.json needs a rebuild here, but nowhere else.
FROM node:26-alpine

WORKDIR /app

COPY apps/matrikkel-mock/package.json ./package.json
COPY apps/matrikkel-mock/src ./src
# The full Bergen extract is the seed; the small file stays as a test fixture.
COPY data/matrikkel.json ./data/matrikkel.json
COPY data/matrikkel.seed.json ./data/matrikkel.seed.json

ENV PORT=8085

EXPOSE 8085

CMD ["node", "src/server.ts"]


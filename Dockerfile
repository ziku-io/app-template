# @ziku/ui is a private git dependency, so the install needs SSH.
# Build with:  docker build --ssh default -t app .
FROM node:22-alpine AS build
RUN apk add --no-cache git openssh-client && \
    mkdir -p -m 0700 ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=ssh pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./
# Only what the server needs at runtime; the client is already static.
RUN --mount=type=ssh pnpm install --prod --frozen-lockfile --ignore-scripts

COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations

EXPOSE 3000
CMD ["node", "dist/server/index.js"]

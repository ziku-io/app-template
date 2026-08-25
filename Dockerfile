# @ziku/ui is a public git dependency, so a plain `docker build` is enough.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# A fresh clone of the template has no migrations yet; a generated app does.
# The directory has to exist either way for the runtime COPY below.
RUN mkdir -p migrations && pnpm build

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./
# Only what the server needs at runtime; the client is already static.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations

EXPOSE 3000
CMD ["node", "dist/server/index.js"]

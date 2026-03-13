FROM node:22-bookworm-slim AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run prisma:generate
RUN pnpm run build

FROM node:22-bookworm-slim AS runtime

RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --prod
RUN pnpm run prisma:generate

COPY --from=build /app/build ./build
COPY --from=build /app/domain ./domain
COPY --from=build /app/platform ./platform
COPY --from=build /app/workers ./workers

CMD ["pnpm", "start"]

# Kete Enterprise's API, built from the repository root. The @kete/* packages come from GitHub
# Packages: the build receives NODE_AUTH_TOKEN as a secret, never as a layer. At start-up it applies
# its migrations with the owner role, then serves: an instance installs itself (doctrine D-026).

FROM node:22.14.0-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
RUN --mount=type=secret,id=node_auth_token,env=NODE_AUTH_TOKEN \
  pnpm config set "//npm.pkg.github.com/:_authToken" "$NODE_AUTH_TOKEN" \
  && pnpm install --frozen-lockfile --prod --filter "@kete-enterprise/api" \
  && pnpm config delete "//npm.pkg.github.com/:_authToken"
COPY apps/api apps/api

FROM node:22.14.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system kete && useradd --system --gid kete --home-dir /app kete
COPY --from=build --chown=kete:kete /app/node_modules ./node_modules
COPY --from=build --chown=kete:kete /app/apps/api ./apps/api
WORKDIR /app/apps/api
USER kete
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["sh", "-c", "node_modules/.bin/tsx scripts/migrate.ts && exec node_modules/.bin/tsx src/main.ts"]

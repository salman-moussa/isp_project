FROM node:22.15.0-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY workers/finance-audit-relay/package.json workers/finance-audit-relay/package.json
RUN npm install --global npm@11.17.0 --audit=false
RUN npm ci --ignore-scripts --audit=false

COPY packages/contracts packages/contracts
COPY packages/database packages/database
COPY workers/finance-audit-relay workers/finance-audit-relay
RUN npm run build --workspace=@isp/contracts \
  && npm run build --workspace=@isp/database \
  && npm run build --workspace=@isp/finance-audit-relay \
  && npm prune --omit=dev --audit=false

FROM node:22.15.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/database/package.json ./packages/database/package.json
COPY --from=build --chown=node:node /app/packages/database/dist ./packages/database/dist
COPY --from=build --chown=node:node /app/workers/finance-audit-relay/package.json ./workers/finance-audit-relay/package.json
COPY --from=build --chown=node:node /app/workers/finance-audit-relay/dist ./workers/finance-audit-relay/dist
USER node
EXPOSE 9464
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:9464/live || exit 1
CMD ["node", "workers/finance-audit-relay/dist/server.js"]

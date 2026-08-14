FROM node:22.15.0-alpine3.21 AS build
WORKDIR /workspace
RUN npm install --global npm@11.17.0 --audit=false
COPY . .
RUN npm ci --ignore-scripts --audit=false \
  && npm run build --workspace=@isp/contracts \
  && npm run build --workspace=@isp/domain \
  && npm run build --workspace=@isp/database \
  && npm run build --workspace=@isp/api \
  && npm prune --omit=dev --audit=false

FROM node:22.15.0-alpine3.21 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /workspace/package.json /workspace/package-lock.json ./
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /workspace/packages/domain/package.json ./packages/domain/package.json
COPY --from=build --chown=node:node /workspace/packages/domain/dist ./packages/domain/dist
COPY --from=build --chown=node:node /workspace/packages/database/package.json ./packages/database/package.json
COPY --from=build --chown=node:node /workspace/packages/database/dist ./packages/database/dist
COPY --from=build --chown=node:node /workspace/packages/database/migrations ./packages/database/migrations
COPY --from=build --chown=node:node /workspace/packages/database/migration-scopes.json ./packages/database/migration-scopes.json
COPY --from=build --chown=node:node /workspace/packages/database/scripts ./packages/database/scripts
COPY --from=build --chown=node:node /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /workspace/apps/api/dist ./apps/api/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]

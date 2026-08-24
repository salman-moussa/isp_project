FROM node:22.15.0-alpine3.21 AS build
WORKDIR /workspace
RUN npm install --global npm@11.17.0 --audit=false
COPY . .
RUN npm ci --ignore-scripts --audit=false
RUN npm run build --workspace=@isp/network-worker \
  && npm prune --omit=dev --audit=false

FROM node:22.15.0-alpine3.21 AS runtime
ENV NODE_ENV=production \
    NETWORK_WORKER_MODE=simulator \
    NETWORK_WORKER_PORT=8092
WORKDIR /app
COPY --from=build --chown=node:node /workspace/package.json /workspace/package-lock.json ./
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/workers/network-worker/package.json ./workers/network-worker/package.json
COPY --from=build --chown=node:node /workspace/workers/network-worker/dist ./workers/network-worker/dist
USER node
EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8092/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "workers/network-worker/dist/server.js"]

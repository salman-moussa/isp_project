FROM node:22.15.0-alpine3.21 AS build
WORKDIR /workspace
RUN npm install --global npm@11.17.0 --audit=false
COPY . .
RUN npm ci --ignore-scripts --audit=false \
  && cd apps/tenant-web \
  && ../../node_modules/.bin/tsc --noEmit \
  && ../../node_modules/.bin/vite build \
  && cd ../platform-web \
  && ../../node_modules/.bin/tsc --noEmit \
  && ../../node_modules/.bin/vite build --base=/control/

FROM nginx:1.29.1-alpine3.22
COPY deploy/production/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/tenant-web/dist /usr/share/nginx/html
COPY --from=build /workspace/apps/platform-web/dist /usr/share/nginx/html/control
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

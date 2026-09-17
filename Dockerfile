# Override NODE_IMAGE with a trusted domestic registry mirror when preparing images.
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY package.json package-lock.json ./
RUN npm ci --registry=${NPM_REGISTRY}

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_ICP_NUMBER
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_ICP_NUMBER=${NEXT_PUBLIC_ICP_NUMBER}
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY"
RUN npm run build && node deploy/china/build-worker.mjs

FROM ${NODE_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM deps AS worker-build
COPY supabase/functions/send-reminders/index.ts ./supabase/functions/send-reminders/index.ts
COPY deploy/china/build-worker.mjs ./deploy/china/build-worker.mjs
RUN node deploy/china/build-worker.mjs && npm prune --omit=dev

FROM ${NODE_IMAGE} AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=worker-build --chown=node:node /app/node_modules ./node_modules
COPY --from=worker-build --chown=node:node /app/deploy/china/generated ./deploy/china/generated
COPY --chown=node:node deploy/china/worker.mjs ./deploy/china/worker.mjs
USER node
CMD ["node", "deploy/china/worker.mjs"]

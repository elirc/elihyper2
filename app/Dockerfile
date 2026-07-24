# Multi-stage: dependencies resolve in the builder, and only production
# dependencies plus source reach the runtime image.
#
# Pinned to a minor tag rather than :latest. An image that rebuilds differently
# next month is not reproducible, and "it worked in CI last week" is not a
# debugging story anyone enjoys.
FROM node:22-alpine AS deps

WORKDIR /app

# Copied before the source on purpose. Docker caches layers, so dependencies are
# only reinstalled when the lockfile actually changes rather than on every edit
# to a route handler.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev


FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

# The node image ships an unprivileged `node` user. Running as root inside a
# container is still root against a kernel escape, and there is nothing here
# that needs it.
USER node

EXPOSE 3000

# Uses the app's own health endpoint, which deliberately makes no AWS calls, so
# a Bedrock outage cannot mark an otherwise healthy container unhealthy.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, not shell form: the process gets PID 1 directly and receives
# SIGTERM, which server.js handles for a graceful shutdown. In shell form the
# signal goes to /bin/sh and the server is killed outright.
CMD ["node", "server.js"]

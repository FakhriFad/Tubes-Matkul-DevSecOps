FROM node:20-alpine AS base
WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev; \
    fi

COPY src/ ./src/
# Copy the healthcheck script so it is always present in the final image
COPY healthcheck.js ./healthcheck.js

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node /app/healthcheck.js

CMD ["node", "src/index.js"]

FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY lib ./lib
COPY worker ./worker

CMD ["sh", "-c", "npx prisma migrate deploy && npm run worker:start"]

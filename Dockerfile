FROM oven/bun:1.2.20-alpine

WORKDIR /app

COPY package.json ./
RUN bun install

COPY . .
RUN bun run build

EXPOSE 50051 3000
CMD ["bun", "run", "start"]

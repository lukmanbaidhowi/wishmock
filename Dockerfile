FROM oven/bun:1.2.20-alpine

WORKDIR /app

COPY package.json ./
RUN bun install

COPY . .
RUN bun run build

EXPOSE 50050 50051 3000

# Set environment for container networking
ENV NODE_ENV=production
ENV HOST=0.0.0.0

CMD ["bun", "run", "start"]

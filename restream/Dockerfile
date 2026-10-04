FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package.json ./
COPY server.js ./

ENV PORT=8787
ENV RESTREAM_MAX_CONCURRENT=2
ENV RESTREAM_IDLE_MS=300000

EXPOSE 8787
CMD ["node", "server.js"]

FROM denoland/deno:2.1.4
WORKDIR /app
COPY tvpro-gateway-deno.ts ./gateway.ts
RUN deno cache gateway.ts
EXPOSE 8000
CMD ["deno", "serve", "--allow-net", "--port", "8000", "gateway.ts"]

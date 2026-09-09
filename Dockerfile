FROM denoland/deno:2.9.4 AS build
WORKDIR /app
COPY deno.json deno.lock package.json ./
RUN deno install --frozen
COPY . .
RUN deno task build

FROM denoland/deno:2.9.4
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server.ts LICENSE ./
USER deno
ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD deno eval 'const r = await fetch("http://127.0.0.1:8000/healthz"); if (!r.ok) Deno.exit(1);'
CMD ["run", "--allow-net", "--allow-read=/app/dist", "--allow-env=PORT", "server.ts"]

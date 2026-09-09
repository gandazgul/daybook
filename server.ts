const root = new URL("./dist/", import.meta.url);
const mime: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  json: "application/json",
  webmanifest: "application/manifest+json",
  txt: "text/plain; charset=utf-8",
  png: "image/png",
  woff2: "font/woff2",
  ico: "image/x-icon",
};
Deno.serve({ port: Number(Deno.env.get("PORT") || 8000), hostname: "0.0.0.0" }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/healthz") return new Response("ok");
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (path.includes("..") || path.includes("\\") || path.includes("\0")) {
    return new Response("Bad request", { status: 400 });
  }
  const file = new URL(path === "/" ? "index.html" : `.${path}`, root);
  if (!file.href.startsWith(root.href)) return new Response("Forbidden", { status: 403 });
  try {
    const content = await Deno.readFile(file);
    return new Response(req.method === "HEAD" ? null : content, {
      headers: {
        "Content-Type": mime[path.split(".").pop() || "html"] ||
          (path === "/" ? mime.html : "application/octet-stream"),
        "Cache-Control": path.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
});

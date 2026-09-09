import { defineConfig } from "vite";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

async function filesIn(directory: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await filesIn(directory, path + "/"));
    else if (path !== "sw.js") files.push(path);
  }
  return files.sort();
}

let outputDirectory: string, workerPath: string;
export default defineConfig({
  plugins: [{
    name: "daybook-offline-shell",
    apply: "build",
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir);
      workerPath = resolve(config.root, "src/service-worker.js");
    },
    async closeBundle() {
      const files = await filesIn(outputDirectory);
      const template = await readFile(workerPath, "utf8");
      const hash = createHash("sha256").update(template);
      for (const file of files) {
        hash.update(file).update(await readFile(join(outputDirectory, file)));
      }
      const version = hash.digest("hex").slice(0, 20);
      const assets = files.map((file) => file === "index.html" ? "/" : "/" + file);
      const worker = template.replace("__DAYBOOK_CACHE__", "daybook-shell-" + version)
        .replace(
          "/* __DAYBOOK_ASSETS__ */",
          assets.map((asset) => JSON.stringify(asset)).join(","),
        );
      await writeFile(join(outputDirectory, "sw.js"), worker);
    },
  }],
  server: { host: "0.0.0.0", port: 5198, strictPort: true },
  build: {
    license: { fileName: "dependency-licenses.txt" },
    rollupOptions: { output: { manualChunks: { phaser: ["phaser"] } } },
    // Phaser is the entire rendering engine, so its standalone chunk is intentionally large.
    chunkSizeWarningLimit: 1500,
  },
});

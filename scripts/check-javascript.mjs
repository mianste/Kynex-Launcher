import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { transform } from "esbuild";

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.(js|jsx|mjs)$/.test(entry.name) ? [path] : [];
  }));
  return files.flat();
}

const files = [
  ...(await sourceFiles("src")),
  ...(await sourceFiles("tests")),
  ...(await sourceFiles("src-java/src/desktop/resources")),
  "vite.config.js",
];
await Promise.all(files.map(async (path) => {
  await transform(await readFile(path, "utf8"), {
    sourcefile: path,
    loader: extname(path) === ".jsx" ? "jsx" : "js",
    jsx: "automatic",
    target: "es2022",
  });
}));
console.log("JavaScript syntax checked in %d files", files.length);

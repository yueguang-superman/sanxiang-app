import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateBazi } from "../functions/_shared/bazi.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith("._")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
};

const files = await walk(root);
for (const file of files.filter((path) => /\.(js|mjs|html|css|json)$/.test(path))) {
  const content = await readFile(file, "utf8");
  if (!content.trim()) throw new Error(`${file} is empty`);
}

const bazi = calculateBazi({
  birthDate: "1992-08-18",
  birthTime: "21:35",
});

if (bazi.pillars.length !== 4 || !bazi.dayMaster) {
  throw new Error("Bazi smoke check failed");
}

console.log("Check passed:", bazi.pillars.map((p) => `${p.label}${p.value}`).join(" "));

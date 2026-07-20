import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".npm-cache",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const EXCLUDED_FILES = new Set([".env", ".env.local"]);
const TEXT_EXTENSIONS = new Set([
  "", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".svg", ".txt", ".yml", ".yaml",
]);

const rules = [
  { name: "OpenAI-style plaintext key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u },
  { name: "map URL", pattern: /https:\/\/[^\s]*(?:google\.[^/\s]+\/maps|maps\.google|maps\.app|openstreetmap)/iu },
  { name: "coordinate value", pattern: /\b(?:lat|latitude|lng|longitude)\s*[:=]\s*-?\d{1,3}\.\d{3,}\b/iu },
  { name: "RouteThai GitHub URL", pattern: /https:\/\/github\.com\/routethai(?:\/|\b)/iu },
  { name: "provider key in browser storage", pattern: /localStorage\.(?:setItem|getItem)\([^)]*(?:api.?key|openai|secret|token)/iu },
  { name: "provider key in console output", pattern: /console\.(?:log|error)\([^)]*(?:apiKey|OPENAI_API_KEY)/u },
];

for (const term of String(process.env.CHANGEPLANE_FORBIDDEN_TERMS ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
  rules.push({ name: "restricted customer term", pattern: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu") });
}

function filesUnder(directory) {
  const results = [];
  for (const entry of readdirSync(directory)) {
    if (EXCLUDED_FILES.has(entry)) continue;
    const absolute = path.join(directory, entry);
    const relative = path.relative(ROOT, absolute);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry)) results.push(...filesUnder(absolute));
      continue;
    }
    if (TEXT_EXTENSIONS.has(path.extname(entry).toLowerCase())) results.push({ absolute, relative });
  }
  return results;
}

const findings = [];
const files = filesUnder(ROOT);
for (const file of files) {
  const content = readFileSync(file.absolute, "utf8");
  for (const rule of rules) {
    if (rule.pattern.test(content)) findings.push({ path: file.relative, rule: rule.name });
  }
}

if (findings.length > 0) {
  process.stderr.write(`${JSON.stringify({ passed: false, filesScanned: files.length, findings }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ passed: true, filesScanned: files.length, rules: rules.map(({ name }) => name) })}\n`);
}

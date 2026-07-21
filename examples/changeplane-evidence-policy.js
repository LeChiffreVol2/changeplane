const DEFAULT_EVIDENCE_PROTECTED_PATHS = Object.freeze([
  "test/**",
  "tests/**",
  "spec/**",
  "specs/**",
  "__tests__/**",
  "e2e/**",
  "cypress/**",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "pyproject.toml",
  "pytest.ini",
  "tox.ini",
  "poetry.lock",
  "Pipfile",
  "Pipfile.lock",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "gradle.lockfile",
  "composer.json",
  "composer.lock",
  "Makefile",
]);

const EVIDENCE_DIRECTORIES = new Set([
  "test",
  "tests",
  "spec",
  "specs",
  "__tests__",
  "__snapshots__",
  "e2e",
  "cypress",
]);

const EVIDENCE_CONTROL_FILES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "pyproject.toml",
  "pytest.ini",
  "tox.ini",
  "poetry.lock",
  "Pipfile",
  "Pipfile.lock",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "gradle.lockfile",
  "composer.json",
  "composer.lock",
  "Makefile",
].map((fileName) => fileName.toLowerCase()));

function validPathRule(rule) {
  if (typeof rule !== "string" || !rule || rule.length > 300 || rule.includes("\\") || rule.startsWith("/")) return false;
  const base = rule.endsWith("/**") ? rule.slice(0, -3) : rule;
  return Boolean(base)
    && !base.includes("*")
    && !base.split("/").some((segment) => !segment || segment === "." || segment === "..");
}

export function evidenceProtectedPaths(policy) {
  const configured = policy?.evidence?.protectedPaths;
  if (configured != null && (!Array.isArray(configured) || configured.length > 50 || configured.some((rule) => !validPathRule(rule)))) {
    throw new Error("Policy evidence.protectedPaths must contain at most 50 exact paths or terminal /** rules");
  }
  return [...new Set([
    ...DEFAULT_EVIDENCE_PROTECTED_PATHS,
    ...(configured ?? []),
  ])].sort();
}

export function effectiveProtectedPaths(policy) {
  const requireApproval = policy?.protectedPaths?.requireApproval;
  const block = policy?.protectedPaths?.block;
  if (!Array.isArray(requireApproval) || !Array.isArray(block)) {
    throw new Error("Policy protectedPaths must define requireApproval and block arrays");
  }
  return {
    requireApproval: [...new Set([...requireApproval, ...evidenceProtectedPaths(policy)])].sort(),
    block: [...new Set(block)].sort(),
  };
}

export function isEvidenceControlPath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/")) return true;
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return true;
  if (segments.slice(0, -1).some((segment) => EVIDENCE_DIRECTORIES.has(segment.toLowerCase()))) return true;

  const fileName = segments.at(-1);
  const lowerName = fileName.toLowerCase();
  if (EVIDENCE_CONTROL_FILES.has(lowerName)) return true;
  if (/\.(?:test|spec)\.[a-z0-9]+$/u.test(lowerName)
    || /^test_.+\.py$/u.test(lowerName)
    || /_test\.go$/u.test(lowerName)
    || /\.feature$/u.test(lowerName)
    || /\.snap$/u.test(lowerName)
    || /^(?:jest|vitest|playwright|cypress)\.config\.[a-z0-9]+$/u.test(lowerName)
    || /^tsconfig(?:\.[a-z0-9_-]+)?\.json$/u.test(lowerName)
    || /^requirements(?:-[a-z0-9_-]+)?\.txt$/u.test(lowerName)) return true;
  return false;
}

export { DEFAULT_EVIDENCE_PROTECTED_PATHS };

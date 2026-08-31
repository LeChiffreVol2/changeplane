const DEFAULT_EVIDENCE_PROTECTED_PATHS = Object.freeze([
  ".changeplane.json",
  ".github/workflows/**",
  "changeplane/**",
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

const IMMUTABLE_EVIDENCE_PREFIXES = Object.freeze([
  ".github/workflows",
  "changeplane",
]);

function normalizedEvidencePath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/")) return null;
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "..")) return null;
  const normalized = segments.filter((segment) => segment !== ".").join("/");
  return normalized || null;
}

function actualEvidenceControlPaths(actualFiles) {
  if (!Array.isArray(actualFiles)) {
    throw new Error("Actual files must be an array before evidence controls are evaluated");
  }
  const protectedPaths = [];
  for (const file of actualFiles) {
    const candidates = typeof file === "string"
      ? [file]
      : file && typeof file === "object" && !Array.isArray(file)
        ? [file.path ?? file.filename, file.previousPath ?? file.previousFilename ?? file.previous_filename]
        : [];
    if (candidates.length === 0 || typeof candidates[0] !== "string") {
      throw new Error("Every actual file needs a repository path before evidence controls are evaluated");
    }
    for (const candidate of candidates) {
      if (candidate == null) continue;
      const normalized = normalizedEvidencePath(candidate);
      if (!normalized) throw new Error("Actual evidence-control paths must be safe repository paths");
      if (isEvidenceControlPath(normalized)) protectedPaths.push(normalized);
    }
  }
  return protectedPaths;
}

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

export function effectiveProtectedPaths(policy, actualFiles = []) {
  const requireApproval = policy?.protectedPaths?.requireApproval;
  const block = policy?.protectedPaths?.block;
  if (!Array.isArray(requireApproval) || !Array.isArray(block)) {
    throw new Error("Policy protectedPaths must define requireApproval and block arrays");
  }
  return {
    requireApproval: [...new Set([
      ...requireApproval,
      ...evidenceProtectedPaths(policy),
      ...actualEvidenceControlPaths(actualFiles),
    ])].sort(),
    block: [...new Set(block)].sort(),
  };
}

export function isEvidenceControlPath(value) {
  const normalized = normalizedEvidencePath(value);
  if (!normalized) return true;
  if (normalized === ".changeplane.json"
    || IMMUTABLE_EVIDENCE_PREFIXES.some((prefix) => (
      normalized === prefix || normalized.startsWith(`${prefix}/`)
    ))) return true;
  const segments = normalized.split("/");
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

import { normalizeRepoPath } from "./changeplane.js";

export const REVIEW_AUTHORITY = "ADVISORY_ONLY";
export const REVIEW_MAX_FINDINGS = 5;
export const REVIEW_SEVERITIES = Object.freeze(["critical", "high", "medium", "low"]);
export const REVIEW_CATEGORIES = Object.freeze(["correctness", "security", "reliability", "performance"]);

const MAX_FILES = 40;
const MAX_LINES = 800;
const MAX_INPUT_BYTES = 160 * 1024;
const MAX_LINE_BYTES = 4 * 1024;
const MAX_MEMORY_BYTES = 32 * 1024;
const FINDING_FIELDS = Object.freeze(["path", "line", "severity", "category", "title", "evidence", "suggestion"]);
const encoder = new TextEncoder();

function byteLength(value) {
  return encoder.encode(value).byteLength;
}

function exactHead(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) {
    throw new TypeError("Review input requires an exact lowercase head SHA.");
  }
  return value;
}

function boundedText(value, label, maxBytes) {
  if (typeof value !== "string" || value.includes("\0")) throw new TypeError(`${label} must be text.`);
  const text = value.replaceAll(/\r\n?/gu, "\n").trim();
  if (!text || byteLength(text) > maxBytes) throw new TypeError(`${label} exceeds its bounded text format.`);
  return text;
}

function boundedSourceLine(value, label) {
  if (typeof value !== "string" || /[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    || byteLength(value) > MAX_LINE_BYTES) {
    throw new TypeError(`${label} exceeds its bounded text format.`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new TypeError(`${label} has an invalid structure.`);
  }
}

export function boundedReviewInput(value = {}) {
  exactKeys(value, ["headSha", "files", "memory"], "Review input");
  const { headSha, files, memory } = value;
  const head = exactHead(headSha);
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) {
    throw new TypeError(`Review input requires 1–${MAX_FILES} changed files.`);
  }

  let lineCount = 0;
  let byteCount = 0;
  const seenPaths = new Set();
  const normalizedFiles = files.map((file) => {
    exactKeys(file, ["path", "lines"], "Review file");
    const path = normalizeRepoPath(file.path);
    if (seenPaths.has(path)) throw new TypeError(`Review input repeats ${path}.`);
    seenPaths.add(path);
    if (!Array.isArray(file.lines) || file.lines.length === 0) {
      throw new TypeError(`Review file ${path} requires changed lines.`);
    }

    const seenLines = new Set();
    const lines = file.lines.map((line) => {
      exactKeys(line, ["line", "text"], "Review line");
      if (!Number.isInteger(line.line) || line.line < 1 || seenLines.has(line.line)) {
        throw new TypeError(`Review file ${path} has an invalid or repeated changed line.`);
      }
      seenLines.add(line.line);
      const text = boundedSourceLine(line.text, `Review line ${path}:${line.line}`);
      lineCount += 1;
      byteCount += byteLength(path) + byteLength(text);
      if (lineCount > MAX_LINES || byteCount > MAX_INPUT_BYTES) {
        throw new TypeError("Review input exceeds the bounded changed-line context.");
      }
      return { line: line.line, text };
    });
    return { path, lines };
  });

  let normalizedMemory;
  if (memory != null) {
    exactKeys(memory, ["path", "text"], "Review assurance memory");
    const path = normalizeRepoPath(memory.path);
    const text = boundedText(memory.text, "Review assurance memory", MAX_MEMORY_BYTES);
    if (/[^\t\n\u0020-\u007e\u00a0-\uffff]/u.test(text)) {
      throw new TypeError("Review assurance memory contains control characters.");
    }
    normalizedMemory = { path, text };
  }
  const normalized = {
    headSha: head,
    files: normalizedFiles,
    ...(normalizedMemory ? { memory: normalizedMemory } : {}),
  };
  if (byteLength(JSON.stringify(normalized)) > MAX_INPUT_BYTES) {
    throw new TypeError("Review input exceeds the bounded changed-line context.");
  }
  return normalized;
}

export function validateReviewFindings(envelope, input) {
  const context = boundedReviewInput(input);
  exactKeys(envelope, ["headSha", "findings"], "Review envelope");
  if (exactHead(envelope.headSha) !== context.headSha) {
    throw new TypeError("Review findings are stale for the bound exact head.");
  }
  if (!Array.isArray(envelope.findings) || envelope.findings.length > REVIEW_MAX_FINDINGS) {
    throw new TypeError(`Review output is limited to ${REVIEW_MAX_FINDINGS} findings.`);
  }

  const changedLines = new Map(context.files.map((file) => [
    file.path,
    new Set(file.lines.map(({ line }) => line)),
  ]));
  const seen = new Set();
  const findings = [];
  for (const finding of envelope.findings) {
    exactKeys(finding, FINDING_FIELDS, "Review finding");
    const path = normalizeRepoPath(finding.path);
    if (!Number.isInteger(finding.line) || !changedLines.get(path)?.has(finding.line)) {
      throw new TypeError(`Review finding is outside the changed diff: ${path}:${finding.line}.`);
    }
    if (!REVIEW_SEVERITIES.includes(finding.severity)) {
      throw new TypeError("Review finding severity is invalid.");
    }
    if (!REVIEW_CATEGORIES.includes(finding.category)) {
      throw new TypeError("Review finding category is invalid.");
    }
    const normalized = {
      path,
      line: finding.line,
      severity: finding.severity,
      category: finding.category,
      title: boundedText(finding.title, "Review finding title", 160),
      evidence: boundedText(finding.evidence, "Review finding evidence", 1_200),
      suggestion: boundedText(finding.suggestion, "Review finding suggestion", 1_200),
    };
    const duplicateKey = `${path}\0${finding.line}\0${finding.category}`;
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);
    findings.push(normalized);
  }

  return Object.freeze({
    authority: REVIEW_AUTHORITY,
    headSha: context.headSha,
    findings: Object.freeze(findings.map(Object.freeze)),
  });
}

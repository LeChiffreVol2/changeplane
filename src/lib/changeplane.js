export const DECISION = Object.freeze({
  PASS: 'PASS',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  BLOCKED: 'BLOCKED',
});

export const AUTONOMOUS_DECISION = Object.freeze({
  PASS: 'PASS',
  REMEDIATION_REQUIRED: 'REMEDIATION_REQUIRED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  BLOCKED: 'BLOCKED',
});

export const REMEDIATION_BUDGET_MS = 15 * 60 * 1000;
export const REMEDIATION_MAX_ATTEMPTS = 2;

const APPROVAL_FIELDS = [
  'baseSha',
  'headSha',
  'policyDigest',
  'inputDigest',
  'contractDigest',
  'evaluatorVersion',
];
const REVIEW_CODES = new Set([
  'OUTSIDE_PLANNED_SCOPE',
  'PROTECTED_PATH_REQUIRES_APPROVAL',
  'CONTRACT_CHANGED_AFTER_BINDING',
  'EVIDENCE_FAILED',
  'EVIDENCE_PENDING',
  'EVIDENCE_MISSING',
  'EVIDENCE_SOURCE_MISMATCH',
]);
const MAX_EVIDENCE_DIAGNOSTIC_LENGTH = 6_000;

function normalizeEvidenceDiagnostic(value) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replaceAll(/\r\n?/gu, '\n')
    .replaceAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .trim();
  return normalized ? normalized.slice(0, MAX_EVIDENCE_DIAGNOSTIC_LENGTH) : null;
}

export function normalizeRepoPath(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Repository path must be a string');
  }

  const candidate = value.trim();
  if (!candidate || candidate.startsWith('/') || candidate.includes('\\')) {
    throw new Error(`Invalid repository path: ${value}`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(candidate)) {
    throw new Error('Repository path contains control characters');
  }
  if (candidate.split('/').includes('..')) {
    throw new Error('Repository path cannot traverse to a parent directory');
  }

  const normalized = candidate
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');
  if (!normalized || normalized === '.' || normalized.startsWith('../')) {
    throw new Error(`Invalid repository path: ${value}`);
  }

  return normalized;
}

function parseRule(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Path rule must be a string');
  }

  const candidate = value.trim();
  const marker = candidate.indexOf('/**');
  const isPrefix = candidate.endsWith('/**');
  if (marker !== -1 && (!isPrefix || marker !== candidate.length - 3)) {
    throw new Error(`Only terminal /** path rules are supported: ${value}`);
  }

  const path = normalizeRepoPath(isPrefix ? candidate.slice(0, -3) : candidate);
  return { path, isPrefix, value: isPrefix ? `${path}/**` : path };
}

function ruleMatches(path, rule) {
  return rule.isPrefix
    ? path === rule.path || path.startsWith(`${rule.path}/`)
    : path === rule.path;
}

export function matchesPathRule(filePath, pathRule) {
  return ruleMatches(normalizeRepoPath(filePath), parseRule(pathRule));
}

function actualPathEntries(actualFiles) {
  if (!Array.isArray(actualFiles)) {
    throw new TypeError('actualFiles must be an array');
  }

  return actualFiles.flatMap((file) => {
    if (typeof file === 'string') {
      return [{ path: normalizeRepoPath(file), pathKind: 'current' }];
    }
    if (!file || typeof file !== 'object') {
      throw new TypeError('Each actual file must be a path or file object');
    }

    const current = file.path ?? file.filename;
    if (typeof current !== 'string') {
      throw new TypeError('File objects require path or filename');
    }

    const entries = [
      { path: normalizeRepoPath(current), pathKind: 'current' },
    ];
    const previous = file.previousPath ?? file.previousFilename ?? file.previous_filename;
    if (previous != null) {
      entries.push({ path: normalizeRepoPath(previous), pathKind: 'previous' });
    }
    return entries;
  });
}

function parseRules(rules, label) {
  if (!Array.isArray(rules)) {
    throw new TypeError(`${label} must be an array`);
  }
  return rules.map(parseRule);
}

function assessApproval(approval, current) {
  if (approval == null) {
    return { status: 'MISSING', staleFields: [] };
  }
  if (typeof approval !== 'object') {
    throw new TypeError('approval must be an object');
  }

  const staleFields = APPROVAL_FIELDS.filter((field) => (
    typeof current[field] !== 'string'
      || current[field].length === 0
      || approval[field] !== current[field]
  ));

  return {
    status: staleFields.length === 0 ? 'VALID' : 'STALE',
    staleFields,
  };
}

export function evaluateChange({
  plannedPaths,
  actualFiles,
  protectedPaths = {},
  approval,
  baseSha,
  headSha,
  policyDigest,
  inputDigest,
  contractDigest,
  evaluatorVersion,
}) {
  const plannedRules = parseRules(plannedPaths, 'plannedPaths');
  const approvalRules = parseRules(
    protectedPaths.requireApproval ?? [],
    'protectedPaths.requireApproval',
  );
  const blockRules = parseRules(
    protectedPaths.block ?? [],
    'protectedPaths.block',
  );
  const entries = actualPathEntries(actualFiles);
  const reasons = [];
  const seen = new Set();

  const addReason = (code, entry, rule) => {
    const key = `${code}:${entry.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    reasons.push({
      code,
      path: entry.path,
      pathKind: entry.pathKind,
      ...(rule ? { rule: rule.value } : {}),
    });
  };

  for (const entry of entries) {
    if (!plannedRules.some((rule) => ruleMatches(entry.path, rule))) {
      addReason('OUTSIDE_PLANNED_SCOPE', entry);
    }

    const blockRule = blockRules.find((rule) => ruleMatches(entry.path, rule));
    if (blockRule) {
      addReason('BLOCKED_PATH', entry, blockRule);
      continue;
    }

    const approvalRule = approvalRules.find((rule) => ruleMatches(entry.path, rule));
    if (approvalRule) {
      addReason('PROTECTED_PATH_REQUIRES_APPROVAL', entry, approvalRule);
    }
  }

  const approvalState = assessApproval(approval, {
    baseSha,
    headSha,
    policyDigest,
    inputDigest,
    contractDigest,
    evaluatorVersion,
  });
  const hasBlockedPath = reasons.some(({ code }) => code === 'BLOCKED_PATH');
  const hasReviewReason = reasons.some(({ code }) => REVIEW_CODES.has(code));
  const approvalIsValid = approvalState.status === 'VALID';

  const decision = hasBlockedPath
    ? DECISION.BLOCKED
    : hasReviewReason && !approvalIsValid
      ? DECISION.REVIEW_REQUIRED
      : DECISION.PASS;

  return {
    decision,
    approval: approvalState,
    reasons: reasons.map((reason) => ({
      ...reason,
      resolved: REVIEW_CODES.has(reason.code) && approvalIsValid,
    })),
  };
}

export function evaluateEvidence({ requiredChecks = [], checks = [] } = {}) {
  if (!Array.isArray(requiredChecks)) throw new TypeError('requiredChecks must be an array');
  if (!Array.isArray(checks)) throw new TypeError('checks must be an array');

  const requirements = requiredChecks.map((requirement) => {
    if (typeof requirement === 'string' && requirement.trim()) {
      return { name: requirement.trim(), appSlug: null };
    }
    if (
      !requirement
      || typeof requirement !== 'object'
      || Array.isArray(requirement)
      || typeof requirement.name !== 'string'
      || !requirement.name.trim()
      || typeof requirement.appSlug !== 'string'
      || !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(requirement.appSlug)
      || Object.keys(requirement).some((key) => key !== 'name' && key !== 'appSlug')
    ) {
      throw new TypeError('Each required check must be a name or { name, appSlug }');
    }
    return { name: requirement.name.trim(), appSlug: requirement.appSlug };
  });

  const byName = new Map();
  for (const check of checks) {
    if (!check || typeof check.name !== 'string') continue;
    const timestamp = Date.parse(check.completedAt ?? check.startedAt ?? check.createdAt ?? 0) || 0;
    const candidates = byName.get(check.name) ?? [];
    candidates.push({ ...check, timestamp });
    byName.set(check.name, candidates);
  }

  const reasons = [];
  const evidence = requirements.map(({ name, appSlug }) => {
    const named = byName.get(name) ?? [];
    const eligible = appSlug ? named.filter(({ source }) => source === appSlug) : named;
    const check = eligible.sort((left, right) => right.timestamp - left.timestamp)[0];
    if (!check) {
      const code = appSlug && named.length > 0 ? 'EVIDENCE_SOURCE_MISMATCH' : 'EVIDENCE_MISSING';
      reasons.push({ code, path: `check:${name}`, pathKind: 'evidence' });
      return { name, source: null, expectedSource: appSlug, status: 'MISSING', conclusion: null };
    }

    const status = String(check.status ?? '').toUpperCase();
    const conclusion = check.conclusion == null ? null : String(check.conclusion).toUpperCase();
    if (status !== 'COMPLETED') {
      reasons.push({ code: 'EVIDENCE_PENDING', path: `check:${name}`, pathKind: 'evidence' });
    } else if (conclusion !== 'SUCCESS') {
      const diagnostic = normalizeEvidenceDiagnostic(check.diagnostic);
      reasons.push({
        code: 'EVIDENCE_FAILED',
        path: `check:${name}`,
        pathKind: 'evidence',
        ...(diagnostic ? { diagnostic } : {}),
      });
    }
    return { name, source: check.source ?? null, expectedSource: appSlug, status, conclusion };
  });

  return {
    decision: reasons.length === 0 ? DECISION.PASS : DECISION.REVIEW_REQUIRED,
    reasons,
    evidence,
  };
}

export function planAutonomousDecision({
  result,
  agentConfigured = false,
  attempt = 0,
  maxAttempts = 2,
}) {
  if (!result || typeof result !== 'object' || !Object.values(DECISION).includes(result.decision)) {
    throw new TypeError('result must be a ChangePlane evaluation result');
  }
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new TypeError('attempt must be a non-negative integer');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new TypeError('maxAttempts must be an integer between 1 and 5');
  }

  if (result.decision === DECISION.BLOCKED) {
    return {
      decision: AUTONOMOUS_DECISION.BLOCKED,
      humanRequired: true,
      reason: 'NON_OVERRIDABLE_POLICY',
      findings: result.reasons.filter(({ resolved }) => !resolved),
    };
  }

  const unresolved = result.reasons.filter(({ resolved }) => !resolved);
  const protectedFindings = unresolved.filter(({ code }) => code === 'PROTECTED_PATH_REQUIRES_APPROVAL');
  if (protectedFindings.length > 0) {
    return {
      decision: AUTONOMOUS_DECISION.REVIEW_REQUIRED,
      humanRequired: true,
      reason: 'PROTECTED_CAPABILITY',
      findings: protectedFindings,
    };
  }

  const nonRemediableFindings = unresolved.filter(({ code }) => (
    code !== 'OUTSIDE_PLANNED_SCOPE' && code !== 'EVIDENCE_FAILED'
  ));
  if (nonRemediableFindings.length > 0) {
    return {
      decision: AUTONOMOUS_DECISION.REVIEW_REQUIRED,
      humanRequired: true,
      reason: nonRemediableFindings[0].code,
      findings: nonRemediableFindings,
    };
  }

  const fixableFindings = unresolved.filter(({ code }) => (
    code === 'OUTSIDE_PLANNED_SCOPE' || code === 'EVIDENCE_FAILED'
  ));
  if (fixableFindings.length > 0) {
    const findingKinds = new Set(fixableFindings.map(({ code }) => code));
    if (findingKinds.size > 1) {
      return {
        decision: AUTONOMOUS_DECISION.REVIEW_REQUIRED,
        humanRequired: true,
        reason: 'MIXED_REMEDIATION_UNSUPPORTED',
        findings: fixableFindings,
      };
    }
    if (!agentConfigured) {
      return {
        decision: AUTONOMOUS_DECISION.REVIEW_REQUIRED,
        humanRequired: true,
        reason: 'AGENT_ADAPTER_NOT_CONFIGURED',
        findings: fixableFindings,
      };
    }
    if (attempt >= maxAttempts) {
      return {
        decision: AUTONOMOUS_DECISION.REVIEW_REQUIRED,
        humanRequired: true,
        reason: 'REMEDIATION_BUDGET_EXHAUSTED',
        findings: fixableFindings,
      };
    }
    return {
      decision: AUTONOMOUS_DECISION.REMEDIATION_REQUIRED,
      humanRequired: false,
      reason: findingKinds.has('EVIDENCE_FAILED')
        ? 'FIXABLE_EVIDENCE_FAILURE'
        : 'FIXABLE_SCOPE_DRIFT',
      nextAttempt: attempt + 1,
      findings: fixableFindings,
    };
  }

  return {
    decision: AUTONOMOUS_DECISION.PASS,
    humanRequired: false,
    reason: 'ALL_GUARANTEES_SATISFIED',
    findings: [],
  };
}

export function buildRemediationRequest({
  idempotencyKey,
  repository,
  repositoryId,
  installationId,
  pullRequestNumber,
  baseRef,
  baseSha,
  headSha,
  headRef,
  headRepository,
  controllerSha,
  contract,
  contractDigest,
  policyDigest,
  evaluatorVersion,
  inputDigest,
  plan,
}) {
  if (typeof idempotencyKey !== 'string' || !/^[a-f0-9]{64}$/u.test(idempotencyKey)) {
    throw new TypeError('idempotencyKey must be a 64-character lowercase hexadecimal digest');
  }
  if (typeof repository !== 'string' || !repository
    || !Number.isSafeInteger(repositoryId) || repositoryId < 1
    || !Number.isSafeInteger(installationId) || installationId < 1
    || !Number.isInteger(pullRequestNumber) || pullRequestNumber < 1) {
    throw new TypeError('repository, installation identity, and pullRequestNumber are required');
  }
  if (!plan || plan.decision !== AUTONOMOUS_DECISION.REMEDIATION_REQUIRED) {
    throw new TypeError('plan must require remediation');
  }
  if (typeof baseRef !== 'string' || !baseRef || typeof headRef !== 'string' || !headRef || headRepository !== repository) {
    throw new TypeError('remediation requires a same-repository head ref');
  }
  if (!/^[a-f0-9]{40}$/u.test(baseSha ?? '') || !/^[a-f0-9]{40}$/u.test(headSha ?? '')
    || !/^[a-f0-9]{40}$/u.test(controllerSha ?? '')) {
    throw new TypeError('remediation requires exact base and head SHAs');
  }
  if (![1, 2].includes(plan.nextAttempt)) {
    throw new TypeError('remediation attempt must be 1 or 2');
  }
  if (!contract || !Array.isArray(contract.scope) || contract.scope.length < 1
    || (contract.goal != null && typeof contract.goal !== 'string')) {
    throw new TypeError('remediation requires the bound pull-request contract');
  }
  for (const value of [contractDigest, policyDigest, inputDigest]) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
      throw new TypeError('remediation authority digests must be lowercase SHA-256 values');
    }
  }
  if (typeof evaluatorVersion !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/u.test(evaluatorVersion)) {
    throw new TypeError('remediation evaluator version is invalid');
  }
  const evidenceRepair = plan.reason === 'FIXABLE_EVIDENCE_FAILURE';
  const allowedPaths = evidenceRepair
    ? contract.scope
    : plan.findings.map(({ path }) => path);

  return {
    schemaVersion: 3,
    issuer: 'changeplane-guard',
    idempotencyKey,
    change: {
      repository,
      repositoryId,
      installationId,
      pullRequestNumber,
      baseRef,
      baseSha,
      headSha,
      headRef,
      headRepository,
    },
    authority: {
      contractDigest,
      policyDigest,
      evaluatorVersion,
      inputDigest,
      controllerSha,
      policyPath: '.changeplane.json',
    },
    contract: { scope: contract.scope, goal: contract.goal ?? null },
    attempt: plan.nextAttempt,
    repairKind: evidenceRepair ? 'evidence' : 'scope',
    allowedPaths,
    instructions: plan.findings.map(({ code, path, pathKind, diagnostic }) => ({
      code,
      path,
      pathKind,
      action: evidenceRepair
        ? 'RESTORE_FAILED_EVIDENCE_WITHIN_DECLARED_SCOPE'
        : 'REVERT_OR_MOVE_INTO_DECLARED_SCOPE',
      ...(evidenceRepair && diagnostic ? { diagnostic } : {}),
    })),
  };
}

export function detectFileOverlap(actualFiles, otherPullRequest) {
  if (!otherPullRequest || String(otherPullRequest.state).toLowerCase() !== 'open') {
    return null;
  }

  const ours = new Set(actualPathEntries(actualFiles).map(({ path }) => path));
  const theirs = new Set(
    actualPathEntries(otherPullRequest.actualFiles ?? []).map(({ path }) => path),
  );
  const paths = [...ours].filter((path) => theirs.has(path)).sort();
  if (paths.length === 0) return null;

  return {
    code: 'OPEN_PR_FILE_OVERLAP',
    severity: 'ADVISORY',
    paths,
    pullRequest: {
      number: otherPullRequest.number,
      title: otherPullRequest.title,
      url: otherPullRequest.url,
    },
  };
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowsClockwise,
  CalendarBlank,
  CaretDown,
  CaretRight,
  Check,
  CheckCircle,
  Circle,
  Clock,
  Copy,
  FileCode,
  FunnelSimple,
  GitBranch,
  GithubLogo,
  GitMerge,
  Lightning,
  LockKey,
  MagnifyingGlass,
  Play,
  Question,
  Robot,
  SignOut,
  ShieldCheck,
  UserCircle,
  Warning,
  WarningOctagon,
  X,
} from "@phosphor-icons/react";
import {
  evaluateChange,
} from "./lib/changeplane.js";
import { runOriginBoundaryProof } from "./lib/assurance-lab.js";
import { ApiError, responseJson } from "./lib/api-client.js";
import {
  REVISION_STAGE_STATE,
  buildRevisionSdlcAssurance,
  buildSdlcAssurance,
} from "./lib/sdlc-assurance.js";
import {
  BYOK_SECRET_NAME,
  DEFAULT_PROPOSAL_MODEL,
  PROPOSAL_REASONING_EFFORT,
  SUPPORTED_PROPOSAL_MODELS,
} from "./lib/runtime.js";

const POLICY = {
  requireApproval: [".github/workflows/**", "tests/**", "migrations/**", "infra/**"],
  block: ["secrets/**"],
};

const REVISION = {
  policyDigest: "policy-release-governance-v3",
  inputDigest: "scope-and-files-v2",
};

const PAGE_QUERY = new URLSearchParams(window.location.search);
const PREVIEW_MODE = import.meta.env.DEV;
const CANARY_OWNER_ENTRY = PAGE_QUERY.get("access") === "canary-owner";
const GITHUB_ENTRY_ERROR = {
  owner_required: "This owner-controlled canary is not available to that GitHub account.",
  owner_ambiguous: "More than one owner installation was found. Review the GitHub App installations before trying again.",
  authorization_cancelled: "GitHub authorization was cancelled. Nothing was connected or changed. Try again when you are ready.",
  authorization_failed: "GitHub could not complete authorization. Try again; no repository access or settings were changed.",
  installation_missing: "No ChangePlane installation is available yet. If you requested organization access, wait for an owner to approve it, then continue with GitHub.",
  installation_unavailable: "That ChangePlane installation is not available to this GitHub account. Sign in with an account that can access it or install ChangePlane again.",
  permissions_required: "ChangePlane is installed, but its required repository permissions are not active. Ask an organization owner to review the App request, then continue with GitHub.",
}[PAGE_QUERY.get("github")] ?? "";
const SESSION_KEY = "changeplane.preview-session.v3";
const RUNS_KEY = "changeplane.autonomous-runs.v2";
const PRESENTATION_USER = {
  name: "Alex Morgan",
  handle: "alex-example",
  email: "alex@example.invalid",
  organization: "Example Engineering",
  role: "Platform Engineering",
  initials: "AM",
  isPreview: true,
};

const PREVIEW_REPOSITORIES = [
  {
    fullName: "routethai-shadow/synthetic-routing",
    private: true,
    defaultBranch: "main",
    permissions: { push: true, admin: false },
  },
];

const RUNNING_STATES = new Set(["binding", "failing", "proposing", "validating", "applying", "rechecking", "publishing"]);
const FILTERS = ["All changes", "Active", "Exceptions"];
const RUNTIME = {
  provider: "OpenAI",
  model: "GPT-5.6 Luna",
  modelId: DEFAULT_PROPOSAL_MODEL,
  effort: PROPOSAL_REASONING_EFFORT,
  secretName: BYOK_SECRET_NAME,
};
const EMPTY_BYOK = {
  configured: false,
  state: "not_connected",
  secretName: RUNTIME.secretName,
  updatedAt: null,
};
const EMPTY_HARNESS = {
  mode: "observe",
  verifyAvailable: true,
  autonomousAvailable: false,
  ready: false,
  enforcement: {
    state: "not_installed",
    assuranceLevel: null,
    active: false,
    queueCertified: false,
    strict: false,
    mergeQueueRequired: false,
    guardRequired: false,
    publisherBound: false,
    evidenceRequired: false,
    evidencePublisherBound: false,
  },
  maxAttempts: 2,
  budgetMinutes: 15,
  sdlc: buildSdlcAssurance(),
};

function enforcementMessage(enforcement) {
  if (enforcement?.assuranceLevel === "queue_certified") return "Queue Certified is active: one strict, no-bypass default-branch Ruleset requires Merge Queue, the dedicated-App guard, and every behavioral evidence Check from its expected publisher.";
  if (enforcement?.assuranceLevel === "strict_head") return "Strict Head is active: the exact pull-request head is protected by one strict, no-bypass Ruleset with the dedicated-App guard and every behavioral evidence Check bound to its expected publisher.";
  if (enforcement?.active && enforcement?.mergeQueueRequired) return "Queue Certified is active: one strict, no-bypass default-branch Ruleset requires Merge Queue, the dedicated-App guard, and every behavioral evidence Check from its expected publisher.";
  if (enforcement?.active) return "Strict Head is active: the exact pull-request head is protected by one strict, no-bypass Ruleset with the dedicated-App guard and every behavioral evidence Check bound to its expected publisher.";
  if (typeof enforcement?.nextAction === "string" && enforcement.nextAction) return enforcement.nextAction;
  if (enforcement?.state === "admin_required") return "A repository administrator must verify merge protection. Nothing was changed.";
  if (enforcement?.state === "ruleset_required") return "Add one active branch Ruleset targeting the default branch, then recheck.";
  if (enforcement?.state === "ruleset_ambiguous") return "Make the default-branch Ruleset unambiguous and remove bypass actors, then recheck.";
  if (enforcement?.state === "strict_required") return "Require strict up-to-date status checks in the same default-branch Ruleset, then recheck.";
  if (enforcement?.state === "merge_queue_required") return "Add Merge Queue to that same default-branch Ruleset, then recheck.";
  if (enforcement?.state === "guard_required") return "Add ChangePlane / guard to that same default-branch Ruleset, then recheck.";
  if (enforcement?.state === "guard_run_required") return "Open or update one pull request so GitHub records the guard publisher, then recheck.";
  if (enforcement?.state === "publisher_binding_required") return "Require ChangePlane / guard from the dedicated ChangePlane App shown on the live Check.";
  if (enforcement?.state === "evidence_required") return "Require every configured behavioral evidence Check in that same Ruleset, then recheck.";
  if (enforcement?.state === "evidence_publisher_binding_required") return "Bind every behavioral evidence Check to its expected GitHub App in that same Ruleset, then recheck.";
  if (enforcement?.state === "verify_mode_required") return "The guard is required, but Observe remains neutral. Switch to Verify only or Autonomous before treating it as enforcement.";
  return "Use one strict, no-bypass default-branch Ruleset with the dedicated-App ChangePlane / guard and every behavioral evidence Check bound to its expected publisher. Add Merge Queue for Queue Certified assurance.";
}

function harnessModeLabel(mode) {
  if (mode === "verify") return "Verify only";
  if (mode === "autonomous") return "Autonomous";
  return "Observe";
}

const GITHUB_ACTIONS_PUBLISHER = "github-actions";
const GITHUB_WORKFLOW_PATH_PATTERN = /^\.github\/workflows\/[^/]+\.(?:yml|yaml)$/u;

function requiresWorkflowPath(appSlug) {
  return appSlug.trim() === GITHUB_ACTIONS_PUBLISHER;
}

function validWorkflowPath(workflowPath) {
  return GITHUB_WORKFLOW_PATH_PATTERN.test(workflowPath.trim());
}

function evidenceOptionValue({ name = "", appSlug = "", workflowPath = "" } = {}) {
  return `${name}\0${appSlug}\0${workflowPath}`;
}

const PREVIEW_PREFLIGHT = {
  repositoryState: "active",
  installable: true,
  conflicts: [],
  setupFiles: 9,
  setupProfile: "verify-lite",
  payloadProfiles: {
    verifyLite: { managedProfile: "verify-lite", files: 9, repairAuthority: false, providerKeyRequired: false },
    autonomous: { managedProfile: "full", files: 21, repairAuthority: true, providerKeyRequired: true },
  },
  evidenceOptions: [{
    name: "test",
    appSlug: "github-actions",
    workflowPath: ".github/workflows/ci.yml",
    suggested: true,
  }],
  harness: { verifyAvailable: true, autonomousAvailable: true, maxAttempts: 2, budgetMinutes: 15 },
  capabilities: {
    independentReview: false,
    agentHandback: true,
    assuranceMemory: false,
    exactHeadPreview: true,
    mergeQueue: true,
  },
  boundary: {
    defaultBranchWrite: false,
    pullRequestOnly: true,
    mergeBlocking: false,
    agentRepairDuringSetup: false,
    untrustedCodeExecution: false,
    providerSecretAccess: false,
  },
};

const CHANGES = [
  {
    id: "route",
    changeId: "chg_RTH_01",
    title: "Keep every stop inside its service window",
    repo: "routethai-shadow/synthetic-routing",
    pr: 48,
    initialStatus: "ready",
    time: "Just now",
    summary: "An agent changed the route-planning heuristic.",
    impact: "One synthetic stop now falls outside its service window.",
    reportedImpact: "The reconstructed new commit matches the same synthetic service-window test that caught the fixture failure.",
    scope: "src/routing/**",
    initialHead: "71b04c2",
    head: "71b04c2",
    repairedHead: "9fc82a1",
    base: "a1f9d7c (main)",
    author: "coding-agent[bot]",
    opened: "58m ago",
    updated: "7m ago",
    worktree: "cp/pr-48",
    agent: "coding-agent[bot]",
    origin: "Codex",
    risk: "R2",
    riskLabel: "Standard",
    plannedFiles: 2,
    initialHeadSha: "71b04c2e8a5d3101cce89d4f0a0b13273f2b631d",
    headSha: "71b04c2e8a5d3101cce89d4f0a0b13273f2b631d",
    repairedHeadSha: "9fc82a1b650d7a77340588f1b04f8ca4e788e7a2",
    intentHeadSha: "71b04c2e8a5d3101cce89d4f0a0b13273f2b631d",
    changeHeadSha: "71b04c2e8a5d3101cce89d4f0a0b13273f2b631d",
    evidenceHeadSha: null,
    reviewHeadSha: "71b04c2e8a5d3101cce89d4f0a0b13273f2b631d",
    previewHead: "9fc82a1",
    previewHeadSha: "9fc82a1b650d7a77340588f1b04f8ca4e788e7a2",
    files: [
      { path: "src/routing/heuristic.ts", add: 34, remove: 11, scope: "In scope", evidenceRelevant: true },
      { path: "src/routing/service-window.ts", add: 12, remove: 4, scope: "In scope" },
    ],
  },
];

const PIPELINE = [
  ["contract", "Bind exact head"],
  ["evidence", "Reconstruct failure"],
  ["proposal", "Project Luna proposal"],
  ["validation", "Project clean validation"],
  ["apply", "Project trusted apply"],
  ["recheck", "Reconstruct new-head evidence"],
  ["check", "Reconstruct guard eligibility"],
];

function readStoredJson(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function useDialogFocus(open, onClose) {
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () => Array.from(dialog.querySelectorAll(focusableSelector));
    const initialFocus = dialog.querySelector("[data-dialog-initial]") || focusable()[0] || dialog;
    initialFocus.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [open]);

  return dialogRef;
}

function sessionFor(login, csrf, authMode = "oauth") {
  const initials = login.slice(0, 2).toUpperCase();
  return {
    name: login,
    handle: login,
    organization: "GitHub",
    role: "Repository access",
    initials,
    csrf,
    authMode,
    isPreview: false,
  };
}

function LoginScreen({ authStatus, configured, authMode, rolloutMode, ownerEntry, error, isSigningIn, onSignIn, onAuthorize, onExplore, onOpenLab }) {
  const checking = authStatus === "loading";
  const canConnect = configured === true && !checking;
  const controlledCanary = rolloutMode === "controlled_canary";
  const exampleOnly = (configured === false || controlledCanary) && !checking;
  const buttonLabel = checking
    ? "Checking GitHub…"
    : configured === false
      ? "GitHub connection unavailable"
      : "Connect GitHub";

  return (
    <main className="auth-stage">
      <section className="auth-shell" aria-labelledby="sign-in-title">
        <div className="auth-story">
          <div className="auth-brand-row">
            <span className="auth-mark" aria-hidden="true"><ShieldCheck size={21} weight="fill" /></span>
            <span>ChangePlane</span>
          </div>

          <div className="auth-message">
            <p className="auth-kicker"><span /> Agentic SDLC assurance</p>
            <h1>Keep GitHub.<br />Let agents ship.</h1>
            <p>Agents can author the change. ChangePlane keeps intent, review, evidence, and delivery tied to the exact commit before GitHub decides what ships.</p>
          </div>

          <div className="auth-signal" aria-label="Exact-revision assurance contract">
            <div className="auth-signal-heading">
              <span><i /> Exact-revision assurance contract</span>
              <time>GitHub-native</time>
            </div>
            <div className="auth-signal-row">
              <div>
                <strong>{exampleOnly
                  ? "Inspect a reconstructed assurance contract without connecting a repository."
                  : "Agent opens PR → ChangePlane verifies → GitHub decides"}</strong>
                <span>{exampleOnly
                  ? "RouteThai use case · synthetic contract reconstruction"
                  : "Works with Codex, Cursor, Claude Code, and other coding agents"}</span>
              </div>
              <span className="auth-pass-label">{exampleOnly ? "No repository access" : "Verify first · no model key"}</span>
            </div>
          </div>
        </div>

        <div className="auth-access">
          <div className="auth-form">
            <p className="auth-eyebrow">{exampleOnly ? "Public example" : "GitHub-native setup"}</p>
            <h2 id="sign-in-title">{exampleOnly ? "See the SDLC assurance spine." : "Give agent PRs independent lifecycle assurance."}</h2>
            <p>{exampleOnly
              ? "Inspect a reconstruction of one synthetic change from bound intent through exact-head evidence and back to GitHub. Nothing connects to a repository."
              : "Connect a repository, bind one real test, and merge one setup pull request. ChangePlane handles the normal path from then on."}</p>

            {error && <p className="auth-error" role="alert"><Warning size={16} weight="fill" /> {error}</p>}

            {exampleOnly ? (
              <button className={`github-sign-in ${isSigningIn ? "is-loading" : ""}`} type="button" onClick={onExplore} disabled={isSigningIn}>
                {isSigningIn ? <ArrowsClockwise className="spin" size={20} weight="bold" aria-hidden="true" /> : <Play size={19} weight="fill" aria-hidden="true" />}
                <span>{isSigningIn ? "Opening workspace…" : "Open RouteThai example workspace"}</span>
                {!isSigningIn && <ArrowRight size={18} aria-hidden="true" />}
              </button>
            ) : (
              <>
                <button
                  className={`github-sign-in ${isSigningIn ? "is-loading" : ""}`}
                  type="button"
                  onClick={onSignIn}
                  disabled={isSigningIn || !canConnect}
                >
                  {isSigningIn || checking ? (
                    <ArrowsClockwise className="spin" size={20} weight="bold" aria-hidden="true" />
                  ) : (
                    <GithubLogo size={21} weight="fill" aria-hidden="true" />
                  )}
                  <span>{isSigningIn ? "Opening GitHub…" : canConnect && authMode === "github_app" ? "Install ChangePlane on GitHub" : buttonLabel}</span>
                  {!isSigningIn && !checking && canConnect && <ArrowRight size={18} aria-hidden="true" />}
                </button>
                {authMode === "github_app" && (
                  <p className="auth-account-choice">Choose a personal account or organization on GitHub. Organization access may require owner approval.</p>
                )}
              </>
            )}

            {authMode === "github_app" && canConnect && (!controlledCanary || ownerEntry) && (
              <button className="github-existing" type="button" onClick={onAuthorize} disabled={isSigningIn}>
                {controlledCanary ? "Canary owner sign in" : "Already installed? Continue with GitHub"}
              </button>
            )}

            {!exampleOnly && (
              <button className="github-existing" type="button" onClick={onExplore} disabled={isSigningIn}>
                View RouteThai example
              </button>
            )}

            <button className="assurance-lab-entry" type="button" onClick={onOpenLab} disabled={isSigningIn}>
              <ShieldCheck size={16} weight="fill" /> Run the synthetic Origin boundary proof <ArrowRight size={14} />
            </button>

            <p className="auth-security"><LockKey size={15} /> {controlledCanary
              ? "The example never accesses GitHub. Private rollout access can see only the pre-authorized canary repository."
              : exampleOnly
              ? "Synthetic data only. The public example cannot push, merge, or deploy."
              : authMode === "github_app"
                ? "GitHub sign-in verifies installations you can access. Your OpenAI key is encrypted directly into GitHub Actions."
                : "Choose one repository. ChangePlane writes only through a setup pull request."}</p>
            {controlledCanary ? (
              <p className="auth-deployment-note">New GitHub installations stay closed while the private canary is validated.</p>
            ) : exampleOnly ? (
              <p className="auth-deployment-note">Synthetic autonomous contract reconstruction · no live repository access.</p>
            ) : configured ? (
              <p className="auth-deployment-note">GitHub.com personal accounts, organizations, and Enterprise Cloud. GitHub Enterprise Server is not yet supported.</p>
            ) : configured === false && !checking && (
              <p className="auth-deployment-note">
                This deployment needs GitHub connection credentials before it can connect a repository.
              </p>
            )}
          </div>

          <footer className="auth-footer">
            <span>Exact commit · trusted checks · clear receipt</span>
            <span className="auth-footer-links">
              <a href="https://github.com/LeChiffreVol2/changeplane/blob/main/docs/data-handling.md" target="_blank" rel="noreferrer">Data handling</a>
              <a href="https://github.com/LeChiffreVol2/changeplane/blob/main/SECURITY.md" target="_blank" rel="noreferrer">Security</a>
              <a href="https://github.com/LeChiffreVol2/changeplane/blob/main/SUPPORT.md" target="_blank" rel="noreferrer">Support</a>
              <span>{checking ? "Checking connection" : controlledCanary ? "Private canary" : configured ? authMode === "github_app" ? "GitHub App" : "GitHub OAuth" : exampleOnly ? "No repository access" : "GitHub not configured"}</span>
            </span>
          </footer>
        </div>
      </section>
    </main>
  );
}

function SetupProgress({ complete, isPreview, repositorySelected, isUpgrade, isCurrent, needsOwnerReview, needsRetry }) {
  return (
    <ol className="setup-progress" aria-label="Repository setup progress">
      <li className="is-complete">
        <span><Check size={13} weight="bold" /></span>
        <div>
          <strong>{isPreview ? "Example opened" : "GitHub connected"}</strong>
          <small>{isPreview ? "No account access" : "Account verified"}</small>
        </div>
      </li>
      <li className={repositorySelected ? "is-complete" : "is-active"}>
        <span>{repositorySelected ? <Check size={13} weight="bold" /> : "2"}</span>
        <div><strong>Choose repository</strong><small>Personal or organization-owned</small></div>
      </li>
      <li className={isCurrent ? "is-complete" : needsOwnerReview || needsRetry ? "is-attention" : complete ? "is-active" : ""}>
        <span>{isCurrent ? <Check size={13} weight="bold" /> : needsOwnerReview || needsRetry ? <Warning size={13} weight="fill" /> : "3"}</span>
        <div>
          <strong>{isCurrent ? "Setup complete" : needsOwnerReview ? "Owner review needed" : needsRetry ? "Retry repository check" : isPreview ? `Project the ${isUpgrade ? "upgrade" : "setup"} PR` : `Merge ${isUpgrade ? "upgrade" : "setup"} PR`}</strong>
          <small>{isCurrent
            ? "No repository change is needed"
            : needsOwnerReview
              ? "ChangePlane stopped before writing"
              : needsRetry
                ? "The read-only check did not finish"
            : isUpgrade
              ? "Current installation stays active until merge"
              : isPreview ? "A connected installation would stay inert before merge" : "Nothing starts before GitHub shows it merged"}</small>
        </div>
      </li>
    </ol>
  );
}

function SetupAccount({ session, onSignOut }) {
  return (
    <div className="setup-account">
      <span className="avatar" aria-hidden="true">{session.initials}</span>
      <span><strong>@{session.handle}</strong><small>{session.isPreview ? "Example workspace · no GitHub access" : session.authMode === "github_app" ? "Connected with GitHub App" : "Connected with GitHub OAuth"}</small></span>
      <button type="button" onClick={onSignOut}><SignOut size={16} /> Sign out</button>
    </div>
  );
}

const SDLC_STATE_LABEL = Object.freeze({
  setup_required: "Setup needed",
  scope_only: "Scope only",
  supported: "Supported",
  controlled: "Controlled",
  action_required: "Action needed",
  external: "External",
});

const SDLC_POSTURE_LABEL = Object.freeze({
  setup_required: "Setup required",
  scope_only: "Scope assurance",
  verification_ready: "Verification ready",
  merge_gate_active: "Merge gate active",
  autonomy_activation_required: "Autonomy needs activation",
  bounded_autonomy_active: "Bounded autonomy active",
});

function SdlcStageIcon({ id }) {
  const Icon = {
    plan: FileCode,
    develop: Robot,
    review: UserCircle,
    verify: ShieldCheck,
    release: GitMerge,
    deploy: GitBranch,
    operate: Clock,
  }[id] ?? Circle;
  return <Icon size={17} weight={id === "verify" ? "fill" : "duotone"} aria-hidden="true" />;
}

function SdlcAssuranceMap({ view }) {
  if (!view || !Array.isArray(view.stages)) return null;
  return (
    <section className="sdlc-assurance-map" aria-labelledby="sdlc-map-title">
      <div className="sdlc-map-heading">
        <div>
          <p>Agentic SDLC assurance</p>
          <h3 id="sdlc-map-title">One evidence spine. Existing tools keep their authority.</h3>
        </div>
        <span>{SDLC_POSTURE_LABEL[view.posture] ?? "Read-only projection"}</span>
      </div>
      <ol className="sdlc-map-stages">
        {view.stages.map((item) => (
          <li className={`sdlc-map-stage sdlc-state-${item.state.replaceAll("_", "-")}`} key={item.id}>
            <span className="sdlc-map-icon"><SdlcStageIcon id={item.id} /></span>
            <span className="sdlc-map-copy">
              <span><strong>{item.label}</strong><small>{item.owner}</small></span>
              <p>{item.proof}</p>
              {["setup_required", "action_required", "scope_only"].includes(item.state) && (
                <small className="sdlc-map-next"><span>Next:</span> {item.nextAction}</small>
              )}
            </span>
            <span className="sdlc-map-state">{SDLC_STATE_LABEL[item.state] ?? item.state}</span>
          </li>
        ))}
      </ol>
      <div className="sdlc-repair-loop">
        <ArrowsClockwise size={17} weight="bold" aria-hidden="true" />
        <span><strong>Failure loop</strong><small>{view.repairLoop.mode === "bounded_autonomous"
          ? "Two bounded attempts within 15 minutes; model proposes, harness decides, controller applies."
          : view.repairLoop.mode === "activation_required"
            ? "Autonomous repair stays off until every owner-controlled prerequisite is active."
            : "Your coding agent receives the exact-head handback and owns the next commit."}</small></span>
      </div>
      <p className="sdlc-map-boundary"><LockKey size={14} aria-hidden="true" /> This map is derived and read-only. Only the exact-head guard contributes to PASS; GitHub owns merge, and customer systems own deploy and operate.</p>
    </section>
  );
}

function RuntimeFunding({
  isPreview,
  repositorySelected,
  runtimeStatus,
  runtimeError,
  byok,
  activeModel,
  modelConfigured,
  modelSaving,
  runtimeUpdate,
  runtimeConfigurable,
  harness,
  requestedHarnessMode,
  autonomyReady,
  saving,
  onSave,
  onDisconnect,
  onChangeModel,
  onChangeHarness,
  rulesetPlanStatus,
  rulesetPlan,
  rulesetPlanError,
  onPrepareRuleset,
  onApplyRuleset,
}) {
  const [apiKey, setApiKey] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const connected = Boolean(byok?.configured);
  const permissionRequired = byok?.state === "permission_required";
  const adminRequired = byok?.state === "admin_required";
  const showForm = (!connected || replaceOpen) && !permissionRequired && !adminRequired;
  const selectedHarnessMode = (runtimeConfigurable ? harness?.mode : requestedHarnessMode) ?? "observe";
  const showRepairControls = selectedHarnessMode === "autonomous" || repairOpen || connected;
  const enforcement = harness?.enforcement ?? EMPTY_HARNESS.enforcement;
  const enforcementLevel = enforcement.assuranceLevel
    ?? (enforcement.active ? enforcement.mergeQueueRequired ? "queue_certified" : "strict_head" : null);
  const repairExpansionAvailable = Boolean(
    runtimeConfigurable
    && enforcement.active
    && harness?.autonomousAvailable,
  );
  const branchSettingsUrl = repositorySelected
    ? `https://github.com/${repositorySelected}/settings/rules`
    : null;
  useEffect(() => {
    setApiKey("");
    setReplaceOpen(false);
    setRepairOpen(false);
  }, [repositorySelected]);

  async function submit(event) {
    event.preventDefault();
    try {
      const saved = await onSave(apiKey);
      if (saved) setReplaceOpen(false);
    } finally {
      setApiKey("");
    }
  }

  if (isPreview) {
    return (
      <section className="runtime-funding" aria-labelledby="runtime-funding-title">
        <div className="runtime-heading">
          <div><p className="runtime-kicker">Synthetic contract reconstruction</p><h3 id="runtime-funding-title">GPT-5.6 Luna</h3></div>
          <span className="runtime-model">Read only</span>
        </div>
        <div className="runtime-option runtime-option-managed">
          <span className="runtime-option-icon"><ShieldCheck size={17} weight="fill" /></span>
          <div className="runtime-option-copy">
            <div><strong>Public reconstruction boundary</strong><span className="runtime-badge is-verified">Synthetic</span></div>
            <p>No API key field or live selector is exposed here. The public workspace reconstructs the authority contract with synthetic receipt-shaped data.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="runtime-funding" aria-labelledby="runtime-funding-title">
      <div className="runtime-heading">
        <div>
          <p className="runtime-kicker">Independent assurance</p>
          <h3 id="runtime-funding-title">Verify first. Repair is optional.</h3>
        </div>
        <span className="runtime-model">{activeModel || RUNTIME.modelId}</span>
      </div>

      <div className={`runtime-option ${selectedHarnessMode !== "observe" ? "is-connected" : ""}`}>
        <span className="runtime-option-icon"><ShieldCheck size={17} weight="fill" /></span>
        <div className="runtime-option-copy">
          <div>
            <strong>Exact-head guard</strong>
            <span className={`runtime-badge ${selectedHarnessMode !== "observe" ? "is-connected" : "is-available"}`}>
              {harnessModeLabel(selectedHarnessMode)}
            </span>
          </div>
          <p>Verify only lets your existing coding agent own the fix while ChangePlane independently checks the new exact commit. No OpenAI key is required.</p>
          {runtimeConfigurable && selectedHarnessMode === "observe" && harness?.verifyAvailable !== false && (
            <button className="text-action" type="button" onClick={() => onChangeHarness("verify")} disabled={modelSaving}>
              Enable Verify only with config PR <ArrowRight size={13} />
            </button>
          )}
          {runtimeConfigurable && selectedHarnessMode === "autonomous" && (
            <button className="text-action" type="button" onClick={() => onChangeHarness("verify")} disabled={modelSaving}>
              Switch to Verify only with config PR <ArrowRight size={13} />
            </button>
          )}
          <p className="runtime-inline-note">Strict Head starts when one strict, no-bypass default-branch Ruleset binds the Guard App and every behavioral evidence publisher. Queue Certified adds Merge Queue and a fresh queue-revision evaluation. <code>ChangePlane guard</code> is operational workflow liveness only.</p>
          {runtimeConfigurable && (
            <div className="runtime-enforcement">
              <span className={`runtime-badge ${enforcement.active ? "is-connected" : "is-available"}`}>
                {enforcementLevel === "queue_certified"
                  ? "Queue Certified active"
                  : enforcementLevel === "strict_head"
                    ? "Strict Head active"
                    : "Owner activation required"}
              </span>
              <p>{enforcementMessage(enforcement)}</p>
              {!enforcement.active && enforcement.state !== "admin_required" && rulesetPlanStatus === "idle" && (
                <button className="text-action" type="button" onClick={() => onPrepareRuleset("strict_head")}>
                  Prepare one-click Strict Head plan <ArrowRight size={13} />
                </button>
              )}
              {rulesetPlanStatus === "loading" && <p><ArrowsClockwise className="spin" size={13} /> Reading exact GitHub policy and publishers…</p>}
              {rulesetPlanStatus === "error" && <>
                <p className="runtime-error"><Warning size={13} weight="fill" /> {rulesetPlanError}</p>
                <button className="text-action" type="button" onClick={() => onPrepareRuleset("strict_head")}>Retry exact plan</button>
              </>}
              {rulesetPlanStatus === "ready" && rulesetPlan?.action === "create" && <div className="ruleset-approval">
                <strong>Deliberate Approval 3 of 3</strong>
                <p>{rulesetPlan.summary}</p>
                <dl>
                  <div><dt>Level</dt><dd>{rulesetPlan.assuranceLevel === "queue_certified" ? "Queue Certified" : "Strict Head"}</dd></div>
                  <div><dt>Exact base</dt><dd><code>{rulesetPlan.repository.defaultBranchSha.slice(0, 12)}</code></dd></div>
                  <div><dt>Bypasses</dt><dd>None</dd></div>
                  <div><dt>Required publishers</dt><dd>{rulesetPlan.mutation.body.rules.at(-1).parameters.required_status_checks.length}</dd></div>
                </dl>
                <button className="primary-action" type="button" onClick={onApplyRuleset}>
                  Approve and create Ruleset <ShieldCheck size={15} weight="fill" />
                </button>
              </div>}
              {rulesetPlanStatus === "ready" && rulesetPlan?.action === "manual_review" && <>
                <p className="runtime-error"><Warning size={13} weight="fill" /> {rulesetPlan.summary}</p>
                {branchSettingsUrl && <a className="text-action" href={branchSettingsUrl} target="_blank" rel="noreferrer">Open repository rulesets <ArrowRight size={13} /></a>}
              </>}
              {rulesetPlanStatus === "applying" && <p><ArrowsClockwise className="spin" size={13} /> Revalidating the approved digest before GitHub mutation…</p>}
              {rulesetPlanStatus === "applied" && <p><CheckCircle size={13} weight="fill" /> GitHub policy applied and re-read successfully.</p>}
              {enforcementLevel === "strict_head" && (
                <button className="text-action" type="button" onClick={() => onPrepareRuleset("queue_certified")} disabled={rulesetPlanStatus === "loading" || rulesetPlanStatus === "applying"}>
                  Prepare Queue Certified upgrade <ArrowRight size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {!showRepairControls && repairExpansionAvailable && (
        <button className="runtime-upgrade-invite" type="button" onClick={() => setRepairOpen(true)}>
          <span><Lightning size={17} weight="fill" /></span>
          <span><strong>Explore Autonomous repair</strong><small>Controlled beta · adds a larger payload and repository BYOK through protected review.</small></span>
          <ArrowRight size={15} />
        </button>
      )}
      {!showRepairControls && runtimeConfigurable && !enforcement.active && (
        <p className="runtime-inline-note">Autonomous expansion remains unavailable until the Verify Lite setup is merged and the qualifying Ruleset gate is active.</p>
      )}
      {!showRepairControls && runtimeConfigurable && enforcement.active && !harness?.autonomousAvailable && (
        <p className="runtime-inline-note">Verify Lite is active. Autonomous remains closed until the controlled-beta controller and repository permissions are available.</p>
      )}

      {showRepairControls && <>
      <div className={`runtime-option ${harness?.ready ? "is-connected" : ""}`}>
        <span className="runtime-option-icon"><Lightning size={17} weight="fill" /></span>
        <div className="runtime-option-copy">
          <div>
            <strong>Exact-revision repair loop</strong>
            <span className={`runtime-badge ${harness?.ready || autonomyReady ? "is-connected" : "is-available"}`}>
              {harness?.ready ? "Active" : autonomyReady ? "Ready" : "Needs test + key"}
            </span>
          </div>
          <p>Two attempts within 15 minutes. Protected, ambiguous, stale, or exhausted changes stop for a human.</p>
          {repairExpansionAvailable && selectedHarnessMode !== "autonomous" && (
            <button
              className="text-action"
              type="button"
              onClick={() => onChangeHarness("autonomous")}
              disabled={modelSaving || !connected}
            >
              Enable autonomous repair with protected expansion PR <ArrowRight size={13} />
            </button>
          )}
          {!runtimeConfigurable && requestedHarnessMode === "autonomous" && autonomyReady && <p className="runtime-inline-note">The setup pull request will enable optional autonomous repair.</p>}
          {!runtimeConfigurable && requestedHarnessMode === "verify" && <p className="runtime-inline-note">Verify-only setup needs no provider key. Add one only if you explicitly choose autonomous repair.</p>}
        </div>
      </div>

      <div className="runtime-option runtime-option-model">
        <span className="runtime-option-icon"><Robot size={17} weight="duotone" /></span>
        <div className="runtime-option-copy">
          <div><strong>Repair model</strong><span className="runtime-badge is-available">Reviewable change</span></div>
          <p>GPT-5.6 Luna is the default. Changing the model opens a configuration pull request.</p>
          <label className="byok-input">
            <span>OpenAI model</span>
            <select
              value={runtimeUpdate?.model || activeModel || DEFAULT_PROPOSAL_MODEL}
              onChange={(event) => onChangeModel(event.target.value)}
              disabled={!runtimeConfigurable || modelSaving}
            >
              {SUPPORTED_PROPOSAL_MODELS.map((model) => (
                <option key={model} value={model}>{model === DEFAULT_PROPOSAL_MODEL ? `${model} · default` : model}</option>
              ))}
            </select>
          </label>
          {!runtimeConfigurable && <p className="runtime-inline-note">Merge the setup pull request before choosing a model.</p>}
          {modelConfigured === false && runtimeConfigurable && <p className="runtime-inline-note">The next model change also updates this repository to the current OpenAI policy.</p>}
          {runtimeUpdate?.pullRequest?.url && (
            <a className="text-action" href={runtimeUpdate.pullRequest.url} target="_blank" rel="noreferrer">Review runtime PR #{runtimeUpdate.pullRequest.number} <ArrowRight size={13} /></a>
          )}
        </div>
      </div>

      <div className={`runtime-option runtime-option-byok ${connected ? "is-connected" : ""}`}>
        <span className="runtime-option-icon"><LockKey size={17} weight="fill" /></span>
        <div className="runtime-option-copy">
          <div>
            <strong>Bring your own OpenAI key</strong>
            <span className={`runtime-badge ${connected ? "is-connected" : "is-available"}`}>
              {connected ? "Connected" : adminRequired ? "Admin needed" : permissionRequired ? "Permission needed" : "Available"}
            </span>
          </div>
          <p>Your key is checked once, encrypted with GitHub's repository key, and saved only as <code>{RUNTIME.secretName}</code> in GitHub Actions.</p>

          {!repositorySelected && <p className="runtime-inline-note">Select a repository before connecting a provider key.</p>}
          {permissionRequired && <p className="runtime-error" role="alert"><Warning size={14} weight="fill" /> Reconnect the GitHub App with Actions Secrets write permission before adding a key.</p>}
          {adminRequired && <p className="runtime-error" role="alert"><Warning size={14} weight="fill" /> A repository administrator must manage provider keys and autonomous repair. Nothing changed; ask an owner to continue.</p>}
          {runtimeStatus === "loading" && repositorySelected && (
            <p className="runtime-inline-note"><ArrowsClockwise className="spin" size={13} /> Checking GitHub secret status…</p>
          )}
          {runtimeError && <p className="runtime-error" role="alert"><Warning size={14} weight="fill" /> {runtimeError}</p>}

          {connected && !showForm && (
            <div className="runtime-connected">
              <span><CheckCircle size={15} weight="fill" /> {byok.secretName || RUNTIME.secretName}</span>
              <div>
                <button type="button" onClick={() => setReplaceOpen(true)}>Replace key</button>
                <button type="button" onClick={onDisconnect} disabled={saving}>Disconnect</button>
              </div>
            </div>
          )}

          {showForm && repositorySelected && runtimeStatus !== "loading" && (
            <form className="byok-form" onSubmit={submit}>
              <label className="byok-input">
                <span>{RUNTIME.provider} API key</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="Paste once — never shown again"
                  autoComplete="new-password"
                  spellCheck={false}
                  minLength={20}
                  maxLength={512}
                  required
                />
              </label>
              <div className="byok-actions">
                {connected && <button className="secondary-action" type="button" onClick={() => setReplaceOpen(false)}>Cancel</button>}
                <button className="runtime-save" type="submit" disabled={saving || !apiKey}>
                  {saving ? <ArrowsClockwise className="spin" size={14} weight="bold" /> : <LockKey size={14} weight="fill" />}
                  {saving ? "Securing…" : connected ? "Replace securely" : "Save to GitHub"}
                </button>
              </div>
            </form>
          )}
          <small className="runtime-observe-note">Optional for Verify only. Required for autonomous proposals; disconnecting it makes repair fail closed.</small>
        </div>
      </div>
      </>}
    </section>
  );
}

function GitHubSetup({
  session,
  repositories,
  repositoryStatus,
  repositoryError,
  selectedRepository,
  onSelectRepository,
  onRetryRepositories,
  preflightStatus,
  preflight,
  preflightError,
  onRetryPreflight,
  installStatus,
  installError,
  installResult,
  runtimeStatus,
  runtimeError,
  byok,
  activeModel,
  modelConfigured,
  modelSaving,
  runtimeUpdate,
  harness,
  byokSaving,
  onSaveByok,
  onDisconnectByok,
  onChangeModel,
  onChangeHarness,
  rulesetPlanStatus,
  rulesetPlan,
  rulesetPlanError,
  onPrepareRuleset,
  onApplyRuleset,
  onInstall,
  onRecheckInstall,
  onResetInstall,
  onOpenWorkspace,
  onSignOut,
}) {
  const [query, setQuery] = useState("");
  const [evidenceMode, setEvidenceMode] = useState("behavior");
  const [checkName, setCheckName] = useState(session.isPreview ? "test" : "");
  const [checkPublisher, setCheckPublisher] = useState("github-actions");
  const [checkWorkflowPath, setCheckWorkflowPath] = useState(session.isPreview ? ".github/workflows/ci.yml" : "");
  const [behaviorConfirmed, setBehaviorConfirmed] = useState(false);
  const evidenceOptions = Array.isArray(preflight?.evidenceOptions) ? preflight.evidenceOptions : [];
  const matchingRepositories = repositories.filter((repository) => (
    repository.fullName.toLowerCase().includes(query.trim().toLowerCase())
  ));
  const selected = repositories.find(({ fullName }) => fullName === selectedRepository);
  const complete = Boolean(installResult);
  const installationState = preflight?.installation?.state ?? "fresh";
  const isUpgrade = installationState === "outdated";
  const policyMigration = preflight?.installation?.policyMigration;
  const isRecoveryUpgrade = isUpgrade && policyMigration?.required === true;
  const isCurrent = installationState === "current";
  const needsOwnerReview = installationState === "conflict" || preflight?.setup?.state === "owner_required";
  const preflightFailed = Boolean(selected && preflightStatus === "error");
  const preflightReady = preflightStatus === "ready" && preflight?.installable;
  const pendingSetup = preflight?.setup?.state === "pending" && preflight.setup.pullRequest?.url;
  const pendingUpgrade = pendingSetup && preflight?.setup?.operation === "upgrade";
  const pendingHarnessMode = pendingSetup
    && ["observe", "verify"].includes(preflight?.setup?.harnessMode)
    ? preflight.setup.harnessMode
    : null;
  const preflightTone = preflightStatus === "ready" && !preflightReady && !isCurrent
    ? "attention"
    : preflightStatus;
  const preflightBlocked = Boolean(selected && preflightStatus === "ready" && !preflightReady && !isCurrent);
  const githubActionsEvidence = requiresWorkflowPath(checkPublisher);
  const workflowPathReady = !githubActionsEvidence || validWorkflowPath(checkWorkflowPath);
  const evidenceReady = (isUpgrade && !isRecoveryUpgrade) || pendingSetup || evidenceMode === "scope"
    || (checkName.trim() && checkPublisher.trim() && workflowPathReady && behaviorConfirmed);
  const requestedHarnessMode = pendingHarnessMode ?? (evidenceMode === "behavior" ? "verify" : "observe");
  const autonomyReady = session.isPreview || Boolean(
    preflight?.harness?.autonomousAvailable
    && byok?.configured
    && evidenceMode === "behavior"
    && checkName.trim()
    && checkPublisher.trim()
    && workflowPathReady
    && behaviorConfirmed
  );
  const repositoryMutationBusy = installStatus === "installing" || byokSaving;
  const enforcementActive = Boolean(harness?.enforcement?.active);
  const verifyLiteFileCount = preflight?.payloadProfiles?.verifyLite?.files ?? 9;
  const selectedManagedProfile = isCurrent
    ? preflight?.installation?.managedProfile
    : isUpgrade ? preflight?.setupProfile : requestedHarnessMode === "autonomous" ? "full" : "verify-lite";
  const repositorySdlc = harness?.sdlc?.type === "changeplane.agentic-sdlc-view" && isCurrent
    ? harness.sdlc
    : buildSdlcAssurance({
      installed: isCurrent,
      managedProfile: selectedManagedProfile,
      harnessMode: isCurrent ? harness?.mode : requestedHarnessMode,
      requiredCheckCount: isCurrent
        ? 0
        : pendingSetup ? Number(Boolean(preflight?.setup?.requiredCheck))
          : evidenceMode === "behavior" && behaviorConfirmed ? 1 : 0,
      enforcement: isCurrent ? harness?.enforcement : null,
      autonomousReady: isCurrent && harness?.ready === true,
      maxAttempts: 2,
    });

  useEffect(() => {
    if (preflightStatus !== "ready") {
      setEvidenceMode("behavior");
      setCheckName("");
      setCheckPublisher("github-actions");
      setCheckWorkflowPath("");
      setBehaviorConfirmed(false);
      return;
    }
    const suggested = evidenceOptions.find((option) => option.suggested) ?? evidenceOptions[0];
    setEvidenceMode(pendingHarnessMode === "observe"
      ? "scope"
      : pendingHarnessMode === "verify" || suggested || isRecoveryUpgrade ? "behavior" : "scope");
    setCheckName(suggested?.name ?? "");
    setCheckPublisher(suggested?.appSlug ?? "github-actions");
    setCheckWorkflowPath(suggested?.workflowPath ?? "");
    setBehaviorConfirmed(false);
  }, [preflight, preflightStatus, selectedRepository, isRecoveryUpgrade, pendingHarnessMode]);

  return (
    <main className="setup-stage">
      <section className="setup-shell" aria-labelledby="setup-title">
        <header className="setup-topbar">
          <a className="setup-brand" href="#setup" aria-label="ChangePlane home">
            <span className="auth-mark" aria-hidden="true"><ShieldCheck size={18} weight="fill" /></span>
            <span>ChangePlane</span>
          </a>
          <SetupAccount session={session} onSignOut={onSignOut} />
        </header>

        <div className="setup-grid" id="setup">
          <aside className="setup-context">
            <p className="setup-context-kicker">Setup</p>
            <h1 id="setup-main-title" tabIndex={-1}>One repository. One setup PR.</h1>
            <p>Choose where ChangePlane runs. Review the setup in GitHub, merge it, then return to your normal pull request workflow.</p>
            <SetupProgress
              complete={complete}
              isPreview={session.isPreview}
              repositorySelected={Boolean(selected)}
              isUpgrade={isUpgrade}
              isCurrent={isCurrent}
              needsOwnerReview={needsOwnerReview}
              needsRetry={preflightFailed}
            />
            <div className="setup-boundary">
              <LockKey size={17} aria-hidden="true" />
              <p><strong>The model never receives GitHub authority.</strong><span>Verify Lite checks the exact revision with no provider key or repair credential.</span></p>
            </div>
          </aside>

          <section className="setup-panel">
            {!installResult ? (
              <>
                <p className="auth-eyebrow">Repository</p>
                <h2 id="setup-title">Choose where ChangePlane runs</h2>
                <p className="setup-intro">{session.isPreview
                  ? "Choose the synthetic RouteThai repository to preview the setup."
                  : "Your personal and organization repositories appear here only when the GitHub App can access them."}</p>

                {session.isPreview && (
                  <button className="setup-skip-action" type="button" onClick={onOpenWorkspace}>
                    Skip setup · See the exact-revision receipt <ArrowRight size={15} />
                  </button>
                )}

                {repositoryStatus === "loading" && (
                  <div className="setup-state" role="status">
                    <ArrowsClockwise className="spin" size={21} weight="bold" />
                    <div><strong>{session.isPreview ? "Loading the synthetic repository fixture" : "Loading writable repositories"}</strong><span>{session.isPreview ? "No GitHub repository or permission is being read." : "Reading repository names and permissions from GitHub."}</span></div>
                  </div>
                )}

                {repositoryStatus === "error" && (
                  <div className="setup-state setup-state-error" role="alert">
                    <WarningOctagon size={21} weight="fill" />
                    <div><strong>Repositories could not be loaded</strong><span>{repositoryError} No repository change was made.</span></div>
                    <button type="button" onClick={onRetryRepositories}>Try again</button>
                  </div>
                )}

                {repositoryStatus === "ready" && repositories.length === 0 && (
                  <div className="setup-state">
                    <GithubLogo size={22} weight="fill" />
                    <div><strong>No writable repositories found</strong><span>Ask a repository owner for push access, then refresh this list.</span></div>
                    <button type="button" onClick={onRetryRepositories}>Refresh</button>
                  </div>
                )}

                {repositoryStatus === "ready" && repositories.length > 0 && (
                  <>
                    <label className="repository-search">
                      <span className="sr-only">Search repositories</span>
                      <MagnifyingGlass size={18} aria-hidden="true" />
                      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search repositories" autoComplete="off" disabled={repositoryMutationBusy} />
                    </label>

                    <div className="repository-list" role="radiogroup" aria-label="Writable GitHub repositories">
                      {matchingRepositories.map((repository) => {
                        const isSelected = repository.fullName === selectedRepository;
                        return (
                          <button
                            className={`repository-row ${isSelected ? "is-selected" : ""}`}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            key={repository.fullName}
                            disabled={repositoryMutationBusy}
                            onClick={() => onSelectRepository(repository.fullName)}
                          >
                            <span className="repository-radio">{isSelected && <Check size={12} weight="bold" />}</span>
                            <GithubLogo size={20} weight="fill" aria-hidden="true" />
                            <span className="repository-name"><strong>{repository.fullName}</strong><small>Default branch: {repository.defaultBranch}</small></span>
                            <span className="repository-visibility">{repository.private ? "Private" : "Public"}</span>
                          </button>
                        );
                      })}
                      {matchingRepositories.length === 0 && (
                        <p className="repository-empty">No repositories match “{query}”.</p>
                      )}
                    </div>

                    <div className="install-summary">
                      <div>
                        <span>Selected repository</span>
                        <strong>{selected?.fullName || "Choose a repository"}</strong>
                      </div>
                      <div><span>Mode</span><strong>{isCurrent
                        ? harnessModeLabel(harness?.mode)
                        : harnessModeLabel(requestedHarnessMode)}</strong></div>
                      <div><span>Change</span><strong>{isCurrent
                        ? enforcementActive ? "Enforcement active" : "Activation pending"
                        : preflightFailed
                          ? "Blocked safely"
                        : preflightBlocked
                          ? "Blocked safely"
                          : preflightStatus === "loading"
                            ? "Checking"
                            : isUpgrade ? "One upgrade PR" : "One setup PR"}</strong></div>
                    </div>

                    <div
                      className={`safety-preflight safety-preflight-${preflightTone}`}
                      aria-live={preflightFailed ? undefined : "polite"}
                      aria-busy={Boolean(selected && preflightStatus === "loading")}
                      role={preflightFailed ? "alert" : undefined}
                    >
                      <div className="safety-preflight-heading">
                        {!selected
                          ? <Circle size={18} weight="bold" aria-hidden="true" />
                          : preflightStatus === "loading"
                          ? <ArrowsClockwise className="spin" size={18} weight="bold" aria-hidden="true" />
                          : preflightReady || isCurrent
                            ? <ShieldCheck size={19} weight="fill" aria-hidden="true" />
                            : <WarningOctagon size={19} weight="fill" aria-hidden="true" />}
                        <div>
                          <strong>{!selected
                            ? "Choose a repository to continue"
                            : preflightStatus === "loading"
                            ? session.isPreview ? "Reconstructing the repository safety preflight" : "Checking repository safety"
                            : isCurrent
                              ? enforcementActive
                                ? "Exact-head merge protection is active."
                                : "Managed files installed. Finish activation."
                              : preflightFailed
                                ? "Read-only check could not finish"
                              : preflightReady
                              ? pendingSetup
                                ? pendingUpgrade ? isRecoveryUpgrade ? "Recovery upgrade PR already ready" : "Upgrade PR already ready" : "Setup PR already ready"
                                : isRecoveryUpgrade ? "v13 evidence recovery ready" : isUpgrade ? "Upgrade ready" : "Ready to install"
                              : "Setup needs attention"}</strong>
                          <span>{!selected
                            ? "Nothing is accessed until you make a selection."
                            : preflightStatus === "loading"
                            ? session.isPreview ? "Synthetic reconstruction. No repository is being accessed or changed." : "Read-only checks. Nothing is being changed."
                            : isCurrent
                              ? enforcementActive
                                ? `${harnessModeLabel(harness?.mode)} is enforced by one verified GitHub Ruleset.`
                                : `${enforcementMessage(harness?.enforcement)} Managed version ${preflight.installation.currentVersion} remains installed.`
                            : preflightFailed
                              ? preflightError || "Repository safety could not be checked."
                            : preflightReady
                              ? pendingSetup
                                ? pendingUpgrade
                                  ? preflight.setup.policyIncluded
                                    ? `Open the existing recovery PR. It binds ${preflight.setup.requiredCheck?.name ?? "scope-only Observe"}${preflight.setup.requiredCheck?.workflowPath ? ` to ${preflight.setup.requiredCheck.workflowPath}` : ""} and includes the policy change for human review.`
                                    : "Open the existing upgrade PR to review the managed-file update."
                                  : preflight.setup.requiredCheck
                                    ? `The existing PR binds ${preflight.setup.requiredCheck.name} from ${preflight.setup.requiredCheck.appSlug}. Open it to review and merge; no new write is needed.`
                                    : "The existing PR is explicitly scope-only. Open it to review and merge; no new write is needed."
                              : isUpgrade
                                ? isRecoveryUpgrade
                                  ? `Upgrade to managed version ${preflight.installation.targetVersion} and repair the legacy enforce policy in the same protected pull request. Verify is the safe default; scope-only Observe must be chosen explicitly.`
                                  : `Update managed files to version ${preflight.installation.targetVersion} without changing your policy.`
                              : evidenceOptions.length > 0
                                  ? session.isPreview
                                    ? `Reconstructed ${evidenceOptions.length} synthetic workflow-bound evidence option${evidenceOptions.length === 1 ? "" : "s"}; confirm the projected behavior contract below.`
                                    : `Found ${evidenceOptions.length} recent GitHub check${evidenceOptions.length === 1 ? "" : "s"}. A likely test is selected; confirm what it protects below.`
                                  : preflight?.evidenceDiscovery?.state === "unavailable"
                                    ? "GitHub checks could not be read right now. Scope-only is selected safely; retry discovery or add a check manually."
                                    : "No existing checks were found. Scope-only is selected; add a real automated test later to prove behavior."
                              : preflight?.setup?.message || preflightError || (preflight?.conflicts?.length
                                ? `Existing ChangePlane paths found: ${preflight.conflicts.join(", ")}`
                              : "This repository is not eligible for setup.")}</span>
                          {preflight?.installation?.state === "conflict" && (
                            <span>Ask a repository owner to review the listed paths. ChangePlane did not overwrite them.</span>
                          )}
                          {selected && preflightStatus !== "loading" && !preflightReady && !isCurrent && <span>No repository change was made.</span>}
                        </div>
                      </div>
                      {(preflightReady || isCurrent) && (
                        <ul className="safety-preflight-facts">
                          <li><Check size={13} weight="bold" /> Pull request only</li>
                          <li><Check size={13} weight="bold" /> {isCurrent ? `${preflight.installation.managedProfile === "verify-lite" ? "Verify Lite" : "Full"} · managed v${preflight.installation.currentVersion}` : isRecoveryUpgrade ? ".changeplane.json included for recovery" : isUpgrade ? "Policy stays repository-owned" : "No direct default-branch write"}</li>
                          <li><Check size={13} weight="bold" /> {isCurrent ? enforcementActive ? "Dedicated-App guard bound" : "No false enforcement claim" : isRecoveryUpgrade ? "No autonomous credential provisioned" : isUpgrade ? "Managed files are versioned" : "Nothing runs before merge"}</li>
                        </ul>
                      )}
                      {preflight?.setup?.state === "stale" && preflight.setup.pullRequest?.url && (
                        <a className="safety-preflight-recovery" href={preflight.setup.pullRequest.url} target="_blank" rel="noreferrer">
                          Open PR #{preflight.setup.pullRequest.number}, choose Close pull request, then Delete branch <ArrowRight size={13} />
                        </a>
                      )}
                      {preflightReady && (!isUpgrade || isRecoveryUpgrade) && preflight?.evidenceDiscovery?.state === "unavailable" && (
                        <button className="evidence-retry" type="button" onClick={onRetryPreflight}>
                          <ArrowsClockwise size={13} weight="bold" /> Try check discovery again
                        </button>
                      )}
                    </div>

                    {preflightReady && !pendingSetup && (!isUpgrade || isRecoveryUpgrade) && (
                      <>
                        <fieldset className="evidence-choice">
                          <legend>Choose what the first receipt proves</legend>
                          <label className={evidenceMode === "behavior" ? "is-selected" : ""}>
                            <input type="radio" name="evidence-mode" value="behavior" checked={evidenceMode === "behavior"} onChange={() => setEvidenceMode("behavior")} />
                            <span><strong>Code behavior</strong><small>{evidenceOptions.length > 0 ? session.isPreview ? "Synthetic workflow-bound fixture" : "Suggested from recent GitHub runs" : "Advanced · bind an existing automated test"}</small></span>
                          </label>
                          {evidenceMode === "behavior" && (
                            <div className="evidence-fields">
                            {evidenceOptions.length > 0 && (
                              <label className="evidence-detected">
                                <span>{session.isPreview ? "Use the synthetic evidence fixture" : "Use a test from GitHub"}</span>
                                <select
                                  value={evidenceOptionValue({ name: checkName, appSlug: checkPublisher, workflowPath: checkWorkflowPath })}
                                  onChange={(event) => {
                                    const [name, appSlug, workflowPath = ""] = event.target.value.split("\0");
                                    setCheckName(name);
                                    setCheckPublisher(appSlug);
                                    setCheckWorkflowPath(workflowPath);
                                    setBehaviorConfirmed(false);
                                  }}
                                >
                                  {evidenceOptions.map((option) => (
                                    <option key={evidenceOptionValue(option)} value={evidenceOptionValue(option)}>
                                      {option.name} · {option.appSlug}{option.workflowPath ? ` · ${option.workflowPath}` : ""}{option.suggested ? " (suggested)" : ""}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                            {githubActionsEvidence && (
                              <p className="evidence-workflow-note">
                                {workflowPathReady
                                  ? <>Bound to <code>{checkWorkflowPath.trim()}</code>, so a same-name Check from another workflow cannot satisfy this evidence.</>
                                  : <>Enter the exact <code>.github/workflows/*.yml</code> or <code>.yaml</code> file. This prevents a same-name Check from another workflow being accepted.</>}
                              </p>
                            )}
                            <details>
                              <summary>{evidenceOptions.length > 0 ? "Advanced · use a different check" : "Advanced · add a check manually"}</summary>
                              {evidenceOptions.length === 0 && <p>Open a recent pull request in GitHub, choose <strong>Checks</strong>, and copy the meaningful test name. GitHub Actions usually uses <code>github-actions</code> as the publisher.</p>}
                              <div className="evidence-manual">
                                <label><span>Exact check name</span><input value={checkName} onChange={(event) => { setCheckName(event.target.value); setBehaviorConfirmed(false); }} placeholder="For example: test" maxLength={100} /></label>
                                <label><span>Publisher</span><input value={checkPublisher} onChange={(event) => {
                                  const publisher = event.target.value;
                                  setCheckPublisher(publisher);
                                  if (!requiresWorkflowPath(publisher)) setCheckWorkflowPath("");
                                  setBehaviorConfirmed(false);
                                }} placeholder="github-actions" maxLength={100} /></label>
                                {githubActionsEvidence && (
                                  <label><span>Workflow file</span><input
                                    value={checkWorkflowPath}
                                    onChange={(event) => { setCheckWorkflowPath(event.target.value); setBehaviorConfirmed(false); }}
                                    placeholder=".github/workflows/ci.yml"
                                    aria-invalid={!workflowPathReady}
                                    maxLength={255}
                                  /></label>
                                )}
                              </div>
                            </details>
                            <label className="evidence-confirmation">
                              <input type="checkbox" checked={behaviorConfirmed} onChange={(event) => setBehaviorConfirmed(event.target.checked)} />
                              <span>This check fails when important code behavior breaks.</span>
                            </label>
                            </div>
                          )}
                          <label className={evidenceMode === "scope" ? "is-selected" : ""}>
                            <input type="radio" name="evidence-mode" value="scope" checked={evidenceMode === "scope"} onChange={() => setEvidenceMode("scope")} />
                            <span><strong>Commit and file scope only</strong><small>Does not prove the code works</small></span>
                          </label>
                        </fieldset>

                        {evidenceMode === "behavior" && isRecoveryUpgrade && (
                          <div className="runtime-inline-note">
                            <strong>Recovery mode: Verify only</strong>
                            <p>The protected PR replaces the legacy evidence binding and turns off autonomous dispatch. No provider key, controller secret, or repair credential is created.</p>
                          </div>
                        )}

                        {evidenceMode === "behavior" && !isRecoveryUpgrade && (
                          <div className="runtime-inline-note">
                            <strong>Verify Lite is the first installation</strong>
                            <p>{verifyLiteFileCount} reviewed files. Your coding agent owns fixes; no provider key, repair workflow, or controller credential is created. Autonomous appears only after this setup is merged and the qualifying Ruleset gate is active, through a separate protected Full expansion pull request.</p>
                          </div>
                        )}
                      </>
                    )}

                    {selected && runtimeStatus === "ready" && (isCurrent || requestedHarnessMode === "autonomous") && (
                      <>
                        <RuntimeFunding
                          isPreview={session.isPreview}
                          repositorySelected={selected?.fullName || ""}
                          runtimeStatus={runtimeStatus}
                          runtimeError={runtimeError}
                          byok={byok}
                          activeModel={activeModel}
                          modelConfigured={modelConfigured}
                          modelSaving={modelSaving}
                          runtimeUpdate={runtimeUpdate}
                          runtimeConfigurable={isCurrent}
                          harness={harness}
                          requestedHarnessMode={requestedHarnessMode}
                          autonomyReady={autonomyReady}
                          saving={byokSaving}
                          onSave={onSaveByok}
                          onDisconnect={onDisconnectByok}
                          onChangeModel={onChangeModel}
                          onChangeHarness={onChangeHarness}
                          rulesetPlanStatus={rulesetPlanStatus}
                          rulesetPlan={rulesetPlan}
                          rulesetPlanError={rulesetPlanError}
                          onPrepareRuleset={onPrepareRuleset}
                          onApplyRuleset={onApplyRuleset}
                        />
                      </>
                    )}

                    {(preflightReady || isCurrent) && <SdlcAssuranceMap view={repositorySdlc} />}

                    {installError && <p className="install-error" role="alert"><Warning size={16} weight="fill" /> {installError}</p>}

                    {preflightStatus === "loading" ? null : pendingSetup ? (
                      <>
                        <a className="primary-action install-action" href={preflight.setup.pullRequest.url} target="_blank" rel="noreferrer">
                          <GitBranch size={17} weight="bold" /> Open existing {pendingUpgrade ? "upgrade" : "setup"} PR <ArrowRight size={16} />
                        </a>
                        <button className="text-action" type="button" onClick={onRetryPreflight}>I merged it — check this repository</button>
                      </>
                    ) : isCurrent ? (
                      <>
                        <button className="primary-action install-action" type="button" onClick={onRetryPreflight}>
                          <ArrowsClockwise size={17} weight="bold" /> Recheck guard and enforcement
                        </button>
                        <a className="text-action install-pulls-link" href={`https://github.com/${selected.fullName}/pulls`} target="_blank" rel="noreferrer">
                          Open project pull requests <ArrowRight size={13} />
                        </a>
                      </>
                    ) : preflightFailed ? (
                      <button className="primary-action install-action" type="button" onClick={onRetryPreflight}>
                        <ArrowsClockwise size={17} weight="bold" /> Try read-only check again
                      </button>
                    ) : needsOwnerReview ? (
                      <a className="primary-action install-action" href={`https://github.com/${selected.fullName}`} target="_blank" rel="noreferrer">
                        <GithubLogo size={17} weight="fill" /> Open repository for owner review <ArrowRight size={16} />
                      </a>
                    ) : preflightBlocked ? null : (
                      <button className="primary-action install-action" type="button" onClick={() => onInstall({
                        requiredCheck: evidenceMode === "behavior"
                          ? {
                            name: checkName.trim(),
                            appSlug: checkPublisher.trim(),
                            ...(githubActionsEvidence ? { workflowPath: checkWorkflowPath.trim() } : {}),
                          }
                          : null,
                        harnessMode: requestedHarnessMode,
                      })} disabled={!selected || !preflightReady || !evidenceReady
                        || (requestedHarnessMode === "autonomous" && !autonomyReady)
                        || installStatus === "installing"}>
                        {installStatus === "installing" ? <ArrowsClockwise className="spin" size={17} weight="bold" /> : <GitBranch size={17} weight="bold" />}
                        {installStatus === "installing"
                          ? session.isPreview ? "Preparing installation flow…" : `Creating ${isUpgrade ? "upgrade" : "installation"} pull request…`
                          : isUpgrade
                            ? isRecoveryUpgrade ? "Create recovery upgrade PR" : "Create upgrade PR"
                            : session.isPreview
                              ? `Preview ${harnessModeLabel(requestedHarnessMode).toLowerCase()} setup`
                              : requestedHarnessMode === "verify"
                                ? "Create Verify-only setup PR"
                                : "Create observe setup PR"}
                      </button>
                    )}
                    <p className="install-note">{session.isPreview
                      ? "No repository is accessed. A production installation would create one protected setup pull request."
                      : pendingSetup
                        ? pendingUpgrade
                          ? preflight.setup.policyIncluded
                            ? "Open the verified recovery pull request. It creates no autonomous credential; the reviewed Verify or explicit Observe policy starts only after merge."
                            : "Open the verified upgrade pull request. Your current installation remains active; the managed update starts only after merge."
                          : "Open the verified setup pull request. Nothing runs until you review and merge it."
                        : isCurrent
                          ? "No test PR is required, and you do not return to ChangePlane for every pull request. On the next real pull request, inspect the dedicated-App ChangePlane / guard; ChangePlane guard is the workflow's operational liveness job."
                          : preflightFailed
                            ? "Nothing was changed. Retry the read-only check without reconnecting or choosing the repository again."
                          : needsOwnerReview
                            ? "ChangePlane stopped before writing. Ask a repository owner to compare the listed managed files with the intended installation."
                            : preflightBlocked
                              ? "ChangePlane stopped before writing. Resolve the repository state shown above, then run the read-only check again."
                          : isUpgrade
                            ? isRecoveryUpgrade
                              ? "Creates one protected upgrade pull request. It includes .changeplane.json only to bind the selected evidence and reset legacy Autonomous to Verify, or to explicit scope-only Observe."
                              : "Creates one upgrade pull request for pristine managed files only. Your policy is not included."
                            : requestedHarnessMode === "autonomous" && !autonomyReady
                              ? "Connect an OpenAI key and confirm one meaningful test. ChangePlane will not enable autonomous repair without both."
                              : requestedHarnessMode === "verify"
                                ? "Creates one installation pull request. Your coding agent owns fixes; ChangePlane independently rechecks each new exact commit. No provider key is required."
                                : "Creates one installation pull request. Nothing runs until you review and merge it; closing the PR stops installation."}</p>
                  </>
                )}
              </>
            ) : (
              <div className="install-success" role="status">
                <span className="success-mark"><Check size={24} weight="bold" /></span>
                <p className="auth-eyebrow">{installResult.preview ? "Setup preview ready" : installResult.operation === "upgrade" ? "Upgrade PR created" : "Setup PR created"}</p>
                <h2 id="setup-title">{installResult.preview
                  ? `${harnessModeLabel(installResult.harnessMode)} setup prepared`
                  : installResult.operation === "upgrade" ? "Review the managed upgrade" : "One last step in GitHub"}</h2>
                <p>{installResult.preview
                  ? "In production, the next GitHub pull request update would start ChangePlane automatically. This reconstruction did not access or change a repository."
                  : installResult.operation === "upgrade"
                    ? installResult.policyIncluded
                      ? "Open the recovery pull request and review both the managed files and the narrow .changeplane.json change. It cannot retain Autonomous and created no repair credential."
                      : "Open the upgrade pull request and review the managed-file changes. Your .changeplane.json policy is not included."
                    : "Open the setup pull request, review the generated ChangePlane files, and merge it. The setup PR itself is not checked; the first normal pull request opened or updated afterward receives the GitHub-owned ChangePlane guard job and the dedicated-App ChangePlane / guard."}</p>

                <dl className="install-result-facts">
                  <div><dt>Repository</dt><dd>{installResult.repository}</dd></div>
                  <div><dt>Branch</dt><dd>{installResult.branch}</dd></div>
                  <div><dt>Mode</dt><dd>{harnessModeLabel(installResult.harnessMode)}</dd></div>
                  <div><dt>Repository write</dt><dd>{installResult.preview ? "None · reconstructed setup only" : installResult.operation === "upgrade" ? "Upgrade pull request only" : "Setup pull request only"}</dd></div>
                  {!installResult.preview && <div><dt>Activation</dt><dd>{installResult.operation === "upgrade" ? installResult.policyIncluded ? `${harnessModeLabel(installResult.harnessMode)} begins only after reviewed merge` : "Current installation stays active until merge" : "Not active until this PR is merged"}</dd></div>}
                </dl>

                {installResult.preview ? (
                  <button className="primary-action success-action" type="button" onClick={onOpenWorkspace}>Inspect the synthetic assurance reconstruction <ArrowRight size={17} /></button>
                ) : (
                  <>
                    <a className="primary-action success-action" href={installResult.pullRequest.url} target="_blank" rel="noreferrer">
                      Open {installResult.operation === "upgrade" ? "upgrade" : "setup"} PR on GitHub <ArrowRight size={17} />
                    </a>
                    <button className="text-action" type="button" onClick={onRecheckInstall}>I merged it — check this repository</button>
                  </>
                )}
                {!installResult.preview && <p className="install-note">{installResult.operation === "upgrade"
                  ? installResult.policyIncluded
                    ? "No autonomous credential was created. The recovered Verify or explicit Observe policy becomes active only after a human merges this pull request."
                    : "Your current installation remains active; the managed update becomes active only after this pull request is merged."
                  : <span>Setup is working when the operational <code>ChangePlane guard</code> job completes and the dedicated App publishes <code>ChangePlane / guard</code> on the latest commit.</span>}</p>}
                <section className="activation-checklist" aria-labelledby="activation-title">
                  <strong id="activation-title">{installResult.preview ? "In a real installation, after merge" : installResult.operation === "upgrade" ? "Finish the upgrade in GitHub" : "Finish activation in GitHub"}</strong>
                  <ol>
                    <li><span>1</span><p>Merge the {installResult.operation === "upgrade" ? "upgrade" : "setup"} pull request.</p></li>
                    {installResult.policyMigration && <li><span>2</span><p>Replace any legacy <code>github-actions</code> branch-policy binding for <code>ChangePlane / guard</code>; v13 guard authority belongs only to the dedicated ChangePlane App.</p></li>}
                    <li><span>{installResult.policyMigration ? "3" : "2"}</span><p>Open or update one normal pull request, then open its <strong>Checks</strong> tab.</p></li>
                    <li><span>{installResult.policyMigration ? "4" : "3"}</span><p>Confirm the operational <code>ChangePlane guard</code> job and open the dedicated-App <code>ChangePlane / guard</code>. <strong>PASS</strong> is published only for the latest exact commit after the bound test succeeds. {installResult.harnessMode === "autonomous" ? "Fixable failures may use the bounded repair harness." : installResult.harnessMode === "verify" ? "A failed check hands work back to your coding agent; its next commit is evaluated from scratch." : "Observe mode records scope without blocking."}</p></li>
                    {installResult.harnessMode !== "observe" && <li><span>{installResult.policyMigration ? "5" : "4"}</span><p>Return here for Deliberate Approval 3 of 3. Review the exact Strict Head Ruleset plan and publisher bindings before ChangePlane applies it. Add Merge Queue later only for Queue Certified; <code>ChangePlane guard</code> remains operational liveness only.</p></li>}
                  </ol>
                </section>
                {!installResult.preview && (
                  <a className="text-action install-pulls-link" href={`https://github.com/${installResult.repository}/pulls`} target="_blank" rel="noreferrer">
                    After merging: open this project’s pull requests <ArrowRight size={13} />
                  </a>
                )}
                <button className="text-action" type="button" onClick={onResetInstall}>Choose another repository</button>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function displayState(status, verified = status === "passed") {
  if (RUNNING_STATES.has(status)) return { state: "running", label: "Checking" };
  if (status === "passed" && verified) return { state: "pass", label: "Synthetic contract matched" };
  if (status === "passed") return { state: "blocked", label: "Evidence stale" };
  if (status === "blocked") return { state: "blocked", label: "Exception" };
  return { state: "ready", label: "Ready to check" };
}

function StatusMark({ status, verified, compact = false }) {
  const { state, label } = displayState(status, verified);
  return (
    <span className={`status-mark status-${state}`}>
      {state === "running" ? <ArrowsClockwise className="spin" size={compact ? 12 : 14} weight="bold" /> : <Circle size={compact ? 9 : 10} weight="fill" />}
      <span>{label}</span>
    </span>
  );
}

function Queue({ changes, selectedId, onSelect, filter, onFilter }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const visible = changes.filter((change) => {
    if (filter === "Active") return change.status === "ready" || RUNNING_STATES.has(change.status);
    if (filter === "Exceptions") return change.status === "blocked";
    return true;
  });

  return (
    <aside className="queue" aria-label="Change queue">
      <div className="queue-heading">
        <span>Change queue</span>
        <div className="filter-wrap">
          <button
            className="icon-button"
            type="button"
            aria-label={`Filter: ${filter}`}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <FunnelSimple size={18} />
          </button>
          {menuOpen && (
            <div className="filter-menu" role="menu">
              {FILTERS.map((name) => (
                <button
                  type="button"
                  role="menuitem"
                  className={name === filter ? "is-active" : ""}
                  key={name}
                  onClick={() => {
                    onFilter(name);
                    setMenuOpen(false);
                  }}
                >
                  <span>{name}</span>
                  {name === filter && <Check size={14} weight="bold" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="queue-list">
        {visible.map((change) => (
          <button
            type="button"
            className={`queue-item ${selectedId === change.id ? "is-selected" : ""}`}
            key={change.id}
            aria-pressed={selectedId === change.id}
            onClick={() => onSelect(change.id)}
          >
            <strong>{change.title}</strong>
            <span className="queue-meta">
              <StatusMark status={change.status} verified={change.verified} compact />
              <time>{change.timeLabel}</time>
            </span>
          </button>
        ))}
        {visible.length === 0 && <p className="empty-state">No changes in this view.</p>}
      </div>

      <div className="queue-foot">
        <span>Reconstructed policy</span>
        <strong>Autonomous fixture</strong>
        <small>Would stop for human exceptions</small>
      </div>
    </aside>
  );
}

function FileTable({ files, onInspect }) {
  return (
    <section className="workspace-section" aria-labelledby="files-title">
      <div className="section-title-row">
        <h2 id="files-title">Files in this change</h2>
        <span>{files.filter(({ resolved }) => !resolved).length} active</span>
      </div>
      <div className="file-table">
        <div className="file-table-head" aria-hidden="true">
          <span>File</span>
          <span>Change</span>
          <span>Allowed</span>
          <span />
        </div>
        {files.map((file) => (
          <button
            type="button"
            className={`file-row ${file.remediable ? "is-remediable" : ""} ${file.blocked ? "is-blocked" : ""} ${file.resolved ? "is-resolved" : ""}`}
            key={file.path}
            onClick={() => onInspect(file)}
          >
            <span className="file-path">{file.path}</span>
            <span className="file-change">
              <span className="added">+{file.add}</span>
              <span className="removed">−{file.remove}</span>
            </span>
            <span className={`file-scope ${file.remediable || file.blocked ? "needs-attention" : ""}`}>
              {file.scope}
            </span>
            <CaretRight size={17} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

function evidenceFor(change) {
  if (change.status === "blocked") {
    return [
      ["pass", "Allowed files in synthetic contract", `${change.base.split(" ")[0]} → ${change.head}`],
      ["pass", "Synthetic test fixture matched", "126 projected tests · 42s fixture duration"],
      ["blocked", "Sensitive-file rule matched", "secrets/**"],
    ];
  }
  if (change.verified) {
    return [
      ["warning", "Projected review fixture flags the changed route boundary", "Advisory only · cannot publish PASS"],
      ["warning", "Reconstructed service-window evidence shows a failure", `${change.initialHead} · one stop scheduled after window`],
      ["pass", "Reconstructed a bounded GPT-5.6 Luna proposal", "1 projected file · no model request or authority"],
      ["pass", "Projected clean validation accepted the patch", "Allowed paths · fresh worktree · attempt 1 of 2"],
      ["pass", "Projected the trusted-controller apply boundary", `${change.initialHead} → ${change.head} · no repository write`],
      ["pass", "Reconstructed exact head is guard-eligible", `No external write · ${change.head}`],
    ];
  }
  const stages = [
    ["binding", "Bind exact head and allowed paths", `${change.initialHead} · ${change.scope}`],
    ["failing", "Reconstruct the synthetic service-window failure", "One stop scheduled after its allowed window"],
    ["proposing", "Reconstruct a bounded GPT-5.6 Luna proposal", "Failure evidence + allowed-path source only · no model request"],
    ["validating", "Project patch validation in a clean harness", "Paths · stale head · attempt budget"],
    ["applying", "Project the trusted-controller apply boundary", "Credential would remain separated from the model job"],
    ["rechecking", "Reconstruct an exact-head recheck", change.repairedHead],
    ["publishing", "Reconstruct guard eligibility", "Guard-eligible synthetic result on the new exact head · no external write"],
  ];
  const activeIndex = stages.findIndex(([status]) => status === change.status);
  return stages.map(([status, label, detail], index) => [
    index < activeIndex ? (status === "failing" ? "warning" : "pass") : index === activeIndex ? "active" : "pending",
    label,
    detail,
  ]);
}

function Evidence({ change }) {
  return (
    <>
      <section className="workspace-section" aria-labelledby="evidence-title">
        <div className="section-title-row">
          <h2 id="evidence-title">What happened</h2>
          <span>Version {change.head}</span>
        </div>
        <div className="plain-list evidence-list">
          {evidenceFor(change).map(([state, label, detail]) => (
            <div className={`plain-list-row evidence-${state}`} key={label}>
              {state === "active" ? (
                <ArrowsClockwise className="spin" size={20} weight="bold" aria-hidden="true" />
              ) : state === "blocked" ? (
                <WarningOctagon size={20} weight="fill" aria-hidden="true" />
              ) : state === "warning" ? (
                <Warning size={20} weight="fill" aria-hidden="true" />
              ) : state === "pending" ? (
                <Circle size={17} aria-hidden="true" />
              ) : (
                <CheckCircle size={20} weight="fill" aria-hidden="true" />
              )}
              <span>{label}</span>
              <time>{detail}</time>
            </div>
          ))}
        </div>
      </section>

      {change.advisory && (
        <section className="workspace-section" aria-labelledby="advisory-title">
          <h2 id="advisory-title">Advisory</h2>
          <button className="advisory-row" type="button">
            <Warning size={22} aria-hidden="true" />
            <span>{change.advisory}</span>
            <time>{change.advisoryTime}</time>
            <CaretRight size={17} aria-hidden="true" />
          </button>
        </section>
      )}
    </>
  );
}

function IndependentReview({ change, onInspectHandback }) {
  const stopped = change.status === "blocked";
  const resolved = change.verified;
  const reviewStale = !stopped && change.reviewHeadSha !== change.headSha;
  return (
    <section className="workspace-section" aria-labelledby="independent-review-title">
      <div className="section-title-row">
        <h2 id="independent-review-title">Independent review</h2>
        <span>Advisory only</span>
      </div>
      <div className={`review-signal ${stopped ? "is-stopped" : resolved && !reviewStale ? "is-resolved" : reviewStale ? "is-stale" : ""}`}>
        <Robot size={21} weight="duotone" aria-hidden="true" />
        <div>
          <strong>{stopped ? "Review stopped at policy" : reviewStale ? "Previous-head review not inherited" : "Changed-line risk · service-window boundary"}</strong>
          <p>{stopped
            ? "A protected-path decision stopped the run before model review."
            : reviewStale
              ? `Review on ${change.initialHead} is omitted from ${change.head}. A fresh exact-diff review would remain advisory.`
              : "The reviewer flags the route fallback separately, then returns the finding through GitHub for any coding agent working on this pull request."}</p>
        </div>
        <span>{stopped ? "Not run" : reviewStale ? `Prior head · ${change.initialHead}` : resolved ? `Resolved · ${change.head}` : "Handed back"}</span>
      </div>
      <p className="review-boundary"><ShieldCheck size={14} weight="fill" aria-hidden="true" /> <code>ChangePlane / review</code> can advise. Only deterministic evidence on the exact head can let <code>ChangePlane / guard</code> publish PASS.</p>
      {!stopped && (
        <button className="handback-inspect" type="button" onClick={onInspectHandback}>
          Inspect agent handback <ArrowRight size={14} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

const REVISION_STATE_LABEL = Object.freeze({
  BOUND: "Bound",
  OBSERVED: "Observed",
  ADVISORY: "Advisory",
  READY: "Ready",
  VERIFYING: "Verifying",
  VERIFIED: "Verified",
  WITHHELD: "Withheld",
  EXACT_HEAD_MATCH: "Exact SHA",
  STALE_OMITTED: "Stale omitted",
  NOT_OBSERVED: "Not observed",
  READY_FOR_GITHUB: "Ready for GitHub",
  QUEUE_GUARD_PASSED: "Queue guard passed",
  GITHUB_DECIDES: "GitHub decides",
  NOT_CARRIED_FORWARD: "Not inherited",
});

const REVISION_TRUST_LABEL = Object.freeze({
  declared: "Declared input",
  observed: "Observed fact",
  advisory: "Advisory only",
  verified: "Verified evidence",
  withheld: "Authority withheld",
  external: "External authority",
  not_observed: "Not observed",
});

function revisionAssuranceFor(change) {
  return buildRevisionSdlcAssurance({
    headSha: change.headSha,
    status: change.status,
    previewHeadSha: change.status === "passed" ? change.previewHeadSha : null,
    reviewHeadSha: change.reviewHeadSha,
    reviewAvailable: true,
    intentHeadSha: change.intentHeadSha,
    changeHeadSha: change.changeHeadSha,
    evidenceHeadSha: change.evidenceHeadSha,
  });
}

function RevisionSdlcSpine({ change }) {
  const [selectedStageId, setSelectedStageId] = useState("verify");
  const stageRefs = useRef([]);
  const view = useMemo(() => revisionAssuranceFor(change), [change.changeHeadSha, change.evidenceHeadSha, change.headSha, change.intentHeadSha, change.previewHeadSha, change.reviewHeadSha, change.status]);
  const selectedStage = view.stages.find(({ id }) => id === selectedStageId) ?? view.stages[0];
  const selectedStageIndex = view.stages.findIndex(({ id }) => id === selectedStage.id);

  function onStageKeyDown(event, index) {
    const last = view.stages.length - 1;
    const nextIndex = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? (index + 1) % view.stages.length
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? (index - 1 + view.stages.length) % view.stages.length
        : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (nextIndex == null) return;
    event.preventDefault();
    setSelectedStageId(view.stages[nextIndex].id);
    stageRefs.current[nextIndex]?.focus();
  }

  return (
    <section className="revision-sdlc" aria-labelledby="revision-sdlc-title">
      <div className="revision-sdlc-heading">
        <div>
          <p>Agentic SDLC assurance spine</p>
          <h2 id="revision-sdlc-title">Every handoff stays on one exact revision.</h2>
        </div>
        <span className="mono" title={view.target.headSha} aria-label={`Full revision ${view.target.headSha}`}>{change.head}</span>
      </div>
      <ol className="revision-sdlc-stages" role="tablist" aria-label="Exact-revision SDLC checkpoints" aria-orientation="horizontal">
        {view.stages.map((item, index) => (
          <li key={item.id} role="presentation">
            <button
              type="button"
              ref={(node) => { stageRefs.current[index] = node; }}
              id={`revision-sdlc-tab-${item.id}`}
              role="tab"
              className={`revision-stage revision-stage-${item.state.toLowerCase().replaceAll("_", "-")} ${selectedStage.id === item.id ? "is-selected" : ""}`}
              aria-selected={selectedStage.id === item.id}
              aria-controls="revision-sdlc-panel"
              aria-label={`${item.label}: ${REVISION_STATE_LABEL[item.state] ?? item.state}`}
              tabIndex={selectedStage.id === item.id ? 0 : -1}
              onClick={() => setSelectedStageId(item.id)}
              onKeyDown={(event) => onStageKeyDown(event, index)}
            >
              <span className="revision-stage-mark" aria-hidden="true" />
              <span>{item.label}</span>
              <small>{REVISION_STATE_LABEL[item.state] ?? item.state}</small>
            </button>
          </li>
        ))}
      </ol>
      <p className="revision-sdlc-scroll-hint"><ArrowRight size={13} weight="bold" aria-hidden="true" /> Scroll for all seven checkpoints</p>
      <div
        className="revision-stage-detail"
        id="revision-sdlc-panel"
        role="tabpanel"
        aria-labelledby={`revision-sdlc-tab-${selectedStage.id}`}
        aria-live="polite"
        tabIndex={0}
        key={`${selectedStage.id}-${selectedStage.state}-${selectedStageIndex}`}
      >
        <span className={`revision-trust revision-trust-${selectedStage.trust}`}>{REVISION_TRUST_LABEL[selectedStage.trust] ?? selectedStage.trust}</span>
        <div><strong>{selectedStage.owner}</strong><p>{selectedStage.detail}</p></div>
      </div>
      <p className="revision-sdlc-boundary"><ArrowsClockwise size={13} weight="bold" aria-hidden="true" /> A new commit restarts every assurance checkpoint. Delivery never contributes to PASS; GitHub always owns merge.</p>
    </section>
  );
}

function Workspace({ change, isPreview, onInspect, onInspectHandback, onRun }) {
  const { state, label } = displayState(change.status, change.verified);
  const automationLabel = change.status === "blocked" ? "Exception only" : "Zero-touch eligible";
  const actualFiles = change.files.filter(({ resolved }) => !resolved).length;
  const drift = actualFiles - change.plannedFiles;
  const routeFacts = change.id === "route";
  return (
    <main className="workspace">
      <div className="workspace-title-row">
        <div>
          <p className="workspace-kicker">{isPreview ? "RouteThai use case · synthetic contract reconstruction" : `${change.changeId} · PR #${change.pr} · ${automationLabel}`}</p>
          <h1 id="workspace-main-title" tabIndex={-1}>{change.title}</h1>
        </div>
        <span className={`decision-pill pill-${state}`}>{label}</span>
      </div>

      {(change.status === "ready" || RUNNING_STATES.has(change.status)) && (
        <section className="workspace-run-card" aria-label="Synthetic assurance action">
          <div>
          <strong>{change.status === "ready" ? "Run the exact-head assurance reconstruction" : "Synthetic contract is reconstructing"}</strong>
          <span>Synthetic failure → projected proposal → reconstructed fresh-head result. No live GitHub or model request.</span>
          </div>
          <button
            className="primary-action workspace-run-action"
            type="button"
            onClick={() => onRun(change.id)}
            disabled={change.status !== "ready"}
          >
            {change.status === "ready"
              ? <><Play size={17} weight="fill" /> Reconstruct exact-head assurance</>
              : <><ArrowsClockwise className="spin" size={17} weight="bold" /> Reconstructing synthetic change</>}
          </button>
        </section>
      )}

      <RevisionSdlcSpine change={change} />

      <dl className="change-summary">
        <div>
          <dt>Summary</dt>
          <dd>{change.summary}</dd>
        </div>
        <div>
          <dt>Outcome</dt>
          <dd>{change.verified && change.reportedImpact ? change.reportedImpact : change.impact}</dd>
        </div>
        <div>
          <dt>Allowed files</dt>
          <dd className="scope-line">
            <code>{change.scope}</code>
            <span aria-hidden="true">·</span>
            <strong>Policy v3</strong>
          </dd>
        </div>
        {change.status === "blocked" && (
          <>
            <div>
              <dt>Policy</dt>
              <dd className="scope-line"><code>{change.blockedPolicy}</code><span>Non-overridable</span></dd>
            </div>
            <div>
              <dt>Owner action</dt>
              <dd>{change.ownerAction}</dd>
            </div>
          </>
        )}
      </dl>

      <dl className="change-facts" aria-label="Change contract comparison">
        <div><dt>Coding agent</dt><dd>{change.origin}</dd></div>
        <div><dt>Risk context</dt><dd>{change.risk} · {change.riskLabel}</dd></div>
        {routeFacts ? (
          <>
            <div><dt>Version</dt><dd className="mono">{change.head}</dd></div>
            <div className={change.status === "failing" ? "has-drift" : ""}><dt>Evidence</dt><dd>{change.verified ? "Guard-eligible · reconstructed exact head" : change.status === "passed" ? "Withheld · stale evidence" : RUNNING_STATES.has(change.status) ? "Reconstruction in progress" : "Ready"}</dd></div>
            <div><dt>Human actions</dt><dd>0</dd></div>
          </>
        ) : (
          <>
            <div><dt>Planned</dt><dd>{change.plannedFiles} {change.plannedFiles === 1 ? "file" : "files"}</dd></div>
            <div><dt>Actual</dt><dd>{actualFiles} {actualFiles === 1 ? "file" : "files"}</dd></div>
            <div className={drift > 0 ? "has-drift" : ""}><dt>Drift</dt><dd>{drift > 0 ? `+${drift}` : drift}</dd></div>
          </>
        )}
      </dl>

      <IndependentReview change={change} onInspectHandback={onInspectHandback} />
      <FileTable files={change.files} onInspect={onInspect} />
      <Evidence change={change} />
    </main>
  );
}

function pipelineState(status, key) {
  const order = { contract: 0, evidence: 1, proposal: 2, validation: 3, apply: 4, recheck: 5, check: 6 };
  if (status === "passed") return "complete";
  if (status === "blocked") return key === "contract" ? "complete" : "blocked";
  if (status === "ready") return "pending";
  const activeIndex = { binding: 0, failing: 1, proposing: 2, validating: 3, applying: 4, rechecking: 5, publishing: 6 }[status] ?? -1;
  if (order[key] < activeIndex) return "complete";
  if (order[key] === activeIndex) return "active";
  return "pending";
}

function AssuranceNotice({ change }) {
  if (change.verified) {
    return (
      <div className="decision-notice notice-pass">
        <GitMerge size={22} weight="fill" aria-hidden="true" />
        <div><strong>Synthetic contract matched on {change.head}</strong><p>The reconstructed service-window fixture now matches. This page publishes nothing; GitHub still decides whether to merge in a connected repository.</p></div>
      </div>
    );
  }
  if (change.status === "passed") {
    return (
      <div className="decision-notice notice-blocked">
        <WarningOctagon size={22} weight="fill" aria-hidden="true" />
        <div><strong>Previous result not inherited</strong><p>No full-SHA evidence result matches this revision, so the synthetic result is withheld. This page sends nothing to GitHub.</p></div>
      </div>
    );
  }
  if (change.status === "blocked") {
    return (
      <div className="decision-notice notice-blocked">
        <WarningOctagon size={22} weight="fill" aria-hidden="true" />
        <div><strong>Automation stopped safely</strong><p>A blocked capability cannot be changed or approved by an agent.</p></div>
      </div>
    );
  }
  if (RUNNING_STATES.has(change.status)) {
    const messages = {
      binding: ["Locking the exact commit", "The receipt is now tied to 71b04c2 and the allowed routing files."],
      failing: ["Reconstructed service-window failure", "One synthetic stop is scheduled too late in the fixture."],
      proposing: ["Reconstructing a bounded Luna proposal", "The projected model context contains the failure and allowed source files—not GitHub credentials."],
      validating: ["Projecting clean validation", "A clean job would check the patch, file scope, commit, and attempt limit."],
      applying: ["Projecting the trusted apply boundary", "A separate trusted controller would apply the accepted patch in a connected run."],
      rechecking: ["Reconstructing the new commit", `Synthetic evidence is projected on ${change.repairedHead}.`],
      publishing: ["Reconstructing guard eligibility", `The synthetic contract is guard-eligible on ${change.repairedHead}; this page publishes nothing.`],
    };
    return (
      <div className="decision-notice notice-progress" aria-live="polite">
        <ArrowsClockwise className="spin" size={22} weight="bold" aria-hidden="true" />
        <div><strong>{messages[change.status][0]}</strong><p>{messages[change.status][1]}</p></div>
      </div>
    );
  }
  return (
    <div className="decision-notice notice-ready">
      <Lightning size={22} weight="fill" aria-hidden="true" />
      <div><strong>Ready to reconstruct</strong><p>The synthetic contract would reconstruct the failure, project a bounded Luna proposal and validation, then reconstruct the new-head result.</p></div>
    </div>
  );
}

function previewEvidenceFor(change) {
  if (change.status === "blocked") {
    return {
      label: "Preview excluded from receipt",
      detail: "Protected change stopped",
      receipt: "Excluded",
      tone: "blocked",
    };
  }
  if (change.verified) {
    return {
      label: "Synthetic evidence matched",
      detail: "Fixture and revision metadata reconstructed",
      receipt: "Included",
      tone: "pass",
    };
  }
  if (change.status === "passed") {
    return {
      label: "Synthetic evidence omitted",
      detail: "The reconstructed result belongs to another full revision",
      receipt: "Withheld",
      tone: "blocked",
    };
  }
  if (RUNNING_STATES.has(change.status)) {
    return {
      label: "Synthetic evidence reconstructing",
      detail: "No live request from this page",
      receipt: "Reconstructing",
      tone: "active",
    };
  }
  return {
    label: "Synthetic evidence ready",
    detail: "Synthetic data only",
    receipt: "Pending verification",
    tone: "ready",
  };
}

function headPreviewFor(change) {
  const deliveryState = revisionAssuranceFor(change).stages.find(({ id }) => id === "delivery")?.state;
  if (change.status === "blocked") {
    return {
      label: "Preview excluded from receipt",
      detail: "Protected change stopped before deployment proof",
      receipt: "Excluded",
      tone: "blocked",
    };
  }
  if (deliveryState === REVISION_STAGE_STATE.EXACT_HEAD_MATCH) {
    return {
      label: "Preview bound to exact head",
      detail: `Synthetic GitHub Deployment · ${change.head}`,
      receipt: "Exact-head match",
      tone: "pass",
    };
  }
  if (deliveryState === REVISION_STAGE_STATE.STALE_OMITTED) {
    return {
      label: "Preview omitted — different revision",
      detail: "Deployment metadata does not match the current full SHA",
      receipt: "Stale omitted",
      tone: "blocked",
    };
  }
  if (change.status === "passed") {
    return {
      label: "Preview withheld with evidence",
      detail: "No verified exact-head receipt can include deployment metadata",
      receipt: "Withheld",
      tone: "blocked",
    };
  }
  if (RUNNING_STATES.has(change.status)) {
    return {
      label: "Preview waiting for exact head",
      detail: "A deployment URL is never carried across commits",
      receipt: "Pending verification",
      tone: "active",
    };
  }
  return {
    label: "Exact-head preview ready",
    detail: "GitHub Deployment evidence · no hosted preview created",
    receipt: "Pending verification",
    tone: "ready",
  };
}

function backboneStateFor(change) {
  if (change.status === "blocked") {
    return {
      label: "Backbone stopped at policy",
      detail: "No repair model dispatched",
      summary: "A protected capability stopped the run before any model could propose a patch.",
      tone: "blocked",
    };
  }
  if (RUNNING_STATES.has(change.status)) {
    return {
      label: change.status === "proposing" ? "Reconstructing a Luna proposal" : "Reconstructing independent verification",
      detail: "Synthetic projection · no model, repository, or publisher request",
      summary: "The reconstruction shows where GPT-5.6 Luna could propose a diff, while a clean deterministic harness and trusted controller would independently own validation and apply.",
      tone: "active",
    };
  }
  if (change.verified) {
    return {
      label: "Reconstructed exact-head assurance",
      detail: `${change.initialHead} → ${change.head}`,
      summary: "The reconstruction projects a bounded Luna proposal, clean validation, separately controlled apply, and fresh exact-head evidence. It publishes no Check and writes no repository.",
      tone: "pass",
    };
  }
  return {
    label: "Assurance ready",
    detail: "Exact commit · repository-owned evidence · bounded authority",
    summary: "The coding agent supplies the pull request. If repair is needed, a model may propose and a separately credentialed controller may apply; neither can decide PASS.",
    tone: "ready",
  };
}

function MetaRows({ change }) {
  const rows = [
    ["Authoring surface", `${change.origin} · coding agent`],
    ["Executor", change.agent],
    ["Base", change.base],
    ["Head", change.head],
    ["Risk context", `${change.risk} · ${change.riskLabel} · informational`],
    ["Policy", "Release Governance v3 · protected paths"],
    ["Evidence source", change.id === "route" ? "synthetic-service-window · github-actions" : "configured checks · github-actions"],
    ["Review", "Projected ChangePlane / review · advisory only"],
    ["Agent handback", "GitHub · any coding agent"],
    ["Proposal model", "gpt-5.6-luna · high"],
    ["Evaluator", "Synthetic ChangePlane guard contract"],
    ["Receipt", change.verified ? "Synthetic reconstruction · guard-eligible" : change.status === "passed" ? "Withheld · stale evidence" : "Synthetic autonomous reconstruction"],
    ["Human", change.status === "blocked" ? "Required" : "0 projected actions"],
  ];
  return (
    <dl className="meta-rows">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={label === "Head" || label === "Base" ? "mono" : ""}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AssuranceRail({ change, isPreview, onReplay, onCopy, onPreview, onBackbone, onShowSetup }) {
  const preview = previewEvidenceFor(change);
  const headPreview = headPreviewFor(change);
  const backbone = backboneStateFor(change);
  const railRef = useRef(null);

  useEffect(() => {
    if (change.verified && railRef.current) {
      railRef.current.scrollTop = 0;
    }
  }, [change.status, change.verified]);

  return (
    <aside className="decision-rail" aria-label="Change receipt details" ref={railRef}>
      <div className="rail-heading">
        <div><p>{isPreview ? "Assurance reconstruction" : `${change.changeId} · report only`}</p><h2>Result</h2></div>
        <span className="mode-live"><i /> {isPreview ? "Synthetic" : "Connected"}</span>
      </div>
      <AssuranceNotice change={change} />

      <section className="authority-map" aria-labelledby="authority-map-title">
        <div className="authority-map-heading">
          <div>
            <p>Assurance passport</p>
            <h3 id="authority-map-title">Independent roles</h3>
          </div>
          <span title={change.headSha} aria-label={`Exact head ${change.headSha}`}>{change.head}</span>
        </div>
        <ol className="authority-roles">
          <li><b>Change</b><span><strong>Coding agent</strong><small>{change.origin} · identity is context only</small></span></li>
          <li><b>Propose</b><span><strong>Proposal model · repair only</strong><small>May propose · no repository or PASS authority</small></span></li>
          <li><b>Decide</b><span><strong>Deterministic harness</strong><small>Repository-owned behavioral evidence</small></span></li>
          <li><b>Apply</b><span><strong>Trusted controller</strong><small>May apply an accepted patch · separate credential</small></span></li>
          <li><b>Merge</b><span><strong>GitHub</strong><small>Final authority stays with your repository</small></span></li>
        </ol>
        <p className="authority-integrity"><LockKey size={13} aria-hidden="true" /> Portable evidence, never portable authority.</p>
      </section>

      <div className="assurance-proofs" aria-label="Agentic backbone and receipt evidence">
        <button className={`preview-proof preview-proof-${backbone.tone}`} type="button" onClick={onBackbone}>
          {backbone.tone === "blocked"
            ? <WarningOctagon size={19} weight="fill" aria-hidden="true" />
            : <Robot size={19} weight="duotone" aria-hidden="true" />}
          <span><strong>{backbone.label}</strong><small>{backbone.detail}</small></span>
          <CaretRight size={16} aria-hidden="true" />
        </button>
        <button className={`preview-proof preview-proof-${preview.tone}`} type="button" onClick={onPreview}>
          {preview.tone === "blocked"
            ? <WarningOctagon size={19} weight="fill" aria-hidden="true" />
            : <GithubLogo size={19} weight="fill" aria-hidden="true" />}
          <span><strong>{preview.label}</strong><small>GPT-5.6 Luna · synthetic contract evidence</small></span>
          <CaretRight size={16} aria-hidden="true" />
        </button>
        <button className={`preview-proof preview-proof-${headPreview.tone}`} type="button" onClick={onPreview}>
          {headPreview.tone === "blocked"
            ? <WarningOctagon size={19} weight="fill" aria-hidden="true" />
            : <GitBranch size={19} weight="duotone" aria-hidden="true" />}
          <span><strong>{headPreview.label}</strong><small>{headPreview.detail}</small></span>
          <CaretRight size={16} aria-hidden="true" />
        </button>
      </div>

      {change.verified && change.id === "route" && (
        <div className="result-actions">
          <button className="secondary-action run-action" type="button" onClick={() => onReplay(change.id)}>
            <ArrowsClockwise size={17} /> Run the reconstruction again
          </button>
          {isPreview && (
            <button className="setup-link-action" type="button" onClick={onShowSetup}>
              Set up your repository <ArrowRight size={15} />
            </button>
          )}
        </div>
      )}

      <p className="pipeline-eyebrow">Repair execution · optional exception path</p>
      <ol className="run-pipeline" aria-label="Repair execution">
        {PIPELINE.map(([key, label]) => {
          const stage = pipelineState(change.verified ? "passed" : change.status === "passed" ? "ready" : change.status, key);
          return (
            <li className={`pipeline-${stage}`} key={key}>
              <span className="pipeline-mark">
                {stage === "complete" ? <Check size={12} weight="bold" /> : stage === "active" ? <ArrowsClockwise className="spin" size={12} weight="bold" /> : stage === "blocked" ? <X size={12} weight="bold" /> : null}
              </span>
              <span>{label}</span>
            </li>
          );
        })}
      </ol>

      <details className="rail-section details-section technical-proof">
        <summary>Show technical proof</summary>
        <div className="rail-section-title"><h3>Bound inputs</h3><button className="copy-button" type="button" onClick={() => onCopy(change.headSha)} aria-label="Copy full exact revision"><Copy size={16} /></button></div>
        <MetaRows change={change} />
      </details>

      <section className="rail-section audit-section">
        <h3>What ChangePlane guarantees</h3>
        <div className="guarantee-row"><ShieldCheck size={18} weight="fill" /><span>A new commit cancels the old result and starts again</span></div>
        <div className="guarantee-row"><LockKey size={18} /><span>The authoring agent cannot issue or change the receipt</span></div>
        <div className="guarantee-row"><Clock size={18} /><span>Every failure, patch, and result stays tied to one exact revision</span></div>
        <div className="guarantee-row"><GithubLogo size={18} /><span>GitHub remains responsible for the merge decision</span></div>
      </section>
    </aside>
  );
}

function FileDialog({ file, onClose }) {
  const dialogRef = useDialogFocus(Boolean(file), onClose);
  if (!file) return null;
  const explanation = file.evidenceRelevant
    ? "This allowed file is tied to the synthetic service-window failure. Luna may propose a diff, but a clean harness must validate it before a separate controller can apply it."
    : file.blocked
        ? "Matched blocked path secrets/**. Automation stops and this path cannot be overridden."
        : "Matched the declared scope for this pull request.";
  return (
    <div className="file-overlay" role="dialog" aria-modal="true" aria-labelledby="file-dialog-title">
      <button className="overlay-scrim" type="button" onClick={onClose} aria-label="Close file details" />
      <section className="file-dialog" ref={dialogRef} tabIndex={-1}>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Close" data-dialog-initial><X size={18} /></button>
        <FileCode size={26} weight="duotone" aria-hidden="true" />
        <p className="eyebrow">Contract decision</p>
        <h2 id="file-dialog-title">{file.path}</h2>
        <div className="file-dialog-stats">
          <span className="added">+{file.add}</span>
          <span className="removed">−{file.remove}</span>
          <span>{file.scope}</span>
        </div>
        <p>{explanation}</p>
        <button className="secondary-action" type="button" onClick={onClose}>Back to change</button>
      </section>
    </div>
  );
}

function GuideDrawer({ onClose, onStart }) {
  const dialogRef = useDialogFocus(true, onClose);
  return (
    <div className="file-overlay" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <button className="overlay-scrim" type="button" onClick={onClose} aria-label="Close assurance workflow" />
      <section className="guide-drawer" ref={dialogRef} tabIndex={-1}>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Close" data-dialog-initial><X size={18} /></button>
        <ShieldCheck size={28} weight="duotone" aria-hidden="true" />
        <p className="eyebrow">Agentic SDLC assurance</p>
        <h2 id="guide-title">No new SDLC workspace.</h2>
        <p className="guide-intro">ChangePlane connects assurance handoffs across the delivery lifecycle. Developers remain in their coding agent and GitHub; existing CI, deployment, and operations systems keep their jobs.</p>
        <ol className="guide-steps">
          <li><span>01</span><div><strong>Platform lead · once</strong><p>Bind one meaningful Check and merge the protected Verify Lite setup PR. BYOK is needed only if the team later chooses bounded Autonomous repair.</p></div></li>
          <li><span>02</span><div><strong>Intent + change</strong><p>The pull request declares one goal and allowed scope. Any coding agent may author the diff; the declaration itself is never treated as proof.</p></div></li>
          <li><span>03</span><div><strong>Review</strong><p>Model review stays advisory. Tests, workflow bytes, evidence controls, and other protected capabilities require a current human decision.</p></div></li>
          <li><span>04</span><div><strong>Verify + repair loop</strong><p>Repository-owned evidence decides. A failed Check returns an exact-head handback or enters the bounded propose → validate → trusted-apply loop.</p></div></li>
          <li><span>05</span><div><strong>Delivery + merge</strong><p>An existing deployment is shown only on an exact SHA match. GitHub Rulesets, branch protection, Merge Queue, and merge authority remain in GitHub.</p></div></li>
        </ol>
        <p className="guide-intro">Operate is intentionally marked not observed: ChangePlane does not replace deployment, observability, incident response, or rollback systems.</p>
        <button className="primary-action guide-primary" type="button" onClick={onStart}>Inspect the exact-revision spine <ArrowRight size={17} /></button>
      </section>
    </div>
  );
}

function PreviewEvidenceDrawer({ change, onClose, onCopy }) {
  const dialogRef = useDialogFocus(true, onClose);
  const preview = previewEvidenceFor(change);
  const headPreview = headPreviewFor(change);
  const accepted = preview.receipt === "Included";
  return (
    <div className="file-overlay" role="dialog" aria-modal="true" aria-labelledby="preview-evidence-title">
      <button className="overlay-scrim" type="button" onClick={onClose} aria-label="Close preview evidence" />
      <section className="guide-drawer preview-drawer" ref={dialogRef} tabIndex={-1}>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Close" data-dialog-initial><X size={18} /></button>
        <GithubLogo size={28} weight="duotone" aria-hidden="true" />
        <p className="eyebrow">Synthetic contract reconstruction</p>
        <h2 id="preview-evidence-title">{accepted ? "Synthetic evidence reconstructed for" : "Synthetic reconstruction at"} {change.head}</h2>
        <p className="guide-intro">ChangePlane is used with RouteThai in production, but this public workspace is only a synthetic contract reconstruction. It makes no model or GitHub request and does not display or replay a production run.</p>

        <dl className="preview-evidence-facts">
          <div><dt>Source</dt><dd>Synthetic contract fixture</dd></div>
          <div><dt>Model</dt><dd>gpt-5.6-luna</dd></div>
          <div><dt>Data</dt><dd>Synthetic route fixture</dd></div>
          <div><dt>Signal</dt><dd>exact-head recheck</dd></div>
          <div><dt>Exact head</dt><dd className="mono" title={change.headSha} aria-label={`Full exact head ${change.headSha}`}>{change.head}</dd></div>
          <div><dt>Receipt</dt><dd className={`preview-receipt-${preview.tone}`}>{preview.receipt}</dd></div>
          <div><dt>Preview</dt><dd className={`preview-receipt-${headPreview.tone}`}>{headPreview.receipt}</dd></div>
        </dl>

        <div className="preview-evidence-note">
          <ShieldCheck size={20} weight="fill" aria-hidden="true" />
          <div><strong>{preview.label}</strong><p>{preview.detail}. Request IDs and timestamps are redacted; no customer, coordinate, or private repository data appears.</p></div>
        </div>

        <div className="preview-evidence-note preview-deployment-note">
          <GitBranch size={20} weight="duotone" aria-hidden="true" />
          <div><strong>{headPreview.label}</strong><p>In this synthetic scenario, the reconstructed receipt includes a GitHub Deployment only when its full commit SHA equals the current full revision. This public reconstruction does not open or create a live preview.</p></div>
        </div>

        <div className="preview-drawer-actions">
          <button className="secondary-action" type="button" onClick={() => onCopy(change.headSha)} aria-label="Copy full exact revision"><Copy size={16} /> Copy exact revision</button>
          <button className="primary-action" type="button" onClick={onClose}>Back to receipt</button>
        </div>
      </section>
    </div>
  );
}

function agentHandbackFor(change) {
  return {
    mediaType: "application/vnd.changeplane.agent-handback+json;v=1",
    subject: {
      repository: change.repo,
      pullRequest: change.pr,
      head: change.initialHeadSha,
    },
    finding: {
      code: "BEHAVIORAL_EVIDENCE_FAILED",
      summary: "Synthetic service-window evidence found one stop outside its allowed window.",
    },
    scope: {
      allowedPaths: [change.scope],
      attempt: 1,
      maxAttempts: 2,
    },
    authority: {
      push: false,
      check: false,
      merge: false,
      pass: false,
    },
  };
}

function AgentHandbackDrawer({ change, onClose, onCopy }) {
  const dialogRef = useDialogFocus(true, onClose);
  const handback = agentHandbackFor(change);
  const payload = JSON.stringify(handback, null, 2);
  return (
    <div className="file-overlay" role="dialog" aria-modal="true" aria-labelledby="handback-title" aria-describedby="handback-intro">
      <button className="overlay-scrim" type="button" onClick={onClose} aria-label="Close agent handback" />
      <section className="guide-drawer handback-drawer" ref={dialogRef} tabIndex={-1}>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Close" data-dialog-initial><X size={18} /></button>
        <GitBranch size={28} weight="duotone" aria-hidden="true" />
        <p className="eyebrow">Agent-neutral handback</p>
        <h2 id="handback-title">Any coding agent can take the next turn.</h2>
        <p className="guide-intro" id="handback-intro">This synthetic payload gives Cursor, Codex, Claude Code, or another agent the same bounded finding. It conveys work—not repository authority.</p>

        <dl className="handback-facts">
          <div><dt>Exact failed head</dt><dd className="mono" title={handback.subject.head} aria-label={`Full exact failed head ${handback.subject.head}`}>{handback.subject.head.slice(0, 7)}</dd></div>
          <div><dt>Allowed paths</dt><dd className="mono">{handback.scope.allowedPaths[0]}</dd></div>
          <div><dt>Bounded finding</dt><dd>{handback.finding.code}</dd></div>
          <div><dt>Attempt</dt><dd>{handback.scope.attempt} of {handback.scope.maxAttempts}</dd></div>
        </dl>

        <div className="handback-authority" aria-label="Handback authority is false">
          {Object.entries(handback.authority).map(([name, allowed]) => (
            <span key={name}><b>{name}</b><strong>{String(allowed)}</strong></span>
          ))}
        </div>

        <details className="handback-payload">
          <summary>Inspect machine-readable payload</summary>
          <pre>{payload}</pre>
        </details>

        <div className="preview-drawer-actions">
          <button className="secondary-action" type="button" onClick={() => onCopy(payload)}><Copy size={16} /> Copy handback JSON</button>
          <button className="primary-action" type="button" onClick={onClose}>Back to change</button>
        </div>
      </section>
    </div>
  );
}

function BackboneDrawer({ change, onClose }) {
  const dialogRef = useDialogFocus(true, onClose);
  const backbone = backboneStateFor(change);
  return (
    <div className="file-overlay" role="dialog" aria-modal="true" aria-labelledby="backbone-title" aria-describedby="backbone-intro">
      <button className="overlay-scrim" type="button" onClick={onClose} aria-label="Close agentic backbone" />
      <section className="guide-drawer backbone-drawer" ref={dialogRef} tabIndex={-1}>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Close" data-dialog-initial><X size={18} /></button>
        <Robot size={28} weight="duotone" aria-hidden="true" />
        <p className="eyebrow">Bounded repair adapter</p>
        <h2 id="backbone-title">Agentic work, without agent authority.</h2>
        <p className="guide-intro" id="backbone-intro">The bounded contract separates proposal, clean validation, trusted apply, and exact-head Check publication. This public reconstruction does not invoke a model, controller, or publisher.</p>

        <div className={`backbone-status backbone-status-${backbone.tone}`}>
          {backbone.tone === "blocked" ? <WarningOctagon size={20} weight="fill" aria-hidden="true" /> : <ShieldCheck size={20} weight="fill" aria-hidden="true" />}
          <div><strong>{backbone.label}</strong><p>{backbone.summary}</p></div>
        </div>

        <ol className="backbone-jobs" aria-label="Agentic backbone job boundaries">
          <li>
            <span>01</span>
            <div><strong>Model job</strong><p><b>{RUNTIME.model} · {RUNTIME.effort} effort</b><br />Native Responses API, bounded source context, unified diff only, and no GitHub token or Check authority.</p></div>
          </li>
          <li>
            <span>02</span>
            <div><strong>Deterministic harness</strong><p>Validates the signed campaign, exact head, granted paths, deadline, Git metadata, and the resulting tree again inside the clean apply job.</p></div>
          </li>
          <li>
            <span>03</span>
            <div><strong>Trusted apply job</strong><p>A separate job rechecks the live PR head, applies only the validated granted paths, then dispatches a fresh exact-head recheck.</p></div>
          </li>
        </ol>

        <div className="backbone-boundary">
          <LockKey size={20} aria-hidden="true" />
          <div><strong>Hard authority boundary</strong><p>The model cannot push, issue PASS, approve a pull request, publish the required Check, or merge code. Only the trusted controller can cross the apply boundary.</p></div>
        </div>

        <div className="backbone-runtime">
          <span>Funding</span>
          <strong>Bring your own OpenAI key</strong>
          <p>Your key stays in GitHub Actions. The model can change; the verification boundary does not.</p>
        </div>

        <button className="primary-action backbone-close" type="button" onClick={onClose}>Back to receipt</button>
      </section>
    </div>
  );
}

const ORIGIN_PROOF_FILTERS = Object.freeze([
  { id: "origin", label: "Authoring surface" },
  { id: "contract", label: "Guard contract" },
  { id: "all", label: "All cases" },
]);

function proofReason(item) {
  if (["FAILED", "REJECTED"].includes(item.observed.providerStatus)) return item.observed.automationReason;
  return item.observed.reasonCodes[0]
    || (item.observed.guardEligible ? "TRUSTED_EXACT_HEAD" : item.observed.automationReason)
    || "NONE";
}

function AssuranceLabDrawer({ onClose }) {
  const [report, setReport] = useState(() => runOriginBoundaryProof());
  const [filter, setFilter] = useState("origin");
  const [copied, setCopied] = useState(false);
  const [runCount, setRunCount] = useState(1);
  const dialogRef = useDialogFocus(true, onClose);
  const originCases = report.cases.filter(({ category }) => category === "origin-boundary");
  const guardCases = report.cases.filter(({ category }) => category !== "origin-boundary");
  const filteredCases = filter === "origin" ? originCases : filter === "contract" ? guardCases : report.cases;
  const filterCounts = { origin: originCases.length, contract: guardCases.length, all: report.cases.length };

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function rerunProof() {
    setReport(runOriginBoundaryProof());
    setRunCount((count) => count + 1);
    setCopied(false);
  }

  return (
    <div className="drawer-overlay assurance-lab-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="drawer assurance-lab-drawer" role="dialog" aria-modal="true" aria-labelledby="assurance-lab-title" ref={dialogRef} tabIndex={-1}>
        <header className="drawer-head assurance-lab-head">
          <div>
            <p>Runnable synthetic contract · documented Origin boundary</p>
            <h2 id="assurance-lab-title">Synthetic GitHub-mirrored Origin boundary proof</h2>
          </div>
          <button type="button" aria-label="Close Origin boundary proof" onClick={onClose}><X size={19} /></button>
        </header>

        <p className="origin-proof-lede">Cursor Origin may be the authoring and mirror surface. This zero-request synthetic proof checks ChangePlane's own GitHub-side contract; it does not test or write to Origin or GitHub.</p>

        <section className="origin-proof-posture" aria-labelledby="origin-proof-posture-title">
          <div>
            <p id="origin-proof-posture-title">Executable contract path</p>
            <strong>GitHub-mirrored Origin</strong>
            <span>Synthetic contract · v13 App/OIDC and live mirror canaries pending</span>
          </div>
          <div>
            <p>Release authority</p>
            <strong>GitHub</strong>
            <span>Guard is evidence, never merge authority</span>
          </div>
          <div className="origin-proof-unsupported">
            <p>Standalone Origin</p>
            <strong>Unsupported</strong>
            <span>Not tested · not counted as proof</span>
          </div>
        </section>

        <div className="assurance-lab-summary origin-proof-summary" aria-live="polite" aria-atomic="true">
          <strong><span>{report.summary.passed}</span> / {report.summary.total} boundary assertions passed</strong>
          <p><b>Run {runCount}.</b> {report.summary.executableCasesPassed} / {report.summary.executableCases} contract cases matched the same deterministic evaluator. No GitHub or Origin API request was made.</p>
          <dl>
            <div><dt>Contract cases</dt><dd>{report.summary.executableCasesPassed} / {report.summary.executableCases}</dd></div>
            <div><dt>Origin cases</dt><dd>{report.summary.originBoundaryCases}</dd></div>
            <div><dt>External requests</dt><dd>{report.execution.externalRequests}</dd></div>
          </dl>
        </div>

        <section className="origin-proof-assertions" aria-labelledby="origin-proof-assertions-title">
          <div className="origin-proof-section-heading">
            <div><p>Observed locally</p><h3 id="origin-proof-assertions-title">Six boundary assertions</h3></div>
            <span>{report.summary.allPassed ? "All matched" : `${report.summary.failed} failed`}</span>
          </div>
          <ol>
            {report.assertions.map((assertion, index) => (
              <li className={assertion.passed ? "assertion-pass" : "assertion-fail"} key={assertion.id}>
                {assertion.passed
                  ? <CheckCircle size={17} weight="fill" aria-hidden="true" />
                  : <WarningOctagon size={17} weight="fill" aria-hidden="true" />}
                <span><strong>{String(index + 1).padStart(2, "0")} · {assertion.label}</strong><small>{assertion.observed}</small></span>
                <b>{assertion.passed ? "MATCH" : "MISMATCH"}</b>
              </li>
            ))}
          </ol>
        </section>

        <section className="origin-proof-sources" aria-labelledby="origin-proof-sources-title">
          <div className="origin-proof-section-heading">
            <div><p>Published context</p><h3 id="origin-proof-sources-title">Cursor documentation</h3></div>
            <span>{report.documentedContext.originStatus.replaceAll("_", " ")} · checked {report.documentedContext.asOf}</span>
          </div>
          <p>Cursor documents Origin as an early-beta git forge. For a GitHub mirror, GitHub remains the source of truth and the mirrored pull-request path returns to GitHub.</p>
          <ul>
            {report.documentedContext.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer">{source.label}<ArrowRight size={12} aria-hidden="true" /></a>
              </li>
            ))}
          </ul>
        </section>

        <section className="origin-proof-cases" aria-labelledby="origin-proof-cases-title">
          <div className="origin-proof-section-heading origin-proof-cases-heading">
            <div><p>Executable fixtures</p><h3 id="origin-proof-cases-title">Inspect the evidence</h3></div>
            <span>{filteredCases.length} shown</span>
          </div>
          <div className="origin-proof-filters" role="group" aria-label="Proof case filter">
            {ORIGIN_PROOF_FILTERS.map((option) => (
              <button
                type="button"
                key={option.id}
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
              >
                {option.label}<span>{filterCounts[option.id]}</span>
              </button>
            ))}
          </div>

          <div className="assurance-lab-cases">
            {filteredCases.map((item, index) => {
              const outcome = item.observed.outcome;
              const reason = proofReason(item);
              return (
                <details className={`assurance-lab-case outcome-${outcome.toLowerCase()}`} key={item.id} style={{ "--case-index": index }}>
                  <summary>
                    <span className="assurance-lab-case-index">{String(index + 1).padStart(2, "0")}</span>
                    <span><strong>{item.label}</strong><small>{item.description}</small></span>
                    <span className="assurance-lab-outcome">{outcome.replaceAll("_", " ")}</span>
                    <CaretRight size={15} />
                  </summary>
                  <dl>
                    <div><dt>Authoring surface</dt><dd>{item.boundary.authoringSurface.replaceAll("_", " ")}</dd></div>
                    <div><dt>Source of truth</dt><dd>{item.boundary.sourceOfTruth}</dd></div>
                    <div><dt>Head binding</dt><dd title={item.revision.headSha} aria-label={`${item.revision.exactHead ? "Exact head" : "Stale head"} ${item.revision.headSha}`}>{item.revision.exactHead ? `Exact · ${item.revision.headSha.slice(0, 8)}` : `Stale · ${item.revision.evaluatedHeadSha.slice(0, 8)}`}</dd></div>
                    <div><dt>Decision reason</dt><dd>{reason}</dd></div>
                    <div><dt>Guard publication</dt><dd>{item.observed.guardEligible ? "Eligible (not published)" : "Not eligible"}</dd></div>
                    <div><dt>Mutation</dt><dd>{item.observed.repositoryMutation ? "Allowed" : "Withheld"}</dd></div>
                    <div><dt>Merge authority</dt><dd>{item.boundary.mergeAuthority}</dd></div>
                    <div><dt>Assertion</dt><dd>{item.assertion.passed ? "Matched expected contract" : "Mismatch"}</dd></div>
                  </dl>
                </details>
              );
            })}
          </div>
        </section>

        <aside className="origin-proof-limit" aria-labelledby="origin-proof-limit-title">
          <strong id="origin-proof-limit-title"><LockKey size={14} aria-hidden="true" /> What this proves</strong>
          <p>{report.limits[1]}</p>
          <p>{report.limits[2]}</p>
        </aside>

        <footer className="assurance-lab-actions">
          <button className="secondary-action" type="button" onClick={rerunProof}>
            <ArrowsClockwise size={15} weight="bold" /> Run proof again
          </button>
          <button className="primary-action" type="button" onClick={copyReport}>
            <Copy size={15} /> {copied ? "Proof JSON copied" : "Copy proof JSON"}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState(() => PREVIEW_MODE ? readStoredJson(SESSION_KEY, null) : null);
  const [authStatus, setAuthStatus] = useState(PREVIEW_MODE ? "ready" : "loading");
  const [githubConfigured, setGithubConfigured] = useState(PREVIEW_MODE ? false : null);
  const [githubAuthMode, setGithubAuthMode] = useState(PREVIEW_MODE ? "example" : "oauth");
  const [githubRolloutMode, setGithubRolloutMode] = useState(PREVIEW_MODE ? "example" : "self_serve");
  const [authError, setAuthError] = useState(GITHUB_ENTRY_ERROR);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [repositories, setRepositories] = useState(() => PREVIEW_MODE && session ? PREVIEW_REPOSITORIES : []);
  const [repositoryStatus, setRepositoryStatus] = useState(() => PREVIEW_MODE && session ? "ready" : "idle");
  const [repositoryError, setRepositoryError] = useState("");
  const [selectedRepository, setSelectedRepository] = useState("");
  const selectedRepositoryRef = useRef(selectedRepository);
  const [preflightStatus, setPreflightStatus] = useState("idle");
  const [preflight, setPreflight] = useState(null);
  const [preflightError, setPreflightError] = useState("");
  const [preflightRefresh, setPreflightRefresh] = useState(0);
  const [installStatus, setInstallStatus] = useState("idle");
  const [installError, setInstallError] = useState("");
  const [installResult, setInstallResult] = useState(null);
  const [runtimeStatus, setRuntimeStatus] = useState("idle");
  const [runtimeError, setRuntimeError] = useState("");
  const [byok, setByok] = useState(EMPTY_BYOK);
  const [activeModel, setActiveModel] = useState(DEFAULT_PROPOSAL_MODEL);
  const [modelConfigured, setModelConfigured] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [runtimeUpdate, setRuntimeUpdate] = useState(null);
  const [harness, setHarness] = useState(EMPTY_HARNESS);
  const [rulesetPlanStatus, setRulesetPlanStatus] = useState("idle");
  const [rulesetPlan, setRulesetPlan] = useState(null);
  const [rulesetPlanError, setRulesetPlanError] = useState("");
  const [byokSaving, setByokSaving] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(CHANGES[0].id);
  const [filter, setFilter] = useState(FILTERS[0]);
  const [runs, setRuns] = useState(() => PREVIEW_MODE ? readStoredJson(RUNS_KEY, {}) : {});
  const [inspectedFile, setInspectedFile] = useState(null);
  const [toast, setToast] = useState("");
  const [policyOpen, setPolicyOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [previewEvidenceOpen, setPreviewEvidenceOpen] = useState(false);
  const [backboneOpen, setBackboneOpen] = useState(false);
  const [handbackOpen, setHandbackOpen] = useState(false);
  const [assuranceLabOpen, setAssuranceLabOpen] = useState(false);
  const timersRef = useRef([]);

  useEffect(() => {
    if (!session) return;
    const targetId = workspaceOpen && session.isPreview ? "workspace-main-title" : "setup-main-title";
    window.requestAnimationFrame(() => document.getElementById(targetId)?.focus());
  }, [workspaceOpen, session]);

  useEffect(() => {
    selectedRepositoryRef.current = selectedRepository;
    setRulesetPlanStatus("idle");
    setRulesetPlan(null);
    setRulesetPlanError("");
  }, [selectedRepository]);

  useEffect(() => {
    if (PREVIEW_MODE) return;
    let cancelled = false;
    async function loadSession() {
      try {
        const payload = await responseJson(await fetch("/api/github?action=session", { credentials: "same-origin" }));
        if (cancelled) return;
        setGithubConfigured(Boolean(payload.configured));
        setGithubAuthMode(payload.authMode === "github_app" ? "github_app" : "oauth");
        setGithubRolloutMode(payload.rolloutMode === "controlled_canary" ? "controlled_canary" : "self_serve");
        setSession(payload.authenticated ? sessionFor(payload.login, payload.csrf, payload.authMode) : null);
        setAuthStatus("ready");
      } catch (error) {
        if (cancelled) return;
        setAuthError(error instanceof Error ? error.message : "GitHub setup could not be checked.");
        setAuthStatus("error");
      }
    }
    loadSession();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!session || session.isPreview) return;
    loadRepositories();
  }, [session]);

  useEffect(() => {
    if (!session || !selectedRepository) {
      setPreflightStatus("idle");
      setPreflight(null);
      setPreflightError("");
      return;
    }
    if (session.isPreview) {
      setPreflightStatus("ready");
      setPreflight(PREVIEW_PREFLIGHT);
      setPreflightError("");
      return;
    }

    let cancelled = false;
    setPreflightStatus("loading");
    setPreflightError("");
    fetch(`/api/github?action=preflight&repository=${encodeURIComponent(selectedRepository)}`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(responseJson)
      .then((payload) => {
        if (cancelled) return;
        setPreflight(payload);
        setPreflightStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setPreflightError(error instanceof Error ? error.message : "Repository safety could not be checked.");
        setPreflightStatus("error");
      });
    return () => { cancelled = true; };
  }, [session, selectedRepository, preflightRefresh]);

  useEffect(() => {
    if (!session || !selectedRepository) {
      setRuntimeStatus("idle");
      setRuntimeError("");
      setByok(EMPTY_BYOK);
      setActiveModel(DEFAULT_PROPOSAL_MODEL);
      setModelConfigured(false);
      setRuntimeUpdate(null);
      setHarness(EMPTY_HARNESS);
      return;
    }
    if (session.isPreview) {
      setRuntimeStatus("ready");
      setRuntimeError("");
      setByok(EMPTY_BYOK);
      setActiveModel(DEFAULT_PROPOSAL_MODEL);
      setModelConfigured(true);
      setRuntimeUpdate(null);
      setHarness({ ...EMPTY_HARNESS, autonomousAvailable: true });
      return;
    }

    let cancelled = false;
    setRuntimeStatus("loading");
    setRuntimeError("");
    fetch(`/api/github?action=runtime&repository=${encodeURIComponent(selectedRepository)}`, { credentials: "same-origin" })
      .then(responseJson)
      .then((payload) => {
        if (cancelled) return;
        setByok(payload.byok);
        setActiveModel(payload.activeModel || DEFAULT_PROPOSAL_MODEL);
        setModelConfigured(Boolean(payload.modelConfigured));
        setRuntimeUpdate(null);
        setHarness({ ...EMPTY_HARNESS, ...payload.harness, sdlc: payload.sdlc ?? EMPTY_HARNESS.sdlc });
        setRuntimeStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setRuntimeError(error instanceof Error ? error.message : "Agent runtime status could not be loaded.");
        setRuntimeStatus("error");
      });
    return () => { cancelled = true; };
  }, [session, selectedRepository, preflightRefresh]);

  useEffect(() => {
    if (session?.isPreview) window.localStorage.setItem(RUNS_KEY, JSON.stringify(runs));
  }, [runs, session]);

  useEffect(() => () => timersRef.current.forEach(window.clearTimeout), []);

  const changes = useMemo(() => CHANGES.map((item) => {
    const record = runs[item.id];
    const status = record?.status ?? item.initialStatus;
    const head = record?.head ?? item.head;
    const headSha = record?.headSha
      ?? (head === item.repairedHead ? item.repairedHeadSha : item.headSha);
    const intentHeadSha = record
      ? Object.hasOwn(record, "intentHeadSha") ? record.intentHeadSha : null
      : item.intentHeadSha;
    const changeHeadSha = record
      ? Object.hasOwn(record, "changeHeadSha") ? record.changeHeadSha : null
      : item.changeHeadSha;
    const evidenceHeadSha = record
      ? Object.hasOwn(record, "evidenceHeadSha") ? record.evidenceHeadSha : null
      : item.evidenceHeadSha;
    const verified = status === "passed"
      && intentHeadSha === headSha
      && changeHeadSha === headSha
      && evidenceHeadSha === headSha;
    const files = item.files;
    const activeFiles = files.filter(({ resolved }) => !resolved);
    const result = evaluateChange({
      plannedPaths: [item.scope],
      actualFiles: activeFiles,
      protectedPaths: POLICY,
      ...REVISION,
      headSha: head,
    });
    const timeLabel = RUNNING_STATES.has(status)
      ? "Now"
      : status === "passed" && item.id === "route" ? "Just now" : item.time;
    return { ...item, status, head, headSha, intentHeadSha, changeHeadSha, evidenceHeadSha, verified, files, analysis: result, timeLabel };
  }), [runs]);

  const change = useMemo(() => changes.find((item) => item.id === selectedId) ?? changes[0], [changes, selectedId]);

  function showToast(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  function signIn() {
    if (isSigningIn || githubConfigured !== true) return;
    setIsSigningIn(true);
    window.location.assign("/api/github?action=login");
  }

  function authorizeExisting() {
    if (isSigningIn || githubConfigured !== true || githubAuthMode !== "github_app") return;
    setIsSigningIn(true);
    window.location.assign("/api/github?action=authorize");
  }

  function exploreProduct() {
    if (isSigningIn) return;
    setIsSigningIn(true);
    window.setTimeout(() => {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(PRESENTATION_USER));
      window.localStorage.removeItem(RUNS_KEY);
      setRuns({});
      setSession(PRESENTATION_USER);
      setRepositories(PREVIEW_REPOSITORIES);
      setSelectedRepository("");
      setRepositoryStatus("ready");
      setSelectedId("route");
      setWorkspaceOpen(true);
      setIsSigningIn(false);
    }, 520);
  }

  async function signOut() {
    if (!session) return;
    if (!session.isPreview) {
      try {
        await responseJson(await fetch("/api/github?action=logout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "x-changeplane-csrf": session.csrf },
        }));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          // The server session is already gone; clear the stale browser state below.
        } else {
        showToast(error instanceof Error ? error.message : "Sign out failed.");
        return;
        }
      }
    }
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
    window.localStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(RUNS_KEY);
    setRuns({});
    setAccountOpen(false);
    setRepositories([]);
    setRepositoryStatus("idle");
    setSelectedRepository("");
    setPreflightStatus("idle");
    setPreflight(null);
    setPreflightError("");
    setInstallStatus("idle");
    setInstallResult(null);
    setRuntimeStatus("idle");
    setRuntimeError("");
    setByok(EMPTY_BYOK);
    setActiveModel(DEFAULT_PROPOSAL_MODEL);
    setModelConfigured(false);
    setRuntimeUpdate(null);
    setHarness(EMPTY_HARNESS);
    setRulesetPlanStatus("idle");
    setRulesetPlan(null);
    setRulesetPlanError("");
    setWorkspaceOpen(false);
    setPreviewEvidenceOpen(false);
    setBackboneOpen(false);
    setHandbackOpen(false);
    setSession(null);
  }

  async function loadRepositories() {
    if (session?.isPreview) {
      setRepositories(PREVIEW_REPOSITORIES);
      setRepositoryStatus("ready");
      return;
    }
    setRepositoryStatus("loading");
    setRepositoryError("");
    try {
      const payload = await responseJson(await fetch("/api/github?action=repos", { credentials: "same-origin" }));
      const nextRepositories = Array.isArray(payload.repositories) ? payload.repositories : [];
      setRepositories(nextRepositories);
      setSelectedRepository((current) => (
        nextRepositories.some(({ fullName }) => fullName === current) ? current : ""
      ));
      setRepositoryStatus("ready");
    } catch (error) {
      setRepositoryError(error instanceof Error ? error.message : "Repositories could not be loaded.");
      setRepositoryStatus("error");
    }
  }

  async function installRepository({ requiredCheck = null, harnessMode = "observe" } = {}) {
    if (!selectedRepository || preflightStatus !== "ready" || !preflight?.installable || installStatus === "installing") return;
    setInstallStatus("installing");
    setInstallError("");
    if (session?.isPreview) {
      const timer = window.setTimeout(() => {
        setInstallResult({
          preview: true,
          repository: selectedRepository,
          branch: "changeplane/observe-setup",
          harnessMode,
        });
        setInstallStatus("complete");
      }, 780);
      timersRef.current.push(timer);
      return;
    }
    try {
      const payload = await responseJson(await fetch("/api/github?action=install", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-changeplane-csrf": session.csrf,
        },
        body: JSON.stringify({ repository: selectedRepository, requiredCheck, harnessMode }),
      }));
      setInstallResult(payload);
      setInstallStatus("complete");
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : "The installation pull request could not be created.");
      setInstallStatus("error");
    }
  }

  async function saveByok(apiKey) {
    if (!selectedRepository || byokSaving) return false;
    const repository = selectedRepository;
    setByokSaving(true);
    setRuntimeError("");
    if (session?.isPreview) {
      const timer = window.setTimeout(() => {
        if (selectedRepositoryRef.current === repository) {
          setByok({ ...EMPTY_BYOK, configured: true, state: "connected", updatedAt: new Date().toISOString() });
          setRuntimeStatus("ready");
          showToast("OpenAI key verified");
        }
        setByokSaving(false);
      }, 520);
      timersRef.current.push(timer);
      return true;
    }
    try {
      const payload = await responseJson(await fetch("/api/github?action=byok", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-changeplane-csrf": session.csrf,
        },
        body: JSON.stringify({ repository, apiKey }),
      }));
      if (selectedRepositoryRef.current === repository) {
        setByok(payload.byok);
        setRuntimeStatus("ready");
        showToast("OpenAI key saved to GitHub Actions");
      }
      return true;
    } catch (error) {
      if (selectedRepositoryRef.current === repository) {
        setRuntimeError(error instanceof Error ? error.message : "The provider key could not be secured.");
        setRuntimeStatus("error");
      }
      return false;
    } finally {
      setByokSaving(false);
    }
  }

  async function prepareRulesetPlan(assuranceLevel = "strict_head") {
    if (!selectedRepository || session?.isPreview || rulesetPlanStatus === "loading" || rulesetPlanStatus === "applying") return;
    const repository = selectedRepository;
    setRulesetPlanStatus("loading");
    setRulesetPlan(null);
    setRulesetPlanError("");
    try {
      const payload = await responseJson(await fetch(
        `/api/github?action=ruleset-plan&repository=${encodeURIComponent(repository)}&assuranceLevel=${encodeURIComponent(assuranceLevel)}`,
        { credentials: "same-origin", cache: "no-store" },
      ));
      if (selectedRepositoryRef.current !== repository) return;
      setRulesetPlan(payload.plan);
      setRulesetPlanStatus(payload.plan?.action === "none" ? "applied" : "ready");
    } catch (error) {
      if (selectedRepositoryRef.current !== repository) return;
      setRulesetPlanError(error instanceof Error ? error.message : "The exact Ruleset plan could not be prepared.");
      setRulesetPlanStatus("error");
    }
  }

  async function applyRulesetPlan() {
    if (!selectedRepository || session?.isPreview || rulesetPlanStatus !== "ready" || rulesetPlan?.action !== "create") return;
    const repository = selectedRepository;
    const approvedPlan = rulesetPlan;
    setRulesetPlanStatus("applying");
    setRulesetPlanError("");
    try {
      const payload = await responseJson(await fetch("/api/github?action=ruleset-apply", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-changeplane-csrf": session.csrf,
        },
        body: JSON.stringify({
          repository,
          assuranceLevel: approvedPlan.assuranceLevel,
          planDigest: approvedPlan.planDigest,
        }),
      }));
      if (selectedRepositoryRef.current !== repository) return;
      setHarness((current) => ({ ...current, enforcement: payload.enforcement }));
      setRulesetPlanStatus("applied");
      showToast(payload.enforcement?.assuranceLevel === "queue_certified"
        ? "Queue Certified is active"
        : "Strict Head is active");
      setPreflightRefresh((value) => value + 1);
    } catch (error) {
      if (selectedRepositoryRef.current !== repository) return;
      setRulesetPlanError(error instanceof Error ? error.message : "The approved Ruleset plan could not be applied.");
      setRulesetPlanStatus("error");
    }
  }

  async function changeRuntimeModel(model) {
    if (!selectedRepository || modelSaving || !SUPPORTED_PROPOSAL_MODELS.includes(model)) return;
    const repository = selectedRepository;
    setModelSaving(true);
    setRuntimeError("");
    try {
      const payload = await responseJson(await fetch("/api/github?action=runtime", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-changeplane-csrf": session.csrf,
        },
        body: JSON.stringify({ repository, model }),
      }));
      if (selectedRepositoryRef.current === repository) {
        setRuntimeUpdate(payload);
        if (payload.state === "current") setActiveModel(model);
        showToast(payload.state === "current" ? `${model} is already active` : `Runtime PR created for ${model}`);
      }
    } catch (error) {
      if (selectedRepositoryRef.current === repository) {
        setRuntimeError(error instanceof Error ? error.message : "The runtime pull request could not be created.");
      }
    } finally {
      setModelSaving(false);
    }
  }

  async function changeHarnessMode(mode) {
    if (!selectedRepository || modelSaving || !["observe", "verify", "autonomous"].includes(mode)) return;
    const repository = selectedRepository;
    setModelSaving(true);
    setRuntimeError("");
    try {
      const payload = await responseJson(await fetch("/api/github?action=runtime", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-changeplane-csrf": session.csrf,
        },
        body: JSON.stringify({ repository, model: activeModel, harnessMode: mode }),
      }));
      if (selectedRepositoryRef.current === repository) {
        setRuntimeUpdate(payload);
        if (payload.state === "current") {
          setHarness((current) => ({ ...current, mode, ready: mode === "autonomous" }));
        }
        showToast(payload.state === "current" ? `${mode} mode is already active` : `Harness PR created for ${mode} mode`);
      }
    } catch (error) {
      if (selectedRepositoryRef.current === repository) {
        setRuntimeError(error instanceof Error ? error.message : "The harness pull request could not be created.");
      }
    } finally {
      setModelSaving(false);
    }
  }

  async function disconnectByok() {
    if (!selectedRepository || byokSaving) return;
    const repository = selectedRepository;
    setByokSaving(true);
    setRuntimeError("");
    if (session?.isPreview) {
      if (selectedRepositoryRef.current === repository) {
        setByok(EMPTY_BYOK);
        showToast("OpenAI key removed from GitHub Actions");
      }
      setByokSaving(false);
      return;
    }
    try {
      const payload = await responseJson(await fetch("/api/github?action=byok", {
        method: "DELETE",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-changeplane-csrf": session.csrf,
        },
        body: JSON.stringify({ repository }),
      }));
      if (selectedRepositoryRef.current === repository) {
        setByok(payload.byok);
        setRuntimeStatus("ready");
        showToast("OpenAI key removed from GitHub Actions");
      }
    } catch (error) {
      if (selectedRepositoryRef.current === repository) {
        setRuntimeError(error instanceof Error ? error.message : "The provider key could not be disconnected.");
        setRuntimeStatus("error");
      }
    } finally {
      setByokSaving(false);
    }
  }

  function resetInstall() {
    setInstallResult(null);
    setInstallStatus("idle");
    setInstallError("");
    setSelectedRepository("");
  }

  function refreshPreflight() {
    if (!selectedRepository || preflightStatus === "loading") return;
    setPreflightStatus("loading");
    setPreflightError("");
    setPreflightRefresh((value) => value + 1);
  }

  function recheckInstall() {
    if (!selectedRepository || preflightStatus === "loading") return;
    setInstallResult(null);
    setInstallStatus("idle");
    setInstallError("");
    refreshPreflight();
  }

  function setRunStep(id, status, head = undefined, headSha = undefined) {
    setRuns((current) => ({
      ...current,
      [id]: {
        ...current[id],
        status,
        ...(head ? { head } : {}),
        ...(headSha ? {
          headSha,
          intentHeadSha: headSha,
          changeHeadSha: headSha,
          evidenceHeadSha: status === "passed" ? headSha : null,
        } : {}),
        updatedAt: new Date().toISOString(),
      },
    }));
  }

  function startRun(id) {
    if (id !== "route") return;
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
    setSelectedId(id);
    setFilter(FILTERS[0]);
    setRunStep(id, "binding", CHANGES[0].initialHead, CHANGES[0].initialHeadSha);
    showToast("Binding exact commit 71b04c2");
    const sequence = [
      [550, "failing", "Synthetic service-window failure reconstructed"],
      [1_150, "proposing", "Reconstructing one bounded GPT-5.6 Luna proposal"],
      [1_850, "validating", "Projecting clean-harness validation"],
      [2_450, "applying", "Projecting the trusted-controller apply boundary"],
      [3_050, "rechecking", "Reconstructed head 9fc82a1 · projecting fresh evidence", CHANGES[0].repairedHead, CHANGES[0].repairedHeadSha],
      [3_650, "publishing", "Exact-head evidence passed · reconstructing guard eligibility", CHANGES[0].repairedHead, CHANGES[0].repairedHeadSha],
      [4_250, "passed", "Synthetic contract matched on 9fc82a1 · no external write", CHANGES[0].repairedHead, CHANGES[0].repairedHeadSha],
    ];
    timersRef.current = sequence.map(([delay, status, message, head, headSha]) => window.setTimeout(() => {
      setRunStep(id, status, head, headSha);
      showToast(message);
    }, delay));
  }

  function replayRun(id) {
    setRuns((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    window.setTimeout(() => startRun(id), 80);
  }

  async function copyHead(head) {
    try {
      await navigator.clipboard.writeText(head);
      showToast("Revision copied");
    } catch {
      showToast(`Revision ${head}`);
    }
  }

  async function copyHandback(payload) {
    try {
      await navigator.clipboard.writeText(payload);
      showToast("Agent handback copied");
    } catch {
      showToast("Handback ready to copy from the payload panel");
    }
  }

  if (!session) {
    return (
      <>
        <LoginScreen
          authStatus={authStatus}
          configured={githubConfigured}
          authMode={githubAuthMode}
          rolloutMode={githubRolloutMode}
          ownerEntry={CANARY_OWNER_ENTRY}
          error={authError}
          isSigningIn={isSigningIn}
          onSignIn={signIn}
          onAuthorize={authorizeExisting}
          onExplore={exploreProduct}
          onOpenLab={() => setAssuranceLabOpen(true)}
        />
        {assuranceLabOpen && <AssuranceLabDrawer onClose={() => setAssuranceLabOpen(false)} />}
      </>
    );
  }

  if (!workspaceOpen || !session.isPreview) {
    return (
      <GitHubSetup
        session={session}
        repositories={repositories}
        repositoryStatus={repositoryStatus}
        repositoryError={repositoryError}
        selectedRepository={selectedRepository}
        onSelectRepository={(repository) => {
          if (installStatus === "installing" || byokSaving) return;
          if (repository === selectedRepository) {
            refreshPreflight();
            return;
          }
          selectedRepositoryRef.current = repository;
          setSelectedRepository(repository);
          setPreflightStatus("loading");
          setPreflight(null);
          setPreflightError("");
          setInstallError("");
        }}
        onRetryRepositories={loadRepositories}
        preflightStatus={preflightStatus}
        preflight={preflight}
        preflightError={preflightError}
        onRetryPreflight={refreshPreflight}
        installStatus={installStatus}
        installError={installError}
        installResult={installResult}
        runtimeStatus={runtimeStatus}
        runtimeError={runtimeError}
        byok={byok}
        activeModel={activeModel}
        modelConfigured={modelConfigured}
        modelSaving={modelSaving}
        runtimeUpdate={runtimeUpdate}
        harness={harness}
        byokSaving={byokSaving}
        onSaveByok={saveByok}
        onDisconnectByok={disconnectByok}
        onChangeModel={changeRuntimeModel}
        onChangeHarness={changeHarnessMode}
        rulesetPlanStatus={rulesetPlanStatus}
        rulesetPlan={rulesetPlan}
        rulesetPlanError={rulesetPlanError}
        onPrepareRuleset={prepareRulesetPlan}
        onApplyRuleset={applyRulesetPlan}
        onInstall={installRepository}
        onRecheckInstall={recheckInstall}
        onResetInstall={resetInstall}
        onOpenWorkspace={() => setWorkspaceOpen(true)}
        onSignOut={signOut}
      />
    );
  }

  return (
    <div className="app-stage">
      <div className={`product-shell ${session.isPreview ? "has-preview-boundary" : ""}`}>
        <header className="topbar">
          <div className="brand-block">
            <a className="brand" href="#top" aria-label="ChangePlane home">ChangePlane</a>
            <span className="topbar-divider" aria-hidden="true" />
            <span className="repo-name">{change.repo}</span>
            <span aria-hidden="true">·</span>
            <span>{session.isPreview ? "Proposed change" : `PR #${change.pr}`}</span>
          </div>
          <div className="topbar-actions">
            <div className="topbar-menu-wrap">
              <button className="policy-switcher" type="button" aria-expanded={policyOpen} onClick={() => { setPolicyOpen((open) => !open); setAccountOpen(false); }}>
                <span>Policy</span><strong>Release Governance v3</strong><CaretDown size={15} />
              </button>
              {policyOpen && (
                <div className="policy-popover">
                  <p>Repository policy</p>
                  <strong>Release Governance v3</strong>
                  <span><CheckCircle size={15} weight="fill" /> Loaded from the trusted base</span>
                  <dl>
                    <div><dt>Revision</dt><dd>Exact head</dd></div>
                    <div><dt>Evidence</dt><dd>1 required check</dd></div>
                    <div><dt>Blocked paths</dt><dd>1 group</dd></div>
                    <div><dt>Assurance memory</dt><dd>Repository-owned</dd></div>
                  </dl>
                </div>
              )}
            </div>
            <span className="topbar-divider" aria-hidden="true" />
            <span className="connection-label"><i /> {session.isPreview ? "Synthetic contract reconstruction" : "GitHub connected"}</span>
            <span className="date-label"><CalendarBlank size={18} /> Jul 20, 2026 · synthetic reconstruction</span>
            <span className="topbar-divider" aria-hidden="true" />
            <button className="icon-button" type="button" aria-label="Assurance workflow" onClick={() => setGuideOpen(true)}><Question size={19} /></button>
            <div className="topbar-menu-wrap">
              <button className="account-button" type="button" aria-label="Account menu" aria-expanded={accountOpen} onClick={() => { setAccountOpen((open) => !open); setPolicyOpen(false); }}>{session.initials}</button>
              {accountOpen && (
                <div className="account-menu">
                  <div className="account-menu-head"><span className="avatar">{session.initials}</span><span><strong>{session.name}</strong><small>@{session.handle}</small></span></div>
                  <div className="account-org"><UserCircle size={16} /><span>{session.organization}<small>{session.role}</small></span></div>
                  <button type="button" onClick={signOut}><SignOut size={17} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>

        {session.isPreview && (
          <div className="preview-boundary-banner">RouteThai use case · synthetic contract reconstruction · no production systems accessed</div>
        )}

        <div className="app-grid" id="top">
          <Queue changes={changes} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setInspectedFile(null); }} filter={filter} onFilter={setFilter} />
          <Workspace
            key={`workspace-${change.id}`}
            change={change}
            isPreview={session.isPreview}
            onInspect={setInspectedFile}
            onInspectHandback={() => setHandbackOpen(true)}
            onRun={startRun}
          />
          <AssuranceRail
            key={`rail-${change.id}`}
            change={change}
            isPreview={session.isPreview}
            onReplay={replayRun}
            onCopy={copyHead}
            onPreview={() => setPreviewEvidenceOpen(true)}
            onBackbone={() => setBackboneOpen(true)}
            onShowSetup={() => setWorkspaceOpen(false)}
          />
        </div>
      </div>

      <FileDialog file={inspectedFile} onClose={() => setInspectedFile(null)} />
      {guideOpen && <GuideDrawer onClose={() => setGuideOpen(false)} onStart={() => { setSelectedId("route"); setGuideOpen(false); }} />}
      {previewEvidenceOpen && <PreviewEvidenceDrawer change={change} onClose={() => setPreviewEvidenceOpen(false)} onCopy={copyHead} />}
      {backboneOpen && <BackboneDrawer change={change} onClose={() => setBackboneOpen(false)} />}
      {handbackOpen && <AgentHandbackDrawer change={change} onClose={() => setHandbackOpen(false)} onCopy={copyHandback} />}
      <div className={`toast ${toast ? "is-visible" : ""}`} role="status" aria-live="polite"><CheckCircle size={18} weight="fill" />{toast}</div>
    </div>
  );
}

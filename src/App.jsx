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
import { ApiError, responseJson } from "./lib/api-client.js";
import {
  BYOK_SECRET_NAME,
  DEFAULT_PROPOSAL_MODEL,
  PROPOSAL_REASONING_EFFORT,
  SUPPORTED_PROPOSAL_MODELS,
} from "./lib/runtime.js";

const POLICY = {
  requireApproval: [".github/workflows/**", "migrations/**", "infra/**"],
  block: ["secrets/**"],
};

const REVISION = {
  policyDigest: "policy-release-governance-v3",
  inputDigest: "scope-and-files-v2",
};

const PAGE_QUERY = new URLSearchParams(window.location.search);
const PREVIEW_MODE = import.meta.env.DEV || PAGE_QUERY.has("preview");
const CANARY_OWNER_ENTRY = PAGE_QUERY.get("access") === "canary-owner";
const GITHUB_ENTRY_ERROR = {
  owner_required: "This owner-controlled canary is not available to that GitHub account.",
  owner_ambiguous: "More than one owner installation was found. Review the GitHub App installations before trying again.",
  authorization_cancelled: "GitHub authorization was cancelled. Nothing was connected or changed. Try again when you are ready.",
}[PAGE_QUERY.get("github")] ?? "";
const SESSION_KEY = "changeplane.preview-session.v3";
const RUNS_KEY = "changeplane.autonomous-runs.v1";
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
  autonomousAvailable: false,
  ready: false,
  maxAttempts: 2,
  budgetMinutes: 15,
};
const PREVIEW_PREFLIGHT = {
  repositoryState: "active",
  installable: true,
  conflicts: [],
  setupFiles: 16,
  evidenceOptions: [{ name: "test", appSlug: "github-actions", suggested: true }],
  harness: { autonomousAvailable: true, maxAttempts: 2, budgetMinutes: 15 },
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
    reportedImpact: "The new commit passed the same service-window test that caught the failure.",
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
    plannedFiles: 3,
    files: [
      { path: "src/routing/heuristic.ts", add: 34, remove: 11, scope: "In scope", evidenceRelevant: true },
      { path: "src/routing/service-window.ts", add: 12, remove: 4, scope: "In scope" },
      { path: "src/routing/service-window.test.ts", add: 61, remove: 0, scope: "In scope" },
    ],
  },
];

const PIPELINE = [
  ["contract", "Bind exact head"],
  ["evidence", "Reproduce failure"],
  ["proposal", "Luna proposes patch"],
  ["validation", "Validate cleanly"],
  ["apply", "Trusted apply"],
  ["recheck", "Check new head"],
  ["check", "Publish PASS"],
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

function LoginScreen({ authStatus, configured, authMode, rolloutMode, ownerEntry, error, isSigningIn, onSignIn, onAuthorize, onExplore }) {
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
            <p className="auth-kicker"><span /> Assurance for agent-written code</p>
            <h1>Keep GitHub.<br />Let agents ship.</h1>
            <p>ChangePlane verifies every agent pull request against the exact commit before GitHub decides what ships.</p>
          </div>

          <div className="auth-signal" aria-label="Automatic pull request workflow">
            <div className="auth-signal-heading">
              <span><i /> Runs on every pull request update</span>
              <time>Inside GitHub</time>
            </div>
            <div className="auth-signal-row">
              <div>
                <strong>{exampleOnly
                  ? "See a real assurance loop without connecting a repository."
                  : "Agent opens PR → ChangePlane verifies → GitHub decides"}</strong>
                <span>{exampleOnly
                  ? "Synthetic RouteThai case · recorded Luna evidence"
                  : "Works with Codex, Cursor, Claude Code, and other coding agents"}</span>
              </div>
              <span className="auth-pass-label">{exampleOnly ? "No repository access" : "Autonomous by policy"}</span>
            </div>
          </div>
        </div>

        <div className="auth-access">
          <div className="auth-form">
            <p className="auth-eyebrow">{exampleOnly ? "Public example" : "GitHub-native setup"}</p>
            <h2 id="sign-in-title">{exampleOnly ? "See how assurance works." : "Make every agent PR prove it works."}</h2>
            <p>{exampleOnly
              ? "Replay one synthetic routing failure from failed evidence to a verified new commit. Nothing connects to GitHub."
              : "Connect a repository, bind one real test, and merge one setup pull request. ChangePlane handles the normal path from then on."}</p>

            {error && <p className="auth-error" role="alert"><Warning size={16} weight="fill" /> {error}</p>}

            {exampleOnly ? (
              <button className={`github-sign-in ${isSigningIn ? "is-loading" : ""}`} type="button" onClick={onExplore} disabled={isSigningIn}>
                {isSigningIn ? <ArrowsClockwise className="spin" size={20} weight="bold" aria-hidden="true" /> : <Play size={19} weight="fill" aria-hidden="true" />}
                <span>{isSigningIn ? "Opening workspace…" : "Open RouteThai example workspace"}</span>
                {!isSigningIn && <ArrowRight size={18} aria-hidden="true" />}
              </button>
            ) : (
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
                <span>{isSigningIn ? "Opening GitHub…" : buttonLabel}</span>
                {!isSigningIn && !checking && canConnect && <ArrowRight size={18} aria-hidden="true" />}
              </button>
            )}

            {authMode === "github_app" && canConnect && (!controlledCanary || ownerEntry) && (
              <button className="github-existing" type="button" onClick={onAuthorize} disabled={isSigningIn}>
                {controlledCanary ? "Canary owner sign in" : "Already installed? Sign in with GitHub"}
              </button>
            )}

            {!exampleOnly && (
              <button className="github-existing" type="button" onClick={onExplore} disabled={isSigningIn}>
                View RouteThai example
              </button>
            )}

            <p className="auth-security"><LockKey size={15} /> {controlledCanary
              ? "The example never accesses GitHub. Private canary access can see only the pre-authorized disposable repository."
              : exampleOnly
              ? "Synthetic data only. The public example cannot push, merge, or deploy."
              : authMode === "github_app"
                ? "Bring your own OpenAI key. It stays encrypted in GitHub Actions and powers only bounded patch proposals."
                : "Choose one repository. ChangePlane writes only through a setup pull request."}</p>
            {controlledCanary ? (
              <p className="auth-deployment-note">New GitHub installations stay closed while the private canary is validated.</p>
            ) : exampleOnly ? (
              <p className="auth-deployment-note">Recorded autonomous run · synthetic data · no live repository access.</p>
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
            <span>{checking ? "Checking connection" : controlledCanary ? "Private canary" : configured ? authMode === "github_app" ? "GitHub App" : "GitHub OAuth" : exampleOnly ? "No repository access" : "GitHub not configured"}</span>
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
          <strong>{isCurrent ? "Setup complete" : needsOwnerReview ? "Owner review needed" : needsRetry ? "Retry repository check" : `Merge ${isUpgrade ? "upgrade" : "setup"} PR`}</strong>
          <small>{isCurrent
            ? "No repository change is needed"
            : needsOwnerReview
              ? "ChangePlane stopped before writing"
              : needsRetry
                ? "The read-only check did not finish"
            : isUpgrade
              ? "Current installation stays active until merge"
              : "Nothing starts before GitHub shows it merged"}</small>
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
  autonomyReady,
  saving,
  onSave,
  onDisconnect,
  onChangeModel,
  onChangeHarness,
}) {
  const [apiKey, setApiKey] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const connected = Boolean(byok?.configured);
  const permissionRequired = byok?.state === "permission_required";
  const showForm = (!connected || replaceOpen) && !permissionRequired;
  useEffect(() => {
    setApiKey("");
    setReplaceOpen(false);
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
          <div><p className="runtime-kicker">Recorded canary evidence</p><h3 id="runtime-funding-title">GPT-5.6 Luna</h3></div>
          <span className="runtime-model">Read only</span>
        </div>
        <div className="runtime-option runtime-option-managed">
          <span className="runtime-option-icon"><ShieldCheck size={17} weight="fill" /></span>
          <div className="runtime-option-copy">
            <div><strong>Public replay boundary</strong><span className="runtime-badge is-verified">Synthetic</span></div>
            <p>No API key field or live selector is exposed here. The public workspace replays redacted evidence from the controlled canary.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="runtime-funding" aria-labelledby="runtime-funding-title">
      <div className="runtime-heading">
        <div>
          <p className="runtime-kicker">Autonomous harness</p>
          <h3 id="runtime-funding-title">Repair only when proof fails</h3>
        </div>
        <span className="runtime-model">{activeModel || RUNTIME.modelId}</span>
      </div>

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
          {runtimeConfigurable && harness?.autonomousAvailable && (
            <button
              className="text-action"
              type="button"
              onClick={() => onChangeHarness(harness?.mode === "autonomous" ? "observe" : "autonomous")}
              disabled={modelSaving || (harness?.mode !== "autonomous" && !connected)}
            >
              {harness?.mode === "autonomous" ? "Switch to observe with config PR" : "Enable with config PR"} <ArrowRight size={13} />
            </button>
          )}
          {!runtimeConfigurable && autonomyReady && <p className="runtime-inline-note">The setup pull request will enable this harness.</p>}
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
              {connected ? "Connected" : permissionRequired ? "Permission needed" : "Available"}
            </span>
          </div>
          <p>Your key is checked once, encrypted with GitHub's repository key, and saved only as <code>{RUNTIME.secretName}</code> in GitHub Actions.</p>

          {!repositorySelected && <p className="runtime-inline-note">Select a repository before connecting a provider key.</p>}
          {permissionRequired && <p className="runtime-error" role="alert"><Warning size={14} weight="fill" /> Reconnect the GitHub App with Actions Secrets write permission before adding a key.</p>}
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
          <small className="runtime-observe-note">Required for autonomous proposals. Disconnecting it makes repair fail closed.</small>
        </div>
      </div>
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
  const [behaviorConfirmed, setBehaviorConfirmed] = useState(false);
  const evidenceOptions = Array.isArray(preflight?.evidenceOptions) ? preflight.evidenceOptions : [];
  const matchingRepositories = repositories.filter((repository) => (
    repository.fullName.toLowerCase().includes(query.trim().toLowerCase())
  ));
  const selected = repositories.find(({ fullName }) => fullName === selectedRepository);
  const complete = Boolean(installResult);
  const installationState = preflight?.installation?.state ?? "fresh";
  const isUpgrade = installationState === "outdated";
  const isCurrent = installationState === "current";
  const needsOwnerReview = installationState === "conflict";
  const preflightFailed = Boolean(selected && preflightStatus === "error");
  const preflightReady = preflightStatus === "ready" && preflight?.installable;
  const pendingSetup = preflight?.setup?.state === "pending" && preflight.setup.pullRequest?.url;
  const pendingUpgrade = pendingSetup && preflight?.setup?.operation === "upgrade";
  const preflightTone = preflightStatus === "ready" && !preflightReady && !isCurrent
    ? "attention"
    : preflightStatus;
  const preflightBlocked = Boolean(selected && preflightStatus === "ready" && !preflightReady && !isCurrent);
  const evidenceReady = isUpgrade || pendingSetup || evidenceMode === "scope"
    || (checkName.trim() && checkPublisher.trim() && behaviorConfirmed);
  const requestedHarnessMode = evidenceMode === "behavior" ? "autonomous" : "observe";
  const autonomyReady = session.isPreview || Boolean(
    preflight?.harness?.autonomousAvailable
    && byok?.configured
    && evidenceMode === "behavior"
    && checkName.trim()
    && checkPublisher.trim()
    && behaviorConfirmed
  );
  const repositoryMutationBusy = installStatus === "installing" || byokSaving;

  useEffect(() => {
    if (preflightStatus !== "ready") {
      setEvidenceMode("behavior");
      setCheckName("");
      setCheckPublisher("github-actions");
      setBehaviorConfirmed(false);
      return;
    }
    const suggested = evidenceOptions.find((option) => option.suggested) ?? evidenceOptions[0];
    setEvidenceMode(suggested ? "behavior" : "scope");
    setCheckName(suggested?.name ?? "");
    setCheckPublisher(suggested?.appSlug ?? "github-actions");
    setBehaviorConfirmed(false);
  }, [preflight, preflightStatus, selectedRepository]);

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
              <p><strong>The model never receives GitHub authority.</strong><span>A separate harness validates, applies, and rechecks one exact revision.</span></p>
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
                    <div><strong>Loading writable repositories</strong><span>Reading repository names and permissions from GitHub.</span></div>
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
                        ? harness?.mode === "autonomous" ? "Autonomous" : "Observe"
                        : requestedHarnessMode === "autonomous" ? "Autonomous" : "Observe"}</strong></div>
                      <div><span>Change</span><strong>{isCurrent
                        ? "None needed"
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
                            ? "Checking repository safety"
                            : isCurrent
                              ? "Setup is merged. ChangePlane is ready."
                              : preflightFailed
                                ? "Read-only check could not finish"
                              : preflightReady
                              ? pendingSetup
                                ? pendingUpgrade ? "Upgrade PR already ready" : "Setup PR already ready"
                                : isUpgrade ? "Upgrade ready" : "Ready to install"
                              : "Setup needs attention"}</strong>
                          <span>{!selected
                            ? "Nothing is accessed until you make a selection."
                            : preflightStatus === "loading"
                            ? "Read-only checks. Nothing is being changed."
                            : isCurrent
                              ? `Managed version ${preflight.installation.currentVersion} is up to date. Your project policy remains repository-owned.`
                            : preflightFailed
                              ? preflightError || "Repository safety could not be checked."
                            : preflightReady
                              ? pendingSetup
                                ? pendingUpgrade
                                  ? "Open the existing upgrade PR to review the managed-file update."
                                  : preflight.setup.requiredCheck
                                    ? `The existing PR binds ${preflight.setup.requiredCheck.name} from ${preflight.setup.requiredCheck.appSlug}. Open it to review and merge; no new write is needed.`
                                    : "The existing PR is explicitly scope-only. Open it to review and merge; no new write is needed."
                              : isUpgrade
                                ? `Update managed files to version ${preflight.installation.targetVersion} without changing your policy.`
                              : evidenceOptions.length > 0
                                  ? `Found ${evidenceOptions.length} recent GitHub check${evidenceOptions.length === 1 ? "" : "s"}. A likely test is selected; confirm what it protects below.`
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
                          <li><Check size={13} weight="bold" /> {isUpgrade || isCurrent ? "Policy stays repository-owned" : "No direct default-branch write"}</li>
                          <li><Check size={13} weight="bold" /> {isUpgrade || isCurrent ? "Managed files are versioned" : "Nothing runs before merge"}</li>
                        </ul>
                      )}
                      {preflight?.setup?.state === "stale" && preflight.setup.pullRequest?.url && (
                        <a className="safety-preflight-recovery" href={preflight.setup.pullRequest.url} target="_blank" rel="noreferrer">
                          Open PR #{preflight.setup.pullRequest.number}, choose Close pull request, then Delete branch <ArrowRight size={13} />
                        </a>
                      )}
                      {preflightReady && !isUpgrade && preflight?.evidenceDiscovery?.state === "unavailable" && (
                        <button className="evidence-retry" type="button" onClick={onRetryPreflight}>
                          <ArrowsClockwise size={13} weight="bold" /> Try check discovery again
                        </button>
                      )}
                    </div>

                    {preflightReady && !pendingSetup && !isUpgrade && (
                      <fieldset className="evidence-choice">
                        <legend>Choose what the first receipt proves</legend>
                        <label className={evidenceMode === "behavior" ? "is-selected" : ""}>
                          <input type="radio" name="evidence-mode" value="behavior" checked={evidenceMode === "behavior"} onChange={() => setEvidenceMode("behavior")} />
                          <span><strong>Code behavior</strong><small>{evidenceOptions.length > 0 ? "Suggested from recent GitHub runs" : "Advanced · bind an existing automated test"}</small></span>
                        </label>
                        {evidenceMode === "behavior" && (
                          <div className="evidence-fields">
                            {evidenceOptions.length > 0 && (
                              <label className="evidence-detected">
                                <span>Use a test from GitHub</span>
                                <select
                                  value={`${checkName}\0${checkPublisher}`}
                                  onChange={(event) => {
                                    const [name, appSlug] = event.target.value.split("\0");
                                    setCheckName(name);
                                    setCheckPublisher(appSlug);
                                    setBehaviorConfirmed(false);
                                  }}
                                >
                                  {evidenceOptions.map((option) => (
                                    <option key={`${option.name}\0${option.appSlug}`} value={`${option.name}\0${option.appSlug}`}>
                                      {option.name} · {option.appSlug}{option.suggested ? " (suggested)" : ""}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                            <details>
                              <summary>{evidenceOptions.length > 0 ? "Advanced · use a different check" : "Advanced · add a check manually"}</summary>
                              {evidenceOptions.length === 0 && <p>Open a recent pull request in GitHub, choose <strong>Checks</strong>, and copy the meaningful test name. GitHub Actions usually uses <code>github-actions</code> as the publisher.</p>}
                              <div className="evidence-manual">
                                <label><span>Exact check name</span><input value={checkName} onChange={(event) => { setCheckName(event.target.value); setBehaviorConfirmed(false); }} placeholder="For example: test" maxLength={100} /></label>
                                <label><span>Publisher</span><input value={checkPublisher} onChange={(event) => { setCheckPublisher(event.target.value); setBehaviorConfirmed(false); }} placeholder="github-actions" maxLength={100} /></label>
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
                    )}

                    {selected && runtimeStatus === "ready" && (
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
                        autonomyReady={autonomyReady}
                        saving={byokSaving}
                        onSave={onSaveByok}
                        onDisconnect={onDisconnectByok}
                        onChangeModel={onChangeModel}
                        onChangeHarness={onChangeHarness}
                      />
                    )}

                    {installError && <p className="install-error" role="alert"><Warning size={16} weight="fill" /> {installError}</p>}

                    {preflightStatus === "loading" ? null : pendingSetup ? (
                      <>
                        <a className="primary-action install-action" href={preflight.setup.pullRequest.url} target="_blank" rel="noreferrer">
                          <GitBranch size={17} weight="bold" /> Open existing {pendingUpgrade ? "upgrade" : "setup"} PR <ArrowRight size={16} />
                        </a>
                        <button className="text-action" type="button" onClick={onRetryPreflight}>I merged it — check this repository</button>
                      </>
                    ) : isCurrent ? (
                      <a className="primary-action install-action" href={`https://github.com/${selected.fullName}/pulls`} target="_blank" rel="noreferrer">
                        <GithubLogo size={17} weight="fill" /> Open project pull requests <ArrowRight size={16} />
                      </a>
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
                          ? { name: checkName.trim(), appSlug: checkPublisher.trim() }
                          : null,
                        harnessMode: requestedHarnessMode,
                      })} disabled={!selected || !preflightReady || !evidenceReady
                        || (requestedHarnessMode === "autonomous" && !autonomyReady)
                        || installStatus === "installing"}>
                        {installStatus === "installing" ? <ArrowsClockwise className="spin" size={17} weight="bold" /> : <GitBranch size={17} weight="bold" />}
                        {installStatus === "installing"
                          ? session.isPreview ? "Preparing installation flow…" : `Creating ${isUpgrade ? "upgrade" : "installation"} pull request…`
                          : isUpgrade
                            ? "Create upgrade PR"
                            : session.isPreview
                              ? "Preview autonomous setup"
                              : requestedHarnessMode === "autonomous"
                                ? "Enable autonomous harness"
                                : "Create observe setup PR"}
                      </button>
                    )}
                    <p className="install-note">{session.isPreview
                      ? "No repository is accessed. The production action creates the same single setup pull request."
                      : pendingSetup
                        ? pendingUpgrade
                          ? "Open the verified upgrade pull request. Your current installation remains active; the managed update starts only after merge."
                          : "Open the verified setup pull request. Nothing runs until you review and merge it."
                        : isCurrent
                          ? "No test PR is required, and you do not return to ChangePlane for every pull request. On the next real pull request, open Checks and find ChangePlane / guard."
                          : preflightFailed
                            ? "Nothing was changed. Retry the read-only check without reconnecting or choosing the repository again."
                          : needsOwnerReview
                            ? "ChangePlane stopped before writing. Ask a repository owner to compare the listed managed files with the intended installation."
                            : preflightBlocked
                              ? "ChangePlane stopped before writing. Resolve the repository state shown above, then run the read-only check again."
                          : isUpgrade
                            ? "Creates one upgrade pull request for pristine managed files only. Your policy is never included."
                            : requestedHarnessMode === "autonomous" && !autonomyReady
                              ? "Connect an OpenAI key and confirm one meaningful test. ChangePlane will not enable autonomous repair without both."
                              : "Creates one installation pull request. Nothing runs until you review and merge it; closing the PR stops installation."}</p>
                  </>
                )}
              </>
            ) : (
              <div className="install-success" role="status">
                <span className="success-mark"><Check size={24} weight="bold" /></span>
                <p className="auth-eyebrow">{installResult.preview ? "Setup preview ready" : installResult.operation === "upgrade" ? "Upgrade PR created" : "Setup PR created"}</p>
                <h2 id="setup-title">{installResult.preview
                  ? "Autonomous setup prepared"
                  : installResult.operation === "upgrade" ? "Review the managed upgrade" : "One last step in GitHub"}</h2>
                <p>{installResult.preview
                  ? "In production, the next GitHub pull request update starts ChangePlane automatically. This example did not access or change a repository."
                  : installResult.operation === "upgrade"
                    ? "Open the upgrade pull request and review the managed-file changes. Your .changeplane.json policy is not included."
                    : "Open the setup pull request, review the generated ChangePlane files, and merge it. The setup PR itself is not checked; the first normal pull request opened or updated afterward receives ChangePlane / guard."}</p>

                <dl className="install-result-facts">
                  <div><dt>Repository</dt><dd>{installResult.repository}</dd></div>
                  <div><dt>Branch</dt><dd>{installResult.branch}</dd></div>
                  <div><dt>Mode</dt><dd>{installResult.harnessMode === "autonomous" ? "Autonomous" : "Observe"}</dd></div>
                  <div><dt>Repository write</dt><dd>{installResult.operation === "upgrade" ? "Upgrade pull request only" : "Setup pull request only"}</dd></div>
                  {!installResult.preview && <div><dt>Activation</dt><dd>{installResult.operation === "upgrade" ? "Current installation stays active until merge" : "Not active until this PR is merged"}</dd></div>}
                </dl>

                {installResult.preview ? (
                  <button className="primary-action success-action" type="button" onClick={onOpenWorkspace}>Inspect an automatic assurance canary <ArrowRight size={17} /></button>
                ) : (
                  <>
                    <a className="primary-action success-action" href={installResult.pullRequest.url} target="_blank" rel="noreferrer">
                      Open {installResult.operation === "upgrade" ? "upgrade" : "setup"} PR on GitHub <ArrowRight size={17} />
                    </a>
                    <button className="text-action" type="button" onClick={onRecheckInstall}>I merged it — check this repository</button>
                  </>
                )}
                {!installResult.preview && <p className="install-note">{installResult.operation === "upgrade"
                  ? "Your current installation remains active; the managed update becomes active only after this pull request is merged."
                  : <span>Setup is working when <code>ChangePlane / guard</code> appears on the latest commit of a normal pull request.</span>}</p>}
                <section className="activation-checklist" aria-labelledby="activation-title">
                  <strong id="activation-title">{installResult.preview ? "In a real installation, after merge" : installResult.operation === "upgrade" ? "Finish the upgrade in GitHub" : "Finish activation in GitHub"}</strong>
                  <ol>
                    <li><span>1</span><p>Merge the {installResult.operation === "upgrade" ? "upgrade" : "setup"} pull request.</p></li>
                    <li><span>2</span><p>Open or update one normal pull request, then open its <strong>Checks</strong> tab.</p></li>
                    <li><span>3</span><p>Choose <code>ChangePlane / guard</code>. <strong>PASS</strong> is published only for the latest exact commit after the bound test succeeds. Fixable failures use the bounded harness automatically.</p></li>
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

function displayState(status) {
  if (RUNNING_STATES.has(status)) return { state: "running", label: "Checking" };
  if (status === "passed") return { state: "pass", label: "Check passed" };
  if (status === "blocked") return { state: "blocked", label: "Exception" };
  return { state: "ready", label: "Ready to check" };
}

function StatusMark({ status, compact = false }) {
  const { state, label } = displayState(status);
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
              <StatusMark status={change.status} compact />
              <time>{change.timeLabel}</time>
            </span>
          </button>
        ))}
        {visible.length === 0 && <p className="empty-state">No changes in this view.</p>}
      </div>

      <div className="queue-foot">
        <span>Harness policy</span>
        <strong>Autonomous</strong>
        <small>Human only on exceptions</small>
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
      ["pass", "Allowed files recorded", `${change.base.split(" ")[0]} → ${change.head}`],
      ["pass", "Project tests passed", "126 tests · 42s"],
      ["blocked", "Sensitive-file rule matched", "secrets/**"],
    ];
  }
  if (change.status === "passed") {
    return [
      ["warning", "Synthetic service-window evidence failed", `${change.initialHead} · one stop scheduled after window`],
      ["pass", "GPT-5.6 Luna proposed a bounded patch", "1 file · model had no Check, push, merge, or PASS authority"],
      ["pass", "Clean validation accepted the patch", "Allowed paths · fresh worktree · attempt 1 of 2"],
      ["pass", "Trusted controller applied the patch", `${change.initialHead} → ${change.head}`],
      ["pass", "Exact new head passed", `ChangePlane / guard · ${change.head}`],
    ];
  }
  const stages = [
    ["binding", "Bind exact head and allowed paths", `${change.initialHead} · ${change.scope}`],
    ["failing", "Reproduce synthetic service-window failure", "One stop scheduled after its allowed window"],
    ["proposing", "Ask GPT-5.6 Luna for a unified diff", "Failure evidence + allowed-path source only"],
    ["validating", "Validate patch in a clean harness", "Paths · stale head · attempt budget"],
    ["applying", "Trusted controller applies accepted patch", "Credential separated from model job"],
    ["rechecking", "Dispatch exact-head recheck", change.repairedHead],
    ["publishing", "Publish ChangePlane / guard", "PASS on the new exact head"],
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

function Workspace({ change, isPreview, onInspect }) {
  const { state, label } = displayState(change.status);
  const automationLabel = change.status === "blocked" ? "Exception only" : "Zero-touch eligible";
  const actualFiles = change.files.filter(({ resolved }) => !resolved).length;
  const drift = actualFiles - change.plannedFiles;
  const routeFacts = change.id === "route";
  return (
    <main className="workspace">
      <div className="workspace-title-row">
        <div>
          <p className="workspace-kicker">{isPreview ? "Synthetic RouteThai example" : `${change.changeId} · PR #${change.pr} · ${automationLabel}`}</p>
          <h1 id="workspace-main-title" tabIndex={-1}>{change.title}</h1>
        </div>
        <span className={`decision-pill pill-${state}`}>{label}</span>
      </div>

      <dl className="change-summary">
        <div>
          <dt>Summary</dt>
          <dd>{change.summary}</dd>
        </div>
        <div>
          <dt>Outcome</dt>
          <dd>{change.status === "passed" && change.reportedImpact ? change.reportedImpact : change.impact}</dd>
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
        <div><dt>Risk</dt><dd>{change.risk} · {change.riskLabel}</dd></div>
        {routeFacts ? (
          <>
            <div><dt>Version</dt><dd className="mono">{change.head}</dd></div>
            <div className={change.status === "failing" ? "has-drift" : ""}><dt>Evidence</dt><dd>{change.status === "passed" ? "PASS · new exact head" : RUNNING_STATES.has(change.status) ? "Replay in progress" : "Ready"}</dd></div>
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
  if (change.status === "passed") {
    return (
      <div className="decision-notice notice-pass">
        <GitMerge size={22} weight="fill" aria-hidden="true" />
        <div><strong>Verified on {change.head}</strong><p>The same service-window test now passes. GitHub still decides whether to merge.</p></div>
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
      failing: ["Service-window test failed", "One synthetic stop was scheduled too late."],
      proposing: ["Luna is proposing a bounded fix", "The model sees the failure and allowed source files—not GitHub credentials."],
      validating: ["Validating the fix", "A clean job checks the patch, file scope, commit, and attempt limit."],
      applying: ["Applying the validated fix", "A separate trusted controller applies the accepted patch."],
      rechecking: ["Checking the new commit", `The same evidence is running on ${change.repairedHead}.`],
      publishing: ["Publishing the result", `ChangePlane / guard is being published on ${change.repairedHead}.`],
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
      <div><strong>Ready to verify</strong><p>ChangePlane will reproduce the failure, validate Luna's fix, and check the new commit before publishing a result.</p></div>
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
  if (change.status === "passed") {
    return {
      label: "Canary evidence matched",
      detail: "Request and commit metadata redacted",
      receipt: "Included",
      tone: "pass",
    };
  }
  if (RUNNING_STATES.has(change.status)) {
    return {
      label: "Canary evidence replaying",
      detail: "No live request from this page",
      receipt: "Pending verification",
      tone: "active",
    };
  }
  return {
    label: "Canary evidence ready",
    detail: "Synthetic data only",
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
      label: change.status === "proposing" ? "Luna proposes. ChangePlane decides." : "Independent verification running",
      detail: "The model cannot push, merge, or publish a result",
      summary: "GPT-5.6 Luna may propose a diff, but the clean deterministic harness and trusted controller independently own validation, apply, and the result.",
      tone: "active",
    };
  }
  if (change.status === "passed") {
    return {
      label: "New commit verified independently",
      detail: `${change.initialHead} → ${change.head}`,
      summary: "Luna proposed one bounded patch. A clean job validated it, a separate controller applied it, and only fresh evidence on the new exact head produced PASS.",
      tone: "pass",
    };
  }
  return {
    label: "Assurance ready",
    detail: "Exact commit · trusted test · bounded fix",
    summary: "The coding agent supplies the pull request. The model can propose a patch, while the deterministic harness and trusted controller independently own the outcome.",
    tone: "ready",
  };
}

function MetaRows({ change }) {
  const rows = [
    ["Origin", change.origin],
    ["Executor", change.agent],
    ["Base", change.base],
    ["Head", change.head],
    ["Risk", `${change.risk} · ${change.riskLabel}`],
    ["Policy", "Release Governance v3 · protected paths"],
    ["Evidence source", change.id === "route" ? "synthetic-service-window · github-actions" : "configured checks · github-actions"],
    ["Proposal model", "gpt-5.6-luna · high"],
    ["Evaluator", "ChangePlane guard v1"],
    ["Receipt", change.status === "passed" ? "Recorded canary · PASS" : "Recorded autonomous run"],
    ["Human", change.status === "blocked" ? "Required" : "0 actions"],
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

function AssuranceRail({ change, isPreview, onRun, onReplay, onCopy, onPreview, onBackbone, onShowSetup }) {
  const running = RUNNING_STATES.has(change.status);
  const preview = previewEvidenceFor(change);
  const backbone = backboneStateFor(change);
  const railRef = useRef(null);

  useEffect(() => {
    if (change.status === "passed" && railRef.current) {
      railRef.current.scrollTop = 0;
    }
  }, [change.status]);

  return (
    <aside className="decision-rail" aria-label="Change receipt details" ref={railRef}>
      <div className="rail-heading">
        <div><p>{isPreview ? "Assurance replay" : `${change.changeId} · report only`}</p><h2>Result</h2></div>
        <span className="mode-live"><i /> {isPreview ? "Synthetic" : "Connected"}</span>
      </div>
      <AssuranceNotice change={change} />

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
          <span><strong>{preview.label}</strong><small>GPT-5.6 Luna · recorded canary evidence</small></span>
          <CaretRight size={16} aria-hidden="true" />
        </button>
      </div>

      {change.status === "ready" && (
        <button className="primary-action run-action" type="button" onClick={() => onRun(change.id)}>
          <Play size={17} weight="fill" /> Start recorded autonomous run
        </button>
      )}
      {running && (
        <button className="primary-action run-action" type="button" disabled>
          <ArrowsClockwise className="spin" size={17} weight="bold" /> Verifying change
        </button>
      )}
      {change.status === "passed" && change.id === "route" && (
        <div className="result-actions">
          <button className="secondary-action run-action" type="button" onClick={() => onReplay(change.id)}>
            <ArrowsClockwise size={17} /> Replay autonomous run
          </button>
          {isPreview && (
            <button className="setup-link-action" type="button" onClick={onShowSetup}>
              Set up your repository <ArrowRight size={15} />
            </button>
          )}
        </div>
      )}

      <ol className="run-pipeline" aria-label="Assurance pipeline">
        {PIPELINE.map(([key, label]) => {
          const stage = pipelineState(change.status, key);
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
        <div className="rail-section-title"><h3>Bound inputs</h3><button className="copy-button" type="button" onClick={() => onCopy(change.head)} aria-label="Copy exact version"><Copy size={16} /></button></div>
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
        <p className="eyebrow">Normal user journey</p>
        <h2 id="guide-title">No handoff to ChangePlane.</h2>
        <p className="guide-intro">A platform lead installs once. After that, GitHub pull request events trigger the assurance loop; developers stay in their coding agent and GitHub.</p>
        <ol className="guide-steps">
          <li><span>01</span><div><strong>Platform lead · once</strong><p>Bind one meaningful test, add a BYOK key, and merge one trusted harness setup PR. No developer installs a new CLI or changes coding tools.</p></div></li>
          <li><span>02</span><div><strong>Coding agent · normal workflow</strong><p>Codex, Claude Code, Cursor, or another agent opens or updates the pull request with its declared goal and scope.</p></div></li>
          <li><span>03</span><div><strong>Luna · proposal only</strong><p>Receives bounded failure evidence and allowed-path source, then returns only a unified diff without GitHub credentials.</p></div></li>
          <li><span>04</span><div><strong>ChangePlane · independent result</strong><p>A clean harness validates, a trusted controller applies, and only a fresh exact-head recheck may publish PASS.</p></div></li>
        </ol>
        <button className="primary-action guide-primary" type="button" onClick={onStart}>Replay the exact-revision check <ArrowRight size={17} /></button>
      </section>
    </div>
  );
}

function PreviewEvidenceDrawer({ change, onClose, onCopy }) {
  const dialogRef = useDialogFocus(true, onClose);
  const preview = previewEvidenceFor(change);
  const accepted = preview.receipt === "Included";
  return (
    <div className="file-overlay" role="dialog" aria-modal="true" aria-labelledby="preview-evidence-title">
      <button className="overlay-scrim" type="button" onClick={onClose} aria-label="Close preview evidence" />
      <section className="guide-drawer preview-drawer" ref={dialogRef} tabIndex={-1}>
        <button className="dialog-close" type="button" onClick={onClose} aria-label="Close" data-dialog-initial><X size={18} /></button>
        <GithubLogo size={28} weight="duotone" aria-hidden="true" />
        <p className="eyebrow">Recorded canary evidence</p>
        <h2 id="preview-evidence-title">{accepted ? "Canary evidence bound to" : "Canary replay at"} {change.head}</h2>
        <p className="guide-intro">The public workspace makes no model or GitHub request. It replays redacted evidence from the disposable canary using the same synthetic RouteThai fixture and exact-head contract.</p>

        <dl className="preview-evidence-facts">
          <div><dt>Source</dt><dd>Disposable GitHub canary</dd></div>
          <div><dt>Model</dt><dd>gpt-5.6-luna</dd></div>
          <div><dt>Data</dt><dd>Synthetic route fixture</dd></div>
          <div><dt>Signal</dt><dd>exact-head recheck</dd></div>
          <div><dt>Exact head</dt><dd className="mono">{change.head}</dd></div>
          <div><dt>Receipt</dt><dd className={`preview-receipt-${preview.tone}`}>{preview.receipt}</dd></div>
        </dl>

        <div className="preview-evidence-note">
          <ShieldCheck size={20} weight="fill" aria-hidden="true" />
          <div><strong>{preview.label}</strong><p>{preview.detail}. Request IDs and timestamps are redacted; no customer, coordinate, or private repository data appears.</p></div>
        </div>

        <div className="preview-drawer-actions">
          <button className="secondary-action" type="button" onClick={() => onCopy(change.head)}><Copy size={16} /> Copy exact revision</button>
          <button className="primary-action" type="button" onClick={onClose}>Back to receipt</button>
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
        <p className="guide-intro" id="backbone-intro">The controlled canary separates proposal, clean validation, trusted apply, and exact-head Check publication. This public replay does not invoke a model in your browser.</p>

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
  const timersRef = useRef([]);
  const autoReplayRef = useRef(false);

  useEffect(() => {
    if (!session) return;
    const targetId = workspaceOpen ? "workspace-main-title" : "setup-main-title";
    window.requestAnimationFrame(() => document.getElementById(targetId)?.focus());
  }, [workspaceOpen, session]);

  useEffect(() => {
    selectedRepositoryRef.current = selectedRepository;
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
        setHarness({ ...EMPTY_HARNESS, ...payload.harness });
        setRuntimeStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setRuntimeError(error instanceof Error ? error.message : "Agent runtime status could not be loaded.");
        setRuntimeStatus("error");
      });
    return () => { cancelled = true; };
  }, [session, selectedRepository]);

  useEffect(() => {
    if (session?.isPreview) window.localStorage.setItem(RUNS_KEY, JSON.stringify(runs));
  }, [runs, session]);

  useEffect(() => () => timersRef.current.forEach(window.clearTimeout), []);

  useEffect(() => {
    if (!session?.isPreview || !workspaceOpen || runs.route || autoReplayRef.current) return undefined;
    autoReplayRef.current = true;
    const timer = window.setTimeout(() => startRun("route"), 450);
    timersRef.current.push(timer);
    return undefined;
  }, [runs.route, session, workspaceOpen]);

  const changes = useMemo(() => CHANGES.map((item) => {
    const record = runs[item.id];
    const status = record?.status ?? item.initialStatus;
    const head = record?.head ?? item.head;
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
    return { ...item, status, head, files, analysis: result, timeLabel };
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
      autoReplayRef.current = false;
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
    autoReplayRef.current = false;
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
    setWorkspaceOpen(false);
    setPreviewEvidenceOpen(false);
    setBackboneOpen(false);
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
    if (!selectedRepository || modelSaving || !["observe", "autonomous"].includes(mode)) return;
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

  function setRunStep(id, status, head = undefined) {
    setRuns((current) => ({
      ...current,
      [id]: {
        ...current[id],
        status,
        ...(head ? { head } : {}),
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
    setRunStep(id, "binding", CHANGES[0].initialHead);
    showToast("Binding exact commit 71b04c2");
    const sequence = [
      [550, "failing", "Synthetic service-window evidence reproduced"],
      [1_150, "proposing", "GPT-5.6 Luna proposing one bounded patch"],
      [1_850, "validating", "Clean harness validating paths and patch"],
      [2_450, "applying", "Trusted controller applying accepted patch"],
      [3_050, "rechecking", "New head 9fc82a1 · fresh evidence running", CHANGES[0].repairedHead],
      [3_650, "publishing", "Exact-head evidence passed · publishing ChangePlane / guard", CHANGES[0].repairedHead],
      [4_250, "passed", "Verified on 9fc82a1 · GitHub decides the merge", CHANGES[0].repairedHead],
    ];
    timersRef.current = sequence.map(([delay, status, message, head]) => window.setTimeout(() => {
      setRunStep(id, status, head);
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

  if (!session) {
    return (
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
      />
    );
  }

  if (!workspaceOpen) {
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
                  <p>Receipt policy</p>
                  <strong>Release Governance v3</strong>
                  <span><CheckCircle size={15} weight="fill" /> Loaded from the trusted base</span>
                  <dl>
                    <div><dt>Revision</dt><dd>Exact head</dd></div>
                    <div><dt>Evidence</dt><dd>1 required check</dd></div>
                    <div><dt>Blocked paths</dt><dd>1 group</dd></div>
                  </dl>
                </div>
              )}
            </div>
            <span className="topbar-divider" aria-hidden="true" />
            <span className="connection-label"><i /> {session.isPreview ? "Recorded canary replay" : "GitHub connected"}</span>
            <span className="date-label"><CalendarBlank size={18} /> Jul 20, 2026 · recorded evidence</span>
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
          <div className="preview-boundary-banner">RouteThai production-informed shadow pilot · synthetic data · public replay · no repository access</div>
        )}

        <div className="app-grid" id="top">
          <Queue changes={changes} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setInspectedFile(null); }} filter={filter} onFilter={setFilter} />
          <Workspace key={`workspace-${change.id}`} change={change} isPreview={session.isPreview} onInspect={setInspectedFile} />
          <AssuranceRail
            key={`rail-${change.id}`}
            change={change}
            isPreview={session.isPreview}
            onRun={startRun}
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
      <div className={`toast ${toast ? "is-visible" : ""}`} role="status" aria-live="polite"><CheckCircle size={18} weight="fill" />{toast}</div>
    </div>
  );
}

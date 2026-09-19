import { useEffect, useRef, useState } from "react";
import { ApiError, responseJson } from "./lib/api-client.js";
import { buildSdlcAssurance } from "./lib/sdlc-assurance.js";
import { BYOK_SECRET_NAME, DEFAULT_PROPOSAL_MODEL, SUPPORTED_PROPOSAL_MODELS } from "./lib/runtime.js";
import { SESSION_KEY, PRESENTATION_USER, PREVIEW_REPOSITORIES, PREVIEW_PREFLIGHT } from "./lib/onboarding-replay.js";

const EMPTY_BYOK = Object.freeze({ configured: false, state: "not_connected", secretName: BYOK_SECRET_NAME, updatedAt: null });
export const EMPTY_HARNESS = Object.freeze({
  mode: "observe", verifyAvailable: true, autonomousAvailable: false, ready: false,
  enforcement: { state: "not_installed", assuranceLevel: null, active: false, queueCertified: false,
    strict: false, mergeQueueRequired: false, guardRequired: false, publisherBound: false,
    evidenceRequired: false, evidencePublisherBound: false },
  maxAttempts: 2, budgetMinutes: 15, sdlc: buildSdlcAssurance(),
});

function emptyRepository(name = "") {
  return {
    name,
    preflight: { status: "idle", data: null, error: "" },
    install: { status: "idle", result: null, error: "" },
    runtime: { status: "idle", error: "", byok: EMPTY_BYOK, activeModel: DEFAULT_PROPOSAL_MODEL,
      modelConfigured: false, modelSaving: false, byokSaving: false, update: null, harness: EMPTY_HARNESS },
    protection: { status: "idle", plan: null, error: "" },
  };
}

function sessionFor({ login, csrf, authMode = "oauth" }) {
  return { name: login, handle: login, organization: "GitHub", role: "Repository access",
    initials: login.slice(0, 2).toUpperCase(), csrf, authMode, isPreview: false };
}

function initialState(previewMode, entryError) {
  let session = null;
  if (previewMode) {
    try {
      // Stored presentation state can never restore a hosted account or credentials.
      if (JSON.parse(window.localStorage.getItem(SESSION_KEY))?.isPreview === true) session = PRESENTATION_USER;
    } catch { /* A broken local replay preference starts signed out. */ }
  }
  return {
    account: { session, status: previewMode ? "ready" : "loading", configured: previewMode ? false : null,
      authMode: previewMode ? "example" : "oauth", rolloutMode: previewMode ? "example" : "self_serve",
      error: entryError, signingIn: false, signingOut: false },
    inventory: { items: session ? PREVIEW_REPOSITORIES : [], status: session ? "ready" : "idle", error: "" },
    repository: emptyRepository(),
  };
}

/** Owns Customer Account onboarding, including the lifetime of every request.
 * A repository selection is a new lifetime even for A → B → A. Account changes
 * invalidate all lifetimes. Secrets are passed straight to the request and never
 * enter state or storage; the form clears its own field after every attempt.
 */
export function useCustomerAccount({ previewMode = false, entryError = "", notify }) {
  const [state, setState] = useState(() => initialState(previewMode, entryError));
  const current = useRef(state);
  const lifetime = useRef({ account: 0, repository: 0, operations: new Map() });
  const mounted = useRef(true);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  function update(change) {
    if (!mounted.current) return;
    current.current = change(current.current);
    setState(current.current);
  }
  function accountPatch(patch) {
    update((value) => ({ ...value, account: { ...value.account, ...patch } }));
  }
  function repositoryPatch(section, patch) {
    update((value) => ({ ...value, repository: { ...value.repository,
      [section]: { ...value.repository[section], ...patch } } }));
  }
  function begin(operation, repositoryScoped = true) {
    const token = { account: lifetime.current.account, repository: lifetime.current.repository };
    lifetime.current.operations.set(operation, token);
    return () => mounted.current && lifetime.current.account === token.account
      && (!repositoryScoped || lifetime.current.repository === token.repository)
      && lifetime.current.operations.get(operation) === token;
  }
  function resetRepository(name = "") {
    lifetime.current.repository += 1;
    update((value) => ({ ...value, repository: emptyRepository(name) }));
  }
  async function request(action, { method = "GET", body, query = {}, session = current.current.account.session } = {}) {
    const search = new URLSearchParams({ action, ...query });
    return responseJson(await fetch(`/api/github?${search}`, {
      method, credentials: "same-origin", cache: "no-store",
      ...(method === "GET" ? {} : { headers: { "content-type": "application/json", "x-changeplane-csrf": session?.csrf },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    }));
  }
  const errorMessage = (error, fallback) => error instanceof Error ? error.message : fallback;

  async function loadRepositories() {
    const session = current.current.account.session;
    if (!session || current.current.account.signingOut) return;
    const isCurrent = begin("inventory", false);
    update((value) => ({ ...value, inventory: { ...value.inventory, status: "loading", error: "" } }));
    try {
      const payload = session.isPreview ? { repositories: PREVIEW_REPOSITORIES } : await request("repos");
      if (!isCurrent()) return;
      const items = Array.isArray(payload.repositories) ? payload.repositories : [];
      if (!items.some(({ fullName }) => fullName === current.current.repository.name)) resetRepository();
      update((value) => ({ ...value, inventory: { items, status: "ready", error: "" } }));
    } catch (error) {
      if (isCurrent()) update((value) => ({ ...value, inventory: { ...value.inventory, status: "error",
        error: errorMessage(error, "Repositories could not be loaded.") } }));
    }
  }

  async function loadRepositorySection(section, action, fallback) {
    const { account: { session }, repository: { name } } = current.current;
    if (!session || !name || current.current.account.signingOut) return;
    const isCurrent = begin(section);
    repositoryPatch(section, { status: "loading", error: "" });
    try {
      const payload = session.isPreview
        ? section === "preflight" ? PREVIEW_PREFLIGHT : { byok: EMPTY_BYOK, modelConfigured: true,
          harness: { ...EMPTY_HARNESS, autonomousAvailable: true } }
        : await request(action, { query: { repository: name } });
      if (!isCurrent()) return;
      repositoryPatch(section, section === "preflight"
        ? { status: "ready", data: payload }
        : { status: "ready", byok: payload.byok, activeModel: payload.activeModel || DEFAULT_PROPOSAL_MODEL,
          modelConfigured: Boolean(payload.modelConfigured), update: null,
          harness: { ...EMPTY_HARNESS, ...payload.harness, sdlc: payload.sdlc ?? EMPTY_HARNESS.sdlc } });
    } catch (error) {
      if (isCurrent()) repositoryPatch(section, { status: "error", error: errorMessage(error, fallback) });
    }
  }
  function refreshRepository() {
    // Independent reads start together; each response belongs to this selection.
    void loadRepositorySection("preflight", "preflight", "Repository safety could not be checked.");
    void loadRepositorySection("runtime", "runtime", "Agent runtime status could not be loaded.");
  }
  function selectRepository(name) {
    const { account, inventory, repository } = current.current;
    if (!account.session || account.signingOut || repository.install.status === "installing" || repository.runtime.byokSaving
      || !inventory.items.some((item) => item.fullName === name)) return;
    if (name !== repository.name) resetRepository(name);
    refreshRepository();
  }
  function refreshPreflight() {
    if (current.current.repository.preflight.status !== "loading") refreshRepository();
  }

  useEffect(() => {
    mounted.current = true;
    const isCurrent = begin("session", false);
    if (!previewMode) {
      request("session").then((payload) => {
        if (!isCurrent()) return;
        accountPatch({ configured: Boolean(payload.configured),
          ...(!payload.configured && typeof payload.accessBlock?.message === "string" ? {
            error: [payload.accessBlock.message, payload.accessBlock.nextAction].filter((value) => typeof value === "string").join(" "),
          } : {}),
          authMode: payload.authMode === "github_app" ? "github_app" : "oauth",
          rolloutMode: ["controlled_canary", "private_alpha"].includes(payload.rolloutMode) ? payload.rolloutMode : "self_serve",
          session: payload.authenticated ? sessionFor(payload) : null, status: "ready" });
        void loadRepositories();
      }).catch((error) => {
        if (isCurrent()) accountPatch({ status: "error", error: errorMessage(error, "GitHub setup could not be checked.") });
      });
    }
    return () => { mounted.current = false; lifetime.current.account += 1; };
  }, []);

  function navigateToGitHub(action) {
    const account = current.current.account;
    if (account.signingIn || account.configured !== true || (action === "authorize" && account.authMode !== "github_app")) return;
    accountPatch({ signingIn: true });
    window.location.assign(`/api/github?action=${action}`);
  }
  function explore() {
    if (current.current.account.signingIn) return false;
    lifetime.current.account += 1;
    resetRepository();
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(PRESENTATION_USER));
    accountPatch({ session: PRESENTATION_USER, signingIn: false });
    update((value) => ({ ...value, inventory: { items: PREVIEW_REPOSITORIES, status: "ready", error: "" } }));
    return true;
  }
  async function signOut() {
    const { session, signingOut } = current.current.account;
    if (!session || signingOut) return false;
    // Invalidate at intent, before waiting for logout. A late mutation response
    // must not restore repository state or report success during account teardown.
    lifetime.current.account += 1;
    const isCurrent = begin("logout", false);
    accountPatch({ signingOut: true });
    try {
      if (!session.isPreview) await request("logout", { method: "POST", session });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        if (isCurrent()) {
          accountPatch({ signingOut: false });
          resetRepository(current.current.repository.name);
          refreshRepository();
          void loadRepositories();
          notifyRef.current(errorMessage(error, "Sign out failed."));
        }
        return false;
      }
    }
    if (!isCurrent()) return false;
    resetRepository();
    window.localStorage.removeItem(SESSION_KEY);
    update((value) => ({ ...value, account: { ...value.account, session: null, signingOut: false },
      inventory: { items: [], status: "idle", error: "" } }));
    return true;
  }

  // All mutations share the same selection/account guard and success/error/finally
  // lifetime. In particular, a stale finally cannot unlock a newer operation.
  async function mutate({ operation, section, pending, action, body, success, failure, settled = {} }) {
    const { session, signingOut } = current.current.account;
    const repository = current.current.repository.name;
    if (!session || session.isPreview || signingOut || !repository) return false;
    const isCurrent = begin(operation);
    repositoryPatch(section, pending);
    try {
      const payload = await request(action, { method: action === "byok" && operation === "disconnect" ? "DELETE" : "POST",
        session, body: { repository, ...body } });
      if (!isCurrent()) return false;
      success(payload);
      return true;
    } catch (error) {
      if (isCurrent()) repositoryPatch(section, { ...failure.patch, error: errorMessage(error, failure.message) });
      return false;
    } finally {
      if (isCurrent()) repositoryPatch(section, settled);
    }
  }
  function install({ requiredCheck = null, harnessMode = "observe" } = {}) {
    const repository = current.current.repository;
    if (repository.preflight.status !== "ready" || !repository.preflight.data?.installable || repository.install.status === "installing") return;
    if (current.current.account.session?.isPreview) {
      repositoryPatch("install", { status: "complete", error: "", result: { preview: true, repository: repository.name,
        branch: "changeplane/observe-setup", harnessMode } });
      return;
    }
    return mutate({ operation: "install", section: "install", pending: { status: "installing", error: "" }, action: "install",
      body: { requiredCheck, harnessMode }, success: (result) => repositoryPatch("install", { result, status: "complete" }),
      failure: { message: "The installation pull request could not be created.", patch: { status: "error" } } });
  }
  function updateByok(apiKey, disconnect = false) {
    if (current.current.repository.runtime.byokSaving) return false;
    return mutate({ operation: disconnect ? "disconnect" : "byok", section: "runtime",
      pending: { byokSaving: true, error: "" }, action: "byok", body: disconnect ? {} : { apiKey },
      success: (payload) => {
        // Supersede a read that began before this credential mutation.
        lifetime.current.operations.delete("runtime");
        repositoryPatch("runtime", { byok: payload.byok, status: "ready" });
        notifyRef.current(disconnect ? "OpenAI key removed from GitHub Actions" : "OpenAI key saved to GitHub Actions");
      }, failure: { message: disconnect ? "The provider key could not be disconnected." : "The provider key could not be secured.",
        patch: { status: "error" } }, settled: { byokSaving: false } });
  }
  function configureRuntime(model, mode) {
    if (current.current.repository.runtime.modelSaving || !SUPPORTED_PROPOSAL_MODELS.includes(model)
      || (mode !== undefined && !["observe", "verify", "autonomous"].includes(mode))) return;
    return mutate({ operation: "configureRuntime", section: "runtime", pending: { modelSaving: true, error: "" },
      action: "runtime", body: { model, ...(mode === undefined ? {} : { harnessMode: mode }) },
      success: (payload) => {
        lifetime.current.operations.delete("runtime");
        const runtime = current.current.repository.runtime;
        repositoryPatch("runtime", { status: "ready", update: payload, ...(payload.state === "current" ? mode === undefined
          ? { activeModel: model } : { harness: { ...runtime.harness, mode, ready: mode === "autonomous" } } : {}) });
        notifyRef.current(mode === undefined
          ? payload.state === "current" ? `${model} is already active` : `Runtime PR created for ${model}`
          : payload.state === "current" ? `${mode} mode is already active` : `Harness PR created for ${mode} mode`);
      }, failure: { message: mode === undefined ? "The runtime pull request could not be created." : "The harness pull request could not be created.", patch: {} },
      settled: { modelSaving: false } });
  }
  async function prepareRuleset(assuranceLevel = "strict_head") {
    const { account, repository } = current.current;
    if (!repository.name || !account.session || account.session.isPreview || account.signingOut
      || ["loading", "applying"].includes(repository.protection.status)) return;
    const isCurrent = begin("ruleset");
    repositoryPatch("protection", { status: "loading", plan: null, error: "" });
    try {
      const payload = await request("ruleset-plan", { query: { repository: repository.name, assuranceLevel } });
      if (isCurrent()) repositoryPatch("protection", { plan: payload.plan, status: payload.plan?.action === "none" ? "applied" : "ready" });
    } catch (error) {
      if (isCurrent()) repositoryPatch("protection", { status: "error", error: errorMessage(error, "The exact Ruleset plan could not be prepared.") });
    }
  }
  function applyRuleset() {
    const { status, plan } = current.current.repository.protection;
    if (status !== "ready" || plan?.action !== "create" || plan.canApply !== true) return;
    return mutate({ operation: "ruleset", section: "protection", pending: { status: "applying", error: "" }, action: "ruleset-apply",
      body: { assuranceLevel: plan.assuranceLevel, planDigest: plan.planDigest }, success: (payload) => {
        repositoryPatch("runtime", { harness: { ...current.current.repository.runtime.harness, enforcement: payload.enforcement } });
        const active = ["applied", "already_active"].includes(payload.state) && payload.enforcement?.active;
        repositoryPatch("protection", { status: active ? "applied" : "reconciliation_required",
          error: active ? "" : payload.enforcement?.nextAction || "Wait for GitHub policy propagation, then recheck this repository." });
        if (active) notifyRef.current(payload.enforcement.assuranceLevel === "queue_certified" ? "Queue Certified is active" : "Strict Head is active");
        refreshRepository();
      }, failure: { message: "The approved Ruleset plan could not be applied.", patch: { status: "error" } } });
  }

  return { ...state, actions: {
    signIn: () => navigateToGitHub("login"), authorize: () => navigateToGitHub("authorize"), explore, signOut,
    selectRepository, loadRepositories, refreshPreflight, install,
    resetInstall: () => resetRepository(),
    recheckInstall: () => {
      if (current.current.repository.preflight.status === "loading") return;
      repositoryPatch("install", { result: null, status: "idle", error: "" });
      refreshRepository();
    },
    saveByok: (apiKey) => updateByok(apiKey), disconnectByok: () => updateByok(undefined, true),
    changeModel: (model) => configureRuntime(model),
    changeHarness: (mode) => configureRuntime(current.current.repository.runtime.activeModel, mode),
    prepareRuleset, applyRuleset,
  } };
}

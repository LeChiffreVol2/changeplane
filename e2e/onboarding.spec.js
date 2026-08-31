import { expect, test } from "@playwright/test";

const APP_ORIGIN = "http://127.0.0.1:43117";
const MANAGED_VERSION = 13;
const INITIAL_HEAD_SHA = "71b04c2e8a5d3101cce89d4f0a0b13273f2b631d";
const REPAIRED_HEAD_SHA = "9fc82a1b650d7a77340588f1b04f8ca4e788e7a2";
const PAYLOAD_PROFILES = Object.freeze({
  verifyLite: {
    managedProfile: "verify-lite",
    files: 9,
    repairAuthority: false,
    providerKeyRequired: false,
  },
  autonomous: {
    managedProfile: "full",
    files: 21,
    repairAuthority: true,
    providerKeyRequired: true,
  },
});

function json(route, payload, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function mockLocalApi(page, handler) {
  const externalRequests = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== APP_ORIGIN) {
      externalRequests.push(url.href);
      await route.abort("blockedbyclient");
      return;
    }
    if (url.pathname === "/api/github") {
      await handler(route, url);
      return;
    }
    await route.continue();
  });
  return externalRequests;
}

test("controlled-canary public root reconstructs the synthetic RouteThai contract from failed head to PASS on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const externalRequests = await mockLocalApi(page, (route, url) => {
    expect(url.searchParams.get("action")).toBe("session");
    return json(route, {
      configured: true,
      authenticated: false,
      authMode: "github_app",
      rolloutMode: "controlled_canary",
    });
  });

  await page.goto("/?github=authorization_cancelled");

  await expect(page.getByRole("heading", { name: "See the SDLC assurance spine." })).toBeVisible();
  await expect(page.getByText("ChangePlane keeps intent, review, evidence, and delivery tied to the exact commit", { exact: false })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("GitHub authorization was cancelled");
  await expect(page.getByText("RouteThai use case · synthetic contract reconstruction")).toHaveCount(1);
  const exampleButton = page.getByRole("button", { name: "Open RouteThai example workspace" });
  await expect(exampleButton).toBeVisible();
  await expect(page.getByRole("button", { name: /Install ChangePlane|Canary owner sign in/u })).toHaveCount(0);
  await expect(page.getByText("New GitHub installations stay closed while the private canary is validated.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await exampleButton.focus();
  await expect(exampleButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Keep every stop inside its service window" })).toBeFocused();
  await expect(page.locator(".preview-boundary-banner")).toHaveText("RouteThai use case · synthetic contract reconstruction · no production systems accessed");
  await expect(page.getByRole("heading", { name: "Independent roles" })).toBeVisible();
  await expect(page.locator(".authority-map")).toContainText("Coding agent");
  await expect(page.locator(".authority-map")).toContainText("Deterministic harness");
  await expect(page.locator(".authority-map")).toContainText("GitHub");
  await expect(page.locator(".authority-map")).toContainText("Portable evidence, never portable authority.");
  await expect(page.getByLabel(`Exact head ${INITIAL_HEAD_SHA}`)).toHaveText("71b04c2");
  await expect(page.locator(".decision-pill")).toHaveText("Ready to check");
  await expect(page.getByRole("heading", { name: "Every handoff stays on one exact revision." })).toBeVisible();
  await expect(page.getByLabel(`Full revision ${INITIAL_HEAD_SHA}`)).toHaveText("71b04c2");
  await expect(page.locator(".revision-stage")).toHaveCount(7);
  await expect(page.getByText("Scroll for all seven checkpoints")).toBeVisible();
  const readyVerifyTab = page.getByRole("tab", { name: "Verify: Ready" });
  await expect(readyVerifyTab).toHaveAttribute("aria-selected", "true");
  await readyVerifyTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Delivery: Not observed" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Delivery: Not observed" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Operate: Not observed" }).click();
  await expect(page.locator(".revision-stage-detail")).toContainText("Production health, incidents, SLOs, promotion, and rollback are outside this receipt.");
  await expect(page.getByRole("button", { name: /service-window\.test/u })).toHaveCount(0);
  const verifyButton = page.getByRole("button", { name: "Reconstruct exact-head assurance" });
  await expect(verifyButton).toBeVisible();
  let buttonBox = await verifyButton.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox.y).toBeGreaterThanOrEqual(0);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(844);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  buttonBox = await verifyButton.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox.y).toBeGreaterThanOrEqual(0);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(900);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByRole("button", { name: "Inspect agent handback" }).click();
  await expect(page.getByRole("dialog", { name: "Any coding agent can take the next turn." })).toBeVisible();
  await expect(page.locator(".handback-facts")).toContainText("71b04c2");
  await expect(page.locator(".handback-facts")).toContainText("src/routing/**");
  await expect(page.locator(".handback-authority")).toContainText("pushfalse");
  await expect(page.locator(".handback-authority")).toContainText("checkfalse");
  await expect(page.locator(".handback-authority")).toContainText("mergefalse");
  await expect(page.locator(".handback-authority")).toContainText("passfalse");
  await page.getByText("Inspect machine-readable payload").click();
  await expect(page.locator(".handback-payload pre")).toContainText("BEHAVIORAL_EVIDENCE_FAILED");
  await page.getByRole("button", { name: "Back to change" }).click();

  await page.waitForTimeout(600);
  await expect(page.locator(".decision-pill")).toHaveText("Ready to check");
  await verifyButton.click();
  await expect(page.locator(".decision-pill")).toHaveText("Checking");
  await expect(page.getByText("GPT-5.6 Luna · synthetic contract evidence")).toBeVisible();
  await expect(page.locator(".decision-pill")).toHaveText("Synthetic contract matched");
  await expect(page.getByLabel(`Exact head ${REPAIRED_HEAD_SHA}`)).toHaveText("9fc82a1");
  await expect(page.getByLabel(`Full revision ${REPAIRED_HEAD_SHA}`)).toHaveText("9fc82a1");
  await expect(page.getByRole("button", { name: "Run the reconstruction again" })).toBeVisible();
  await expect(page.getByText("Synthetic contract matched on 9fc82a1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Independent review" })).toBeVisible();
  await expect(page.locator(".review-boundary")).toContainText("ChangePlane / review");
  await expect(page.locator(".review-boundary")).toContainText("ChangePlane / guard");
  const headPreview = page.getByRole("button", { name: /Preview bound to exact head/u });
  await expect(headPreview).toBeVisible();
  await headPreview.click();
  await expect(page.getByRole("dialog", { name: /Synthetic evidence reconstructed for 9fc82a1/u })).toBeVisible();
  await expect(page.locator(".preview-evidence-facts")).toContainText("Exact-head match");
  await expect(page.getByLabel(`Full exact head ${REPAIRED_HEAD_SHA}`)).toHaveText("9fc82a1");
  await expect(page.getByRole("button", { name: "Copy full exact revision" })).toBeVisible();
  await page.getByRole("button", { name: "Back to receipt" }).click();
  await expect(page.getByText("Reconstructed exact head is guard-eligible")).toBeVisible();
  await expect(page.locator("time").filter({ hasText: "No external write · 9fc82a1" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Verify: Verified" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Review: Stale omitted" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Delivery: Exact SHA" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Merge: Ready for GitHub" })).toBeVisible();
  await page.getByRole("tab", { name: "Review: Stale omitted" }).click();
  await expect(page.locator(".revision-stage-detail")).toContainText("belongs to another revision");
  await page.getByRole("tab", { name: "Delivery: Exact SHA" }).click();
  await expect(page.locator(".revision-stage-detail")).toContainText("informational only");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(externalRequests).toEqual([]);
});

test("self-serve root explains organization approval recovery without changing access", async ({ page }) => {
  const externalRequests = await mockLocalApi(page, (route, url) => {
    expect(url.searchParams.get("action")).toBe("session");
    return json(route, {
      configured: true,
      authenticated: false,
      authMode: "github_app",
      rolloutMode: "self_serve",
    });
  });

  await page.goto("/?github=installation_missing");

  await expect(page.getByRole("alert")).toContainText("wait for an owner to approve it");
  await expect(page.getByRole("button", { name: "Install ChangePlane on GitHub" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Already installed? Continue with GitHub" })).toBeVisible();
  await expect(page.getByText("Organization access may require owner approval.", { exact: false })).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("public Cursor Origin drawer proves the GitHub boundary without claiming native Origin support", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const externalRequests = await mockLocalApi(page, (route, url) => {
    expect(url.searchParams.get("action")).toBe("session");
    return json(route, {
      configured: true,
      authenticated: false,
      authMode: "github_app",
      rolloutMode: "self_serve",
    });
  });

  await page.goto("/");
  const openProof = page.getByRole("button", { name: "Run the synthetic Origin boundary proof" });
  await expect(openProof).toBeVisible();
  await openProof.focus();
  await expect(openProof).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Synthetic GitHub-mirrored Origin boundary proof" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".origin-proof-summary")).toContainText("6 / 6 boundary assertions passed");
  await expect(dialog.locator(".origin-proof-summary")).toContainText("12 / 12 contract cases matched");
  await expect(dialog.locator(".origin-proof-summary")).toContainText("Origin cases3");
  await expect(dialog.locator(".origin-proof-summary")).toContainText("External requests0");
  await expect(dialog.locator(".origin-proof-assertions li")).toHaveCount(6);
  await expect(dialog.locator(".origin-proof-assertions li", { hasText: "MATCH" })).toHaveCount(6);

  const unsupported = dialog.locator(".origin-proof-unsupported");
  await expect(unsupported).toContainText("Standalone Origin");
  await expect(unsupported).toContainText("Unsupported");
  await expect(unsupported).toContainText("Not tested · not counted as proof");

  await expect(dialog.locator(".assurance-lab-case")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /Authoring surface\s*3/u })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: /All cases\s*12/u }).click();
  await expect(dialog.locator(".assurance-lab-case")).toHaveCount(12);
  await expect(dialog.getByText("12 shown", { exact: true })).toBeVisible();

  const exactHeadCase = dialog.locator(".assurance-lab-case").filter({ hasText: "Origin mirror · exact GitHub head" });
  await exactHeadCase.locator("summary").click();
  await expect(exactHeadCase.locator("dl")).toContainText("Guard publicationEligible (not published)");

  const staleHeadCase = dialog.locator(".assurance-lab-case").filter({ hasText: "Origin mirror · stale visible head" });
  await staleHeadCase.locator("summary").click();
  await expect(staleHeadCase.locator("dl")).toContainText("STALE_HEAD");
  await expect(staleHeadCase.locator("dl")).toContainText("Guard publicationNot eligible");
  await expect(staleHeadCase.locator("dl")).toContainText("Merge authoritygithub");

  const originOverview = dialog.getByRole("link", { name: "Cursor Origin" });
  const mirrorDocs = dialog.getByRole("link", { name: "GitHub mirroring" });
  const originApi = dialog.getByRole("link", { name: "Origin API" });
  await expect(originOverview).toBeVisible();
  await expect(originOverview).toHaveAttribute("href", "https://cursor.com/docs/origin");
  await expect(mirrorDocs).toBeVisible();
  await expect(mirrorDocs).toHaveAttribute("href", "https://cursor.com/docs/origin/mirror-github");
  await expect(originApi).toBeVisible();
  await expect(originApi).toHaveAttribute("href", "https://cursor.com/docs/api/origin");
  await expect(page).toHaveURL(`${APP_ORIGIN}/`);

  await expect(dialog.locator(".origin-proof-limit")).toContainText("does not prove that ChangePlane is faster");
  await expect(dialog.locator(".origin-proof-limit")).toContainText("Standalone Origin repositories remain unsupported");
  await expect(dialog.locator(".origin-proof-summary")).toContainText("No GitHub or Origin API request was made");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  const closeProof = dialog.getByRole("button", { name: "Close Origin boundary proof" });
  await expect(closeProof).toBeVisible();
  await closeProof.click();
  await expect(dialog).toHaveCount(0);
  await expect(openProof).toBeFocused();
  expect(externalRequests).toEqual([]);
});

test("production preview query cannot bypass server session resolution", async ({ page }) => {
  let sessionRequests = 0;
  const externalRequests = await mockLocalApi(page, (route, url) => {
    const action = url.searchParams.get("action");
    if (action === "session") {
      sessionRequests += 1;
      return json(route, {
        configured: true,
        authenticated: true,
        login: "connected-owner",
        csrf: "local-csrf",
        authMode: "github_app",
        rolloutMode: "self_serve",
      });
    }
    if (action === "repos") return json(route, { repositories: [] });
    throw new Error(`Unexpected local API action: ${action}`);
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("changeplane.preview-session.v3", JSON.stringify({
      name: "Synthetic user",
      handle: "synthetic",
      initials: "SY",
      isPreview: true,
    }));
  });

  await page.goto("/?preview=1");

  await expect(page.getByRole("heading", { name: "One repository. One setup PR." })).toBeVisible();
  await expect(page.locator(".app-stage")).toHaveCount(0);
  await expect(page.getByText("RouteThai use case · synthetic contract reconstruction")).toHaveCount(0);
  expect(sessionRequests).toBe(1);
  expect(externalRequests).toEqual([]);
});

test("write collaborators cannot reach autonomous expansion before owner activation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let connected = false;
  let byokMutations = 0;
  const externalRequests = await mockLocalApi(page, async (route, url) => {
    const action = url.searchParams.get("action");
    if (action === "session") {
      return json(route, {
        configured: true,
        authenticated: connected,
        login: connected ? "writer" : null,
        csrf: connected ? "local-csrf" : null,
        authMode: "github_app",
        rolloutMode: "self_serve",
      });
    }
    if (action === "login") {
      connected = true;
      return route.fulfill({ status: 302, headers: { location: "/?connected=1" }, body: "" });
    }
    if (action === "repos") {
      return json(route, { repositories: [{
        fullName: "acme/writer-api",
        private: true,
        defaultBranch: "main",
        permissions: { push: true, admin: false },
      }] });
    }
    if (action === "preflight") {
      return json(route, {
        repositoryState: "active",
        installation: {
          state: "current",
          currentVersion: MANAGED_VERSION,
          targetVersion: MANAGED_VERSION,
          managedProfile: "verify-lite",
          conflicts: [],
        },
        installable: false,
        conflicts: [],
        setupFiles: 0,
        setupProfile: "verify-lite",
        payloadProfiles: PAYLOAD_PROFILES,
        setup: { state: "current", managedVersion: MANAGED_VERSION },
        evidenceOptions: [],
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
      });
    }
    if (action === "runtime" || action === "byok" && route.request().method() === "GET") {
      return json(route, {
        provider: "openai",
        activeModel: "gpt-5.6-luna",
        modelConfigured: true,
        managedProfile: "verify-lite",
        autonomousUpgradeRequired: true,
        harness: {
          mode: "verify",
          autonomousAvailable: false,
          ready: false,
          enforcement: {
            source: "ruleset",
            state: "admin_required",
            active: false,
            strict: false,
            guardRequired: false,
            publisherBound: false,
          },
          maxAttempts: 2,
          budgetMinutes: 15,
        },
        managed: { state: "reserved", available: false, providerVerified: false, executionReady: false },
        byok: { configured: false, state: "admin_required", secretName: "OPENAI_API_KEY", updatedAt: null },
      });
    }
    if (action === "byok") {
      byokMutations += 1;
      return json(route, { error: "unexpected secret mutation" }, 500);
    }
    throw new Error(`Unexpected local API action: ${action}`);
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Install ChangePlane on GitHub" }).click();
  await page.getByRole("radio", { name: /acme\/writer-api/u }).click();

  await expect(page.locator(".app-stage")).toHaveCount(0);
  await expect(page.getByText("RouteThai use case · synthetic contract reconstruction")).toHaveCount(0);
  await expect(page.getByText("Verify Lite · managed v13")).toBeVisible();
  await expect(page.getByRole("heading", { name: "One evidence spine. Existing tools keep their authority." })).toBeVisible();
  await expect(page.locator(".sdlc-map-stage")).toHaveCount(7);
  await expect(page.locator(".sdlc-map-stage").filter({ hasText: "Operate" })).toContainText("External");
  await expect(page.locator(".sdlc-map-boundary")).toContainText("GitHub owns merge");
  await expect(page.getByLabel("OpenAI API key")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Explore Autonomous repair/u })).toHaveCount(0);
  await expect(page.getByText(/Autonomous expansion remains unavailable until the Verify Lite setup is merged and the qualifying Ruleset gate is active/u)).toBeVisible();
  await expect(page.getByLabel("OpenAI API key")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save to GitHub" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open project pull requests" })).toBeVisible();
  expect(byokMutations).toBe(0);
  expect(externalRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("fresh setup never exposes direct Autonomous even when controller capacity exists", async ({ page }) => {
  let connected = false;
  let installRequests = 0;
  let byokMutations = 0;
  const externalRequests = await mockLocalApi(page, async (route, url) => {
    const action = url.searchParams.get("action");
    if (action === "session") {
      return json(route, {
        configured: true,
        authenticated: connected,
        login: connected ? "admin" : null,
        csrf: connected ? "local-csrf" : null,
        authMode: "github_app",
        rolloutMode: "self_serve",
      });
    }
    if (action === "login") {
      connected = true;
      return route.fulfill({ status: 302, headers: { location: "/?connected=1" }, body: "" });
    }
    if (action === "repos") {
      return json(route, { repositories: [{
        fullName: "acme/non-strict-api",
        private: true,
        defaultBranch: "main",
        permissions: { push: true, admin: true },
      }] });
    }
    if (action === "preflight") {
      return json(route, {
        repositoryState: "active",
        installation: { state: "fresh", currentVersion: null, targetVersion: MANAGED_VERSION, conflicts: [] },
        installable: true,
        conflicts: [],
        setupFiles: 9,
        setupProfile: "verify-lite",
        payloadProfiles: PAYLOAD_PROFILES,
        setup: { state: "none" },
        evidenceOptions: [{ name: "CI / test", appSlug: "github-actions", workflowPath: ".github/workflows/ci.yml", suggested: true }],
        harness: { autonomousAvailable: true, maxAttempts: 2, budgetMinutes: 15 },
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
      });
    }
    if (action === "runtime") {
      return json(route, {
        provider: "openai",
        activeModel: "gpt-5.6-luna",
        modelConfigured: true,
        managedProfile: "full",
        harness: { mode: "observe", autonomousAvailable: true, ready: false, maxAttempts: 2, budgetMinutes: 15 },
        managed: { state: "reserved", available: false, providerVerified: false, executionReady: false },
        byok: { configured: true, state: "connected", secretName: "OPENAI_API_KEY", updatedAt: null },
      });
    }
    if (action === "byok") {
      byokMutations += 1;
      return json(route, { error: "unexpected provider mutation" }, 500);
    }
    if (action === "install") installRequests += 1;
    throw new Error(`Unexpected local API action: ${action}`);
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Install ChangePlane on GitHub" }).click();
  await page.getByRole("radio", { name: /acme\/non-strict-api/u }).click();
  await expect(page.getByText("Verify Lite is the first installation")).toBeVisible();
  await expect(page.getByText(/9 reviewed files\. Your coding agent owns fixes/u)).toBeVisible();
  await expect(page.locator(".sdlc-assurance-map")).toContainText("Agentic SDLC assurance");
  await expect(page.locator(".sdlc-map-stage").filter({ hasText: "Plan / contract" })).toContainText("Setup needed");
  await expect(page.locator(".sdlc-map-stage").filter({ hasText: "Plan / contract" })).toContainText("Next: Merge the protected setup pull request.");
  await expect(page.locator(".sdlc-map-stage").filter({ hasText: "Operate" })).toContainText("External");
  await page.getByRole("checkbox", { name: "This check fails when important code behavior breaks." }).check();
  await expect(page.getByRole("radio", { name: /Autonomous repair/u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Enable autonomous/u })).toHaveCount(0);
  await expect(page.getByLabel("OpenAI API key")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create Verify-only setup PR" })).toBeEnabled();
  await page.getByRole("radio", { name: /Commit and file scope only/u }).click();
  await expect(page.locator(".install-summary").getByText("Observe", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create observe setup PR" })).toBeEnabled();
  expect(installRequests).toBe(0);
  expect(byokMutations).toBe(0);
  expect(externalRequests).toEqual([]);
});

test("Verify only installs with exact behavioral evidence and no provider-key interaction", async ({ page }) => {
  let connected = false;
  let byokMutations = 0;
  let installPayload = null;
  const externalRequests = await mockLocalApi(page, async (route, url) => {
    const action = url.searchParams.get("action");
    if (action === "session") {
      return json(route, {
        configured: true,
        authenticated: connected,
        login: connected ? "admin" : null,
        csrf: connected ? "local-csrf" : null,
        authMode: "github_app",
        rolloutMode: "self_serve",
      });
    }
    if (action === "login") {
      connected = true;
      return route.fulfill({ status: 302, headers: { location: "/?connected=1" }, body: "" });
    }
    if (action === "repos") {
      return json(route, { repositories: [{
        fullName: "acme/agent-api",
        private: true,
        defaultBranch: "main",
        permissions: { push: true, admin: true },
      }] });
    }
    if (action === "preflight") {
      return json(route, {
        repositoryState: "active",
        installation: { state: "fresh", currentVersion: null, targetVersion: MANAGED_VERSION, conflicts: [] },
        installable: true,
        conflicts: [],
        setupFiles: 9,
        setupProfile: "verify-lite",
        payloadProfiles: PAYLOAD_PROFILES,
        setup: { state: "none" },
        evidenceOptions: [{ name: "CI / test", appSlug: "github-actions", workflowPath: ".github/workflows/ci.yml", suggested: true }],
        evidenceDiscovery: { state: "ready" },
        harness: { verifyAvailable: true, autonomousAvailable: false, maxAttempts: 2, budgetMinutes: 15 },
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
      });
    }
    if (action === "runtime") {
      return json(route, {
        provider: "openai",
        activeModel: "gpt-5.6-luna",
        modelConfigured: true,
        managedProfile: "verify-lite",
        autonomousUpgradeRequired: true,
        harness: { mode: "observe", verifyAvailable: true, autonomousAvailable: false, ready: false, maxAttempts: 2, budgetMinutes: 15 },
        managed: { state: "reserved", available: false, providerVerified: false, executionReady: false },
        byok: { configured: false, state: "not_connected", secretName: "OPENAI_API_KEY", updatedAt: null },
      });
    }
    if (action === "byok") {
      byokMutations += 1;
      return json(route, { error: "unexpected provider-key mutation" }, 500);
    }
    if (action === "install") {
      installPayload = route.request().postDataJSON();
      return json(route, {
        repository: "acme/agent-api",
        branch: "changeplane/observe-setup",
        operation: "install",
        harnessMode: "verify",
        managedVersion: MANAGED_VERSION,
        managedProfile: "verify-lite",
        pullRequest: { number: 91, url: "https://github.com/acme/agent-api/pull/91", state: "open" },
      }, 201);
    }
    throw new Error(`Unexpected local API action: ${action}`);
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Install ChangePlane on GitHub" }).click();
  await page.getByRole("radio", { name: /acme\/agent-api/u }).click();
  await expect(page.locator(".install-summary").getByText("Verify only", { exact: true })).toBeVisible();
  await expect(page.getByText("Verify Lite is the first installation")).toBeVisible();
  await expect(page.getByText(/9 reviewed files\. Your coding agent owns fixes; no provider key, repair workflow, or controller credential/u)).toBeVisible();
  await expect(page.getByRole("radio", { name: /Autonomous repair/u })).toHaveCount(0);
  await expect(page.getByLabel("OpenAI API key")).toHaveCount(0);
  await expect(page.getByText(/same-name Check from another workflow cannot satisfy/u)).toBeVisible();
  await page.getByText("Advanced · use a different check").click();
  await expect(page.getByLabel("Workflow file")).toHaveValue(".github/workflows/ci.yml");
  await page.getByLabel("Workflow file").fill("ci.yml");
  await expect(page.getByLabel("Workflow file")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/Enter the exact .*\.github\/workflows/u)).toBeVisible();
  await page.getByLabel("Workflow file").fill(".github/workflows/release.yaml");
  await expect(page.getByLabel("Workflow file")).toHaveAttribute("aria-invalid", "false");
  await page.getByLabel("Publisher").fill("vercel");
  await expect(page.getByLabel("Workflow file")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "This check fails when important code behavior breaks." }).check();
  const installButton = page.getByRole("button", { name: "Create Verify-only setup PR" });
  await expect(installButton).toBeEnabled();
  await installButton.click();

  await expect(page.getByRole("heading", { name: "One last step in GitHub" })).toBeVisible();
  await expect(page.locator(".install-result-facts")).toContainText("Verify only");
  await expect(page.locator(".activation-checklist")).toContainText("your coding agent");
  await expect(page.locator(".activation-checklist")).toContainText("Require ChangePlane / guard from the dedicated App");
  expect(installPayload).toEqual({
    repository: "acme/agent-api",
    requiredCheck: { name: "CI / test", appSlug: "vercel" },
    harnessMode: "verify",
  });
  expect(byokMutations).toBe(0);
  expect(externalRequests).toEqual([]);
});

test("fresh self-serve installs Verify Lite before protected Autonomous expansion", async ({ page }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 844 });
  let connected = false;
  let byokConnected = false;
  let installPayload = null;
  let preflightRequests = 0;
  const apiActions = [];
  const externalRequests = await mockLocalApi(page, async (route, url) => {
    const action = url.searchParams.get("action");
    apiActions.push(action);
    if (action === "session") {
      return json(route, {
        configured: true,
        authenticated: connected,
        login: connected ? "alex" : null,
        csrf: connected ? "local-csrf" : null,
        authMode: "github_app",
        rolloutMode: "self_serve",
      });
    }
    if (action === "login") {
      connected = true;
      return route.fulfill({ status: 302, headers: { location: "/?connected=1" }, body: "" });
    }
    if (action === "repos") {
      return json(route, {
        repositories: [{
          fullName: "acme/payments-api",
          private: true,
          defaultBranch: "main",
          permissions: { push: true, admin: true },
        }],
      });
    }
    if (action === "preflight") {
      preflightRequests += 1;
      expect(url.searchParams.get("repository")).toBe("acme/payments-api");
      if (preflightRequests > 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return json(route, {
          repositoryState: "active",
          installation: {
            state: "current",
            currentVersion: MANAGED_VERSION,
            targetVersion: MANAGED_VERSION,
            managedProfile: "verify-lite",
            conflicts: [],
          },
          installable: false,
          conflicts: [],
          setupFiles: 0,
          setupProfile: "verify-lite",
          payloadProfiles: PAYLOAD_PROFILES,
          setup: { state: "current", managedVersion: MANAGED_VERSION },
          evidenceOptions: [],
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
        });
      }
      return json(route, {
        repositoryState: "active",
        installation: {
          state: "fresh",
          currentVersion: null,
          targetVersion: MANAGED_VERSION,
          conflicts: [],
        },
        installable: true,
        conflicts: [],
        setupFiles: 9,
        setupProfile: "verify-lite",
        payloadProfiles: PAYLOAD_PROFILES,
        setup: { state: "none" },
        evidenceOptions: [{ name: "test", appSlug: "github-actions", workflowPath: ".github/workflows/ci.yml", suggested: true }],
        harness: { autonomousAvailable: true, maxAttempts: 2, budgetMinutes: 15 },
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
      });
    }
    if (action === "runtime" && route.request().method() === "GET") {
      const installed = Boolean(installPayload);
      return json(route, {
        provider: "openai",
        activeModel: "gpt-5.6-luna",
        modelConfigured: true,
        managedProfile: "verify-lite",
        autonomousUpgradeRequired: installed,
        harness: {
          mode: installed ? "verify" : "observe",
          autonomousAvailable: true,
          ready: false,
          enforcement: installed ? {
            source: "ruleset",
            state: "active",
            active: true,
            strict: true,
            mergeQueueRequired: true,
            guardRequired: true,
            publisherBound: true,
            evidenceRequired: true,
            evidencePublisherBound: true,
            nextAction: "No action is required; one qualifying Ruleset independently contains every authority binding.",
          } : undefined,
          maxAttempts: 2,
          budgetMinutes: 15,
        },
        managed: { state: "reserved", available: false, providerVerified: false, executionReady: false },
        byok: { configured: byokConnected, state: byokConnected ? "connected" : "not_connected", secretName: "OPENAI_API_KEY", updatedAt: null },
      });
    }
    if (action === "byok") {
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers()["x-changeplane-csrf"]).toBe("local-csrf");
      expect(route.request().postDataJSON().repository).toBe("acme/payments-api");
      expect(route.request().postDataJSON().apiKey).toMatch(/^sk-test-/u);
      byokConnected = true;
      return json(route, {
        byok: { configured: true, state: "connected", secretName: "OPENAI_API_KEY", updatedAt: null },
      });
    }
    if (action === "runtime" && route.request().method() === "POST") {
      expect(byokConnected).toBe(true);
      expect(route.request().postDataJSON()).toEqual({
        repository: "acme/payments-api",
        model: "gpt-5.6-luna",
        harnessMode: "autonomous",
      });
      return json(route, {
        repository: "acme/payments-api",
        branch: "changeplane/runtime-config",
        operation: "autonomous-upgrade",
        model: "gpt-5.6-luna",
        harnessMode: "autonomous",
        managedProfile: "full",
        state: "pending",
        pullRequest: {
          number: 44,
          url: "https://github.com/acme/payments-api/pull/44",
          state: "open",
        },
      });
    }
    if (action === "install") {
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers()["x-changeplane-csrf"]).toBe("local-csrf");
      installPayload = route.request().postDataJSON();
      return json(route, {
        repository: "acme/payments-api",
        branch: "changeplane/observe-setup",
        operation: "install",
        harnessMode: "verify",
        managedVersion: MANAGED_VERSION,
        managedProfile: "verify-lite",
        pullRequest: {
          number: 42,
          url: "https://github.com/acme/payments-api/pull/42",
          state: "open",
        },
      }, 201);
    }
    throw new Error(`Unexpected local API action: ${action}`);
  });

  await page.goto("/");
  const connectButton = page.getByRole("button", { name: "Install ChangePlane on GitHub" });
  await expect(connectButton).toBeVisible();
  await expect(page.getByText("Choose a personal account or organization on GitHub.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Already installed? Continue with GitHub" })).toBeVisible();
  await connectButton.focus();
  await page.keyboard.press("Enter");

  const setupHeading = page.getByRole("heading", { name: "One repository. One setup PR." });
  await expect(setupHeading).toBeFocused();
  await expect(page.getByRole("heading", { name: "Choose where ChangePlane runs" })).toBeVisible();

  await page.keyboard.press("Tab");
  const search = page.getByPlaceholder("Search repositories");
  await expect(search).toBeFocused();
  await page.keyboard.press("Tab");
  const repository = page.getByRole("radio", { name: /acme\/payments-api/u });
  await expect(repository).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByText("Ready to install")).toBeVisible();
  await expect(page.getByText("Verify Lite is the first installation")).toBeVisible();
  await expect(page.getByText(/9 reviewed files\. Your coding agent owns fixes/u)).toBeVisible();
  await expect(page.getByRole("radio", { name: /Autonomous repair/u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Explore Autonomous repair/u })).toHaveCount(0);
  await expect(page.getByLabel("OpenAI API key")).toHaveCount(0);
  const evidenceSelect = page.getByLabel("Use a test from GitHub");
  await expect(evidenceSelect).toBeVisible();
  await expect(evidenceSelect).toHaveValue("test\0github-actions\0.github/workflows/ci.yml");
  await expect(page.getByText(/same-name Check from another workflow cannot satisfy/u)).toBeVisible();
  const evidenceConfirmation = page.getByRole("checkbox", { name: "This check fails when important code behavior breaks." });
  await evidenceConfirmation.focus();
  await page.keyboard.press("Space");
  await expect(evidenceConfirmation).toBeChecked();
  const sdlcMap = page.locator(".sdlc-assurance-map");
  await expect(sdlcMap).toContainText("Agentic SDLC assurance");
  await expect(sdlcMap).toContainText("Setup required");
  await expect(sdlcMap.locator(".sdlc-map-stage")).toHaveCount(7);
  await expect(sdlcMap).toContainText("GitHub reviewers");
  await expect(sdlcMap).toContainText("Deterministic harness");
  await expect(sdlcMap).toContainText("GitHub owns merge");
  await expect(sdlcMap).toContainText("customer systems own deploy and operate");

  const installButton = page.getByRole("button", { name: "Create Verify-only setup PR" });
  await expect(installButton).toBeEnabled();
  await installButton.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "One last step in GitHub" })).toBeVisible();
  await expect(page.getByText("Setup PR created")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open setup PR on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/acme/payments-api/pull/42",
  );
  await page.getByRole("button", { name: "I merged it — check this repository" }).click();
  await expect(page.locator(".safety-preflight")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: /Create .* PR/u })).toHaveCount(0);
  await expect(page.locator(".install-summary").getByText("acme/payments-api", { exact: true })).toBeVisible();
  await expect(page.getByText("Exact-head merge protection is active.")).toBeVisible();
  await expect(page.getByText("Verify Lite · managed v13")).toBeVisible();
  await expect(page.locator(".runtime-enforcement")).toContainText("one strict, no-bypass default-branch Ruleset requires Merge Queue");
  const exploreAutonomous = page.getByRole("button", { name: /Explore Autonomous repair/u });
  await expect(exploreAutonomous).toBeVisible();
  await exploreAutonomous.click();
  await expect(page.getByText("Bring your own OpenAI key")).toBeVisible();
  const apiKey = page.getByLabel("OpenAI API key");
  await apiKey.fill(`sk-test-${"x".repeat(32)}`);
  await page.getByRole("button", { name: "Save to GitHub" }).click();
  await expect(page.locator(".runtime-connected").getByText("OPENAI_API_KEY", { exact: true })).toBeVisible();
  const expandButton = page.getByRole("button", { name: /Enable autonomous repair with protected expansion PR/u });
  await expect(expandButton).toBeEnabled();
  await expandButton.click();
  await expect(page.getByRole("link", { name: "Review runtime PR #44" })).toHaveAttribute(
    "href",
    "https://github.com/acme/payments-api/pull/44",
  );
  await expect(page.getByRole("button", { name: "Recheck guard and enforcement" })).toBeVisible();
  expect(installPayload).toEqual({
    repository: "acme/payments-api",
    requiredCheck: { name: "test", appSlug: "github-actions", workflowPath: ".github/workflows/ci.yml" },
    harnessMode: "verify",
  });
  expect(preflightRequests).toBe(2);
  expect(apiActions).toEqual(expect.arrayContaining(["session", "login", "repos", "preflight", "runtime", "byok", "install"]));
  expect(externalRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a pristine legacy install offers one policy-preserving upgrade pull request", async ({ page }) => {
  let connected = false;
  let installPayload = null;
  let preflightRequests = 0;
  const externalRequests = await mockLocalApi(page, async (route, url) => {
    const action = url.searchParams.get("action");
    if (action === "session") {
      return json(route, {
        configured: true,
        authenticated: connected,
        login: connected ? "alex" : null,
        csrf: connected ? "local-csrf" : null,
        authMode: "github_app",
        rolloutMode: "self_serve",
      });
    }
    if (action === "login") {
      connected = true;
      return route.fulfill({ status: 302, headers: { location: "/?connected=1" }, body: "" });
    }
    if (action === "repos") {
      return json(route, {
        repositories: [{
          fullName: "acme/payments-api",
          private: true,
          defaultBranch: "main",
          permissions: { push: true, admin: false },
        }],
      });
    }
    if (action === "preflight") {
      preflightRequests += 1;
      if (preflightRequests > 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return json(route, {
          repositoryState: "active",
          installation: {
            state: "current",
            currentVersion: MANAGED_VERSION,
            targetVersion: MANAGED_VERSION,
            managedProfile: "full",
            conflicts: [],
          },
          installable: false,
          conflicts: [],
          setupFiles: 0,
          setupProfile: "full",
          payloadProfiles: PAYLOAD_PROFILES,
          setup: { state: "current", managedVersion: MANAGED_VERSION },
          evidenceOptions: [],
          boundary: {
            defaultBranchWrite: false,
            pullRequestOnly: true,
            mergeBlocking: false,
            agentRepairDuringSetup: false,
            untrustedCodeExecution: false,
            providerSecretAccess: false,
          },
        });
      }
      return json(route, {
        repositoryState: "active",
        installation: {
          state: "outdated",
          currentVersion: 0,
          targetVersion: MANAGED_VERSION,
          managedProfile: "full",
          conflicts: [],
        },
        installable: true,
        conflicts: [],
        setupFiles: 19,
        setupProfile: "full",
        payloadProfiles: PAYLOAD_PROFILES,
        setup: { state: "upgrade_available", operation: "upgrade" },
        evidenceOptions: [],
        evidenceDiscovery: { state: "unavailable" },
        boundary: {
          defaultBranchWrite: false,
          pullRequestOnly: true,
          mergeBlocking: false,
          agentRepairDuringSetup: false,
          untrustedCodeExecution: false,
          providerSecretAccess: false,
        },
      });
    }
    if (action === "runtime") {
      return json(route, {
        provider: "openai",
        activeModel: "gpt-5.6-luna",
        modelConfigured: true,
        managedProfile: "full",
        autonomousUpgradeRequired: false,
        harness: {
          mode: "verify",
          verifyAvailable: true,
          autonomousAvailable: false,
          ready: false,
          enforcement: {
            source: "ruleset",
            state: "active",
            active: true,
            strict: true,
            guardRequired: true,
            publisherBound: true,
            mergeQueueRequired: true,
            evidenceRequired: true,
            evidencePublisherBound: true,
            nextAction: "No action is required; one independently complete Ruleset binds the dedicated-App guard and every behavioral evidence Check to its expected publisher.",
          },
          maxAttempts: 2,
          budgetMinutes: 15,
        },
        managed: { state: "reserved", available: false, providerVerified: false, executionReady: false },
        byok: { configured: false, state: "not_connected", secretName: "OPENAI_API_KEY", updatedAt: null },
      });
    }
    if (action === "install") {
      installPayload = route.request().postDataJSON();
      return json(route, {
        repository: "acme/payments-api",
        branch: "changeplane/observe-upgrade-v13",
        operation: "upgrade",
        harnessMode: "observe",
        managedVersion: MANAGED_VERSION,
        managedProfile: "full",
        pullRequest: {
          number: 43,
          url: "https://github.com/acme/payments-api/pull/43",
          state: "open",
        },
      }, 201);
    }
    throw new Error(`Unexpected local API action: ${action}`);
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Install ChangePlane on GitHub" }).click();
  await page.getByRole("radio", { name: /acme\/payments-api/u }).click();

  await expect(page.getByText("Upgrade ready")).toBeVisible();
  await expect(page.getByText("Update managed files to version 13 without changing your policy.")).toBeVisible();
  await expect(page.getByText("Current installation stays active until merge")).toBeVisible();
  await expect(page.locator(".repository-capabilities")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Choose what the first receipt proves" })).toHaveCount(0);
  await expect(page.getByText("Setup complete")).toHaveCount(0);

  await page.getByRole("button", { name: "Create upgrade PR" }).click();

  await expect(page.getByRole("heading", { name: "Review the managed upgrade" })).toBeVisible();
  await expect(page.getByText("Upgrade pull request only")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open upgrade PR on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/acme/payments-api/pull/43",
  );
  await page.getByRole("button", { name: "I merged it — check this repository" }).click();
  await expect(page.getByText("Checking repository safety")).toBeVisible();
  await expect(page.locator(".safety-preflight")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: /Create .* PR/u })).toHaveCount(0);
  await expect(page.locator(".install-summary").getByText("acme/payments-api", { exact: true })).toBeVisible();
  await expect(page.getByText("Exact-head merge protection is active.")).toBeVisible();
  await expect(page.getByText("Full · managed v13")).toBeVisible();
  await expect(page.getByText("Merge blocking active", { exact: true })).toBeVisible();
  await expect(page.getByText("Verify only is enforced by one verified GitHub Ruleset.")).toBeVisible();
  await expect(page.locator(".runtime-enforcement")).toContainText("one strict, no-bypass default-branch Ruleset requires Merge Queue");
  await expect(page.getByText(/No test PR is required/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Recheck guard and enforcement" })).toBeVisible();
  await expect(page.locator(".install-summary").getByText("acme/payments-api", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open project pull requests" })).toHaveAttribute(
    "href",
    "https://github.com/acme/payments-api/pulls",
  );
  expect(preflightRequests).toBe(2);
  expect(installPayload).toEqual({ repository: "acme/payments-api", requiredCheck: null, harnessMode: "observe" });
  expect(externalRequests).toEqual([]);
});

test("a legacy enforce policy recovers through one reviewed Verify upgrade without autonomous credentials", async ({ page }) => {
  let connected = false;
  let installPayload = null;
  const migration = {
    required: true,
    reason: "github_actions_workflow_path_required",
    previousHarnessMode: "autonomous",
    defaultHarnessMode: "verify",
    allowedHarnessModes: ["verify", "observe"],
    policyIncluded: true,
    ownerSelectionRequired: true,
    autonomousCredentialsProvisioned: false,
    legacyGuardPolicyAction: "replace_with_dedicated_app_guard",
    ownerAuthorized: true,
  };
  const requiredCheck = {
    name: "CI / verify",
    appSlug: "github-actions",
    workflowPath: ".github/workflows/ci.yml",
  };
  const externalRequests = await mockLocalApi(page, async (route, url) => {
    const action = url.searchParams.get("action");
    if (action === "session") {
      return json(route, {
        configured: true,
        authenticated: connected,
        login: connected ? "alex" : null,
        csrf: connected ? "local-csrf" : null,
        authMode: "github_app",
        rolloutMode: "self_serve",
      });
    }
    if (action === "login") {
      connected = true;
      return route.fulfill({ status: 302, headers: { location: "/?connected=1" }, body: "" });
    }
    if (action === "repos") {
      return json(route, {
        repositories: [{
          fullName: "acme/legacy-service",
          private: true,
          defaultBranch: "main",
          permissions: { push: true, admin: true },
        }],
      });
    }
    if (action === "preflight") {
      return json(route, {
        repositoryState: "active",
        installation: {
          state: "outdated",
          currentVersion: 12,
          targetVersion: MANAGED_VERSION,
          managedProfile: "full",
          conflicts: [],
          policyMigration: migration,
        },
        installable: true,
        conflicts: [],
        setupFiles: 20,
        setupProfile: "full",
        payloadProfiles: PAYLOAD_PROFILES,
        setup: { state: "upgrade_available", operation: "upgrade", policyMigration: migration },
        evidenceOptions: [{ ...requiredCheck, suggested: true }],
        evidenceDiscovery: { state: "found", checkedHeads: 1 },
        harness: { verifyAvailable: true, autonomousAvailable: false, maxAttempts: 2, budgetMinutes: 15 },
        boundary: {
          defaultBranchWrite: false,
          pullRequestOnly: true,
          mergeBlocking: false,
          agentRepairDuringSetup: false,
          untrustedCodeExecution: false,
          providerSecretAccess: false,
        },
      });
    }
    if (action === "runtime") {
      return json(route, {
        error: "Upgrade the outdated managed installation before reading runtime state.",
      }, 409);
    }
    if (action === "install") {
      installPayload = route.request().postDataJSON();
      return json(route, {
        repository: "acme/legacy-service",
        branch: "changeplane/observe-upgrade-v13",
        operation: "upgrade",
        harnessMode: "verify",
        managedVersion: MANAGED_VERSION,
        managedProfile: "full",
        policyIncluded: true,
        policyMigration: { ...migration, appliedHarnessMode: "verify", requiredCheck },
        pullRequest: {
          number: 51,
          url: "https://github.com/acme/legacy-service/pull/51",
          state: "open",
        },
      }, 201);
    }
    throw new Error(`Unexpected local API action: ${action}`);
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Install ChangePlane on GitHub" }).click();
  await page.getByRole("radio", { name: /acme\/legacy-service/u }).click();

  await expect(page.getByText("v13 evidence recovery ready")).toBeVisible();
  await expect(page.getByText(".changeplane.json included for recovery")).toBeVisible();
  await expect(page.getByText("No autonomous credential provisioned")).toBeVisible();
  await expect(page.getByText("Recovery mode: Verify only")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Autonomous repair/u })).toHaveCount(0);
  await expect(page.getByLabel("Use a test from GitHub")).toHaveValue(
    "CI / verify\0github-actions\0.github/workflows/ci.yml",
  );
  await page.getByRole("checkbox", { name: "This check fails when important code behavior breaks." }).check();
  await expect(page.getByRole("button", { name: "Create recovery upgrade PR" })).toBeEnabled();
  await page.getByRole("button", { name: "Create recovery upgrade PR" }).click();

  await expect(page.getByRole("heading", { name: "Review the managed upgrade" })).toBeVisible();
  await expect(page.getByText(/narrow \.changeplane\.json change/u)).toBeVisible();
  await expect(page.getByText(/No autonomous credential was created/u)).toBeVisible();
  await expect(page.locator(".activation-checklist")).toContainText("Replace any legacy github-actions branch-policy binding");
  await expect(page.locator(".activation-checklist")).toContainText("strict, no-bypass default-branch Ruleset");
  expect(installPayload).toEqual({
    repository: "acme/legacy-service",
    requiredCheck,
    harnessMode: "verify",
  });
  expect(externalRequests).toEqual([]);
});

test("pending, current, and owner-review states never offer an unsafe mutation", async ({ page }) => {
  let connected = false;
  let installRequests = 0;
  let pendingPreflightRequests = 0;
  let retryPreflightRequests = 0;
  const externalRequests = await mockLocalApi(page, async (route, url) => {
    const action = url.searchParams.get("action");
    if (action === "session") {
      return json(route, {
        configured: true,
        authenticated: connected,
        login: connected ? "alex" : null,
        csrf: connected ? "local-csrf" : null,
        authMode: "github_app",
        rolloutMode: "self_serve",
      });
    }
    if (action === "login") {
      connected = true;
      return route.fulfill({ status: 302, headers: { location: "/?connected=1" }, body: "" });
    }
    if (action === "repos") {
      return json(route, {
        repositories: ["pending-api", "observe-recovery-api", "current-api", "retry-api", "recovery-api", "conflict-api"].map((name) => ({
          fullName: `acme/${name}`,
          private: true,
          defaultBranch: "main",
          permissions: { push: true, admin: false },
        })),
      });
    }
    if (action === "preflight") {
      const repository = url.searchParams.get("repository");
      const boundary = {
        defaultBranchWrite: false,
        pullRequestOnly: true,
        mergeBlocking: false,
        agentRepairDuringSetup: false,
        untrustedCodeExecution: false,
        providerSecretAccess: false,
      };
      if (repository === "acme/pending-api") {
        pendingPreflightRequests += 1;
        return json(route, {
          repositoryState: "active",
          installation: {
            state: "outdated",
            currentVersion: 0,
            targetVersion: MANAGED_VERSION,
            managedProfile: "full",
            conflicts: [],
          },
          installable: true,
          conflicts: [],
          setupFiles: 19,
          setupProfile: "full",
          payloadProfiles: PAYLOAD_PROFILES,
          setup: {
            state: "pending",
            operation: "upgrade",
            pullRequest: { number: 7, url: "https://github.com/acme/pending-api/pull/7" },
          },
          evidenceOptions: [],
          boundary,
        });
      }
      if (repository === "acme/observe-recovery-api") {
        const policyMigration = {
          required: true,
          reason: "github_actions_workflow_path_required",
          previousHarnessMode: "autonomous",
          defaultHarnessMode: "verify",
          allowedHarnessModes: ["verify", "observe"],
          policyIncluded: true,
          ownerSelectionRequired: true,
          autonomousCredentialsProvisioned: false,
          legacyGuardPolicyAction: "replace_with_dedicated_app_guard",
          ownerAuthorized: true,
        };
        return json(route, {
          repositoryState: "active",
          installation: {
            state: "outdated",
            currentVersion: 12,
            targetVersion: MANAGED_VERSION,
            managedProfile: "full",
            conflicts: [],
            policyMigration,
          },
          installable: true,
          conflicts: [],
          setupFiles: 20,
          setupProfile: "full",
          payloadProfiles: PAYLOAD_PROFILES,
          setup: {
            state: "pending",
            operation: "upgrade",
            pullRequest: { number: 8, url: "https://github.com/acme/observe-recovery-api/pull/8" },
            harnessMode: "observe",
            requiredCheck: null,
            policyIncluded: true,
            policyMigration,
          },
          evidenceOptions: [],
          boundary,
        });
      }
      if (repository === "acme/current-api") {
        return json(route, {
          repositoryState: "active",
          installation: {
            state: "current",
            currentVersion: MANAGED_VERSION,
            targetVersion: MANAGED_VERSION,
            managedProfile: "verify-lite",
            conflicts: [],
          },
          installable: false,
          conflicts: [],
          setupFiles: 0,
          setupProfile: "verify-lite",
          payloadProfiles: PAYLOAD_PROFILES,
          setup: { state: "current", managedVersion: MANAGED_VERSION },
          evidenceOptions: [],
          boundary,
        });
      }
      if (repository === "acme/retry-api") {
        retryPreflightRequests += 1;
        if (retryPreflightRequests === 1) {
          return json(route, { error: "GitHub could not complete the read-only check." }, 503);
        }
        return json(route, {
          repositoryState: "active",
          installation: {
            state: "current",
            currentVersion: MANAGED_VERSION,
            targetVersion: MANAGED_VERSION,
            managedProfile: "verify-lite",
            conflicts: [],
          },
          installable: false,
          conflicts: [],
          setupFiles: 0,
          setupProfile: "verify-lite",
          payloadProfiles: PAYLOAD_PROFILES,
          setup: { state: "current", managedVersion: MANAGED_VERSION },
          evidenceOptions: [],
          boundary,
        });
      }
      if (repository === "acme/recovery-api") {
        const policyMigration = {
          required: true,
          reason: "github_actions_workflow_path_required",
          previousHarnessMode: "autonomous",
          defaultHarnessMode: "verify",
          allowedHarnessModes: ["verify", "observe"],
          policyIncluded: true,
          ownerSelectionRequired: true,
          autonomousCredentialsProvisioned: false,
          legacyGuardPolicyAction: "replace_with_dedicated_app_guard",
          ownerAuthorized: false,
        };
        return json(route, {
          repositoryState: "active",
          installation: {
            state: "outdated",
            currentVersion: 12,
            targetVersion: MANAGED_VERSION,
            managedProfile: "full",
            conflicts: [],
            policyMigration,
          },
          installable: false,
          conflicts: [],
          setupFiles: 20,
          setupProfile: "full",
          payloadProfiles: PAYLOAD_PROFILES,
          setup: {
            state: "owner_required",
            operation: "upgrade",
            message: "A repository administrator must select the exact behavioral Check and workflow path, then create and review the protected v13 recovery pull request. Nothing was changed.",
            policyMigration,
          },
          evidenceOptions: [],
          boundary,
        });
      }
      if (repository === "acme/conflict-api") {
        return json(route, {
          repositoryState: "active",
          installation: {
            state: "conflict",
            currentVersion: null,
            targetVersion: MANAGED_VERSION,
            conflicts: ["changeplane/action/index.js"],
          },
          installable: false,
          conflicts: ["changeplane/action/index.js"],
          setupFiles: 0,
          setup: {
            state: "conflict",
            message: "ChangePlane will not overwrite repository-owned or modified paths: changeplane/action/index.js",
          },
          evidenceOptions: [],
          boundary,
        });
      }
    }
    if (action === "runtime") {
      return json(route, {
        provider: "openai",
        activeModel: "gpt-5.6-luna",
        modelConfigured: true,
        managedProfile: "verify-lite",
        autonomousUpgradeRequired: true,
        harness: {
          mode: "verify",
          verifyAvailable: true,
          autonomousAvailable: false,
          ready: false,
          enforcement: {
            state: "admin_required",
            active: false,
            strict: false,
            guardRequired: false,
            publisherBound: false,
          },
          maxAttempts: 2,
          budgetMinutes: 15,
        },
        managed: { state: "reserved", available: false, providerVerified: false, executionReady: false },
        byok: { configured: false, state: "not_connected", secretName: "OPENAI_API_KEY", updatedAt: null },
      });
    }
    if (action === "install") {
      installRequests += 1;
      return json(route, { message: "unexpected" }, 500);
    }
    throw new Error(`Unexpected local API action: ${action}`);
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Install ChangePlane on GitHub" }).click();

  await page.getByRole("radio", { name: /acme\/pending-api/u }).click();
  await expect(page.getByText("Upgrade PR already ready")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open existing upgrade PR" })).toHaveAttribute(
    "href",
    "https://github.com/acme/pending-api/pull/7",
  );
  await page.getByRole("button", { name: "I merged it — check this repository" }).click();
  await expect(page.getByText("Upgrade PR already ready")).toBeVisible();
  expect(pendingPreflightRequests).toBe(2);
  await page.getByRole("radio", { name: /acme\/pending-api/u }).click();
  await expect(page.getByText("Upgrade PR already ready")).toBeVisible();
  expect(pendingPreflightRequests).toBe(3);

  await page.getByRole("radio", { name: /acme\/observe-recovery-api/u }).click();
  await expect(page.getByText("Recovery upgrade PR already ready")).toBeVisible();
  await expect(page.locator(".install-summary").getByText("Observe", { exact: true })).toBeVisible();
  await expect(page.getByText(/binds scope-only Observe and includes the policy change/u)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open existing upgrade PR" })).toHaveAttribute(
    "href",
    "https://github.com/acme/observe-recovery-api/pull/8",
  );
  await expect(page.getByText("Recovery mode: Verify only")).toHaveCount(0);

  await page.getByRole("radio", { name: /acme\/current-api/u }).click();
  await expect(page.getByText("Managed files installed. Finish activation.")).toBeVisible();
  await expect(page.getByText("Verify Lite · managed v13")).toBeVisible();
  await expect(page.getByRole("button", { name: "Recheck guard and enforcement" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create upgrade PR" })).toHaveCount(0);

  await page.getByRole("radio", { name: /acme\/retry-api/u }).click();
  await expect(page.getByRole("alert")).toContainText("Read-only check could not finish");
  await expect(page.getByRole("alert")).toContainText("GitHub could not complete the read-only check.");
  await expect(page.locator(".install-summary").getByText("Blocked safely", { exact: true })).toBeVisible();
  const retryButton = page.getByRole("button", { name: "Try read-only check again" });
  await retryButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Managed files installed. Finish activation.")).toBeVisible();
  await expect(page.getByText("Verify Lite · managed v13")).toBeVisible();
  await expect(page.getByRole("radio", { name: /acme\/retry-api/u })).toBeChecked();
  expect(retryPreflightRequests).toBe(2);

  await page.getByRole("radio", { name: /acme\/recovery-api/u }).click();
  await expect(page.getByText("Setup needs attention")).toBeVisible();
  await expect(page.getByText(/repository administrator must select the exact behavioral Check and workflow path/u)).toBeVisible();
  await expect(page.getByText("No repository change was made.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create recovery upgrade PR" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open repository for owner review" })).toHaveAttribute(
    "href",
    "https://github.com/acme/recovery-api",
  );

  await page.getByRole("radio", { name: /acme\/conflict-api/u }).click();
  await expect(page.getByText("Setup needs attention")).toBeVisible();
  await expect(page.getByText("Ask a repository owner to review the listed paths. ChangePlane did not overwrite them.")).toBeVisible();
  await expect(page.locator(".safety-preflight-attention")).toBeVisible();
  await expect(page.getByText("No repository change was made.")).toBeVisible();
  await expect(page.getByText("Blocked safely")).toBeVisible();
  await expect(page.getByText("Owner review needed")).toBeVisible();
  await expect(page.getByText("ChangePlane stopped before writing", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create setup PR" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open repository for owner review" })).toHaveAttribute(
    "href",
    "https://github.com/acme/conflict-api",
  );

  expect(installRequests).toBe(0);
  expect(externalRequests).toEqual([]);
});

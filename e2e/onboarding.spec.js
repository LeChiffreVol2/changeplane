import { expect, test } from "@playwright/test";

const APP_ORIGIN = "http://127.0.0.1:4173";

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

test("controlled-canary public root replays RouteThai assurance from failed head to PASS on mobile", async ({ page }) => {
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

  await expect(page.getByRole("heading", { name: "See how assurance works." })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("GitHub authorization was cancelled");
  await expect(page.getByText("RouteThai production case · sanitized replay")).toHaveCount(1);
  const exampleButton = page.getByRole("button", { name: "Open RouteThai example workspace" });
  await expect(exampleButton).toBeVisible();
  await expect(page.getByRole("button", { name: /Install ChangePlane|Canary owner sign in/u })).toHaveCount(0);
  await expect(page.getByText("New GitHub installations stay closed while the private canary is validated.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await exampleButton.focus();
  await expect(exampleButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Keep every stop inside its service window" })).toBeFocused();
  await expect(page.locator(".preview-boundary-banner")).toHaveText("RouteThai production-tested · sanitized public replay · synthetic data · no production systems accessed");
  await expect(page.getByText("GPT-5.6 Luna · recorded canary evidence")).toBeVisible();
  await expect(page.locator(".decision-pill")).toHaveText("Check passed");
  await expect(page.getByRole("button", { name: "Replay autonomous run" })).toBeVisible();
  await expect(page.getByText("Verified on 9fc82a1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Independent review" })).toBeVisible();
  await expect(page.locator(".review-boundary")).toContainText("ChangePlane / review");
  await expect(page.locator(".review-boundary")).toContainText("ChangePlane / guard");
  const headPreview = page.getByRole("button", { name: /Preview bound to exact head/u });
  await expect(headPreview).toBeVisible();
  await headPreview.click();
  await expect(page.getByRole("dialog", { name: /Canary evidence bound to 9fc82a1/u })).toBeVisible();
  await expect(page.locator(".preview-evidence-facts")).toContainText("Exact-head match");
  await expect(page.getByText("Exact new head passed")).toBeVisible();
  await expect(page.locator("time").filter({ hasText: "ChangePlane / guard · 9fc82a1" })).toBeVisible();
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

test("mocked self-serve onboarding reaches a setup pull request with keyboard navigation", async ({ page }) => {
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
          permissions: { push: true, admin: false },
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
          installation: { state: "current", currentVersion: 11, targetVersion: 11, conflicts: [] },
          installable: false,
          conflicts: [],
          setupFiles: 0,
          setup: { state: "current", managedVersion: 2 },
          evidenceOptions: [],
          capabilities: {
            independentReview: true,
            agentHandback: true,
            assuranceMemory: true,
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
          targetVersion: 11,
          conflicts: [],
        },
        installable: true,
        conflicts: [],
        setupFiles: 16,
        setup: { state: "none" },
        evidenceOptions: [{ name: "test", appSlug: "github-actions", suggested: true }],
        harness: { autonomousAvailable: true, maxAttempts: 2, budgetMinutes: 15 },
        capabilities: {
          independentReview: true,
          agentHandback: true,
          assuranceMemory: true,
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
        harness: { mode: "observe", autonomousAvailable: true, ready: false, maxAttempts: 2, budgetMinutes: 15 },
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
    if (action === "install") {
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers()["x-changeplane-csrf"]).toBe("local-csrf");
      installPayload = route.request().postDataJSON();
      return json(route, {
        repository: "acme/payments-api",
        branch: "changeplane/observe-setup",
        operation: "install",
        harnessMode: "autonomous",
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
  await expect(page.getByLabel("OpenAI API key")).toBeVisible();
  await expect(page.getByText("Bring your own OpenAI key")).toBeVisible();
  const capabilities = page.locator(".repository-capabilities");
  await expect(capabilities).toContainText("5 of 5 available");
  await capabilities.locator("summary").click();
  await expect(capabilities).toContainText("Review can never publish PASS");
  await expect(capabilities).toContainText("any coding agent");
  await expect(capabilities).toContainText("exact merge_group revision");
  const evidenceSelect = page.getByLabel("Use a test from GitHub");
  await expect(evidenceSelect).toBeVisible();
  await expect(evidenceSelect).toHaveValue("test\0github-actions");
  const evidenceConfirmation = page.getByRole("checkbox", { name: "This check fails when important code behavior breaks." });
  await evidenceConfirmation.focus();
  await page.keyboard.press("Space");
  await expect(evidenceConfirmation).toBeChecked();

  const apiKey = page.getByLabel("OpenAI API key");
  await apiKey.fill(`sk-test-${"x".repeat(32)}`);
  await page.getByRole("button", { name: "Save to GitHub" }).click();
  await expect(page.locator(".runtime-connected").getByText("OPENAI_API_KEY", { exact: true })).toBeVisible();

  const installButton = page.getByRole("button", { name: "Enable autonomous harness" });
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
  await expect(page.getByText("Setup is merged. ChangePlane is ready.")).toBeVisible();
  expect(installPayload).toEqual({
    repository: "acme/payments-api",
    requiredCheck: { name: "test", appSlug: "github-actions" },
    harnessMode: "autonomous",
  });
  expect(preflightRequests).toBe(2);
  expect(apiActions).toEqual(expect.arrayContaining(["session", "login", "repos", "preflight", "runtime", "byok", "install"]));
  expect(externalRequests).toEqual([]);
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
        await new Promise((resolve) => setTimeout(resolve, 150));
        return json(route, {
          repositoryState: "active",
          installation: { state: "current", currentVersion: 11, targetVersion: 11, conflicts: [] },
          installable: false,
          conflicts: [],
          setupFiles: 0,
          setup: { state: "current", managedVersion: 2 },
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
          targetVersion: 11,
          conflicts: [],
        },
        installable: true,
        conflicts: [],
        setupFiles: 1,
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
        managed: { state: "reserved", available: false, providerVerified: false, executionReady: false },
        byok: { configured: false, state: "not_connected", secretName: "OPENAI_API_KEY", updatedAt: null },
      });
    }
    if (action === "install") {
      installPayload = route.request().postDataJSON();
      return json(route, {
        repository: "acme/payments-api",
        branch: "changeplane/observe-upgrade-v11",
        operation: "upgrade",
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
  await expect(page.getByText("Update managed files to version 11 without changing your policy.")).toBeVisible();
  await expect(page.getByText("Current installation stays active until merge")).toBeVisible();
  const capabilities = page.locator(".repository-capabilities");
  await expect(capabilities).toContainText("0 of 5 available");
  await capabilities.locator("summary").click();
  await expect(capabilities).toContainText("Do not require the guard on a merge queue yet.");
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
  await expect(page.getByText("Setup is merged. ChangePlane is ready.")).toBeVisible();
  await expect(page.getByText("Setup complete")).toBeVisible();
  await expect(page.getByText("No repository change is needed", { exact: true })).toBeVisible();
  await expect(page.getByText(/No test PR is required/u)).toBeVisible();
  await expect(page.locator(".install-summary").getByText("acme/payments-api", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open project pull requests" })).toHaveAttribute(
    "href",
    "https://github.com/acme/payments-api/pulls",
  );
  expect(preflightRequests).toBe(2);
  expect(installPayload).toEqual({ repository: "acme/payments-api", requiredCheck: null, harnessMode: "observe" });
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
        repositories: ["pending-api", "current-api", "retry-api", "conflict-api"].map((name) => ({
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
          installation: { state: "outdated", currentVersion: 0, targetVersion: 11, conflicts: [] },
          installable: true,
          conflicts: [],
          setupFiles: 1,
          setup: {
            state: "pending",
            operation: "upgrade",
            pullRequest: { number: 7, url: "https://github.com/acme/pending-api/pull/7" },
          },
          evidenceOptions: [],
          boundary,
        });
      }
      if (repository === "acme/current-api") {
        return json(route, {
          repositoryState: "active",
          installation: { state: "current", currentVersion: 11, targetVersion: 11, conflicts: [] },
          installable: false,
          conflicts: [],
          setupFiles: 0,
          setup: { state: "current", managedVersion: 2 },
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
          installation: { state: "current", currentVersion: 11, targetVersion: 11, conflicts: [] },
          installable: false,
          conflicts: [],
          setupFiles: 0,
          setup: { state: "current", managedVersion: 2 },
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
            targetVersion: 11,
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

  await page.getByRole("radio", { name: /acme\/current-api/u }).click();
  await expect(page.getByText("Setup is merged. ChangePlane is ready.")).toBeVisible();
  await expect(page.getByText("Setup complete")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create upgrade PR" })).toHaveCount(0);

  await page.getByRole("radio", { name: /acme\/retry-api/u }).click();
  await expect(page.getByRole("alert")).toContainText("Read-only check could not finish");
  await expect(page.getByRole("alert")).toContainText("GitHub could not complete the read-only check.");
  await expect(page.locator(".install-summary").getByText("Blocked safely", { exact: true })).toBeVisible();
  const retryButton = page.getByRole("button", { name: "Try read-only check again" });
  await retryButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Setup is merged. ChangePlane is ready.")).toBeVisible();
  await expect(page.getByRole("radio", { name: /acme\/retry-api/u })).toBeChecked();
  expect(retryPreflightRequests).toBe(2);

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

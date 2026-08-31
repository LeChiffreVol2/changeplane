import assert from "node:assert/strict";
import test from "node:test";

import { githubRulesetReadiness, rulesetEnforcementState } from "./github-ruleset-readiness.js";

const OPTIONS = Object.freeze({
  defaultBranch: "main",
  guardCheckName: "ChangePlane / guard",
  publisherIntegrationId: 15368,
  evidenceChecks: Object.freeze([
    Object.freeze({ name: "CI / verify", integrationId: 15369 }),
    Object.freeze({ name: "Security / scan", integrationId: 15370 }),
  ]),
});

function expectedChecks() {
  return [
    { context: OPTIONS.guardCheckName, integration_id: OPTIONS.publisherIntegrationId },
    ...OPTIONS.evidenceChecks.map(({ name, integrationId }) => ({
      context: name,
      integration_id: integrationId,
    })),
  ];
}

function requiredStatusChecks({ strict = true, checks = expectedChecks() } = {}) {
  return {
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: strict,
      required_status_checks: checks,
    },
  };
}

function branchRuleset(overrides = {}) {
  return {
    id: 42,
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [requiredStatusChecks(), { type: "merge_queue" }],
    ...overrides,
  };
}

test("reports active only when one unambiguous ruleset contains the entire authority gate", () => {
  const input = [branchRuleset()];
  const before = structuredClone(input);

  assert.deepEqual(githubRulesetReadiness(input, OPTIONS), {
    source: "ruleset",
    state: "active",
    active: true,
    strict: true,
    mergeQueueRequired: true,
    guardRequired: true,
    publisherBound: true,
    evidenceRequired: true,
    evidencePublisherBound: true,
    nextAction: "No action is required; one active default-branch GitHub Ruleset has no bypasses, requires merge queue and strict status checks, and binds the ChangePlane guard plus every behavioral evidence check to its expected publisher.",
  });
  assert.deepEqual(input, before);
  assert.equal(rulesetEnforcementState, githubRulesetReadiness);
});

test("keeps the GitHub Actions liveness job outside authority and readiness", () => {
  const withoutLiveness = githubRulesetReadiness([branchRuleset()], OPTIONS);
  const withUnboundLiveness = githubRulesetReadiness([branchRuleset({
    rules: [requiredStatusChecks({
      checks: [
        ...expectedChecks(),
        { context: "ChangePlane guard" },
      ],
    }), { type: "merge_queue" }],
  })], OPTIONS);

  assert.equal(withoutLiveness.state, "active");
  assert.equal(withUnboundLiveness.state, "active");
  assert.equal(Object.hasOwn(withoutLiveness, "evaluationRequired"), false);
  assert.equal(Object.hasOwn(withoutLiveness, "evaluationPublisherBound"), false);
});

test("accepts exact refs and ~ALL as unambiguous default-branch targets", () => {
  for (const include of [["refs/heads/main"], ["~ALL"]]) {
    const result = githubRulesetReadiness([
      branchRuleset({ conditions: { ref_name: { include, exclude: ["refs/heads/release"] } } }),
    ], OPTIONS);
    assert.equal(result.state, "active");
  }
});

test("accepts validated parent organization selectors only for repository-scoped API results", () => {
  const selectors = [
    {
      repository_name: {
        include: ["agent-api"],
        exclude: [],
        protected: true,
      },
    },
    { repository_id: { repository_ids: [77] } },
    {
      repository_property: {
        include: [{ name: "risk", property_values: ["high"], source: "custom" }],
        exclude: [],
      },
    },
  ];

  for (const selector of selectors) {
    const ruleset = branchRuleset({
      source_type: "Organization",
      conditions: {
        ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
        ...selector,
      },
    });
    assert.equal(githubRulesetReadiness([ruleset], OPTIONS).state, "ruleset_ambiguous");
    assert.equal(githubRulesetReadiness([ruleset], {
      ...OPTIONS,
      repositoryScoped: true,
    }).state, "active");
  }
});

test("never aggregates authority facts across incomplete layered rulesets", () => {
  const strictQueue = branchRuleset({
    id: 1,
    rules: [requiredStatusChecks({
      checks: [{ context: "Unrelated / check", integration_id: 999 }],
    }), { type: "merge_queue" }],
  });
  const publishers = branchRuleset({
    id: 2,
    rules: [requiredStatusChecks({ strict: false })],
  });

  const result = githubRulesetReadiness([strictQueue, publishers], OPTIONS);
  assert.equal(result.state, "strict_required");
  assert.equal(result.active, false);
  assert.equal(result.strict, false);
  assert.equal(result.mergeQueueRequired, false);
  assert.equal(result.guardRequired, true);
  assert.equal(result.evidencePublisherBound, true);
});

test("distinguishes repositories without an applicable active ruleset", () => {
  const result = githubRulesetReadiness([
    branchRuleset({ enforcement: "disabled" }),
    branchRuleset({ enforcement: "evaluate" }),
    branchRuleset({ target: "tag" }),
    branchRuleset({ conditions: { ref_name: { include: ["refs/heads/release"], exclude: [] } } }),
    branchRuleset({ conditions: { ref_name: { include: ["~ALL"], exclude: ["~DEFAULT_BRANCH"] } } }),
  ], OPTIONS);

  assert.equal(result.state, "ruleset_required");
  assert.equal(result.active, false);
  assert.match(result.nextAction, /Add an active branch ruleset/u);
});

test("returns precise, fixable states for each incomplete gate", () => {
  const evidenceOnly = OPTIONS.evidenceChecks.map(({ name, integrationId }) => ({
    context: name,
    integration_id: integrationId,
  }));
  const scenarios = [
    {
      expected: "strict_required",
      rules: [requiredStatusChecks({ strict: false }), { type: "merge_queue" }],
      nextAction: /require status checks and require branches to be up to date/u,
    },
    {
      expected: "merge_queue_required",
      rules: [requiredStatusChecks()],
      nextAction: /Add a merge queue rule to that same/u,
    },
    {
      expected: "guard_required",
      rules: [requiredStatusChecks({ checks: evidenceOnly }), { type: "merge_queue" }],
      nextAction: /Add ChangePlane \/ guard/u,
    },
    {
      expected: "publisher_binding_required",
      rules: [requiredStatusChecks({ checks: [
        { context: OPTIONS.guardCheckName, integration_id: 999 },
        ...evidenceOnly,
      ] }), { type: "merge_queue" }],
      nextAction: /integration ID 15368/u,
    },
    {
      expected: "evidence_required",
      rules: [requiredStatusChecks({ checks: expectedChecks().slice(0, 2) }), { type: "merge_queue" }],
      nextAction: /Missing: Security \/ scan \(integration ID 15370\)/u,
    },
    {
      expected: "evidence_publisher_binding_required",
      rules: [requiredStatusChecks({ checks: [
        ...expectedChecks().slice(0, 2),
        { context: "Security / scan", integration_id: 999 },
      ] }), { type: "merge_queue" }],
      nextAction: /Incorrect or unbound: Security \/ scan \(integration ID 15370\)/u,
    },
  ];

  for (const scenario of scenarios) {
    const result = githubRulesetReadiness([branchRuleset({ rules: scenario.rules })], OPTIONS);
    assert.equal(result.state, scenario.expected);
    assert.match(result.nextAction, scenario.nextAction);
  }
});

test("reports evidence presence separately from publisher binding", () => {
  const result = githubRulesetReadiness([branchRuleset({
    rules: [requiredStatusChecks({ checks: [
      { context: OPTIONS.guardCheckName, integration_id: OPTIONS.publisherIntegrationId },
      { context: "CI / verify", integration_id: 999 },
      { context: "Security / scan" },
    ] }), { type: "merge_queue" }],
  })], OPTIONS);

  assert.equal(result.state, "evidence_publisher_binding_required");
  assert.equal(result.evidenceRequired, true);
  assert.equal(result.evidencePublisherBound, false);
  assert.match(result.nextAction, /CI \/ verify \(integration ID 15369\)/u);
  assert.match(result.nextAction, /Security \/ scan \(integration ID 15370\)/u);
});

test("fails closed for invalid or empty expected authority options", () => {
  const malformedOptions = [
    { ...OPTIONS, publisherIntegrationId: null },
    { ...OPTIONS, evidenceChecks: [] },
    { ...OPTIONS, evidenceChecks: undefined },
    { ...OPTIONS, evidenceChecks: [{ name: "CI / verify", integrationId: 0 }] },
    { ...OPTIONS, evidenceChecks: [{ name: OPTIONS.guardCheckName, integrationId: 15369 }] },
    { ...OPTIONS, evidenceChecks: [
      { name: "CI / verify", integrationId: 15369 },
      { name: "CI / verify", integrationId: 15370 },
    ] },
    { ...OPTIONS, evidenceChecks: [{ name: "CI / verify", integrationId: 15369, appSlug: "github-actions" }] },
  ];

  for (const options of malformedOptions) {
    assert.equal(githubRulesetReadiness([branchRuleset()], options).state, "ruleset_ambiguous");
  }
});

test("fails closed for bypasses, partial list payloads, and ambiguous ref conditions", () => {
  const ambiguous = [
    branchRuleset({ bypass_actors: [{ actor_id: 5, actor_type: "Team", bypass_mode: "always" }] }),
    branchRuleset({ bypass_actors: undefined }),
    branchRuleset({ conditions: undefined }),
    branchRuleset({ conditions: { ref_name: { include: ["refs/heads/ma*"], exclude: [] } } }),
    branchRuleset({ conditions: { ref_name: { include: ["~ALL"], exclude: ["refs/heads/ma*"] } } }),
    branchRuleset({
      conditions: {
        ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
        repository_name: { include: ["~ALL"], exclude: [] },
      },
    }),
    { id: 42, target: "branch", enforcement: "active" },
  ];

  for (const ruleset of ambiguous) {
    const result = githubRulesetReadiness([ruleset], OPTIONS);
    assert.equal(result.state, "ruleset_ambiguous");
    assert.equal(result.active, false);
    assert.equal(typeof result.nextAction, "string");
  }
});

test("an ambiguous active branch ruleset prevents a complete ruleset from being overstated", () => {
  const result = githubRulesetReadiness([
    branchRuleset(),
    branchRuleset({ id: 99, conditions: { ref_name: { include: ["refs/heads/*"], exclude: [] } } }),
  ], OPTIONS);

  assert.equal(result.state, "ruleset_ambiguous");
  assert.equal(result.active, false);
  assert.equal(result.strict, true);
  assert.equal(result.mergeQueueRequired, true);
  assert.equal(result.publisherBound, true);
  assert.equal(result.evidencePublisherBound, true);
});

test("fails closed on malformed API and required-status-check shapes", () => {
  const malformedRules = [
    branchRuleset({ rules: undefined }),
    branchRuleset({ rules: [null] }),
    branchRuleset({ rules: [{ type: "required_status_checks" }] }),
    branchRuleset({ rules: [requiredStatusChecks({ checks: "ChangePlane / guard" })] }),
    branchRuleset({
      rules: [requiredStatusChecks({
        checks: [{ context: OPTIONS.guardCheckName, integration_id: String(OPTIONS.publisherIntegrationId) }],
      })],
    }),
    branchRuleset({
      rules: [requiredStatusChecks({ checks: [
        ...expectedChecks(),
        { context: "CI / verify", integration_id: 15369 },
      ] }), { type: "merge_queue" }],
    }),
  ];

  for (const ruleset of malformedRules) {
    assert.equal(githubRulesetReadiness([ruleset], OPTIONS).state, "ruleset_ambiguous");
  }
  for (const input of [null, {}, [null], [branchRuleset({ enforcement: "enabled" })]]) {
    assert.equal(githubRulesetReadiness(input, OPTIONS).state, "ruleset_ambiguous");
  }
  assert.equal(githubRulesetReadiness([], { ...OPTIONS, defaultBranch: "" }).state, "ruleset_ambiguous");
  assert.equal(githubRulesetReadiness([], null).state, "ruleset_ambiguous");
});

test("fails closed on malformed repository selectors even for repository-scoped results", () => {
  const malformedSelectors = [
    { repository_name: { include: [], exclude: [], protected: true } },
    { repository_id: { repository_ids: [0] } },
    { repository_property: { include: [{ name: "risk", property_values: [] }], exclude: [] } },
    { repository_name: { include: ["agent-api"], exclude: [], protected: true }, repository_id: { repository_ids: [77] } },
  ];
  for (const selector of malformedSelectors) {
    const ruleset = branchRuleset({
      conditions: {
        ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
        ...selector,
      },
    });
    assert.equal(githubRulesetReadiness([ruleset], {
      ...OPTIONS,
      repositoryScoped: true,
    }).state, "ruleset_ambiguous");
  }
});

test("strictness and merge queue are not credited from another ruleset", () => {
  const strictWithoutChecks = branchRuleset({
    id: 1,
    rules: [requiredStatusChecks({ checks: [] }), { type: "merge_queue" }],
  });
  const nonStrictAuthority = branchRuleset({
    id: 2,
    rules: [requiredStatusChecks({ strict: false })],
  });

  const result = githubRulesetReadiness([strictWithoutChecks, nonStrictAuthority], OPTIONS);
  assert.equal(result.state, "strict_required");
  assert.equal(result.active, false);
});

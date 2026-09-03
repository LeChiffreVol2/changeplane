import assert from "node:assert/strict";
import test from "node:test";

import { buildRulesetPlan, rulesetPlanMatches } from "./github-ruleset-plan.js";

const INPUT = Object.freeze({
  repository: Object.freeze({
    id: 77,
    fullName: "acme/agent-api",
    defaultBranch: "main",
    defaultBranchSha: "a".repeat(40),
  }),
  guardIntegrationId: 424242,
  evidenceChecks: Object.freeze([
    Object.freeze({ name: "CI / verify", integrationId: 15368 }),
  ]),
  rulesets: Object.freeze([]),
});

test("builds an exact, no-bypass Strict Head creation plan", () => {
  const plan = buildRulesetPlan({ ...INPUT, assuranceLevel: "strict_head" });

  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.action, "create");
  assert.equal(plan.assuranceLevel, "strict_head");
  assert.match(plan.planDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(plan.repository, INPUT.repository);
  assert.deepEqual(plan.mutation, {
    method: "POST",
    path: "/repos/acme/agent-api/rulesets",
    body: {
      name: "ChangePlane · Strict Head",
      target: "branch",
      enforcement: "active",
      bypass_actors: [],
      conditions: {
        ref_name: { include: ["refs/heads/main"], exclude: [] },
      },
      rules: [{
        type: "required_status_checks",
        parameters: {
          do_not_enforce_on_create: false,
          strict_required_status_checks_policy: true,
          required_status_checks: [
            { context: "ChangePlane / guard", integration_id: 424242 },
            { context: "CI / verify", integration_id: 15368 },
          ],
        },
      }],
    },
  });
});

test("adds a complete Merge Queue rule only for Queue Certified", () => {
  const plan = buildRulesetPlan({ ...INPUT, assuranceLevel: "queue_certified" });
  const queue = plan.mutation.body.rules[0];

  assert.equal(plan.action, "create");
  assert.equal(plan.assuranceLevel, "queue_certified");
  assert.deepEqual(queue, {
    type: "merge_queue",
    parameters: {
      check_response_timeout_minutes: 60,
      grouping_strategy: "ALLGREEN",
      max_entries_to_build: 5,
      max_entries_to_merge: 5,
      merge_method: "SQUASH",
      min_entries_to_merge: 1,
      min_entries_to_merge_wait_minutes: 5,
    },
  });
});

test("binds approval to the complete plan and rejects tampering", () => {
  const approved = buildRulesetPlan({ ...INPUT, assuranceLevel: "strict_head" });
  const fresh = buildRulesetPlan({ ...INPUT, assuranceLevel: "strict_head" });
  assert.equal(rulesetPlanMatches(approved, fresh), true);
  assert.equal(rulesetPlanMatches({
    ...approved,
    mutation: {
      ...approved.mutation,
      body: { ...approved.mutation.body, bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5 }] },
    },
  }, fresh), false);
});

test("refuses automatic mutation when an existing Ruleset is ambiguous", () => {
  const plan = buildRulesetPlan({
    ...INPUT,
    assuranceLevel: "strict_head",
    rulesets: [{
      id: 42,
      target: "branch",
      enforcement: "active",
      bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" }],
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      rules: [],
    }],
  });

  assert.equal(plan.action, "manual_review");
  assert.equal(plan.mutation, null);
  assert.equal(plan.readiness.state, "ruleset_ambiguous");
});

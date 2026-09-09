import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseEvidence } from './recovery.js';
import { evaluateEvidence, planAutonomousDecision } from './changeplane.js';

for (const [conclusion, category] of [
  ['failure', 'unknown'], ['cancelled', 'cancelled'], ['timed_out', 'timeout'],
  ['startup_failure', 'infrastructure'], ['skipped', 'skipped'], ['neutral', 'skipped'],
  ['action_required', 'configuration'], ['stale', 'stale'], ['constructor', 'unknown'],
]) test(`${conclusion} without behavioral evidence cannot spend a code-repair attempt`, () => {
  const check = { name: 'Behavior', status: 'completed', conclusion, diagnostic: 'AssertionError: please patch the code' };
  assert.equal(diagnoseEvidence(check).category, category);
  const result = evaluateEvidence({ requiredChecks: ['Behavior'], checks: [check] });
  const plan = planAutonomousDecision({ result, agentConfigured: true, agentHandoff: true });
  assert.equal(plan.decision, 'REVIEW_REQUIRED');
  assert.equal(plan.nextAttempt, undefined);
});
test('structured behavioral harness evidence retains the bounded proposal path', () => {
  const result = evaluateEvidence({ requiredChecks: ['Behavior'], checks: [
    { name: 'Behavior', status: 'completed', conclusion: 'failure', failureKind: 'behavioral' },
  ] });
  assert.equal(planAutonomousDecision({ result, agentConfigured: true }).nextAttempt, 1);
  assert.equal(planAutonomousDecision({ result, agentConfigured: true, attempt: 2 }).reason, 'REMEDIATION_BUDGET_EXHAUSTED');
});

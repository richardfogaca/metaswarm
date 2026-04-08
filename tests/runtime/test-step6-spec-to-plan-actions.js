#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const {
  validateStep6WorkflowState,
} = require(path.join(ROOT, 'lib/runtime/temporal/contracts'));
const {
  buildPlanningArtifactRef,
  executeIdempotentSpecToPlanAction,
} = require(path.join(ROOT, 'lib/runtime/temporal/spec-to-plan-actions'));

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step6-actions-'));
}

function makeAction(overrides = {}) {
  return {
    kind: 'draft_plan',
    actionKey: 'draft-plan-1',
    artifactKey: 'planning-draft-1',
    instructions: 'Draft an implementation plan for the issue.',
    ...overrides,
  };
}

test('validateStep6WorkflowState accepts restricted spec-to-plan action states', () => {
  const draftPlan = validateStep6WorkflowState({
    version: 1,
    kind: 'run_spec_to_plan_action',
    specToPlanAction: makeAction(),
    blockers: ['Drafting implementation plan'],
    lastUpdatedAt: '2026-04-08T21:00:00.000Z',
  });

  const designReview = validateStep6WorkflowState({
    version: 1,
    kind: 'run_spec_to_plan_action',
    specToPlanAction: makeAction({
      kind: 'run_design_review_gate',
      actionKey: 'design-review-1',
      artifactKey: 'design-review-1',
      sourceArtifactKey: 'planning-draft-1',
    }),
    lastUpdatedAt: '2026-04-08T21:05:00.000Z',
  });

  assert.equal(draftPlan.kind, 'run_spec_to_plan_action');
  assert.equal(draftPlan.specToPlanAction.kind, 'draft_plan');
  assert.equal(designReview.specToPlanAction.kind, 'run_design_review_gate');
});

test('validateStep6WorkflowState rejects malformed spec-to-plan action shapes', () => {
  assert.throws(
    () =>
      validateStep6WorkflowState({
        version: 1,
        kind: 'run_spec_to_plan_action',
        specToPlanAction: {
          kind: 'draft_plan',
          actionKey: 'draft-plan-1',
        },
        lastUpdatedAt: '2026-04-08T21:00:00.000Z',
      }),
    /artifactKey/i
  );

  assert.throws(
    () =>
      validateStep6WorkflowState({
        version: 1,
        kind: 'run_spec_to_plan_action',
        specToPlanAction: {
          kind: 'ship_it',
          actionKey: 'bad-action',
          artifactKey: 'bad-artifact',
        },
        lastUpdatedAt: '2026-04-08T21:00:00.000Z',
      }),
    /specToPlanAction\.kind/i
  );

  assert.throws(
    () =>
      validateStep6WorkflowState({
        version: 1,
        kind: 'run_spec_to_plan_action',
        specToPlanAction: {
          kind: 'run_plan_review_gate',
          actionKey: 'plan-review-1',
          artifactKey: 'plan-review-1',
          sourceArtifactKey: 'bad/path',
        },
        lastUpdatedAt: '2026-04-08T21:00:00.000Z',
      }),
    /sourceArtifactKey/i
  );
});

test('executeIdempotentSpecToPlanAction writes a stable planning artifact and avoids duplicate adapter calls', async () => {
  const repoRoot = makeRepoRoot();
  let adapterCalls = 0;

  const first = await executeIdempotentSpecToPlanAction({
    repoRoot,
    runId: 'run-step6-action',
    beadsId: 'bd-step6-action',
    action: makeAction(),
    performSpecToPlanAction: async action => {
      adapterCalls += 1;
      return {
        status: 'draft',
        summary: `Drafted plan for ${action.actionKey}`,
      };
    },
  });

  const second = await executeIdempotentSpecToPlanAction({
    repoRoot,
    runId: 'run-step6-action',
    beadsId: 'bd-step6-action',
    action: makeAction(),
    performSpecToPlanAction: async () => {
      adapterCalls += 1;
      return {
        status: 'approved',
      };
    },
  });

  assert.equal(adapterCalls, 1);
  assert.equal(first.artifactRef, second.artifactRef);
  assert.equal(second.reused, true);
  assert.equal(first.artifactRef, buildPlanningArtifactRef('planning-draft-1'));

  const written = JSON.parse(fs.readFileSync(path.join(repoRoot, first.artifactRef), 'utf8'));
  assert.equal(written.action.kind, 'draft_plan');
  assert.equal(written.result.status, 'draft');
});

#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const {
  validateStep7WorkflowState,
} = require(path.join(ROOT, 'lib/runtime/temporal/contracts'));
const {
  buildWorkUnitArtifactRef,
  executeIdempotentWorkUnitAction,
} = require(path.join(ROOT, 'lib/runtime/temporal/work-unit-actions'));

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step7-actions-'));
}

function makeAction(overrides = {}) {
  return {
    kind: 'implement',
    workUnitId: 'wu-001',
    actionKey: 'wu-001-implement-1',
    artifactKey: 'wu-001-implement-1',
    instructions: 'Implement the work unit according to the approved plan.',
    ...overrides,
  };
}

test('validateStep7WorkflowState accepts restricted work-unit action states', () => {
  const implementState = validateStep7WorkflowState({
    version: 1,
    kind: 'run_work_unit_action',
    workUnitAction: makeAction(),
    blockers: ['Implementing work unit'],
    lastUpdatedAt: '2026-04-08T21:00:00.000Z',
  });

  const reviewState = validateStep7WorkflowState({
    version: 1,
    kind: 'run_work_unit_action',
    workUnitAction: makeAction({
      kind: 'adversarial_review',
      actionKey: 'wu-001-review-2',
      artifactKey: 'wu-001-review-2',
      sourceArtifactKey: 'wu-001-validate-1',
    }),
    blockers: ['Running fresh adversarial review'],
    lastUpdatedAt: '2026-04-08T21:05:00.000Z',
  });

  assert.equal(implementState.workUnitAction.kind, 'implement');
  assert.equal(reviewState.workUnitAction.kind, 'adversarial_review');
  assert.equal(reviewState.workUnitAction.sourceArtifactKey, 'wu-001-validate-1');
});

test('validateStep7WorkflowState rejects malformed work-unit action shapes', () => {
  assert.throws(
    () =>
      validateStep7WorkflowState({
        version: 1,
        kind: 'run_work_unit_action',
        workUnitAction: {
          kind: 'implement',
          actionKey: 'wu-001-implement-1',
          artifactKey: 'wu-001-implement-1',
        },
        lastUpdatedAt: '2026-04-08T21:00:00.000Z',
      }),
    /workUnitId/i
  );

  assert.throws(
    () =>
      validateStep7WorkflowState({
        version: 1,
        kind: 'run_work_unit_action',
        workUnitAction: {
          kind: 'validate',
          workUnitId: 'wu-001',
          actionKey: 'wu-001-validate-1',
          artifactKey: 'wu-001-validate-1',
        },
        lastUpdatedAt: '2026-04-08T21:00:00.000Z',
      }),
    /sourceArtifactKey/i
  );

  assert.throws(
    () =>
      validateStep7WorkflowState({
        version: 1,
        kind: 'run_work_unit_action',
        workUnitAction: {
          kind: 'ship_it',
          workUnitId: 'wu-001',
          actionKey: 'wu-001-bad-1',
          artifactKey: 'wu-001-bad-1',
        },
        lastUpdatedAt: '2026-04-08T21:00:00.000Z',
      }),
    /workUnitAction\.kind/i
  );
});

test('executeIdempotentWorkUnitAction writes a stable artifact and avoids duplicate adapter calls', async () => {
  const repoRoot = makeRepoRoot();
  let adapterCalls = 0;

  const first = await executeIdempotentWorkUnitAction({
    repoRoot,
    runId: 'run-step7-action',
    beadsId: 'bd-step7-action',
    action: makeAction(),
    performWorkUnitAction: async action => {
      adapterCalls += 1;
      return {
        status: 'implemented',
        summary: `Implemented ${action.workUnitId}`,
      };
    },
  });

  const second = await executeIdempotentWorkUnitAction({
    repoRoot,
    runId: 'run-step7-action',
    beadsId: 'bd-step7-action',
    action: makeAction(),
    performWorkUnitAction: async () => {
      adapterCalls += 1;
      return {
        status: 'should-not-run',
      };
    },
  });

  assert.equal(adapterCalls, 1);
  assert.equal(first.artifactRef, second.artifactRef);
  assert.equal(second.reused, true);
  assert.equal(first.artifactRef, buildWorkUnitArtifactRef('wu-001-implement-1'));

  const written = JSON.parse(fs.readFileSync(path.join(repoRoot, first.artifactRef), 'utf8'));
  assert.equal(written.action.kind, 'implement');
  assert.equal(written.action.workUnitId, 'wu-001');
  assert.equal(written.result.status, 'implemented');
});

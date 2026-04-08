#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const {
  validateStep4WorkflowState,
} = require(path.join(ROOT, 'lib/runtime/temporal/contracts'));
const {
  loadBeadsWorkflowState,
} = require(path.join(ROOT, 'lib/runtime/temporal/beads-workflow-state'));

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step4-state-'));
}

function run(repoRoot, command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function initBeadsRepo(repoRoot, prefix) {
  run(repoRoot, 'git', ['init', '-q']);
  run(repoRoot, 'bd', ['init', '--non-interactive', '--quiet', '--skip-agents', '--skip-hooks', '--prefix', prefix]);
}

function createIssue(repoRoot) {
  return run(repoRoot, 'bd', ['create', 'Step 4 test issue', '--type', 'task', '--silent']).trim();
}

function setWorkflowState(repoRoot, beadsId, state) {
  run(repoRoot, 'bd', [
    'update',
    beadsId,
    '--set-metadata',
    `temporal_workflow_state=${JSON.stringify(state)}`,
  ]);
}

test('validateStep4WorkflowState accepts the restricted authoritative states', () => {
  const sleepState = validateStep4WorkflowState({
    version: 1,
    kind: 'sleep_until',
    sleepUntil: '2026-04-08T22:00:00.000Z',
    blockers: ['Waiting for timer wakeup'],
    lastUpdatedAt: '2026-04-08T21:00:00.000Z',
  });
  const approvalState = validateStep4WorkflowState({
    version: 1,
    kind: 'await_human_approval',
    blockers: ['Waiting for operator approval'],
    humanActionRequired: 'Approve latest plan',
    lastUpdatedAt: '2026-04-08T21:05:00.000Z',
  });
  const observationState = validateStep4WorkflowState({
    version: 1,
    kind: 'await_external_observation',
    blockers: ['Waiting for CI'],
    lastUpdatedAt: '2026-04-08T21:10:00.000Z',
  });
  const completeState = validateStep4WorkflowState({
    version: 1,
    kind: 'complete',
    acceptedChanges: ['plan-approved'],
    lastUpdatedAt: '2026-04-08T21:15:00.000Z',
  });

  assert.equal(sleepState.kind, 'sleep_until');
  assert.equal(approvalState.kind, 'await_human_approval');
  assert.equal(observationState.kind, 'await_external_observation');
  assert.equal(completeState.kind, 'complete');
});

test('validateStep4WorkflowState rejects malformed restricted states', () => {
  assert.throws(
    () =>
      validateStep4WorkflowState({
        version: 1,
        kind: 'sleep_until',
        lastUpdatedAt: '2026-04-08T21:00:00.000Z',
      }),
    /sleepUntil/i
  );

  assert.throws(
    () =>
      validateStep4WorkflowState({
        version: 1,
        kind: 'await_human_approval',
        blockers: ['Waiting for approval'],
        humanActionRequired: 42,
        lastUpdatedAt: '2026-04-08T21:00:00.000Z',
      }),
    /humanActionRequired/i
  );

  assert.throws(
    () =>
      validateStep4WorkflowState({
        version: 1,
        kind: 'complete',
        lastUpdatedAt: 'not-a-timestamp',
      }),
    /lastUpdatedAt/i
  );
});

test('loadBeadsWorkflowState parses metadata.temporal_workflow_state from BEADS', async () => {
  const repoRoot = makeRepoRoot();
  initBeadsRepo(repoRoot, 'step4state');
  const beadsId = createIssue(repoRoot);

  setWorkflowState(repoRoot, beadsId, {
    version: 1,
    kind: 'await_human_approval',
    blockers: ['Waiting for operator approval'],
    humanActionRequired: 'Approve the proposed changes',
    lastUpdatedAt: '2026-04-08T21:00:00.000Z',
  });

  const state = await loadBeadsWorkflowState({
    repoRoot,
    beadsId,
  });

  assert.equal(state.kind, 'await_human_approval');
  assert.equal(state.humanActionRequired, 'Approve the proposed changes');
});

test('loadBeadsWorkflowState fails loudly when workflow metadata is missing or malformed', async () => {
  const repoRoot = makeRepoRoot();
  initBeadsRepo(repoRoot, 'step4missing');
  const missingId = createIssue(repoRoot);

  await assert.rejects(
    () =>
      loadBeadsWorkflowState({
        repoRoot,
        beadsId: missingId,
      }),
    /temporal_workflow_state/i
  );

  const malformedId = createIssue(repoRoot);
  run(repoRoot, 'bd', [
    'update',
    malformedId,
    '--set-metadata',
    'temporal_workflow_state=not-json',
  ]);

  await assert.rejects(
    () =>
      loadBeadsWorkflowState({
        repoRoot,
        beadsId: malformedId,
      }),
    /valid JSON/i
  );
});

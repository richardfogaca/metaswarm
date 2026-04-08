#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const {
  buildStep1ReviewArtifact,
  buildTerminalWorkflowResult,
  validateIssueWorkflowInput,
  validateIssueWorkflowResult,
  validateMorningReviewArtifact,
} = require(path.join(ROOT, 'lib/runtime/temporal/contracts'));
const { materializeRunSummary } = require(path.join(ROOT, 'lib/runtime/temporal/review-artifacts'));

function makeInput(overrides = {}) {
  return {
    version: 1,
    runId: 'run-step1-contracts',
    triggerType: 'ad_hoc',
    beadsTarget: {
      kind: 'existing',
      beadsId: 'bd-1234',
    },
    initiatedAt: '2026-04-08T21:00:00.000Z',
    initiatedBy: 'operator',
    runtimeSkeleton: {
      mode: 'complete',
    },
    ...overrides,
  };
}

function makeArtifact(overrides = {}) {
  return {
    version: 1,
    runId: 'run-step1-contracts',
    beadsId: 'bd-1234',
    triggerType: 'ad_hoc',
    runtimeStatus: 'sleeping',
    startedAt: '2026-04-08T21:00:00.000Z',
    endedAt: '2026-04-08T21:10:00.000Z',
    stepsAttempted: ['runtime-skeleton'],
    acceptedChanges: [],
    validationSummary: {
      testsRun: [],
      checksRun: [],
      passes: [],
      failures: [],
      warnings: [],
    },
    blockers: ['Waiting for timer wakeup'],
    humanActionRequired: null,
    ...overrides,
  };
}

test('validateIssueWorkflowInput accepts the restricted Step 1 profile', () => {
  const input = validateIssueWorkflowInput(
    makeInput({
      runtimeSkeleton: {
        mode: 'sleep_until',
        sleepUntil: '2026-04-08T22:00:00.000Z',
        reason: 'Wait for deterministic timer wakeup',
      },
    })
  );

  assert.equal(input.beadsTarget.kind, 'existing');
  assert.equal(input.runtimeSkeleton.mode, 'sleep_until');
});

test('validateIssueWorkflowInput rejects materialized BEADS targets in Step 1', () => {
  assert.throws(
    () =>
      validateIssueWorkflowInput(
        makeInput({
          beadsTarget: {
            kind: 'materialized',
            beadsId: 'bd-9999',
            sourceTaskDefinitionId: 'taskdef-step1',
          },
        })
      ),
    /existing/i
  );
});

test('validateIssueWorkflowInput rejects malformed timer directives', () => {
  assert.throws(
    () =>
      validateIssueWorkflowInput(
        makeInput({
          runtimeSkeleton: {
            mode: 'sleep_until',
          },
        })
      ),
    /sleepUntil/i
  );

  assert.throws(
    () =>
      validateIssueWorkflowInput(
        makeInput({
          runtimeSkeleton: {
            mode: 'sleep_until',
            sleepUntil: '2026-04-08T20:59:59.000Z',
          },
        })
      ),
    /later than initiatedAt/i
  );
});

test('validateIssueWorkflowResult only accepts terminal completion states', () => {
  const result = validateIssueWorkflowResult(
    buildTerminalWorkflowResult({
      runId: 'run-step1-contracts',
      beadsId: 'bd-1234',
      terminalStatus: 'completed',
      summaryRef: '.metaswarm/runtime/reviews/run-step1-contracts.json',
    })
  );

  assert.equal(result.terminalStatus, 'completed');

  assert.throws(
    () =>
      validateIssueWorkflowResult({
        version: 1,
        runId: 'run-step1-contracts',
        beadsId: 'bd-1234',
        terminalStatus: 'sleeping',
        summaryRef: '.metaswarm/runtime/reviews/run-step1-contracts.json',
      }),
    /terminalStatus/i
  );
});

test('validateMorningReviewArtifact accepts sleeping and completed artifacts', () => {
  const sleeping = validateMorningReviewArtifact(makeArtifact());
  const completed = validateMorningReviewArtifact(
    makeArtifact({
      runtimeStatus: 'completed',
      blockers: [],
      endedAt: '2026-04-08T22:00:00.000Z',
    })
  );

  assert.equal(sleeping.runtimeStatus, 'sleeping');
  assert.equal(completed.runtimeStatus, 'completed');
});

test('materializeRunSummary rewrites the stable per-run artifact path idempotently', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step1-artifacts-'));
  const sleepingArtifact = buildStep1ReviewArtifact({
    input: makeInput(),
    runtimeStatus: 'sleeping',
    endedAt: '2026-04-08T21:10:00.000Z',
    blockers: ['Waiting for timer wakeup'],
    humanActionRequired: null,
  });

  const firstWrite = await materializeRunSummary({
    repoRoot,
    artifact: sleepingArtifact,
  });

  const completedArtifact = buildStep1ReviewArtifact({
    input: makeInput(),
    runtimeStatus: 'completed',
    endedAt: '2026-04-08T22:00:00.000Z',
    blockers: [],
    humanActionRequired: null,
  });

  const secondWrite = await materializeRunSummary({
    repoRoot,
    artifact: completedArtifact,
  });

  assert.equal(firstWrite.summaryRef, secondWrite.summaryRef);

  const writtenArtifact = JSON.parse(
    fs.readFileSync(path.join(repoRoot, secondWrite.summaryRef), 'utf8')
  );
  assert.equal(writtenArtifact.runtimeStatus, 'completed');
});

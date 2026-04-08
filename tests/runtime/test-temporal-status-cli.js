#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const { materializeLaunchRecord } = require(path.join(ROOT, 'lib/runtime/temporal/launch-records'));
const { materializeRunSummary } = require(path.join(ROOT, 'lib/runtime/temporal/review-artifacts'));

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step8-status-cli-'));
}

function makeLaunchRecord() {
  return {
    version: 1,
    runId: 'run-step8-cli',
    taskDefinitionId: 'taskdef-step8-cli',
    triggerType: 'ad_hoc',
    initiatedAt: '2026-04-08T12:00:00.000Z',
    initiatedBy: 'operator',
    materialization: {
      sourceKind: 'existing_beads_issue',
      resolvedBeadsId: 'bd-step8-cli',
      created: false,
    },
    workflowInput: {
      version: 1,
      runId: 'run-step8-cli',
      triggerType: 'ad_hoc',
      taskDefinitionId: 'taskdef-step8-cli',
      beadsTarget: {
        kind: 'existing',
        beadsId: 'bd-step8-cli',
      },
      initiatedAt: '2026-04-08T12:00:00.000Z',
      initiatedBy: 'operator',
      runtimeSkeleton: {
        mode: 'complete',
      },
    },
  };
}

function makeReviewArtifact() {
  return {
    version: 1,
    runId: 'run-step8-cli',
    beadsId: 'bd-step8-cli',
    taskDefinitionId: 'taskdef-step8-cli',
    triggerType: 'ad_hoc',
    runtimeStatus: 'blocked',
    startedAt: '2026-04-08T12:00:00.000Z',
    endedAt: '2026-04-08T12:05:00.000Z',
    stepsAttempted: ['runtime-skeleton'],
    acceptedChanges: ['Prepared the branch'],
    validationSummary: {
      status: 'passed',
      checks: ['unit'],
    },
    blockers: ['Waiting for human approval'],
    humanActionRequired: 'Approve the run',
  };
}

async function seedRuntime(repoRoot) {
  await materializeLaunchRecord({
    repoRoot,
    launchRecord: makeLaunchRecord(),
  });
  await materializeRunSummary({
    repoRoot,
    artifact: makeReviewArtifact(),
  });
}

test('temporal status --json prints the merged status view', async () => {
  const repoRoot = makeRepoRoot();
  await seedRuntime(repoRoot);

  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'cli/metaswarm.js'), 'temporal', 'status', '--run-id', 'run-step8-cli', '--json'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        TEMPORAL_ADDRESS: '',
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.runId, 'run-step8-cli');
  assert.equal(parsed.runtimeStatus, 'blocked');
  assert.equal(parsed.launchRef, '.metaswarm/runtime/launches/run-step8-cli.json');
  assert.equal(parsed.summaryRef, '.metaswarm/runtime/reviews/run-step8-cli.json');
});

test('temporal status prints a concise human-readable summary', async () => {
  const repoRoot = makeRepoRoot();
  await seedRuntime(repoRoot);

  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'cli/metaswarm.js'), 'temporal', 'status', '--run-id', 'run-step8-cli'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        TEMPORAL_ADDRESS: '',
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /runtime status:\s+blocked/);
  assert.match(result.stdout, /launch ref:\s+.metaswarm\/runtime\/launches\/run-step8-cli\.json/);
  assert.match(result.stdout, /summary ref:\s+.metaswarm\/runtime\/reviews\/run-step8-cli\.json/);
  assert.match(result.stdout, /Waiting for human approval/);
  assert.match(result.stdout, /Approve the run/);
});

test('temporal status rejects ambiguous selectors', async () => {
  const repoRoot = makeRepoRoot();
  await seedRuntime(repoRoot);

  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'cli/metaswarm.js'),
      'temporal',
      'status',
      '--latest',
      '--run-id',
      'run-step8-cli',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /exactly one selector/i);
});

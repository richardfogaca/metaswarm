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
  DEFAULT_TEMPORAL_TASK_QUEUE,
  createWorkerBootstrapOptions,
  ensureRuntimeDirectories,
  resolveRuntimePaths,
  toIssueWorkflowId,
  toScheduledWorkflowId,
} = require(path.join(ROOT, 'lib/runtime/temporal/bootstrap'));

function makeTempRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-temporal-bootstrap-'));
}

test('resolveRuntimePaths keeps runtime data under .metaswarm/runtime', () => {
  const repoRoot = '/tmp/metaswarm-example';
  const paths = resolveRuntimePaths(repoRoot);

  assert.equal(paths.repoRoot, repoRoot);
  assert.equal(paths.runtimeRoot, path.join(repoRoot, '.metaswarm', 'runtime'));
  assert.equal(paths.taskDefinitionsDir, path.join(repoRoot, '.metaswarm', 'runtime', 'task-definitions'));
  assert.equal(paths.launchesDir, path.join(repoRoot, '.metaswarm', 'runtime', 'launches'));
  assert.equal(paths.schedulesDir, path.join(repoRoot, '.metaswarm', 'runtime', 'schedules'));
  assert.equal(paths.reviewsDir, path.join(repoRoot, '.metaswarm', 'runtime', 'reviews'));
});

test('ensureRuntimeDirectories creates the bootstrap directory layout', () => {
  const repoRoot = makeTempRepoRoot();
  const paths = ensureRuntimeDirectories(repoRoot);

  assert.ok(fs.statSync(paths.runtimeRoot).isDirectory());
  assert.ok(fs.statSync(paths.taskDefinitionsDir).isDirectory());
  assert.ok(fs.statSync(paths.launchesDir).isDirectory());
  assert.ok(fs.statSync(paths.schedulesDir).isDirectory());
  assert.ok(fs.statSync(paths.reviewsDir).isDirectory());
});

test('toIssueWorkflowId uses the documented issue-<beads-id> shape', () => {
  assert.equal(toIssueWorkflowId('bd-1234'), 'issue-bd-1234');
  assert.throws(() => toIssueWorkflowId(''), /beadsId/i);
});

test('toScheduledWorkflowId uses a schedule-scoped workflow id shape', () => {
  assert.equal(
    toScheduledWorkflowId('bd-1234', 'sched-nightly'),
    'issue-bd-1234-schedule-sched-nightly'
  );
  assert.throws(() => toScheduledWorkflowId('', 'sched-nightly'), /beadsId/i);
  assert.throws(() => toScheduledWorkflowId('bd-1234', ''), /scheduleId/i);
});

test('createWorkerBootstrapOptions wires task queue, workflow module, and activities', () => {
  const activities = {
    emitRunSummary() {},
  };

  const options = createWorkerBootstrapOptions({
    repoRoot: ROOT,
    activities,
  });

  assert.equal(options.taskQueue, DEFAULT_TEMPORAL_TASK_QUEUE);
  assert.equal(options.activities, activities);
  assert.match(options.workflowsPath, /lib\/runtime\/temporal\/workflows\/issue-workflow\.js$/);
});

test('temporal worker bootstrap script supports a dry-run check mode', () => {
  const repoRoot = makeTempRepoRoot();
  const output = execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts/temporal-worker.js'),
      '--check',
      '--repo-root',
      repoRoot,
    ],
    { encoding: 'utf8' }
  );
  const summary = JSON.parse(output);

  assert.equal(summary.taskQueue, DEFAULT_TEMPORAL_TASK_QUEUE);
  assert.equal(summary.repoRoot, repoRoot);
  assert.match(summary.workflowsPath, /lib\/runtime\/temporal\/workflows\/issue-workflow\.js$/);
  assert.equal(summary.runtimePaths.reviewsDir, path.join(repoRoot, '.metaswarm', 'runtime', 'reviews'));
});

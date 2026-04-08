#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Worker } = require('@temporalio/worker');
const { TestWorkflowEnvironment } = require('@temporalio/testing');

const ROOT = path.resolve(__dirname, '../..');
const { DEFAULT_TEMPORAL_TASK_QUEUE } = require(path.join(ROOT, 'lib/runtime/temporal/bootstrap'));
const { createTemporalActivities } = require(path.join(ROOT, 'lib/runtime/temporal/activities'));
const { launchAdHocTask, prepareAdHocLaunch } = require(path.join(
  ROOT,
  'lib/runtime/temporal/ad-hoc-launch'
));

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step2-launch-'));
}

function writeJson(repoRoot, relativePath, value) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(repoRoot, relativePath, value) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, value);
}

function makeRequest(taskDefinitionId, runId) {
  return {
    version: 1,
    taskDefinitionId,
    initiatedAt: '2026-04-08T21:00:00.000Z',
    initiatedBy: 'operator',
    runId,
    runtimeSkeleton: {
      mode: 'complete',
    },
  };
}

test('existing-target and create-new launches converge on the same workflow input contract', async () => {
  const repoRoot = makeRepoRoot();

  writeJson(repoRoot, '.metaswarm/runtime/task-definitions/taskdef-existing.json', {
    version: 1,
    taskDefinitionId: 'taskdef-existing',
    name: 'Existing issue launch',
    mode: 'ad_hoc',
    materialization: {
      kind: 'existing_beads_issue',
      beadsId: 'bd-existing-step2',
    },
  });

  writeJson(repoRoot, '.metaswarm/runtime/task-definitions/taskdef-create.json', {
    version: 1,
    taskDefinitionId: 'taskdef-create',
    name: 'Create issue launch',
    mode: 'ad_hoc',
    materialization: {
      kind: 'create_beads_issue',
      issueType: 'task',
      titleTemplate: 'Created issue {run_id}',
      descriptionTemplateRef: 'templates/runtime/create.md',
      priority: 2,
    },
  });
  writeText(repoRoot, 'templates/runtime/create.md', 'Created from {task_definition_id}.');

  const existingLaunch = await prepareAdHocLaunch({
    repoRoot,
    request: makeRequest('taskdef-existing', 'run-step2-existing'),
  });

  const createLaunch = await prepareAdHocLaunch({
    repoRoot,
    request: makeRequest('taskdef-create', 'run-step2-create'),
    createBeadsIssue: async () => ({
      beadsId: 'bd-created-step2',
    }),
  });

  assert.equal(existingLaunch.workflowInput.triggerType, 'ad_hoc');
  assert.equal(createLaunch.workflowInput.triggerType, 'ad_hoc');
  assert.deepEqual(existingLaunch.workflowInput.beadsTarget, {
    kind: 'existing',
    beadsId: 'bd-existing-step2',
  });
  assert.deepEqual(createLaunch.workflowInput.beadsTarget, {
    kind: 'existing',
    beadsId: 'bd-created-step2',
  });
});

test('launchAdHocTask can start the Step 1 workflow for an existing or created BEADS target', async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const repoRoot = makeRepoRoot();

  writeJson(repoRoot, '.metaswarm/runtime/task-definitions/taskdef-existing-run.json', {
    version: 1,
    taskDefinitionId: 'taskdef-existing-run',
    name: 'Existing issue runtime launch',
    mode: 'ad_hoc',
    materialization: {
      kind: 'existing_beads_issue',
      beadsId: 'bd-existing-runtime',
    },
  });

  writeJson(repoRoot, '.metaswarm/runtime/task-definitions/taskdef-create-run.json', {
    version: 1,
    taskDefinitionId: 'taskdef-create-run',
    name: 'Create issue runtime launch',
    mode: 'ad_hoc',
    materialization: {
      kind: 'create_beads_issue',
      issueType: 'task',
      titleTemplate: 'Runtime created issue {run_id}',
      descriptionTemplateRef: 'templates/runtime/runtime-create.md',
    },
  });
  writeText(repoRoot, 'templates/runtime/runtime-create.md', 'Runtime path for {task_definition_id}.');

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('../../lib/runtime/temporal/workflows/issue-workflow'),
    activities: createTemporalActivities({ repoRoot }),
  });

  try {
    const { existingResult, createdResult } = await worker.runUntil(async () => {
      const existingLaunch = await launchAdHocTask({
        repoRoot,
        request: makeRequest('taskdef-existing-run', 'run-step2-existing-runtime'),
        client: env.client,
      });
      const launch = await launchAdHocTask({
        repoRoot,
        request: makeRequest('taskdef-create-run', 'run-step2-create-runtime'),
        client: env.client,
        createBeadsIssue: async () => ({
          beadsId: 'bd-created-runtime',
        }),
      });
      const [existingResult, createdResult] = await Promise.all([
        existingLaunch.handle.result(),
        launch.handle.result(),
      ]);

      return {
        existingResult,
        createdResult,
      };
    });

    assert.equal(existingResult.terminalStatus, 'completed');
    assert.equal(createdResult.terminalStatus, 'completed');

    const existingLaunchRecord = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, '.metaswarm/runtime/launches/run-step2-existing-runtime.json'),
        'utf8'
      )
    );
    const createdLaunchRecord = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, '.metaswarm/runtime/launches/run-step2-create-runtime.json'),
        'utf8'
      )
    );

    assert.equal(existingLaunchRecord.workflowInput.beadsTarget.kind, 'existing');
    assert.equal(createdLaunchRecord.workflowInput.beadsTarget.kind, 'existing');
    assert.equal(createdLaunchRecord.materialization.resolvedBeadsId, 'bd-created-runtime');

    const existingReview = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, '.metaswarm/runtime/reviews/run-step2-existing-runtime.json'),
        'utf8'
      )
    );
    const createdReview = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, '.metaswarm/runtime/reviews/run-step2-create-runtime.json'),
        'utf8'
      )
    );

    assert.equal(existingReview.runtimeStatus, 'completed');
    assert.equal(createdReview.runtimeStatus, 'completed');
  } finally {
    await env.teardown();
  }
});

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
const { launchRecurringSchedule } = require(path.join(ROOT, 'lib/runtime/temporal/schedules'));

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step3-recurring-launch-'));
}

function writeJson(repoRoot, relativePath, value) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeRecurringScheduleDefinition(overrides = {}) {
  return {
    version: 1,
    scheduleId: 'sched-runtime-recurring-step3',
    taskDefinitionId: 'taskdef-runtime-recurring-step3',
    state: 'active',
    trigger: {
      kind: 'recurring',
      cadence: {
        kind: 'cron',
        expression: '* * * * *',
      },
    },
    overlapPolicy: 'allow_parallel',
    catchupPolicy: 'none',
    timezone: 'UTC',
    ...overrides,
  };
}

test('launchRecurringSchedule drives recurring existing-target runs through the issue workflow contract', async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const repoRoot = makeRepoRoot();
  const initiatedAt = new Date(await env.currentTimeMs()).toISOString();

  writeJson(
    repoRoot,
    '.metaswarm/runtime/task-definitions/taskdef-runtime-recurring-step3.json',
    {
      version: 1,
      taskDefinitionId: 'taskdef-runtime-recurring-step3',
      name: 'Recurring runtime task',
      mode: 'recurring',
      materialization: {
        kind: 'existing_beads_issue',
        beadsId: 'bd-runtime-recurring-step3',
      },
    }
  );
  writeJson(
    repoRoot,
    '.metaswarm/runtime/schedules/sched-runtime-recurring-step3.json',
    makeRecurringScheduleDefinition()
  );

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('../../lib/runtime/temporal/workflows'),
    activities: createTemporalActivities({ repoRoot, client: env.client }),
  });

  try {
    const runWorker = worker.run();
    const handle = await launchRecurringSchedule({
      repoRoot,
      scheduleId: 'sched-runtime-recurring-step3',
      initiatedAt,
      client: env.client,
    });

    await env.sleep('70 seconds');
    await handle.cancel();
    await env.sleep('1 second');
    worker.shutdown();
    await runWorker;

    const launchPaths = fs
      .readdirSync(path.join(repoRoot, '.metaswarm', 'runtime', 'launches'))
      .sort();
    assert.equal(launchPaths.length, 1);

    const launchRecord = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, '.metaswarm', 'runtime', 'launches', launchPaths[0]),
        'utf8'
      )
    );
    assert.equal(launchRecord.triggerType, 'recurring');
    assert.equal(launchRecord.scheduleId, 'sched-runtime-recurring-step3');
    assert.equal(launchRecord.runtimeStart.mode, 'recurring');
    assert.equal(launchRecord.workflowInput.triggerType, 'recurring');

    const reviewPaths = fs
      .readdirSync(path.join(repoRoot, '.metaswarm', 'runtime', 'reviews'))
      .sort();
    assert.equal(reviewPaths.length, 1);
    const reviewArtifact = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, '.metaswarm', 'runtime', 'reviews', reviewPaths[0]),
        'utf8'
      )
    );
    assert.equal(reviewArtifact.triggerType, 'recurring');
    assert.equal(reviewArtifact.scheduleId, 'sched-runtime-recurring-step3');
  } finally {
    await env.teardown();
  }
});

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
const {
  DEFAULT_TEMPORAL_TASK_QUEUE,
  toScheduledWorkflowId,
} = require(path.join(ROOT, 'lib/runtime/temporal/bootstrap'));
const { createTemporalActivities } = require(path.join(ROOT, 'lib/runtime/temporal/activities'));
const { prepareAdHocLaunch } = require(path.join(ROOT, 'lib/runtime/temporal/ad-hoc-launch'));
const { launchScheduledTask, prepareScheduledLaunch } = require(path.join(
  ROOT,
  'lib/runtime/temporal/schedules'
));

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step3-scheduled-launch-'));
}

function writeJson(repoRoot, relativePath, value) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeScheduledTaskDefinition() {
  return {
    version: 1,
    taskDefinitionId: 'taskdef-scheduled-runtime-step3',
    name: 'Scheduled runtime task',
    mode: 'scheduled_once',
    materialization: {
      kind: 'existing_beads_issue',
      beadsId: 'bd-scheduled-runtime-step3',
    },
  };
}

function makeScheduleDefinition() {
  return {
    version: 1,
    scheduleId: 'sched-runtime-step3',
    taskDefinitionId: 'taskdef-scheduled-runtime-step3',
    state: 'active',
    trigger: {
      kind: 'once',
      startAt: '2026-04-08T22:00:00.000Z',
    },
    overlapPolicy: 'skip',
    catchupPolicy: 'none',
  };
}

test('scheduled launch converges with ad hoc launch apart from trigger-specific fields', async () => {
  const repoRoot = makeRepoRoot();

  writeJson(
    repoRoot,
    '.metaswarm/runtime/task-definitions/taskdef-scheduled-runtime-step3.json',
    makeScheduledTaskDefinition()
  );
  writeJson(
    repoRoot,
    '.metaswarm/runtime/task-definitions/taskdef-ad-hoc-runtime-step3.json',
    {
      ...makeScheduledTaskDefinition(),
      taskDefinitionId: 'taskdef-ad-hoc-runtime-step3',
      mode: 'ad_hoc',
    }
  );
  writeJson(
    repoRoot,
    '.metaswarm/runtime/schedules/sched-runtime-step3.json',
    makeScheduleDefinition()
  );

  const scheduledLaunch = await prepareScheduledLaunch({
    repoRoot,
    scheduleId: 'sched-runtime-step3',
    now: '2026-04-08T21:00:00.000Z',
  });
  const adHocLaunch = await prepareAdHocLaunch({
    repoRoot,
    request: {
      version: 1,
      taskDefinitionId: 'taskdef-ad-hoc-runtime-step3',
      initiatedAt: '2026-04-08T21:00:00.000Z',
      initiatedBy: 'operator',
      runId: 'run-step3-ad-hoc-compare',
      runtimeSkeleton: {
        mode: 'complete',
      },
    },
  });

  assert.deepEqual(scheduledLaunch.workflowInput.beadsTarget, adHocLaunch.workflowInput.beadsTarget);
  assert.equal(scheduledLaunch.workflowInput.taskDefinitionId, 'taskdef-scheduled-runtime-step3');
  assert.equal(adHocLaunch.workflowInput.taskDefinitionId, 'taskdef-ad-hoc-runtime-step3');
  assert.equal(scheduledLaunch.workflowInput.triggerType, 'scheduled_once');
  assert.equal(adHocLaunch.workflowInput.triggerType, 'ad_hoc');
  assert.equal(scheduledLaunch.workflowInput.initiatedBy, 'schedule');
  assert.equal(adHocLaunch.workflowInput.initiatedBy, 'operator');
  assert.equal(scheduledLaunch.launchRecord.scheduleId, 'sched-runtime-step3');
  assert.equal(adHocLaunch.launchRecord.scheduleId, undefined);
});

test('launchScheduledTask starts a delayed-once workflow via Temporal startDelay and emits schedule-aware artifacts', async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const repoRoot = makeRepoRoot();
  const now = new Date(await env.currentTimeMs()).toISOString();
  const startAt = new Date((await env.currentTimeMs()) + 60 * 60 * 1000).toISOString();

  writeJson(
    repoRoot,
    '.metaswarm/runtime/task-definitions/taskdef-scheduled-runtime-step3.json',
    makeScheduledTaskDefinition()
  );
  writeJson(
    repoRoot,
    '.metaswarm/runtime/schedules/sched-runtime-step3.json',
    {
      ...makeScheduleDefinition(),
      trigger: {
        kind: 'once',
        startAt,
      },
    }
  );

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('../../lib/runtime/temporal/workflows/issue-workflow'),
    activities: createTemporalActivities({ repoRoot }),
  });

  try {
    const { result, workflowId, launchRef } = await worker.runUntil(async () => {
      const launch = await launchScheduledTask({
        repoRoot,
        scheduleId: 'sched-runtime-step3',
        now,
        client: env.client,
      });

      return {
        result: await launch.handle.result(),
        workflowId: launch.handle.workflowId,
        launchRef: launch.launchRef,
      };
    });

    assert.equal(result.terminalStatus, 'completed');
    assert.equal(
      workflowId,
      toScheduledWorkflowId('bd-scheduled-runtime-step3', 'sched-runtime-step3')
    );

    const launchRecord = JSON.parse(
      fs.readFileSync(path.join(repoRoot, launchRef), 'utf8')
    );
    assert.equal(launchRecord.triggerType, 'scheduled_once');
    assert.equal(launchRecord.scheduleId, 'sched-runtime-step3');
    assert.equal(launchRecord.runtimeStart.mode, 'delayed_once');
    assert.equal(launchRecord.workflowInput.scheduleId, 'sched-runtime-step3');

    const reviewArtifact = JSON.parse(
      fs.readFileSync(path.join(repoRoot, result.summaryRef), 'utf8')
    );
    assert.equal(reviewArtifact.triggerType, 'scheduled_once');
    assert.equal(reviewArtifact.scheduleId, 'sched-runtime-step3');
    assert.equal(reviewArtifact.runtimeStatus, 'completed');
  } finally {
    await env.teardown();
  }
});

test('launchScheduledTask rejects duplicate registration while a delayed run is already pending', async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const repoRoot = makeRepoRoot();
  const now = new Date(await env.currentTimeMs()).toISOString();
  const startAt = new Date((await env.currentTimeMs()) + 60 * 60 * 1000).toISOString();

  writeJson(
    repoRoot,
    '.metaswarm/runtime/task-definitions/taskdef-scheduled-runtime-step3.json',
    makeScheduledTaskDefinition()
  );
  writeJson(
    repoRoot,
    '.metaswarm/runtime/schedules/sched-runtime-step3.json',
    {
      ...makeScheduleDefinition(),
      trigger: {
        kind: 'once',
        startAt,
      },
    }
  );

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('../../lib/runtime/temporal/workflows/issue-workflow'),
    activities: createTemporalActivities({ repoRoot }),
  });

  try {
    await worker.runUntil(async () => {
      await launchScheduledTask({
        repoRoot,
        scheduleId: 'sched-runtime-step3',
        now,
        client: env.client,
      });

      await assert.rejects(
        () =>
          launchScheduledTask({
            repoRoot,
            scheduleId: 'sched-runtime-step3',
            now,
            client: env.client,
          }),
        /already started|WorkflowExecutionAlreadyStarted/i
      );
    });
  } finally {
    await env.teardown();
  }
});

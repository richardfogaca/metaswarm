#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { Worker } = require('@temporalio/worker');
const { TestWorkflowEnvironment } = require('@temporalio/testing');

const ROOT = path.resolve(__dirname, '../..');
const { DEFAULT_TEMPORAL_TASK_QUEUE, toScheduleWorkflowId } = require(path.join(
  ROOT,
  'lib/runtime/temporal/bootstrap'
));
const { computeRecurringScheduleTick, validateScheduleDefinition } = require(path.join(
  ROOT,
  'lib/runtime/temporal/schedules'
));

function toIso(ms) {
  return new Date(ms).toISOString();
}

function makeScheduleDefinition(overrides = {}) {
  return validateScheduleDefinition({
    version: 1,
    scheduleId: 'sched-recurring-workflow-step3',
    taskDefinitionId: 'taskdef-recurring-workflow-step3',
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
  });
}

function createWorkflowActivities({ scheduleDefinition, launches, activeDurationMs = 0 }) {
  const activeUntil = new Map();

  return {
    async readRecurringScheduleDefinition({ scheduleId }) {
      assert.equal(scheduleId, scheduleDefinition.scheduleId);
      return scheduleDefinition;
    },
    async computeRecurringScheduleTick(input) {
      return computeRecurringScheduleTick(input);
    },
    async filterActiveIssueWorkflowIds({ workflowIds, observedAt }) {
      const observedAtMs = Date.parse(observedAt);
      return workflowIds.filter((workflowId) => {
        const activeUntilMs = activeUntil.get(workflowId);
        return typeof activeUntilMs === 'number' && observedAtMs < activeUntilMs;
      });
    },
    async launchRecurringOccurrence({ scheduledFor }) {
      const workflowId = `issued-${launches.length + 1}`;
      launches.push({
        workflowId,
        scheduledFor,
      });
      activeUntil.set(workflowId, Date.parse(scheduledFor) + activeDurationMs);
      return {
        workflowId,
        runId: `run-${launches.length}`,
      };
    },
  };
}

test('recurring scheduler workflow survives worker restart and can be resumed by a new worker', async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const launches = [];
  const scheduleDefinition = makeScheduleDefinition();
  const workflowId = toScheduleWorkflowId(scheduleDefinition.scheduleId);
  const startMs = await env.currentTimeMs();
  const registeredAt = toIso(startMs + 15 * 1000);

  const workerOne = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('../../lib/runtime/temporal/workflows'),
    activities: createWorkflowActivities({ scheduleDefinition, launches }),
  });

  try {
    const runWorkerOne = workerOne.run();
    await env.client.workflow.start('recurringScheduleWorkflow', {
      args: [
        {
          version: 1,
          scheduleId: scheduleDefinition.scheduleId,
          registeredAt,
        },
      ],
      taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowId,
    });

    await env.sleep('80 seconds');
    workerOne.shutdown();
    await runWorkerOne;

    const handle = env.client.workflow.getHandle(workflowId);
    const description = await handle.describe();
    assert.equal(description.status.name, 'RUNNING');
    assert.equal(launches.length, 1);

    const workerTwo = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowsPath: require.resolve('../../lib/runtime/temporal/workflows'),
      activities: createWorkflowActivities({ scheduleDefinition, launches }),
    });

    const runWorkerTwo = workerTwo.run();
    await handle.cancel();
    await env.sleep('1 second');
    workerTwo.shutdown();
    await runWorkerTwo;

    assert.equal(launches.length, 1);
  } finally {
    await env.teardown();
  }
});

test('recurring scheduler workflow enforces overlapPolicy=skip while still launching later occurrences', async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const launches = [];
  const scheduleDefinition = makeScheduleDefinition({
    overlapPolicy: 'skip',
  });
  const startMs = await env.currentTimeMs();
  const registeredAt = toIso(startMs);

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('../../lib/runtime/temporal/workflows'),
    activities: createWorkflowActivities({
      scheduleDefinition,
      launches,
      activeDurationMs: 90 * 1000,
    }),
  });

  try {
    const runWorker = worker.run();
    const handle = await env.client.workflow.start('recurringScheduleWorkflow', {
      args: [
        {
          version: 1,
          scheduleId: scheduleDefinition.scheduleId,
          registeredAt,
        },
      ],
      taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowId: toScheduleWorkflowId(scheduleDefinition.scheduleId),
    });

    await env.sleep('3 minutes');
    await handle.cancel();
    await env.sleep('1 second');
    worker.shutdown();
    await runWorker;

    assert.equal(launches.length, 2);
    assert.equal(Date.parse(launches[1].scheduledFor) - Date.parse(launches[0].scheduledFor), 2 * 60 * 1000);
  } finally {
    await env.teardown();
  }
});

test('recurring scheduler workflow applies catchupPolicy windows to initial backlog', async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  const launches = [];
  const scheduleDefinition = makeScheduleDefinition({
    catchupPolicy: 'within_window',
    catchupWindowMinutes: 2,
  });
  const startMs = await env.currentTimeMs();
  const registeredAt = toIso(startMs - 3 * 60 * 1000);

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('../../lib/runtime/temporal/workflows'),
    activities: createWorkflowActivities({ scheduleDefinition, launches }),
  });

  try {
    const runWorker = worker.run();
    const handle = await env.client.workflow.start('recurringScheduleWorkflow', {
      args: [
        {
          version: 1,
          scheduleId: scheduleDefinition.scheduleId,
          registeredAt,
        },
      ],
      taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowId: toScheduleWorkflowId(scheduleDefinition.scheduleId),
    });

    await env.sleep('1 second');
    await handle.cancel();
    await env.sleep('1 second');
    worker.shutdown();
    await runWorker;

    assert.equal(launches.length, 2);
    const nowMs = startMs;
    assert.ok(nowMs - Date.parse(launches[0].scheduledFor) <= 2 * 60 * 1000);
    assert.ok(nowMs - Date.parse(launches[1].scheduledFor) <= 2 * 60 * 1000);
  } finally {
    await env.teardown();
  }
});

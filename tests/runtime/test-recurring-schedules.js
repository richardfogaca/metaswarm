#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const {
  computeRecurringScheduleTick,
  normalizeRecurringOccurrenceKey,
  prepareRecurringLaunch,
  validateScheduleDefinition,
} = require(path.join(ROOT, 'lib/runtime/temporal/schedules'));

function makeRepoRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metaswarm-step3-recurring-'));
}

function writeJson(repoRoot, relativePath, value) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeRecurringTaskDefinition(overrides = {}) {
  return {
    version: 1,
    taskDefinitionId: 'taskdef-recurring-step3',
    name: 'Recurring Step 3 task',
    mode: 'recurring',
    materialization: {
      kind: 'existing_beads_issue',
      beadsId: 'bd-recurring-step3',
    },
    ...overrides,
  };
}

function makeRecurringScheduleDefinition(overrides = {}) {
  return {
    version: 1,
    scheduleId: 'sched-recurring-step3',
    taskDefinitionId: 'taskdef-recurring-step3',
    state: 'active',
    trigger: {
      kind: 'recurring',
      cadence: {
        kind: 'cron',
        expression: '* * * * *',
      },
    },
    overlapPolicy: 'allow_parallel',
    catchupPolicy: 'within_window',
    catchupWindowMinutes: 2,
    timezone: 'UTC',
    ...overrides,
  };
}

test('validateScheduleDefinition accepts the recurring expansion profile', () => {
  const scheduleDefinition = validateScheduleDefinition(makeRecurringScheduleDefinition());

  assert.equal(scheduleDefinition.trigger.kind, 'recurring');
  assert.equal(scheduleDefinition.trigger.cadence.kind, 'cron');
  assert.equal(scheduleDefinition.overlapPolicy, 'allow_parallel');
  assert.equal(scheduleDefinition.catchupPolicy, 'within_window');
  assert.equal(scheduleDefinition.catchupWindowMinutes, 2);
  assert.equal(scheduleDefinition.timezone, 'UTC');
});

test('validateScheduleDefinition rejects malformed recurring timezone and catchup shapes', () => {
  assert.throws(
    () =>
      validateScheduleDefinition(
        makeRecurringScheduleDefinition({
          timezone: 'Not/A-Timezone',
        })
      ),
    /timezone/i
  );

  assert.throws(
    () =>
      validateScheduleDefinition(
        makeRecurringScheduleDefinition({
          catchupPolicy: 'within_window',
          catchupWindowMinutes: undefined,
        })
      ),
    /catchupWindowMinutes/i
  );

  assert.throws(
    () =>
      validateScheduleDefinition(
        makeRecurringScheduleDefinition({
          catchupPolicy: 'none',
          catchupWindowMinutes: 15,
        })
      ),
    /catchupWindowMinutes/i
  );
});

test('computeRecurringScheduleTick applies catchup semantics and returns the next occurrence', () => {
  const noneTick = computeRecurringScheduleTick({
    scheduleDefinition: validateScheduleDefinition(
      makeRecurringScheduleDefinition({
        catchupPolicy: 'none',
        catchupWindowMinutes: undefined,
      })
    ),
    after: '2026-04-08T12:00:00.000Z',
    now: '2026-04-08T12:03:30.000Z',
  });

  assert.deepEqual(
    noneTick.dueOccurrences.map((occurrence) => occurrence.scheduledFor),
    ['2026-04-08T12:03:00.000Z']
  );
  assert.equal(noneTick.nextOccurrence, '2026-04-08T12:04:00.000Z');

  const withinWindowTick = computeRecurringScheduleTick({
    scheduleDefinition: validateScheduleDefinition(
      makeRecurringScheduleDefinition({
        catchupPolicy: 'within_window',
        catchupWindowMinutes: 2,
      })
    ),
    after: '2026-04-08T12:00:00.000Z',
    now: '2026-04-08T12:03:30.000Z',
  });

  assert.deepEqual(
    withinWindowTick.dueOccurrences.map((occurrence) => occurrence.scheduledFor),
    ['2026-04-08T12:02:00.000Z', '2026-04-08T12:03:00.000Z']
  );
  assert.equal(withinWindowTick.nextOccurrence, '2026-04-08T12:04:00.000Z');
});

test('prepareRecurringLaunch emits deterministic recurring metadata and schedule-aware create-new materialization', async () => {
  const repoRoot = makeRepoRoot();
  const createRequests = [];

  writeJson(
    repoRoot,
    '.metaswarm/runtime/task-definitions/taskdef-recurring-step3.json',
    makeRecurringTaskDefinition({
      materialization: {
        kind: 'create_beads_issue',
        issueType: 'task',
        titleTemplate: 'Nightly follow-up {yyyy}-{mm}-{dd} {run_id}',
      },
    })
  );
  writeJson(
    repoRoot,
    '.metaswarm/runtime/schedules/sched-recurring-step3.json',
    makeRecurringScheduleDefinition({
      timezone: 'America/Sao_Paulo',
    })
  );

  const scheduledFor = '2026-04-09T02:30:00.000Z';
  const occurrenceKey = normalizeRecurringOccurrenceKey(scheduledFor);
  const prepared = await prepareRecurringLaunch({
    repoRoot,
    scheduleId: 'sched-recurring-step3',
    scheduledFor,
    initiatedAt: '2026-04-09T02:30:05.000Z',
    createBeadsIssue: async (createRequest) => {
      createRequests.push(createRequest);
      return { beadsId: 'bd-created-recurring-step3' };
    },
  });

  assert.equal(prepared.workflowInput.triggerType, 'recurring');
  assert.equal(prepared.workflowInput.scheduleId, 'sched-recurring-step3');
  assert.equal(prepared.workflowInput.runId, `sched-recurring-step3-${occurrenceKey}`);
  assert.equal(prepared.launchRecord.runtimeStart.mode, 'recurring');
  assert.equal(prepared.launchRecord.runtimeStart.scheduledFor, scheduledFor);
  assert.equal(prepared.launchRecord.runtimeStart.occurrenceKey, occurrenceKey);
  assert.equal(prepared.workflowInput.beadsTarget.beadsId, 'bd-created-recurring-step3');
  assert.equal(createRequests.length, 1);
  assert.equal(
    createRequests[0].title,
    `Nightly follow-up 2026-04-08 sched-recurring-step3-${occurrenceKey}`
  );
  assert.equal(
    createRequests[0].externalRef,
    `metaswarm:run:sched-recurring-step3-${occurrenceKey}`
  );
});

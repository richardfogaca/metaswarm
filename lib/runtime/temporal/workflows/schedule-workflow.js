'use strict';

const { proxyActivities, sleep } = require('@temporalio/workflow');

const { validateRecurringScheduleWorkflowInput } = require('../schedule-workflow-contracts');

const {
  computeRecurringScheduleTick,
  filterActiveIssueWorkflowIds,
  launchRecurringOccurrence,
  readRecurringScheduleDefinition,
} = proxyActivities({
  startToCloseTimeout: '1 minute',
});

function nowIso() {
  return new Date(Date.now()).toISOString();
}

async function recurringScheduleWorkflow(rawInput) {
  const input = validateRecurringScheduleWorkflowInput(rawInput);
  const scheduleDefinition = await readRecurringScheduleDefinition({
    scheduleId: input.scheduleId,
  });

  if (scheduleDefinition.state !== 'active') {
    throw new Error(`Schedule ${scheduleDefinition.scheduleId} is paused`);
  }

  if (scheduleDefinition.trigger.kind !== 'recurring') {
    throw new Error('Recurring schedule workflow requires trigger.kind = recurring');
  }

  let after = input.registeredAt;
  let activeWorkflowIds = [];

  while (true) {
    const currentTime = nowIso();
    const tick = await computeRecurringScheduleTick({
      scheduleDefinition,
      after,
      now: currentTime,
    });

    if (tick.dueOccurrences.length === 0) {
      if (!tick.nextOccurrence) {
        return {
          version: 1,
          scheduleId: input.scheduleId,
          launchedCount: 0,
        };
      }

      const delayMs = Date.parse(tick.nextOccurrence) - Date.now();
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      continue;
    }

    if (scheduleDefinition.overlapPolicy === 'skip' && activeWorkflowIds.length > 0) {
      activeWorkflowIds = await filterActiveIssueWorkflowIds({
        workflowIds: activeWorkflowIds,
        observedAt: currentTime,
      });
    }

    for (const occurrence of tick.dueOccurrences) {
      if (scheduleDefinition.overlapPolicy === 'skip' && activeWorkflowIds.length > 0) {
        after = occurrence.scheduledFor;
        continue;
      }

      const launch = await launchRecurringOccurrence({
        scheduleId: input.scheduleId,
        scheduledFor: occurrence.scheduledFor,
        initiatedAt: currentTime,
        runtimeSkeleton: input.runtimeSkeleton,
      });
      activeWorkflowIds.push(launch.workflowId);
      after = occurrence.scheduledFor;
    }
  }
}

module.exports = {
  recurringScheduleWorkflow,
};

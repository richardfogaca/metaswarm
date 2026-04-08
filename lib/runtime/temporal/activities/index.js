'use strict';

const { WorkflowNotFoundError } = require('@temporalio/client');

const { materializeRunSummary } = require('../review-artifacts');
const {
  computeRecurringScheduleTick,
  launchRecurringOccurrence: launchRecurringOccurrenceRuntime,
  loadScheduleDefinition,
} = require('../schedules');

function notImplementedActivity(name) {
  return async function phaseZeroPlaceholderActivity() {
    throw new Error(`${name} is not implemented yet in the current Temporal runtime slice.`);
  };
}

function createTemporalActivities({ repoRoot = process.cwd(), client } = {}) {
  return {
    async emitRunSummary(artifact) {
      return materializeRunSummary({
        repoRoot,
        artifact,
      });
    },
    async lookupBeadsTarget(target) {
      return target;
    },
    async readWorkflowState(input) {
      return {
        status: 'step1-unimplemented',
        input,
      };
    },
    async readRecurringScheduleDefinition({ scheduleId }) {
      return loadScheduleDefinition({
        repoRoot,
        scheduleId,
      }).scheduleDefinition;
    },
    async computeRecurringScheduleTick(input) {
      return computeRecurringScheduleTick(input);
    },
    async filterActiveIssueWorkflowIds({ workflowIds, observedAt }) {
      if (!client || !client.workflow) {
        throw new Error('Temporal client is required for recurring schedule workflow status checks');
      }

      const activeWorkflowIds = [];
      for (const workflowId of workflowIds) {
        try {
          const description = await client.workflow.getHandle(workflowId).describe();
          if (description.status.name === 'RUNNING') {
            activeWorkflowIds.push(workflowId);
          }
        } catch (error) {
          if (!(error instanceof WorkflowNotFoundError)) {
            throw error;
          }
        }
      }

      return activeWorkflowIds;
    },
    async launchRecurringOccurrence(input) {
      if (!client || !client.workflow) {
        throw new Error('Temporal client is required for recurring schedule workflow launches');
      }

      const launched = await launchRecurringOccurrenceRuntime({
        repoRoot,
        client,
        ...input,
      });

      return {
        workflowId: launched.handle.workflowId,
        runId: launched.workflowInput.runId,
        launchRef: launched.launchRef,
      };
    },
  };
}

const bootstrapActivities = createTemporalActivities();

module.exports = {
  bootstrapActivities,
  createTemporalActivities,
  notImplementedActivity,
};

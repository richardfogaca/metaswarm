'use strict';

const fs = require('fs');
const path = require('path');

const { Client, Connection, WorkflowNotFoundError } = require('@temporalio/client');

const {
  resolveRuntimePaths,
  toIssueWorkflowId,
  toRecurringWorkflowId,
  toScheduledWorkflowId,
} = require('./bootstrap');
const { validateMorningReviewArtifact } = require('./contracts');
const { buildLaunchRef } = require('./launch-records');
const { buildSummaryRef } = require('./review-artifacts');
const { resolveTemporalRuntimeConfig } = require('./runtime-config');
const { validateLaunchRecord } = require('./task-definitions');

const RICH_REVIEW_STATUSES = new Set(['sleeping', 'blocked']);
const TERMINAL_OR_RUNNING_STATUSES = new Set(['running', 'completed', 'failed', 'cancelled', 'unknown']);

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

function parseStatusCommandArgs(args) {
  let selector = null;
  let json = false;

  function setSelector(nextSelector) {
    if (selector !== null) {
      throw new Error('temporal status requires exactly one selector');
    }
    selector = nextSelector;
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--latest') {
      setSelector({ kind: 'latest' });
      continue;
    }

    if (arg === '--run-id' || arg === '--workflow-id' || arg === '--beads-id') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }

      if (arg === '--run-id') {
        setSelector({ kind: 'run_id', runId: value });
      } else if (arg === '--workflow-id') {
        setSelector({ kind: 'workflow_id', workflowId: value });
      } else {
        setSelector({ kind: 'beads_id', beadsId: value });
      }
      index += 1;
      continue;
    }

    throw new Error(`unknown flag for temporal status: ${arg}`);
  }

  if (selector === null) {
    throw new Error('temporal status requires exactly one selector');
  }

  return { selector, json };
}

function getTemporalAddress(env = process.env) {
  const config = resolveTemporalRuntimeConfig({
    env,
  });

  const explicitAddress =
    (typeof env.METASWARM_TEMPORAL_ADDRESS === 'string' && env.METASWARM_TEMPORAL_ADDRESS.trim() !== '') ||
    (typeof env.TEMPORAL_ADDRESS === 'string' && env.TEMPORAL_ADDRESS.trim() !== '');

  return explicitAddress ? config.address : null;
}

function normalizeTemporalWorkflowStatus(description) {
  const rawStatus = description?.status;

  if (typeof rawStatus === 'string' && rawStatus.trim() !== '') {
    return rawStatus;
  }

  if (rawStatus && typeof rawStatus.name === 'string' && rawStatus.name.trim() !== '') {
    return rawStatus.name;
  }

  return null;
}

function mapTemporalWorkflowStatus(temporalWorkflowStatus) {
  switch (temporalWorkflowStatus) {
    case 'RUNNING':
      return 'running';
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
    case 'TIMED_OUT':
      return 'failed';
    case 'CANCELED':
    case 'CANCELLED':
    case 'TERMINATED':
      return 'cancelled';
    default:
      return temporalWorkflowStatus === null ? null : 'unknown';
  }
}

function deriveWorkflowIdFromLaunchRecord(launchRecord) {
  const normalizedLaunchRecord = validateLaunchRecord(launchRecord);
  const beadsId = normalizedLaunchRecord.materialization.resolvedBeadsId;

  if (
    normalizedLaunchRecord.triggerType === 'recurring' ||
    normalizedLaunchRecord.runtimeStart?.mode === 'recurring'
  ) {
    return toRecurringWorkflowId(
      beadsId,
      normalizedLaunchRecord.scheduleId,
      normalizedLaunchRecord.runId
    );
  }

  if (normalizedLaunchRecord.scheduleId !== undefined) {
    return toScheduledWorkflowId(beadsId, normalizedLaunchRecord.scheduleId);
  }

  return toIssueWorkflowId(beadsId);
}

function loadValidatedJsonFile({ absolutePath, validator, label }) {
  const fileContents = fs.readFileSync(absolutePath, 'utf8');

  let parsedValue;
  try {
    parsedValue = JSON.parse(fileContents);
  } catch (error) {
    throw new Error(`${label} at ${absolutePath} is not valid JSON: ${error.message}`);
  }

  try {
    return validator(parsedValue);
  } catch (error) {
    throw new Error(`${label} at ${absolutePath} is invalid: ${error.message}`);
  }
}

function loadLaunchRecords(repoRoot = process.cwd()) {
  const { launchesDir } = resolveRuntimePaths(repoRoot);

  if (!fs.existsSync(launchesDir)) {
    return [];
  }

  return fs
    .readdirSync(launchesDir)
    .filter(fileName => fileName.endsWith('.json'))
    .map((fileName) => {
      const absolutePath = path.join(launchesDir, fileName);
      return loadValidatedJsonFile({
        absolutePath,
        validator: validateLaunchRecord,
        label: 'launch record',
      });
    });
}

function loadReviewArtifact(repoRoot, runId) {
  const summaryRef = buildSummaryRef(runId);
  const absolutePath = path.join(repoRoot, summaryRef);

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  return loadValidatedJsonFile({
    absolutePath,
    validator: validateMorningReviewArtifact,
    label: 'review artifact',
  });
}

function compareLaunchRecordsByInitiatedAt(left, right) {
  return Date.parse(right.initiatedAt) - Date.parse(left.initiatedAt) || right.runId.localeCompare(left.runId);
}

function selectLaunchRecord(launchRecords, selector) {
  const sortedRecords = [...launchRecords].sort(compareLaunchRecordsByInitiatedAt);

  if (sortedRecords.length === 0) {
    throw new Error('no launch records were found under .metaswarm/runtime/launches');
  }

  if (selector.kind === 'latest') {
    return sortedRecords[0];
  }

  if (selector.kind === 'run_id') {
    return sortedRecords.find(record => record.runId === selector.runId) ?? null;
  }

  if (selector.kind === 'workflow_id') {
    return (
      sortedRecords.find(record => deriveWorkflowIdFromLaunchRecord(record) === selector.workflowId) ?? null
    );
  }

  if (selector.kind === 'beads_id') {
    return (
      sortedRecords.find(
        record => record.materialization.resolvedBeadsId === selector.beadsId
      ) ?? null
    );
  }

  throw new Error(`unsupported selector kind: ${selector.kind}`);
}

async function inspectTemporalWorkflowLive({ workflowId, client, env = process.env }) {
  let temporalClient = client;
  let ephemeralConnection = null;

  if (!temporalClient) {
    const address = getTemporalAddress(env);
    if (!address) {
      return {
        temporalWorkflowStatus: null,
        warning:
          'Artifact-only status view: live Temporal inspection is not configured. Set TEMPORAL_ADDRESS to enable it.',
      };
    }

    try {
      ephemeralConnection = await Connection.connect({
        address,
      });
      temporalClient = new Client({
        connection: ephemeralConnection,
        namespace: resolveTemporalRuntimeConfig({ env }).namespace,
      });
    } catch (error) {
      return {
        temporalWorkflowStatus: null,
        warning: `Live Temporal inspection failed for ${workflowId}: ${error.message}`,
      };
    }
  }

  try {
    const description = await temporalClient.workflow.getHandle(workflowId).describe();
    return {
      temporalWorkflowStatus: normalizeTemporalWorkflowStatus(description),
      warning: null,
    };
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) {
      return {
        temporalWorkflowStatus: null,
        warning: `Temporal workflow ${workflowId} was not found during live inspection.`,
      };
    }

    return {
      temporalWorkflowStatus: null,
      warning: `Live Temporal inspection failed for ${workflowId}: ${error.message}`,
    };
  } finally {
    if (ephemeralConnection) {
      await ephemeralConnection.close();
    }
  }
}

function deriveRuntimeStatus({ reviewArtifact, temporalWorkflowStatus }) {
  if (reviewArtifact && RICH_REVIEW_STATUSES.has(reviewArtifact.runtimeStatus)) {
    return {
      runtimeStatus: reviewArtifact.runtimeStatus,
      runtimeStatusSource: 'review_artifact',
    };
  }

  const mappedTemporalStatus = mapTemporalWorkflowStatus(temporalWorkflowStatus);
  if (mappedTemporalStatus && TERMINAL_OR_RUNNING_STATUSES.has(mappedTemporalStatus)) {
    return {
      runtimeStatus: mappedTemporalStatus,
      runtimeStatusSource: 'temporal',
    };
  }

  if (reviewArtifact) {
    return {
      runtimeStatus: reviewArtifact.runtimeStatus,
      runtimeStatusSource: 'review_artifact',
    };
  }

  return {
    runtimeStatus: 'unknown',
    runtimeStatusSource: 'derived',
  };
}

async function loadTemporalRunStatus({
  repoRoot = process.cwd(),
  selector,
  client,
  env = process.env,
  inspectTemporalWorkflow,
} = {}) {
  if (!selector || typeof selector.kind !== 'string') {
    throw new TypeError('selector.kind is required');
  }

  const launchRecords = loadLaunchRecords(repoRoot);
  const selectedLaunchRecord = selectLaunchRecord(launchRecords, selector);

  if (!selectedLaunchRecord) {
    throw new Error(`no run matched selector ${JSON.stringify(selector)}`);
  }

  const workflowId = deriveWorkflowIdFromLaunchRecord(selectedLaunchRecord);
  const reviewArtifact = loadReviewArtifact(repoRoot, selectedLaunchRecord.runId);
  const warnings = [];

  const inspectFn =
    inspectTemporalWorkflow ??
    (async ({ workflowId: liveWorkflowId }) =>
      inspectTemporalWorkflowLive({
        workflowId: liveWorkflowId,
        client,
        env,
      }));

  const temporalInspection = await inspectFn({ workflowId, launchRecord: selectedLaunchRecord });
  if (temporalInspection?.warning) {
    warnings.push(temporalInspection.warning);
  }

  const temporalWorkflowStatus = temporalInspection?.temporalWorkflowStatus ?? null;
  const derivedRuntimeStatus = deriveRuntimeStatus({
    reviewArtifact,
    temporalWorkflowStatus,
  });

  return {
    version: 1,
    selector,
    runId: selectedLaunchRecord.runId,
    workflowId,
    beadsId: selectedLaunchRecord.materialization.resolvedBeadsId,
    triggerType: selectedLaunchRecord.triggerType,
    taskDefinitionId: selectedLaunchRecord.taskDefinitionId,
    scheduleId: selectedLaunchRecord.scheduleId,
    runtimeStatus: derivedRuntimeStatus.runtimeStatus,
    runtimeStatusSource: derivedRuntimeStatus.runtimeStatusSource,
    temporalWorkflowStatus,
    initiatedAt: selectedLaunchRecord.initiatedAt,
    scheduledFor: selectedLaunchRecord.runtimeStart?.scheduledFor,
    endedAt: reviewArtifact?.endedAt,
    blockers: reviewArtifact?.blockers ?? [],
    humanActionRequired: reviewArtifact?.humanActionRequired ?? null,
    launchRef: buildLaunchRef(selectedLaunchRecord.runId),
    summaryRef: reviewArtifact ? buildSummaryRef(selectedLaunchRecord.runId) : null,
    acceptedChanges: reviewArtifact?.acceptedChanges ?? [],
    validationSummary: reviewArtifact?.validationSummary,
    warnings,
  };
}

function formatTemporalRunStatus(statusView) {
  const lines = [
    `run id:          ${statusView.runId}`,
    `workflow id:     ${statusView.workflowId}`,
    `beads id:        ${statusView.beadsId}`,
    `runtime status:  ${statusView.runtimeStatus} (${statusView.runtimeStatusSource})`,
    `trigger type:    ${statusView.triggerType}`,
    `initiated at:    ${statusView.initiatedAt}`,
    `launch ref:      ${statusView.launchRef}`,
  ];

  if (statusView.taskDefinitionId) {
    lines.push(`task definition: ${statusView.taskDefinitionId}`);
  }

  if (statusView.scheduleId) {
    lines.push(`schedule id:     ${statusView.scheduleId}`);
  }

  if (statusView.scheduledFor) {
    lines.push(`scheduled for:   ${statusView.scheduledFor}`);
  }

  if (statusView.endedAt) {
    lines.push(`ended at:        ${statusView.endedAt}`);
  }

  if (statusView.temporalWorkflowStatus) {
    lines.push(`temporal status: ${statusView.temporalWorkflowStatus}`);
  }

  lines.push(`summary ref:     ${statusView.summaryRef ?? '(not emitted yet)'}`);

  if (statusView.blockers.length > 0) {
    lines.push(`blockers:        ${statusView.blockers.join('; ')}`);
  }

  if (statusView.humanActionRequired) {
    lines.push(`human action:    ${statusView.humanActionRequired}`);
  }

  if (statusView.acceptedChanges.length > 0) {
    lines.push(`accepted changes: ${statusView.acceptedChanges.join('; ')}`);
  }

  if (statusView.validationSummary) {
    lines.push(`validation:      ${statusView.validationSummary.status}`);
  }

  if (statusView.warnings.length > 0) {
    lines.push('warnings:');
    for (const warning of statusView.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  deriveWorkflowIdFromLaunchRecord,
  formatTemporalRunStatus,
  getTemporalAddress,
  loadTemporalRunStatus,
  mapTemporalWorkflowStatus,
  parseStatusCommandArgs,
};

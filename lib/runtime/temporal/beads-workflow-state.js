'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const { validateRuntimeWorkflowState } = require('./contracts');

const execFileAsync = promisify(execFile);

function parseMetadataWorkflowState(rawState, fieldName = 'metadata.temporal_workflow_state') {
  if (rawState === undefined) {
    throw new Error(`${fieldName} is required`);
  }

  if (typeof rawState === 'string') {
    try {
      return JSON.parse(rawState);
    } catch (error) {
      throw new Error(`${fieldName} must contain valid JSON`);
    }
  }

  if (rawState === null || typeof rawState !== 'object' || Array.isArray(rawState)) {
    throw new Error(`${fieldName} must be an object or a JSON-encoded object string`);
  }

  return rawState;
}

async function loadBeadsWorkflowState({ repoRoot = process.cwd(), beadsId }) {
  const { stdout } = await execFileAsync('bd', ['show', beadsId, '--json', '--long'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`bd show ${beadsId} must return valid JSON`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed[0] === null || typeof parsed[0] !== 'object') {
    throw new Error(`BEADS issue ${beadsId} was not found`);
  }

  const issue = parsed[0];
  const metadata = issue.metadata ?? {};
  const workflowState = parseMetadataWorkflowState(metadata.temporal_workflow_state);

  return validateRuntimeWorkflowState(workflowState);
}

module.exports = {
  loadBeadsWorkflowState,
  parseMetadataWorkflowState,
};

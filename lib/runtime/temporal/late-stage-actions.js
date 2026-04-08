'use strict';

const fs = require('fs');
const path = require('path');

const { ensureRuntimeDirectories } = require('./bootstrap');
const { validateLateStageAction } = require('./contracts');

function buildActionReceiptRef(actionKey) {
  const normalizedAction = validateLateStageAction({
    kind: 'sync_pr',
    actionKey,
  });
  return path.posix.join('.metaswarm', 'runtime', 'action-receipts', `${normalizedAction.actionKey}.json`);
}

async function executeIdempotentLateStageAction({
  repoRoot = process.cwd(),
  runId,
  beadsId,
  action,
  performLateStageAction,
} = {}) {
  const normalizedAction = validateLateStageAction(action, 'action');
  ensureRuntimeDirectories(repoRoot);

  const receiptRef = buildActionReceiptRef(normalizedAction.actionKey);
  const absolutePath = path.join(repoRoot, receiptRef);

  if (fs.existsSync(absolutePath)) {
    return {
      receiptRef,
      receipt: JSON.parse(fs.readFileSync(absolutePath, 'utf8')),
      reused: true,
    };
  }

  const result = await (performLateStageAction ?? (async () => ({
    adapter: 'placeholder',
    performed: false,
  })))(normalizedAction);
  const receipt = {
    version: 1,
    runId,
    beadsId,
    action: normalizedAction,
    performedAt: new Date().toISOString(),
    result,
  };

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(receipt, null, 2)}\n`);

  return {
    receiptRef,
    receipt,
    reused: false,
  };
}

module.exports = {
  buildActionReceiptRef,
  executeIdempotentLateStageAction,
};

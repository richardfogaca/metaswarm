'use strict';

function assertRecord(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

function assertSafeIdentifier(value, fieldName) {
  assertNonEmptyString(value, fieldName);
  if (value.includes('/') || value.includes('\\')) {
    throw new TypeError(`${fieldName} must not contain path separators`);
  }
}

function assertIsoTimestamp(value, fieldName) {
  assertNonEmptyString(value, fieldName);
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${fieldName} must be a valid timestamp`);
  }
}

function validateRecurringScheduleWorkflowInput(input) {
  assertRecord(input, 'input');

  if (input.version !== 1) {
    throw new TypeError('input.version must be 1');
  }

  assertSafeIdentifier(input.scheduleId, 'input.scheduleId');
  assertIsoTimestamp(input.registeredAt, 'input.registeredAt');
  if (input.runtimeSkeleton !== undefined) {
    assertRecord(input.runtimeSkeleton, 'input.runtimeSkeleton');
  }

  return {
    version: 1,
    scheduleId: input.scheduleId,
    registeredAt: input.registeredAt,
    runtimeSkeleton: input.runtimeSkeleton,
  };
}

module.exports = {
  validateRecurringScheduleWorkflowInput,
};

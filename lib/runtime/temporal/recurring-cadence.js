'use strict';

const { CronExpressionParser } = require('cron-parser');

const DAY_OF_WEEK_TO_CRON = {
  SUNDAY: '0',
  MONDAY: '1',
  TUESDAY: '2',
  WEDNESDAY: '3',
  THURSDAY: '4',
  FRIDAY: '5',
  SATURDAY: '6',
};

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

function assertIsoTimestamp(value, fieldName) {
  assertNonEmptyString(value, fieldName);
  if (Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${fieldName} must be a valid timestamp`);
  }
}

function normalizeRecurringOccurrenceKey(scheduledFor) {
  assertIsoTimestamp(scheduledFor, 'scheduledFor');
  return scheduledFor.replace(/[^0-9A-Za-z]/g, '');
}

function toCronExpression(cadence) {
  assertRecord(cadence, 'cadence');

  switch (cadence.kind) {
    case 'daily':
      return `0 ${cadence.minute} ${cadence.hour} * * *`;
    case 'weekly':
      return `0 ${cadence.minute} ${cadence.hour} * * ${DAY_OF_WEEK_TO_CRON[cadence.dayOfWeek]}`;
    case 'monthly':
      return `0 ${cadence.minute} ${cadence.hour} ${cadence.dayOfMonth} * *`;
    case 'cron': {
      const fields = cadence.expression.trim().split(/\s+/);
      if (fields.length === 5) {
        return `0 ${cadence.expression.trim()}`;
      }
      return cadence.expression.trim();
    }
    default:
      throw new TypeError(`Unsupported recurring cadence kind: ${cadence.kind}`);
  }
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function toIso(value) {
  return toDate(value).toISOString();
}

function computeRecurringScheduleTick({ scheduleDefinition, after, now }) {
  assertRecord(scheduleDefinition, 'scheduleDefinition');
  if (!scheduleDefinition.trigger || scheduleDefinition.trigger.kind !== 'recurring') {
    throw new TypeError('scheduleDefinition.trigger.kind must be recurring');
  }

  assertIsoTimestamp(after, 'after');
  assertIsoTimestamp(now, 'now');

  const cronExpression = toCronExpression(scheduleDefinition.trigger.cadence);
  const timezone = scheduleDefinition.timezone || 'UTC';
  const iterator = CronExpressionParser.parse(cronExpression, {
    currentDate: after,
    tz: timezone,
    strict: true,
  });

  const nowMs = Date.parse(now);
  const rawDueOccurrences = [];
  let nextOccurrence;

  while (true) {
    const candidate = toIso(iterator.next());
    if (Date.parse(candidate) <= nowMs) {
      rawDueOccurrences.push(candidate);
      continue;
    }

    nextOccurrence = candidate;
    break;
  }

  let dueOccurrences = rawDueOccurrences;
  if (scheduleDefinition.catchupPolicy === 'none' && dueOccurrences.length > 1) {
    dueOccurrences = dueOccurrences.slice(-1);
  } else if (scheduleDefinition.catchupPolicy === 'within_window') {
    const windowMs = scheduleDefinition.catchupWindowMinutes * 60 * 1000;
    dueOccurrences = dueOccurrences.filter(candidate => nowMs - Date.parse(candidate) <= windowMs);
  }

  return {
    dueOccurrences: dueOccurrences.map(scheduledFor => ({
      scheduledFor,
      occurrenceKey: normalizeRecurringOccurrenceKey(scheduledFor),
    })),
    nextOccurrence,
  };
}

module.exports = {
  computeRecurringScheduleTick,
  normalizeRecurringOccurrenceKey,
  toCronExpression,
};

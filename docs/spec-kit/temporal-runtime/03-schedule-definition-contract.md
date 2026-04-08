# Schedule Definition Contract

**Date**: 2026-04-08
**Status**: Proposed implementation reference

## Purpose

A schedule definition tells the scheduler when to launch or wake a workflow.

It does not define:

- workflow semantics
- task decomposition
- approval semantics

## Contract

```ts
type ScheduleDefinition = {
  version: 1;
  scheduleId: string;
  taskDefinitionId: string;
  state: "active" | "paused";
  trigger: ScheduleTrigger;
  overlapPolicy: "skip" | "allow_parallel";
  catchupPolicy: "none" | "within_window";
  catchupWindowMinutes?: number;
  timezone?: string;
  metadata?: Record<string, string>;
};

type ScheduleTrigger =
  | {
      kind: "once";
      startAt: string;
    }
  | {
      kind: "recurring";
      cadence: Cadence;
    };

type Cadence =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; dayOfWeek: string; hour: number; minute: number }
  | { kind: "monthly"; dayOfMonth: number; hour: number; minute: number }
  | { kind: "cron"; expression: string };
```

## Field Semantics

### `scheduleId`

Stable identifier for the schedule.

This identifies the scheduling definition, not the workflow truth of any resulting BEADS task.

### `taskDefinitionId`

The schedule launches the referenced task definition.

### `overlapPolicy`

- `skip`: if a prior run is still active, do not start another
- `allow_parallel`: concurrent runs are permitted

Recommended default:

- `skip`

### `catchupPolicy`

- `none`: missed runs are dropped
- `within_window`: missed runs are allowed only within a configured window

Recommended default:

- `none` for most recurring engineering workflows

## Invariants

1. A schedule definition must not carry workflow phase state.
2. A schedule definition must not mutate BEADS directly.
3. A schedule definition only starts or wakes workflows.
4. Schedule metadata must remain distinct from BEADS workflow truth.

## Example: One-Off

```json
{
  "version": 1,
  "scheduleId": "sched-auth-fix-tonight",
  "taskDefinitionId": "taskdef-auth-fix-now",
  "state": "active",
  "trigger": {
    "kind": "once",
    "startAt": "2026-04-09T02:00:00-03:00"
  },
  "overlapPolicy": "skip",
  "catchupPolicy": "none",
  "timezone": "America/Sao_Paulo"
}
```

## Example: Weekly

```json
{
  "version": 1,
  "scheduleId": "sched-weekly-knowledge-maintenance",
  "taskDefinitionId": "taskdef-weekly-knowledge-maintenance",
  "state": "active",
  "trigger": {
    "kind": "recurring",
    "cadence": {
      "kind": "weekly",
      "dayOfWeek": "MONDAY",
      "hour": 9,
      "minute": 0
    }
  },
  "overlapPolicy": "skip",
  "catchupPolicy": "within_window",
  "catchupWindowMinutes": 120,
  "timezone": "America/Sao_Paulo"
}
```

## Recommended Storage

Suggested repo-local location:

```text
.metaswarm/runtime/schedules/<schedule-id>.json
```

This is scheduling configuration.

It is not workflow truth.

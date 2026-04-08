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

type ScheduledLaunchRequest = {
  version: 1;
  scheduleId: string;
  taskDefinitionId: string;
  triggerType: "scheduled_once" | "recurring";
  initiatedAt: string;
  initiatedBy: "schedule";
  runtimeSkeleton?: {
    mode: "complete" | "sleep_until";
    sleepUntil?: string;
    reason?: string;
  };
};
```

## Field Semantics

### `scheduleId`

Stable identifier for the schedule.

This identifies the scheduling definition, not the workflow truth of any resulting BEADS task.

### `taskDefinitionId`

The schedule launches the referenced task definition.

Expected alignment:

- `trigger.kind: "once"` should reference a task definition with `mode: "scheduled_once"`
- `trigger.kind: "recurring"` should reference a task definition with `mode: "recurring"`

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

### `timezone`

`timezone` matters only for recurring schedules whose cadence is interpreted in local time.

For one-off schedules, `startAt` must already be a concrete timestamp, so `timezone` is informational at most and should not change the meaning of the timestamp.

## Step 3 Restricted Profile

Step 3 should begin with the smallest honest scheduling slice.

Supported in Step 3:

- repo-local JSON schedule definitions
- `trigger.kind: "once"` only
- `state: "active" | "paused"`
- `overlapPolicy: "skip"` only
- `catchupPolicy: "none"` only
- schedule-triggered launches that converge on the same top-level workflow input contract used by ad hoc runs
- Temporal-native delayed start for one-off schedules
- one-off schedules are registered before `trigger.startAt`, not after it has already passed

Deferred until later Step 3 expansion:

- `trigger.kind: "recurring"`
- non-`skip` overlap behavior
- catchup windows
- timezone-aware recurring cadence interpretation
- schedule-triggered create-new materialization
- pause, backfill, and cancellation management beyond basic validation

The Step 3 restricted profile should reference task definitions that are already fully resolvable at scheduling time. To keep idempotency simple, the first implementation should only schedule task definitions whose materialization resolves to an existing BEADS issue.

## Scheduled Launch Request

The scheduler layer should not invent a second workflow-start model.

For Step 3, schedule evaluation should normalize to a scheduled launch request that then flows through the same launch/materialization path as an ad hoc launch, with these differences:

- `triggerType` is `scheduled_once` or `recurring`
- `initiatedBy` is `schedule`
- `scheduleId` is present in the resulting workflow input and launch record

For delayed-once registration in Step 3:

- `initiatedAt` should reflect when the scheduler registered the delayed run with Temporal
- the desired fire time should be carried separately in launch metadata such as `runtimeStart.scheduledFor`
- `trigger.startAt` should be later than the registration timestamp for the restricted profile

For one-off delayed schedules, the scheduler may use Temporal `startDelay` or an equivalent Temporal-native scheduling primitive so that timer state remains runtime truth inside Temporal rather than in repo-local files.

## Invariants

1. A schedule definition must not carry workflow phase state.
2. A schedule definition must not mutate BEADS directly.
3. A schedule definition only starts or wakes workflows.
4. Schedule metadata must remain distinct from BEADS workflow truth.
5. A schedule definition must align with the referenced task-definition mode.
6. The scheduler must converge on the same launch and workflow-input contracts used by ad hoc execution.
7. Repo-local schedule files are configuration only, not schedule execution truth.

## Example: One-Off

```json
{
  "version": 1,
  "scheduleId": "sched-auth-fix-tonight",
  "taskDefinitionId": "taskdef-auth-fix-tonight",
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

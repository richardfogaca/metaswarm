# Top-Level Workflow Contract

**Date**: 2026-04-08
**Status**: Proposed implementation reference

## Purpose

The top-level workflow is the primary runtime unit.

Default rule:

- one Temporal workflow owns one issue or epic lifecycle

The top-level workflow is responsible for driving metaswarm policy against BEADS truth.

## Input Contract

```ts
type IssueWorkflowInput = {
  version: 1;
  runId: string;
  triggerType: "ad_hoc" | "scheduled_once" | "recurring" | "resume_signal";
  taskDefinitionId?: string;
  scheduleId?: string;
  beadsTarget: BeadsTarget;
  initiatedAt: string;
  initiatedBy: "operator" | "schedule" | "signal";
};

type BeadsTarget =
  | {
      kind: "existing";
      beadsId: string;
    }
  | {
      kind: "materialized";
      beadsId: string;
      sourceTaskDefinitionId: string;
    };
```

## Output Contract

```ts
type IssueWorkflowResult = {
  version: 1;
  runId: string;
  beadsId: string;
  runtimeStatus: "completed" | "sleeping" | "blocked" | "failed" | "cancelled";
  summaryRef: string;
  nextAction:
    | { kind: "none" }
    | { kind: "wait_for_human"; reason: string }
    | { kind: "wait_for_external"; reason: string }
    | { kind: "resume_at"; at: string; reason: string };
};
```

## Responsibilities

The top-level workflow must:

1. resolve or materialize the BEADS target
2. read authoritative workflow state
3. determine the next legal metaswarm step
4. execute the step through activities
5. validate results
6. write accepted state back to BEADS
7. wait safely at human and external boundaries
8. emit a review artifact

## Core Loop

```text
resolve target
  -> read BEADS
  -> derive next metaswarm step
  -> run activity
  -> validate
  -> persist accepted state
  -> either continue or wait
```

## Activity Categories

Activities should cover:

- BEADS mutation and lookup
- worktree operations
- agent host invocation
- validation command execution
- GitHub and CI observation fetches
- PR operations
- summary materialization

## Signal Contract

Expected signal types:

- `human_approval`
- `external_observation_changed`
- `credentials_available`
- `manual_resume`
- `manual_pause`
- `manual_cancel`

Rule:

- no signal may advance workflow semantics by itself
- the workflow must re-read authoritative state before acting

## Invariants

1. The top-level workflow is the default owner of the issue lifecycle.
2. The top-level workflow must re-read BEADS after wakeup.
3. Workflow progression must still follow metaswarm rules.
4. Human approval must be durable before resume.
5. The workflow must emit a run summary on every terminal or sleeping outcome.

## Failure Model

If an activity fails:

- apply retry policy when appropriate
- preserve idempotency
- do not corrupt BEADS truth
- surface the failure in the summary

If the worker crashes:

- Temporal restores runtime state
- workflow reconciles from BEADS before continuing

## Recommended Workflow Id Shape

```text
issue-<beads-id>
```

Examples:

- `issue-bd-1234`
- `issue-bd-9001`

For recurring launches, multiple runs may share the same schedule id but each workflow execution still maps to one concrete BEADS business target.

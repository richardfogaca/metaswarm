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
  runtimeSkeleton?: Step1RuntimeSkeletonDirective;
};

type BeadsTarget = {
  kind: "existing";
  beadsId: string;
};

type Step1RuntimeSkeletonDirective = {
  mode: "complete" | "sleep_until";
  sleepUntil?: string;
  reason?: string;
};
```

Step 1 input rules:

- `runtimeSkeleton` is required for the restricted Step 1 implementation
- `runtimeSkeleton.mode: "complete"` requires no extra fields
- `runtimeSkeleton.mode: "sleep_until"` requires `sleepUntil`
- `sleepUntil` must be a valid timestamp later than `initiatedAt`
- `reason` is optional operator-facing context for the emitted review artifact

Step 2 launch rule:

- launch/materialization must finish before workflow start
- the workflow receives one concrete `beadsTarget`
- ad hoc launches that create a new BEADS issue still normalize to `beadsTarget.kind: "existing"` before Temporal execution begins

Step 3 schedule rule:

- scheduled launches still normalize to the same `IssueWorkflowInput` shape
- `scheduleId` is present for schedule-triggered runs
- Temporal delay or scheduling metadata stays outside BEADS workflow truth
- recurring cadence ownership may live in a separate scheduler workflow, but the issue workflow still starts only after one concrete launch has been materialized

## Output Contract

```ts
type IssueWorkflowResult = {
  version: 1;
  runId: string;
  beadsId: string;
  terminalStatus: "completed" | "failed" | "cancelled";
  summaryRef: string;
};
```

`summaryRef` should be a repo-relative path to the latest JSON review artifact for the run:

```text
.metaswarm/runtime/reviews/<run-id>.json
```

Sleeping or blocked states do not appear as workflow return values because a sleeping Temporal workflow has not completed yet. Those states are surfaced through the latest emitted review artifact while the workflow remains open.

## Step 1 Restricted Profile

Step 1 is intentionally narrower than the full end-state contract.

Supported in Step 1:

- `beadsTarget.kind: "existing"`
- immediate completion or timer-based sleep chosen through `runtimeSkeleton`
- summary emission before sleep and on terminal completion
- deterministic timer wakeup

Deferred until later steps:

- BEADS-driven next-step derivation
- human approval signals
- external observation refresh
- real metaswarm phase execution

The `runtimeSkeleton` field exists only so Step 1 can prove runtime behavior without pretending Step 4 policy wiring is already implemented. It is a temporary implementation aid, not the long-term home of workflow law.

## Responsibilities

The top-level workflow must:

1. accept one concrete BEADS target for the run
2. read authoritative workflow state
3. determine the next legal metaswarm step
4. execute the step through activities
5. validate results
6. write accepted state back to BEADS
7. wait safely at human and external boundaries
8. emit a review artifact

In Step 1, responsibilities 2 through 6 are intentionally reduced to contract validation plus summary emission. Full BEADS reconciliation and policy derivation begin in Step 4.

## Core Loop

```text
read BEADS
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

Step 1 minimum activity set:

- summary materialization
- optional no-op or stub adapters for BEADS lookup/read boundaries

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

Step 1 does not implement signals yet. Signals are deferred so timer sleep/wake behavior can be proven in isolation first.

## Invariants

1. The top-level workflow is the default owner of the issue lifecycle.
2. The top-level workflow must re-read BEADS after wakeup.
3. Workflow progression must still follow metaswarm rules.
4. Human approval must be durable before resume.
5. The workflow must emit a run summary on every terminal or sleeping outcome.

For Step 1, invariant 2 is satisfied by deferral: the implementation must not invent stale BEADS-derived progression after wakeup because it is not yet allowed to derive progression from BEADS at all.

## Failure Model

If an activity fails:

- apply retry policy when appropriate
- preserve idempotency
- do not corrupt BEADS truth
- surface the failure in the summary

If the worker crashes:

- Temporal restores runtime state
- workflow reconciles from BEADS before continuing

In Step 1, recovery proof focuses on timer determinism and summary emission. BEADS reconciliation after crash remains a later-step responsibility.

## Recommended Workflow Id Shape

```text
issue-<beads-id>
```

Examples:

- `issue-bd-1234`
- `issue-bd-9001`

For recurring launches, multiple runs may share the same schedule id but each workflow execution still maps to one concrete BEADS business target.

That concrete target should already have been resolved or created by the launch/materialization layer before the workflow starts.

For delayed-once schedules, a schedule-scoped workflow id may be appropriate if that is the simplest way to keep schedule registration idempotent without weakening the business-id linkage to the BEADS target.

For recurring schedules, a schedule-scoped issue-workflow id is not sufficient because multiple occurrences may legitimately start over time, including overlapping runs when policy allows it.

Recommended recurring issue-workflow id shape:

```text
issue-<beads-id>-schedule-<schedule-id>-run-<run-id>
```

The scheduler workflow itself may use a stable control-plane id such as `schedule-<schedule-id>`. That scheduler-owned workflow is not a substitute for the top-level issue workflow. It only owns cadence and launch timing.

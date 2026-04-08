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

Step 4 authority rule:

- the workflow may omit `runtimeSkeleton` once it is driven by authoritative BEADS workflow state
- in that mode, BEADS must tell the workflow whether it should complete, sleep, or remain blocked
- the workflow must not invent progression from stale in-memory assumptions or from signal delivery alone

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

## Step 4 Restricted Profile

Step 4 should still begin with a narrow, explicit authority model.

The first honest Step 4 slice is not full metaswarm phase execution.

It is:

- BEADS-backed authoritative workflow state
- start and wake reconciliation
- signal handling that never bypasses BEADS truth
- external observation refresh before continuation from observation waits

Restricted authoritative state contract for Step 4:

```ts
type Step4WorkflowState = {
  version: 1;
  kind:
    | "complete"
    | "sleep_until"
    | "await_human_approval"
    | "await_external_observation";
  sleepUntil?: string;
  blockers?: string[];
  humanActionRequired?: string | null;
  stepsAttempted?: string[];
  acceptedChanges?: string[];
  validationSummary?: ValidationSummary;
  lastUpdatedAt: string;
};
```

Recommended BEADS metadata location:

```json
{
  "temporal_workflow_state": {
    "...": "..."
  }
}
```

Interpretation rules for the restricted profile:

- `complete` means the workflow may emit a terminal summary and finish
- `sleep_until` means the workflow emits a sleeping summary, sleeps until the provided timestamp, and then re-reads BEADS before doing anything else
- `await_human_approval` means the workflow emits a blocked summary and waits for a resume-style signal, but it still re-reads BEADS before continuing
- `await_external_observation` means the workflow must refresh external observation through an activity, then re-read BEADS before it can continue

Important limit:

- this state contract is a restricted projection of workflow truth for Step 4 only
- it is not yet the full metaswarm policy engine encoded in BEADS
- richer next-step derivation remains deferred to later workflow phases

## Step 5 Restricted Profile

Step 5 should extend the same authority model rather than invent a second late-stage runtime lane.

The first honest Step 5 slice is not full PR shepherding automation.

It is:

- explicit late-stage wait targets for CI, review comments, and periodic PR shepherd wakeups
- one idempotent late-stage action contract
- action execution followed by observation refresh and BEADS reconciliation
- replay-safe receipts that remain derived runtime audit, not workflow truth

Restricted late-stage additions:

```ts
type Step5WorkflowState =
  | Step4WorkflowState
  | {
      version: 1;
      kind: "run_late_stage_action";
      lateStageAction: LateStageAction;
      observation?: ExternalObservationTarget;
      blockers?: string[];
      stepsAttempted?: string[];
      acceptedChanges?: string[];
      validationSummary?: ValidationSummary;
      lastUpdatedAt: string;
    };

type ExternalObservationTarget = {
  kind: "generic" | "ci" | "review_comments" | "pr_shepherd";
};

type LateStageAction = {
  kind: "sync_pr" | "post_pr_comment";
  actionKey: string;
  commentBody?: string;
};
```

Interpretation rules for the restricted profile:

- `await_external_observation` may now include `observation.kind`
- `observation.kind: "ci"` means the workflow is explicitly waiting for CI observation refresh and should surface CI-specific blockers
- `observation.kind: "review_comments"` means the workflow is explicitly waiting for PR review or review-comment observation refresh
- `observation.kind: "pr_shepherd"` means the workflow is waiting for a periodic PR shepherd wakeup before refreshing PR state and re-reading BEADS
- `run_late_stage_action` means the workflow must execute exactly one idempotent late-stage activity using `lateStageAction.actionKey`, refresh the relevant observation, and then re-read BEADS before deciding what comes next

Recommended runtime receipt location:

```text
.metaswarm/runtime/action-receipts/<action-key>.json
```

Important limit:

- receipt files are derived runtime audit and idempotency support only
- receipt files must not become workflow authority
- BEADS still decides whether the workflow should keep waiting, run another action, or complete
- the restricted profile supports only the two action kinds above and does not yet claim full PR shepherd automation

## Step 6 Restricted Profile

Step 6 should extend the same authority model rather than embedding a planning engine inside the workflow.

The first honest Step 6 slice is not full metaswarm intake through implementation handoff.

It is:

- idempotent research and planning actions
- idempotent plan-review and optional design-review gate actions
- persisted planning artifacts that remain derived accepted outputs, not workflow authority
- clean stop behavior at real human approval gates using the existing approval model

Restricted spec-to-plan additions:

```ts
type Step6WorkflowState =
  | Step5WorkflowState
  | {
      version: 1;
      kind: "run_spec_to_plan_action";
      specToPlanAction: SpecToPlanAction;
      blockers?: string[];
      stepsAttempted?: string[];
      acceptedChanges?: string[];
      validationSummary?: ValidationSummary;
      lastUpdatedAt: string;
    };

type SpecToPlanAction = {
  kind:
    | "research_brief"
    | "draft_plan"
    | "run_plan_review_gate"
    | "run_design_review_gate";
  actionKey: string;
  artifactKey: string;
  sourceArtifactKey?: string;
  instructions?: string;
};
```

Interpretation rules for the restricted profile:

- `run_spec_to_plan_action` means the workflow must execute exactly one idempotent planning activity using `specToPlanAction.actionKey`
- that activity must persist one stable planning artifact at `specToPlanAction.artifactKey`
- after the action completes, the workflow must re-read BEADS before deciding whether to continue, wait for approval, or complete
- `run_plan_review_gate` and `run_design_review_gate` are gate-execution actions only; approval and continuation authority still live in BEADS

Recommended planning artifact location:

```text
.metaswarm/runtime/planning-artifacts/<artifact-key>.json
```

Important limit:

- planning artifacts are derived accepted outputs and replay guards only
- planning artifacts must not become workflow truth or gate authority
- the restricted profile supports only the four action kinds above and does not yet claim full spec-intake or implementation handoff
- reviewer fan-out and richer gate semantics remain deferred

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

Step 4 restricted signal rules:

- `human_approval` and `manual_resume` may only wake a blocked workflow; they do not authorize progress by themselves
- after either signal, the workflow must re-read BEADS and only continue if authoritative state has changed
- `external_observation_changed` may wake a workflow waiting on external state, but the workflow must run the refresh activity before re-reading BEADS and deciding what to do next
- duplicate signals must be harmless

Step 5 restricted signal rules:

- `external_observation_changed` may wake `await_external_observation` states whose `observation.kind` is `generic`, `ci`, or `review_comments`
- `pr_shepherd_tick` may wake `await_external_observation` states whose `observation.kind` is `pr_shepherd`
- after either wakeup, the workflow must refresh the relevant observation first and only then re-read BEADS
- signals still do not authorize action execution or workflow completion by themselves

Step 6 restricted signal rules:

- the existing `human_approval` and `manual_resume` signals remain wakeup-only for planning checkpoints
- plan-review and design-review actions do not bypass that rule; if BEADS still says approval is pending, the workflow must remain blocked
- no planning action may self-approve or self-promote the workflow without BEADS state changing first

## Invariants

1. The top-level workflow is the default owner of the issue lifecycle.
2. The top-level workflow must re-read BEADS after wakeup.
3. Workflow progression must still follow metaswarm rules.
4. Human approval must be durable before resume.
5. The workflow must emit a run summary on every terminal or sleeping outcome.

For Step 1, invariant 2 is satisfied by deferral: the implementation must not invent stale BEADS-derived progression after wakeup because it is not yet allowed to derive progression from BEADS at all.

For the restricted Step 4 slice, invariant 3 is satisfied by the narrow state machine above. The runtime proves reconciliation and safe wake behavior without claiming it already implements the full metaswarm step engine.

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

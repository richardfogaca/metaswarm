# Implementation Roadmap

**Date**: 2026-04-08
**Status**: Proposed implementation reference

## Goal

Move from research to implementation without losing architectural clarity.

## Implementation Order

### Step 1: Runtime Skeleton

Build:

- top-level workflow shell
- basic workflow input/output contract
- basic activity boundaries
- summary emission

Implementation boundary:

- support one workflow per existing BEADS issue
- prove timer-based sleep and wake behavior
- emit operator-facing summaries at reporting boundaries
- keep policy derivation intentionally minimal

Explicitly defer to later steps:

- task materialization from task definitions
- recurring schedules
- BEADS reconciliation as the source of next-step derivation
- human approval signal handling
- external observation refresh
- real metaswarm step execution

Must prove:

- one workflow per issue works
- retries and wakeups are deterministic
- run summaries are emitted

Validation strategy:

- contract tests for workflow input/output and summary artifact shape
- deterministic workflow tests with fake time for sleep/wake behavior
- activity tests for summary materialization and idempotent retry handling
- scenario test for one issue run that sleeps and resumes cleanly

Step 1 restricted profile:

- `beadsTarget.kind` is `existing` only
- sleeping and blocked states are represented through the emitted review artifact, not through workflow completion
- the workflow may use a temporary Step 1-only skeleton directive in its input to choose between immediate completion and timer sleep
- the workflow must emit a summary before sleeping and again on terminal completion if state changed

Phase exit gate:

- do not proceed until one issue workflow survives restart, emits a valid summary artifact, and demonstrates deterministic wakeup behavior

### Step 2: Task Definitions

Build:

- task definition loader and validator
- ad hoc task entry
- existing-BEADS and create-new materialization paths
- launch-record emission for each ad hoc run

Must prove:

- ad hoc tasks can launch safely
- materialization into BEADS is explicit and reproducible
- existing-target and create-new launches converge on the same concrete workflow input shape

Step 2 restricted profile:

- repo-local JSON task definitions
- ad hoc launch only
- materialization completes before workflow start
- every workflow still starts with one concrete BEADS target
- launch records are written to `.metaswarm/runtime/launches/<run-id>.json`

Explicitly defer to later steps:

- schedule-triggered execution of non-`ad_hoc` task definitions
- recurring/catchup policy behavior
- workflow-side BEADS reconciliation logic beyond the Step 1 skeleton
- advanced template rendering beyond a minimal documented token set

Validation strategy:

- schema validation tests for task definition parsing and rejection
- materialization tests for existing-BEADS and create-new paths
- launch-record tests proving the resolved BEADS target and materialization request are explicit
- scenario tests proving that ad hoc existing-target launch and ad hoc create-new launch converge on the same workflow input contract

Phase exit gate:

- do not proceed until task definitions can be validated, materialized into explicit BEADS targets without hidden assumptions, and launched through the same normalized workflow input contract

### Step 3: Schedule Definitions

Build:

- schedule definition loader and validator
- one-off delayed scheduling
- scheduled-launch normalization through the existing launch path

Must prove:

- one-off delayed tasks run once
- scheduled launches converge on the same workflow input and launch-record model as ad hoc launches
- schedule state stays outside workflow truth

Step 3 restricted profile:

- repo-local JSON schedule definitions
- `trigger.kind: "once"` only
- `overlapPolicy: "skip"` only
- `catchupPolicy: "none"` only
- schedule-triggered launches reference task definitions with `mode: "scheduled_once"`
- first implementation schedules task definitions that resolve to an existing BEADS issue
- Temporal-native delayed start keeps timer state in Temporal rather than repo-local schedule ledgers

Explicitly defer to later Step 3 expansion:

- recurring cadence execution
- overlap policies beyond `skip`
- catchup windows
- timezone-aware recurring interpretation
- schedule-triggered create-new materialization
- richer pause/cancel/backfill lifecycle

Validation strategy:

- schema validation tests for schedule definitions
- deterministic fake-time tests for delayed once scheduling
- rejection tests for unsupported recurring, overlap, and catchup combinations in the restricted profile
- scenario tests proving scheduled launches and ad hoc launches converge on the same top-level workflow behavior

Phase exit gate:

- do not proceed until delayed once schedules are deterministic, replay-safe, and clearly separate from BEADS workflow truth, with a documented path for later recurring expansion

### Step 3 Expansion: Recurring Scheduler Slice

Build:

- recurring cadence support
- one scheduler-owned workflow per `scheduleId`
- overlap behavior for `skip` and `allow_parallel`
- catchup behavior for `none` and `within_window`
- schedule-triggered create-new materialization through the existing launch path

Must prove:

- recurring schedules launch durably on cadence
- each due occurrence converges on the same launch-record and workflow-input model used elsewhere
- overlap behavior is explicit instead of accidental
- catchup behavior is explicit instead of accidental
- timezone-aware recurring interpretation is stable for the supported cadence forms

Restricted profile for this expansion:

- cadence kinds `daily`, `weekly`, `monthly`, and `cron`
- `overlapPolicy: "skip" | "allow_parallel"`
- `catchupPolicy: "none" | "within_window"`
- recurring cadence is owned by a dedicated scheduler workflow rather than repo-local ledgers
- one-off delayed schedules remain on the existing Step 3 path

Explicitly defer after this expansion:

- overlap behavior richer than `skip` and `allow_parallel`
- scheduler pause/resume/backfill/cancel lifecycle beyond validation and basic state checks
- server-native Temporal Schedule migration

Validation strategy:

- contract tests for recurring schedule definitions, timezone handling requirements, and rejection of unsupported overlap/catchup values
- deterministic workflow tests for recurring cadence, overlap decisions, and catchup windows under fake time
- activity tests for recurring launch normalization, create-new materialization, and workflow-status inspection used for overlap checks
- scenario tests proving recurring existing-target and recurring create-new launches both feed the same issue-workflow contract

Phase exit gate:

- do not proceed until recurring schedules can survive restart, launch explicit per-occurrence runs, enforce documented overlap/catchup behavior, and keep schedule execution truth inside Temporal

### Step 4: Top-Level Workflow Behavior

Build:

- BEADS reconciliation at workflow start and wakeup
- next-step derivation
- signal handling
- external observation refresh

Must prove:

- workflow does not advance on stale assumptions
- human approval requires durable state before resume

Validation strategy:

- deterministic workflow tests for reconciliation after wakeup
- signal tests proving signal-only progression is rejected
- activity tests for BEADS reread behavior and external observation refresh
- scenario tests for pause, approval write, signal, reread, and safe continuation

Phase exit gate:

- do not proceed until stale-state progression and signal-only approval shortcuts are impossible in tested scenarios

Step 4 restricted profile:

- use a BEADS-backed authoritative workflow-state projection rather than the temporary Step 1 `runtimeSkeleton`
- support only four authoritative states:
  - `complete`
  - `sleep_until`
  - `await_human_approval`
  - `await_external_observation`
- treat signal delivery as a wakeup only, never as workflow truth
- refresh external observation before continuing from observation waits
- keep full metaswarm phase derivation deferred

This slice is intentionally narrower than the eventual end state.

It proves the hardest safety property first:

- the runtime always re-reads authority before acting

Explicitly defer after the restricted Step 4 slice:

- full metaswarm phase derivation from BEADS
- real work-unit execution decisions
- durable writes of accepted workflow progress back into richer BEADS state
- multi-signal coordination beyond the small wakeup set above

### Step 5: Late-Stage Durability

Build:

- PR shepherd wakeups
- CI waiting
- review comment follow-up path

Must prove:

- overnight late-stage progress is reliable
- side effects are not duplicated on retry

Validation strategy:

- activity tests for idempotent PR and comment operations
- deterministic workflow tests for CI waiting and review-follow-up wakeups
- scenario tests covering CI failure, retry, resumed success, and review-comment handling

Phase exit gate:

- do not proceed until late-stage side effects are replay-safe and next-day summaries clearly explain the result

Step 5 restricted profile:

- extend the Step 4 authority model instead of replacing it
- support `await_external_observation` with explicit `observation.kind` values:
  - `ci`
  - `review_comments`
  - `pr_shepherd`
- support one action state, `run_late_stage_action`, with only two action kinds:
  - `sync_pr`
  - `post_pr_comment`
- require every late-stage action to carry a durable `actionKey`
- execute the action through an idempotent activity boundary, record a derived runtime receipt, refresh the relevant observation, and then re-read BEADS
- treat `pr_shepherd_tick` as a wakeup only, never as workflow truth

This slice is intentionally narrower than the eventual end state.

It proves the second hard safety property:

- late-stage external side effects can be replay-safe without moving workflow authority out of BEADS

Explicitly defer after the restricted Step 5 slice:

- full PR shepherd automation and branch mutation policy
- review-resolution semantics beyond comment follow-up
- CI-specific retry policy beyond wake, refresh, and reconcile
- GitHub-specific adapter integration beyond the generic idempotent action boundary

### Step 6: Spec-To-Plan Lane

Build:

- research
- planning
- plan review gate
- optional design review gate

Must prove:

- plan quality does not degrade
- overnight progress is meaningful

Validation strategy:

- scenario tests for research, planning, plan review, and optional design review
- output contract tests for persisted approved planning state
- regression-style acceptance checks comparing runtime-driven outcomes against intended metaswarm gate semantics

Phase exit gate:

- do not proceed until the runtime can produce planning progress overnight without weakening plan or design gate semantics

Step 6 restricted profile:

- extend the Step 5 authority model instead of replacing it
- support one planning state, `run_spec_to_plan_action`, with only four action kinds:
  - `research_brief`
  - `draft_plan`
  - `run_plan_review_gate`
  - `run_design_review_gate`
- require every planning action to carry a durable `actionKey` and `artifactKey`
- execute the action through an idempotent activity boundary, persist one stable planning artifact, and then re-read BEADS
- keep human approval at checkpoints on the existing `await_human_approval` path

This slice is intentionally narrower than the eventual end state.

It proves the third hard safety property:

- useful planning progress can be made durably without moving planning or gate authority out of BEADS

Explicitly defer after the restricted Step 6 slice:

- full intake materialization and issue decomposition
- reviewer fan-out and richer review-isolation enforcement
- gate-to-gate progression beyond the small planning lane
- direct integration with metaswarm agent hosts beyond the generic idempotent planning boundary

### Step 7: Work-Unit Execution

Build:

- implement
- validate
- adversarial review
- commit

Must prove:

- parent workflow coordination is sufficient by default
- idempotency and reviewer-isolation rules hold

Validation strategy:

- scenario tests for IMPLEMENT -> VALIDATE -> REVIEW -> COMMIT loops
- reviewer isolation tests proving fresh-reviewer requirements still hold
- idempotency tests for repeated work-unit retries
- BEADS consistency tests for parent-owned work-unit coordination

Phase exit gate:

- do not proceed until the parent workflow can coordinate work units safely and reviewers remain isolated under retry and resume conditions

## Non-Negotiable Validation Rules

Implementation should not proceed without proving:

1. BEADS remains workflow-facing truth.
2. Temporal remains runtime truth.
3. scheduled tasks and ad hoc tasks converge on the same top-level workflow model.
4. recurring schedules do not create a second orchestration model.
5. morning review artifacts remain derived read models only.

These rules should be re-checked repeatedly across phases, not just once.

## Suggested First Delivery Slice

The first concrete delivery slice should include:

- task definition contract
- schedule definition contract
- one top-level workflow
- one summary artifact
- one delayed-start schedule

That is the smallest slice that exercises the architecture honestly.

For the actual implementation sequence in this repo, a bootstrap scaffold may land first, but Step 1 is not considered complete until the restricted profile above is proven with deterministic workflow tests.

# Runtime Interaction Model

Date: 2026-04-08

## Core Loop

The desired runtime pattern is:

1. a launcher resolves or materializes one concrete BEADS issue or epic for the run
2. a Temporal workflow starts for that concrete BEADS target
3. it reads authoritative workflow state
4. it determines the next eligible metaswarm step
5. it executes that step through an activity
6. it validates the result
7. it writes accepted state back to authoritative workflow storage
8. if blocked on a human or an external condition, it waits
9. on wakeup, it re-reads authoritative state before continuing

For the restricted Step 4 slice, that authoritative state may be a small BEADS-backed projection that only answers:

- complete now
- sleep until a timestamp
- wait for human approval
- wait for refreshed external observation

This is enough to prove safe wakeup behavior without claiming the full metaswarm policy engine has already been encoded in runtime form.

This loop assumes a higher-level structure around it:

- a task definition tells the system what should run
- a scheduler decides when to start or wake a run
- a top-level issue workflow executes the loop
- a review surface explains the outcome afterward

## Task Entry Model

The runtime should support three ways to enter the loop:

### 1. Ad Hoc Task

- operator starts a task now

### 2. One-Off Scheduled Task

- operator defines a task that should start later once

### 3. Recurring Scheduled Task

- operator defines a task template or recurring work item that should run on a cadence

In all three cases, the runtime behavior after start should converge on the same top-level workflow model.

The launch path may differ, but the workflow should still begin with one explicit BEADS target rather than a deferred materialization instruction.

## Recommended v1 Shape

### One workflow per issue

The first slice should use:

- one Temporal workflow per issue or epic

This is simpler to reason about and easier to test.

This should remain the default model even when the system later supports subtasks and recurring schedules.

The scheduler starts a top-level workflow.

The top-level workflow remains the owner of the issue lifecycle.

The launch/materialization layer should finish resolving a concrete BEADS target first and record how that happened.

### Activities for side effects

Activities should own side-effecting work such as:

- invoking `bd`
- invoking `gh`
- creating worktrees
- invoking agent hosts
- running validation commands
- collecting CI status
- creating PRs
- posting comments

### Signals for wakeups

Signals or updates should be used for:

- human approval
- credentials configured
- PR review arrived
- CI changed
- PR shepherd tick
- manual resume
- manual pause or cancel

### Schedules for recurring starts

Schedules should be used for:

- nightly task kickoff
- periodic PR shepherd wakeups
- recurring maintenance runs

Schedules should start or wake workflows.

They should not themselves encode metaswarm workflow logic.

For a one-off delayed start, the thinnest acceptable scheduler shape is one that converts schedule configuration into the same launch contract used by ad hoc runs and lets Temporal own the actual timer.

For recurring starts, a dedicated scheduler-owned Temporal workflow is a reasonable v1 shape when it is the simplest way to keep cadence, catchup, and overlap decisions durable while still producing explicit per-occurrence launch records before the issue workflow begins.

For the restricted Step 5 slice, late-stage side effects may be executed through a small idempotent action boundary that writes derived runtime receipts keyed by a durable `actionKey`. That receipt is an audit and replay guard only. It does not replace BEADS workflow truth.

## Why Not Child Workflows In v1

This does not mean child workflows are bad.

It means they should not be the starting point.

Bad first design:

- parent workflow for the issue
- child workflow for research
- child workflow for planning
- child workflow for each reviewer
- child workflow for each work unit
- child workflow for PR shepherding

Problems:

- too many ids to correlate
- more message-passing complexity
- harder cancellation behavior
- more ways for Temporal and BEADS to drift
- harder debugging and recovery

Recommended first design:

- one durable issue workflow
- activities for the actual steps

Default rule for subtasks:

- represent them in BEADS
- coordinate them from the parent workflow
- keep them inside the same runtime workflow unless a real isolation need appears

Possible later uses for child workflows:

- a very large work unit with its own long lifecycle
- a release lane with genuinely separate timing
- a recursive sub-epic that behaves like a separate service boundary

Narrow exception:

- a scheduler-owned workflow whose only job is recurring cadence management and launch triggering

That exception is acceptable because it is control-plane plumbing, not business workflow decomposition.

## Example Overnight Sequence

1. a schedule starts the workflow for `bd-1234`
2. the workflow reads BEADS and sees the task is ready for planning
3. it runs planning through an activity
4. it runs the plan review gate
5. it records accepted planning state
6. it continues if the next step is autonomous
7. it sleeps if a human gate is reached
8. a human later approves through the authoritative workflow path
9. the runtime receives a resume signal
10. the workflow re-reads authoritative state
11. it proceeds only if the durable approval is present
12. in the morning, the operator reviews a clear summary of what happened

## Morning Review Artifact Contract

To keep next-day review simple, the system should eventually produce one concise per-run review artifact or report.

Minimum contents:

- task id
- run id
- trigger type:
  - ad hoc
  - one-off scheduled
  - recurring scheduled
- start and end timestamps
- steps attempted
- accepted changes summary
- validation summary
- blocked or failed points
- human action required now

This should be a read model only.

It should not become workflow authority.

For the restricted Step 6 slice, research, plan, and gate outputs may be materialized as stable planning artifacts keyed by durable ids. Those artifacts are replay-safe outputs for the runtime and operator, not authoritative workflow truth.

For the restricted Step 7 slice, work-unit execution should use the same pattern: the parent workflow executes one BEADS-issued work-unit action at a time through an idempotent activity boundary, persists one stable work-unit artifact, and then re-reads BEADS before continuing. Fresh adversarial review comes from a new BEADS-issued action identity, not from hidden runtime state.

When a workflow is sleeping or blocked, this artifact is the operator-facing state surface while the workflow remains open. A sleeping workflow does not have a terminal return value yet.

## Morning Review Surface

To satisfy the end goal, the runtime must produce a review surface that answers:

- what steps ran overnight
- what changed
- what validations ran
- what gates passed
- what failed
- what remains blocked
- what now needs a human

That summary can be built from:

- Temporal execution history
- BEADS task state
- repo diff information
- validation outputs

But the final operator view should be intentionally simple.

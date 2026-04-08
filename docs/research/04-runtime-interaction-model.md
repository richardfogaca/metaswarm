# Runtime Interaction Model

Date: 2026-04-08

## Core Loop

The desired runtime pattern is:

1. a Temporal workflow starts for one BEADS issue or epic
2. it reads authoritative workflow state
3. it determines the next eligible metaswarm step
4. it executes that step through an activity
5. it validates the result
6. it writes accepted state back to authoritative workflow storage
7. if blocked on a human or an external condition, it waits
8. on wakeup, it re-reads authoritative state before continuing

## Recommended v1 Shape

### One workflow per issue

The first slice should use:

- one Temporal workflow per issue or epic

This is simpler to reason about and easier to test.

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
- manual resume
- manual pause or cancel

### Schedules for recurring starts

Schedules should be used for:

- nightly task kickoff
- periodic PR shepherd wakeups
- recurring maintenance runs

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

Possible later uses for child workflows:

- a very large work unit with its own long lifecycle
- a release lane with genuinely separate timing
- a recursive sub-epic that behaves like a separate service boundary

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

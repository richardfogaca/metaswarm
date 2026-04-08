# Authority And Boundaries

Date: 2026-04-08

## Why This Matters

The main architectural risk is not adding Temporal itself.

The main risk is creating two competing sources of truth:

- BEADS says one thing
- Temporal thinks another thing
- operators stop trusting the system

So the integration must define authority very explicitly.

## Authority Matrix

### BEADS Owns

- issue and epic identity
- work-unit identity
- dependency graph
- workflow-visible task status
- durable coordination context
- knowledge priming context
- decomposition truth for tasks and subtasks

If a human asks, "what is the task state?" the answer should be recoverable from BEADS.

### Temporal Owns

- whether a runtime execution exists
- whether it is running, sleeping, retrying, failed, or complete
- timers
- retry policy
- wakeup scheduling
- operational execution history
- schedule execution state

If a human asks, "what is the runtime doing right now?" the answer belongs to Temporal.

### metaswarm Policy Owns

- what step is allowed next
- what gates are blocking
- what counts as approval
- what counts as failure
- when escalation is required
- how top-level tasks decompose into subtasks and work units

### Agent Hosts Own

- nothing authoritative

They produce candidates only.

### External Systems Own

- their own local truth only

Examples:

- GitHub owns PR state
- CI owns check results

Those observations can influence workflow progression, but do not define metaswarm workflow truth by themselves.

## Boundary Contracts

### Contract 1: BEADS Owns Workflow Truth

Temporal may mirror workflow state, but it must not be the only durable home for it.

This includes:

- top-level task state
- subtask/work-unit decomposition state
- workflow-visible blocked/ready/completed state

### Contract 2: Temporal Owns Runtime Truth

BEADS should not be repurposed into a homemade scheduler or sleep ledger.

This includes:

- whether a scheduled run has started
- whether it is asleep waiting on time
- whether it is retrying
- which runtime execution produced a given overnight summary

For delayed one-off scheduling, this means timer state should live in Temporal runtime mechanisms such as delayed start or schedule execution state, not in repo-local schedule ledgers that try to mirror runtime timekeeping.

For recurring scheduling, this also means cadence cursor, overlap decisions, and catchup decisions should live in Temporal execution state, not in repo-local files.

### Contract 3: Human Approval Must Be Durable Before Resume

A Temporal signal alone is not sufficient.

Safe sequence:

1. approval is written to authoritative workflow state
2. runtime receives a resume signal
3. workflow re-reads authoritative state
4. workflow proceeds only if the durable state matches the resume request

### Contract 4: Agents Produce Candidates, Not Truth

Plans, code, reviews, and summaries remain provisional until validated and accepted by the orchestrator.

### Contract 5: External Events Are Inputs, Not Commands

GitHub comments, CI changes, and review arrivals can wake the runtime, but they should not directly mutate workflow truth.

### Contract 6: One Stable Business Identifier

Recommended identity model:

- BEADS id is the business id
- Temporal workflow id references the BEADS id
- branches, worktrees, and reports also carry the BEADS id

For recurring scheduled runs, the recurring definition should have its own stable schedule id, and each resulting runtime execution should still map back to the BEADS business id created or targeted by that run.

If recurring cadence is implemented through a scheduler-owned workflow, that workflow may use its own stable control-plane id. Each launched issue workflow must still carry a concrete run id and map back to the resolved BEADS target for that occurrence.

### Contract 7: Reconciliation Before Action

After every wakeup, retry, or signal:

- re-read BEADS
- re-read relevant repo state
- re-read needed external observations

Do not continue from stale in-memory assumptions alone.

## Safety Rules

### No dual workflow authority

Never let Temporal phase state outrank BEADS workflow state.

### No implicit approvals

Approvals must not exist only as:

- signals
- chat messages
- issue comments

They must be reflected in authoritative workflow state first.

### No non-idempotent replay hazards

Operations such as:

- PR creation
- comment posting
- task creation
- task closure
- worktree creation

must be replay-safe.

### No silent reviewer coupling

metaswarm's reviewer independence rules must survive runtime integration.

Fresh reviewers should remain fresh where metaswarm requires that isolation.

### No runtime failure corruption

If a worker crashes or an activity times out:

- BEADS should still reflect the last accepted state
- recovery should begin from reconciliation, not guesswork

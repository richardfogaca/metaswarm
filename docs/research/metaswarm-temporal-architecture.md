# metaswarm + Temporal Architecture Research

Date: 2026-04-08

## Purpose

This document captures a conservative architecture for adding Temporal to metaswarm without breaking metaswarm's core process model.

The goal is not "add a scheduler somewhere." The goal is:

- keep metaswarm's quality discipline
- keep BEADS as a core part of the workflow substrate
- add durable overnight execution, sleeping, wakeups, retries, and schedules
- avoid introducing a second competing workflow authority

This document is intended to be a reference baseline for implementation.

## Grounding In Existing metaswarm Structure

This architecture is based on the current documented structure of the forked repo:

- `README.md`
- `AGENTS.md`
- `USAGE.md`
- `skills/orchestrated-execution/SKILL.md`
- `skills/plan-review-gate/SKILL.md`
- `skills/design-review-gate/SKILL.md`
- `agents/issue-orchestrator.md`

Key existing metaswarm properties:

- metaswarm is a multi-agent orchestration framework with a structured software delivery lifecycle.
- metaswarm already has a strong quality process:
  - research
  - planning
  - plan review gate
  - design review gate
  - work-unit decomposition
  - 4-phase execution loop
  - final review
  - PR shepherding
  - closure and learning
- metaswarm treats BEADS as the source of truth for task state and coordination.
- metaswarm relies on prompt/skill-driven orchestration plus repo-local artifacts and task state, not a dedicated runtime substrate.
- metaswarm already supports recursive orchestration, team mode, external AI tools, and autonomous PR follow-through.

The main missing capability for "work while I sleep" is not workflow doctrine. It is durable runtime behavior.

## Problem Statement

metaswarm appears strong on process quality but weaker on durable runtime concerns such as:

- scheduled execution
- long sleeps and wakeups
- durable retries
- resumable waiting on humans or external systems
- execution history across process restarts
- reliable overnight continuation

Temporal is a strong candidate to add those runtime capabilities without replacing metaswarm's workflow policy.

## Design Goal

Add Temporal as runtime authority around metaswarm.

Do not replace:

- metaswarm workflow policy
- metaswarm skills
- BEADS task graph
- existing quality gates

Do add:

- durable workflow execution
- schedules
- signals for human and external events
- retry and timeout behavior
- execution history
- operator-facing run summaries

## Architectural Position

The cleanest design is:

- metaswarm defines what good work means
- BEADS records the durable task graph and workflow context
- Temporal drives runtime execution
- agent hosts generate candidate outputs
- GitHub, CI, and other systems provide observations

This is a wrapper architecture, not a rewrite architecture.

## High-Level Components

### 1. metaswarm Workflow Policy Layer

Role:

- defines workflow phases
- defines quality gates
- defines agent roles
- defines review rubrics
- defines decomposition and execution rules

Owns:

- process semantics
- gate criteria
- review protocol
- escalation rules

Does not own:

- durable waiting
- schedules
- retries
- runtime execution history

Examples from the current repo:

- `skills/orchestrated-execution/SKILL.md`
- `skills/plan-review-gate/SKILL.md`
- `skills/design-review-gate/SKILL.md`
- `agents/issue-orchestrator.md`

### 2. BEADS

Role:

- durable task graph
- issue and epic hierarchy
- dependency tracking
- task claims and statuses
- knowledge priming substrate
- workflow coordination memory

Owns:

- task/work-item truth
- dependency truth
- durable coordination state for metaswarm tasks
- workflow-visible progress that agents and humans reason about

Does not own:

- sleeping and wakeups
- retry timers
- execution scheduling
- runtime liveness

Important practical note:

Current BEADS documentation describes:

- embedded mode as single-writer
- server mode as multi-writer

That matters for Temporal integration. If multiple Temporal workers, sessions, or agents can write concurrently, server mode is the safer target.

### 3. Temporal

Role:

- runtime authority
- durable execution engine
- scheduler
- wait and resume mechanism
- retry and timeout controller
- signal receiver for external events
- execution history store

Owns:

- workflow run lifecycle
- sleep/wake state
- retry policies
- backoff behavior
- runtime timing
- workflow-level operational history

Does not own:

- task semantics
- approval semantics
- quality rules
- authoritative issue/work-unit truth

Temporal should know how to drive the process, but not redefine what the process means.

### 4. Issue Orchestrator

Role:

- main business-level coordinator for one issue/epic

In the integrated design:

- the issue orchestrator remains the workflow brain
- a Temporal workflow hosts its durable execution lifecycle

That means the orchestrator logic is still metaswarm logic, but it runs inside a durable runtime shell.

### 5. Swarm Coordinator

Role:

- top-level intake and assignment
- worktree allocation
- parallel issue orchestration
- conflict avoidance

In the integrated design:

- it likely maps to Temporal schedule starters, queueing logic, and dispatcher workflows
- but it should remain thin at first

### 6. Agent Hosts

Examples:

- Claude Code
- Codex CLI
- Gemini CLI

Role:

- generate plans
- generate code
- generate reviews
- produce candidate artifacts or diffs

Owns:

- candidate generation only

Does not own:

- workflow truth
- runtime truth
- gate approval

### 7. External Tools And Adapters

Examples:

- `gh`
- git
- worktrees
- CI systems
- Playwright
- package manager / test runners

Role:

- side effects
- observation collection
- validation execution
- code hosting interaction

These should be treated as activity boundaries in a Temporal-based design.

### 8. Knowledge Base

Role:

- reusable patterns
- gotchas
- anti-patterns
- decisions and learned constraints

Owns:

- reusable supporting memory

Does not own:

- live workflow state
- runtime control

## Authority Matrix

The core safety property is authority separation.

### BEADS Is Authoritative For

- issue and epic existence
- work unit existence
- dependency graph
- claimed/blocked/ready/closed task state
- workflow-visible decomposition state
- durable task memory used by agents
- knowledge priming context
- approved work context that future runs must see

### Temporal Is Authoritative For

- whether a runtime execution exists
- whether it is running, sleeping, retrying, failed, or completed
- scheduled wakeups
- timers
- wait conditions
- runtime-level execution history
- operational retry policy

### metaswarm Skills And Rubrics Are Authoritative For

- what must happen before implementation
- what counts as approval
- what counts as failure
- when human escalation is required
- how review and validation are performed

### Agent Hosts Are Authoritative For

- nothing durable

They are untrusted producers of candidate work.

### GitHub / CI / External Systems Are Authoritative For

- their own observed state only

Examples:

- PR open/closed/merged state
- check run outcomes
- review comment presence

They are not authoritative for metaswarm workflow progression by themselves.

## Boundary Contracts

These are the contracts that keep the system coherent.

### Contract 1: BEADS Owns Workflow Truth

If a human asks "what is the state of this issue?" the answer should be recoverable from BEADS plus repo state, not Temporal alone.

Corollary:

- Temporal may mirror BEADS state for convenience
- Temporal must not become the only place where workflow state lives

### Contract 2: Temporal Owns Runtime Truth

If a human asks "is the orchestrator sleeping until tomorrow?" that answer belongs to Temporal.

Corollary:

- BEADS should not become a home-grown scheduler
- do not encode runtime sleep semantics as fake BEADS tasks unless there is a genuine business need

### Contract 3: Approvals Must Land In Workflow Truth Before Runtime Continues

A human approval signal by itself is insufficient.

Required sequence:

1. approval is recorded in BEADS or repo-local authoritative state
2. Temporal receives a signal to resume
3. workflow re-reads authoritative state
4. workflow proceeds only if the authoritative record matches the resume request

This avoids "resume by signal alone" drift.

### Contract 4: Agents Produce Candidates, Not Truth

Any plan, code change, review, or summary produced by an agent is provisional until:

- validation runs
- the orchestrator accepts it
- authoritative state is updated

### Contract 5: External Observations Are Advisory Inputs

GitHub comments, CI results, and external system events can wake the runtime, but they should not directly mutate workflow truth.

The workflow should:

1. ingest the observation
2. normalize it
3. validate it against current task state
4. then decide whether workflow progression is allowed

### Contract 6: One Stable Business Identifier

The safest identity scheme is:

- BEADS id = primary business id
- Temporal workflow id references the BEADS id
- branches, worktrees, PR labels, and summaries also carry the BEADS id

This reduces correlation ambiguity.

### Contract 7: Orchestrator Re-Reads Authoritative State Before Acting

After every wakeup, retry, or signal:

- re-read BEADS
- re-read relevant repo state
- re-read external observations if needed

Do not trust stale in-memory assumptions after a long wait.

## Interaction Model

The intended runtime pattern is:

1. a Temporal workflow starts for one BEADS epic or issue
2. it reads current BEADS state
3. it determines the next eligible metaswarm step
4. it executes that step via an Activity
5. it validates the result
6. it writes accepted state back to BEADS
7. if blocked on a human or external event, it sleeps and waits for a signal
8. on wakeup, it re-reads BEADS and continues

## Recommended First-Cut Mapping

### Per-Issue Runtime Model

Recommended v1 model:

- one Temporal workflow per issue/epic

Not recommended for v1:

- one workflow per reviewer
- one workflow per work unit
- one workflow per agent
- one workflow per PR comment

This keeps orchestration understandable and limits dual-state drift.

### Temporal Workflow

Represents:

- the durable execution lifecycle of one metaswarm issue

Contains:

- current runtime phase
- waiting state
- retry policies
- timers
- signal handlers

### Temporal Activities

Activities should own all side effects, for example:

- read or mutate BEADS through `bd`
- run `gh` commands
- create worktrees
- invoke agent hosts
- run tests and linters
- gather CI status
- create PRs
- post comments
- gather review comments

### Temporal Signals / Updates

Use for:

- human approval
- credentials configured
- PR review arrived
- CI changed
- manual resume
- cancel or pause request

### Temporal Schedules

Use for:

- nightly issue kickoff
- periodic PR shepherd wakeups
- recurring maintenance/report runs
- retry windows for blocked-but-recheckable tasks

## Why "No Child Workflows" For v1

This does not mean "never use child workflows."

It means:

- do not explode metaswarm's entire existing process into a workflow tree before the basic integration works

Bad first design:

- parent workflow for issue
- child workflow for research
- child workflow for planning
- child workflow for each reviewer
- child workflow for each work unit
- child workflow for PR shepherding

Why that is risky early:

- more workflow ids to correlate
- more message passing complexity
- more parent/child cancellation behavior
- more chances for BEADS and Temporal state to diverge
- harder recovery semantics
- more complicated observability from day one

Recommended first design:

- one durable issue workflow
- activities for research, planning, review, coding, validation, PR work, and reflection

Possible later uses for child workflows:

- a very large work unit with its own long lifecycle
- a release/deployment lane with independent timing
- a large recursive sub-epic that genuinely behaves like a separate service boundary

Child workflows should solve a real isolation problem, not be used for code organization.

## Suggested Component Responsibilities

### BEADS

Responsibilities:

- model epics, tasks, and dependencies
- store task status and graph structure
- support knowledge priming and durable issue context
- remain the workflow-facing system of record

Must not:

- become a retry engine
- become a schedule engine
- become a timer ledger for runtime sleeps

### Temporal

Responsibilities:

- start and manage durable issue runs
- sleep until timers or signals
- handle retries and backoff
- record execution history
- survive worker restarts

Must not:

- invent workflow meaning that is not represented in metaswarm policy
- bypass BEADS updates
- proceed on resume without checking authoritative state

### Issue Orchestrator Logic

Responsibilities:

- choose next step using metaswarm process rules
- enforce gates
- decide when escalation is required
- choose which agent host to invoke
- interpret validation outcomes

Must not:

- trust subagent self-reports
- bypass validation and review gates

### Swarm Coordinator

Responsibilities:

- assign issues for processing
- coordinate worktrees and parallelism at the repo level
- avoid collisions

Must not:

- hide work assignment in runtime memory only

### Agent Adapters

Responsibilities:

- invoke Claude/Codex/Gemini
- normalize outputs
- report machine-readable success/failure
- enforce timeouts and resource bounds

Must not:

- mutate authoritative state directly unless explicitly mediated by the orchestrator

## Overnight Run Sequence

An example overnight run should look like this:

1. Temporal Schedule starts an issue workflow for `bd-1234`.
2. Workflow reads BEADS and sees the issue is ready for planning.
3. Workflow runs a planning activity.
4. Workflow runs the plan review gate via activities.
5. If the plan fails, it retries according to policy or escalates.
6. If the plan passes and the next step requires human input, the workflow writes the approved planning state to BEADS and sleeps.
7. A human approves later.
8. Approval is recorded in authoritative workflow state first.
9. Temporal receives a resume signal.
10. Workflow wakes, re-reads BEADS, verifies approval, and proceeds.
11. If code execution occurs, each work unit goes through implement, validate, adversarial review, commit.
12. At the end of the night, a summary is generated from execution history plus current BEADS state.

## Safety Rules

These rules should be treated as non-negotiable.

### Rule 1: No Dual Workflow Authority

Never allow Temporal phase state to outrank BEADS workflow state.

### Rule 2: Resume Requires Reconciliation

Every wakeup or signal must re-check BEADS and relevant observations before progressing.

### Rule 3: Side Effects Must Be Idempotent

Operations such as:

- creating a PR
- posting a comment
- creating a BEADS task
- closing a task
- creating a worktree

must be replay-safe.

At minimum, use explicit correlation keys and precondition checks.

### Rule 4: Human Gates Are Explicit

Human approval cannot exist only as:

- a Temporal signal
- a Slack message
- a GitHub comment

It must be written into authoritative workflow state first.

### Rule 5: BEADS Concurrency Must Be Planned

If Temporal introduces concurrent writers, embedded single-writer mode is risky.

For serious parallel orchestration:

- favor BEADS server mode
- constrain write ownership
- ensure only one actor closes or mutates the same task at a time

### Rule 6: Reviewer Independence Must Survive Runtime Integration

Temporal must not accidentally collapse adversarial independence.

For example:

- fresh reviewers must remain fresh
- review iterations must not leak prior reviewer findings when metaswarm requires isolation

### Rule 7: Runtime Failures Must Not Corrupt Workflow Truth

If an activity times out or a worker crashes:

- BEADS should still reflect the last accepted workflow state
- the system should recover by rereading BEADS, not guessing

## Integration Strategy

The safest implementation path is incremental.

### Phase A: Runtime Wrapper Around Existing Flows

Add Temporal without changing metaswarm semantics.

Focus:

- scheduled kickoff
- durable waiting
- basic signal handling
- morning summaries

Keep:

- BEADS unchanged
- skills mostly unchanged
- orchestrator logic mostly unchanged

### Phase B: Durable Late-Stage Continuation

Add Temporal to:

- PR shepherd
- CI waiting
- review comment follow-up
- merge follow-through

This gives immediate value for overnight work with less risk than full end-to-end orchestration.

### Phase C: Durable Spec-To-Plan Lane

Add Temporal to:

- intake
- research
- planning
- plan review gate
- optional design review gate

This is likely the best early proof point because it is high-value, bounded, and heavy on waiting/review.

### Phase D: Work-Unit Execution

Add Temporal around:

- IMPLEMENT
- VALIDATE
- ADVERSARIAL REVIEW
- COMMIT

This is more complex because retries, validation, and reviewer freshness matter more.

### Phase E: Selective Deeper Decomposition

Only after the above is stable should the system consider:

- child workflows
- richer multi-issue runtime coordination
- deeper team-mode integration

## MVP Recommendation

If the immediate goal is "high-quality overnight work," the recommended minimum viable architecture is:

- BEADS remains the workflow/task substrate
- metaswarm skills remain the policy layer
- one Temporal workflow per issue/epic
- activities wrap side effects and agent invocations
- signals resume blocked runs after explicit workflow-state updates
- schedules handle nightly kickoff and late-stage wakeups
- no child workflows in v1
- BEADS server mode is the default target for concurrent orchestration

This architecture is:

- aligned with metaswarm's current design
- additive rather than destructive
- capable of overnight autonomous progress
- less likely to produce authority drift

## Open Design Questions

These should be resolved before implementation gets deep.

1. Which state transitions must be explicitly mirrored from BEADS into Temporal search attributes or summaries?
2. Should approvals live only in BEADS, or partly in repo-local docs as well?
3. What is the exact idempotency contract for BEADS mutations issued by Temporal activities?
4. Which metaswarm phases are safe to automate overnight without human review in the middle?
5. How should Team Mode interact with a durable runtime when teammates are conceptually persistent but worker processes are not?
6. Which external observations should wake workflows immediately, and which should be handled on a polling schedule?
7. What operator-facing summary artifacts or dashboards are needed for morning review?

## Recommended Initial Invariants

If implementation starts from this document, these invariants should be preserved:

1. BEADS remains the workflow-facing source of truth.
2. Temporal remains the runtime authority.
3. metaswarm quality gates remain blocking.
4. Agent outputs are never trusted without independent validation.
5. Human gates remain explicit and durable.
6. Every runtime continuation re-reads authoritative state before acting.
7. Simplicity beats cleverness in the first Temporal slice.

## Bottom Line

The right architecture is not:

- "replace metaswarm with Temporal"
- "replace BEADS with Temporal"
- "turn every agent into a workflow"

The right architecture is:

- metaswarm for workflow law
- BEADS for durable task/workflow truth
- Temporal for durable runtime execution

That split preserves metaswarm's strength while adding the missing capability required for reliable overnight autonomous work.

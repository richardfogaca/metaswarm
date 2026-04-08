# Operator Status Surface

**Date**: 2026-04-08
**Status**: Proposed implementation reference

## Purpose

The operator status surface answers one practical question:

> What is this Temporal run doing right now, or what most recently happened?

This surface is a read model only.

It must not become a second workflow authority.

## Restricted Step 8 Goal

The first honest status slice is:

- one CLI status command
- one merged operator-facing read model
- one graceful fallback path when live Temporal status is unavailable

It is not:

- a dashboard
- a streaming watch mode
- a new event store
- a replacement for BEADS or Temporal history

## Inputs

The restricted Step 8 status surface should support exactly these selectors:

- `--latest`
- `--run-id <run-id>`
- `--workflow-id <workflow-id>`
- `--beads-id <beads-id>`

Restricted interpretation rules:

- `--latest` means the most recently initiated run visible in local launch records
- `--beads-id` means the most recent run for that BEADS target, not a full run listing
- `--workflow-id` means the most recent run whose derived workflow id matches, not a full run listing
- exactly one selector should be required
- if no matching run is found, the command should fail clearly

## Data Sources

The status surface should merge three kinds of data:

### 1. Launch Record

Provides:

- run identity
- trigger type
- schedule identity when present
- workflow input shape
- runtime start intent such as delayed start

Recommended source:

```text
.metaswarm/runtime/launches/<run-id>.json
```

### 2. Morning Review Artifact

Provides:

- latest operator-facing summary
- blocked/completed outcome
- accepted changes summary
- validation summary
- human action required now

Recommended source:

```text
.metaswarm/runtime/reviews/<run-id>.json
```

### 3. Live Temporal Workflow Status

Provides:

- whether the runtime is currently running
- whether it has completed
- whether the workflow still exists

This is optional in the restricted Step 8 slice:

- if a Temporal connection is available, use it
- if it is unavailable, degrade to artifact-only status and surface that limitation clearly

Restricted availability rule:

- the first implementation should treat live Temporal inspection as opt-in through explicit runtime connection configuration such as `TEMPORAL_ADDRESS`
- if no live connection configuration is present, the status command should stay local and report artifact-only status rather than guessing

## Output Contract

```ts
type TemporalRunStatusView = {
  version: 1;
  selector: StatusSelector;
  runId: string;
  workflowId: string;
  beadsId: string;
  triggerType: "ad_hoc" | "scheduled_once" | "recurring" | "resume_signal";
  taskDefinitionId?: string;
  scheduleId?: string;
  runtimeStatus: "running" | "completed" | "failed" | "cancelled" | "sleeping" | "blocked" | "unknown";
  runtimeStatusSource: "temporal" | "review_artifact" | "derived";
  temporalWorkflowStatus?: string | null;
  initiatedAt: string;
  scheduledFor?: string;
  endedAt?: string;
  blockers: string[];
  humanActionRequired: string | null;
  launchRef: string;
  summaryRef?: string | null;
  acceptedChanges: string[];
  validationSummary?: ValidationSummary;
  warnings: string[];
};

type StatusSelector =
  | { kind: "latest" }
  | { kind: "run_id"; runId: string }
  | { kind: "workflow_id"; workflowId: string }
  | { kind: "beads_id"; beadsId: string };
```

## Status Derivation Rules

The restricted Step 8 slice should derive status in this order:

1. if a review artifact exists with `runtimeStatus: "sleeping"` or `runtimeStatus: "blocked"`, preserve that richer operator-facing status even when Temporal says the workflow is still `RUNNING`
2. otherwise, if live Temporal workflow status is available, use it for current runtime posture
3. otherwise, if a review artifact exists, use its `runtimeStatus`
4. otherwise derive `unknown` from launch-only information

Important boundary rule:

- live Temporal status answers runtime posture only
- the review artifact remains the operator-facing summary surface
- the launch record remains launch audit only
- none of these override BEADS workflow truth

Restricted mapping rule:

- `RUNNING` from Temporal is not specific enough to replace a richer `sleeping` or `blocked` review artifact
- Temporal terminal states may fill gaps when no review artifact exists yet
- the status command should surface both `runtimeStatus` and raw `temporalWorkflowStatus` when they differ

## Workflow Id Resolution

The restricted Step 8 slice should not require a new workflow-id ledger.

Workflow ids should be derived from existing launch metadata using the documented shapes:

- ad hoc runs: `issue-<beads-id>`
- delayed once runs: `issue-<beads-id>-schedule-<schedule-id>`
- recurring runs: `issue-<beads-id>-schedule-<schedule-id>-run-<run-id>`

If a workflow id cannot be derived from a malformed launch record, status resolution should fail loudly.

## CLI Expectations

Recommended command shape:

```text
metaswarm temporal status --latest
metaswarm temporal status --run-id <run-id>
metaswarm temporal status --workflow-id <workflow-id>
metaswarm temporal status --beads-id <beads-id>
metaswarm temporal status --latest --json
```

Restricted output modes:

- default: concise human-readable summary
- `--json`: exact machine-readable status view

Restricted connectivity behavior:

- lack of live Temporal connection configuration is a warning, not an error
- failure to resolve local artifacts for the selected run is an error
- failure to query a configured Temporal endpoint should degrade to artifact-only status with a warning in the restricted slice

## Important Limits

The restricted Step 8 slice intentionally defers:

- `watch` or streaming status updates
- structured event logging and retention
- multi-run tables for one BEADS target
- dashboard or TUI surfaces
- mutation actions such as resume, cancel, or retry from the status command

Those belong to later operational slices.

# Morning Review Artifact

**Date**: 2026-04-08
**Status**: Proposed implementation reference

## Purpose

The morning review artifact is the operator-facing summary of a runtime execution.

It exists so the operator can quickly understand:

- what happened overnight
- what changed
- what passed
- what failed
- what is blocked
- what needs human input

This is a read model only.

It is not workflow authority.

It is also the authoritative operator-facing surface for non-terminal runtime states such as sleeping or blocked while the workflow is still open.

## Contract

```ts
type MorningReviewArtifact = {
  version: 1;
  runId: string;
  beadsId: string;
  taskDefinitionId?: string;
  scheduleId?: string;
  triggerType: "ad_hoc" | "scheduled_once" | "recurring" | "resume_signal";
  runtimeStatus: "completed" | "sleeping" | "blocked" | "failed" | "cancelled";
  startedAt: string;
  endedAt: string;
  stepsAttempted: string[];
  acceptedChanges: string[];
  validationSummary: ValidationSummary;
  blockers: string[];
  humanActionRequired: string | null;
};

type ValidationSummary = {
  testsRun?: string[];
  checksRun?: string[];
  passes: string[];
  failures: string[];
  warnings: string[];
};
```

## Minimum Required Fields

Every artifact must include:

- `runId`
- `beadsId`
- `triggerType`
- `runtimeStatus`
- `startedAt`
- `endedAt`
- `stepsAttempted`
- `validationSummary`
- `blockers`
- `humanActionRequired`

## Content Rules

### `stepsAttempted`

Should be human-readable and high signal.

Examples:

- `planning`
- `plan-review-gate`
- `design-review-gate`
- `wu-001 implement`
- `wu-001 validate`
- `pr-shepherd`

### `acceptedChanges`

Should summarize accepted outputs, not raw noise.

Examples:

- `Approved implementation plan persisted to BEADS`
- `Created PR #123`
- `Resolved 4 review threads`

### `humanActionRequired`

Should be explicit when non-null.

Examples:

- `Approve checkpoint to continue into implementation`
- `Provide STRIPE_SECRET_KEY before dependent work can resume`
- `Decide whether to override remaining plan review blocker`

## Recommended Formats

Recommended outputs:

- JSON for machine use
- Markdown for operator reading

Suggested locations:

```text
.metaswarm/runtime/reviews/<run-id>.json
.metaswarm/runtime/reviews/<run-id>.md
```

The JSON file is required. Markdown is optional in early phases.

These are derived artifacts.

They should be rebuildable from:

- Temporal execution history
- BEADS task state
- validation outputs
- repo state

The per-run artifact path is stable. The runtime may rewrite the same artifact as the run crosses reporting boundaries:

- sleeping
- blocked
- failed
- completed

This keeps the operator surface simple: one run, one current review file.

## Example JSON

```json
{
  "version": 1,
  "runId": "run-20260408-001",
  "beadsId": "bd-1234",
  "taskDefinitionId": "taskdef-auth-fix-now",
  "scheduleId": null,
  "triggerType": "ad_hoc",
  "runtimeStatus": "sleeping",
  "startedAt": "2026-04-08T21:00:00-03:00",
  "endedAt": "2026-04-08T23:40:00-03:00",
  "stepsAttempted": [
    "planning",
    "plan-review-gate"
  ],
  "acceptedChanges": [
    "Approved implementation plan persisted to BEADS"
  ],
  "validationSummary": {
    "testsRun": [],
    "checksRun": ["plan-review-gate"],
    "passes": ["plan approved by all required reviewers"],
    "failures": [],
    "warnings": []
  },
  "blockers": [],
  "humanActionRequired": "Approve checkpoint to continue into implementation"
}
```

## Step 1 Minimum Expectations

For Step 1, the artifact may be intentionally sparse as long as it remains valid and high signal.

Acceptable Step 1 defaults:

- `stepsAttempted: ["runtime-skeleton"]`
- `acceptedChanges: []`
- empty `testsRun`, `checksRun`, `passes`, `failures`, and `warnings`

Step 1 is proving runtime behavior, not full workflow semantics.

## Operator Experience Rule

The morning review artifact should optimize for:

- fast comprehension
- low noise
- clear decisions

If the artifact becomes an execution dump, it has failed its purpose.

# Local Development Stack

**Date**: 2026-04-08
**Status**: Proposed implementation reference

## Purpose

This slice defines the first honest local developer environment for the Temporal-backed metaswarm runtime.

It answers one practical question:

> How does a developer run Temporal locally with metaswarm without inventing a fake production deployment model?

## Restricted Goal

The restricted local-development slice should provide:

- one Docker Compose stack for local Temporal infrastructure
- one host-side metaswarm worker process
- one documented validation flow for delayed scheduled runs

It is not:

- a production deployment model
- a containerized BEADS or git environment
- a fully orchestrated one-command application platform
- a Kubernetes design

## Local Runtime Boundary

The restricted boundary is:

- Temporal server and Temporal UI run in containers
- the metaswarm Temporal worker runs on the host
- the worker reads and writes the real repo under the developer's current working tree
- the worker uses host-installed tools such as `bd`, `git`, and optional `gh`

This split is intentional.

The worker is the runtime component that touches:

- `.metaswarm/runtime/*`
- `.beads/*`
- the git worktree
- host credentials and developer tool configuration

Containerizing that worker in the same first slice would add path-mount, auth, and host-tool duplication problems without architectural benefit.

## Required Components

The restricted slice should define exactly these runtime components:

### 1. Local Temporal Infrastructure

Owns:

- Temporal gRPC endpoint for workflows and workers
- Temporal UI for local inspection

Recommended implementation:

- Docker Compose
- `temporalio/auto-setup` for local server bootstrap
- `temporalio/ui` for browser inspection

The compose stack may include any minimal supporting data store needed by the chosen Temporal image.

### 2. Host-Side metaswarm Worker

Owns:

- connecting to the local Temporal server
- polling the configured task queue
- registering workflows and activities
- reading and writing repo-local runtime artifacts
- using host BEADS state and host CLI tools

Recommended command shape:

```text
npm run temporal:worker
```

This worker must be a real long-running worker, not a dry-run check only.

### 3. Dev Convenience Entry

The restricted slice may provide a thin convenience command that:

1. brings the compose stack up if needed
2. starts the host worker

Recommended shape:

```text
npm run temporal:dev
```

This convenience command is optional for the first implementation, but if included it must remain a wrapper around the same compose stack and worker command rather than a separate runtime path.

## Environment Contract

The restricted slice should make the environment contract explicit.

Required behavior:

- local worker defaults to `localhost:7233` when no Temporal address is provided
- local worker defaults to namespace `default` unless explicitly overridden
- local worker accepts `--repo-root <path>` so it can be pointed at another checkout intentionally
- the same environment values should be usable by the status surface
- if compose host ports are overridden, the worker and status surface must be able to follow through normal Temporal address configuration rather than a special dev-only path

Recommended environment variables:

- `TEMPORAL_ADDRESS`
- `TEMPORAL_NAMESPACE`

Allowed metaswarm-specific aliases:

- `METASWARM_TEMPORAL_ADDRESS`
- `METASWARM_TEMPORAL_NAMESPACE`

If aliases are supported, they must normalize to the same effective runtime configuration rather than creating a second parallel config system.

## Compose Contract

The compose layer should stay intentionally narrow.

Required properties:

- one stable compose file in the repository
- recommended filename: `compose.temporal.yaml`
- published local gRPC port for Temporal
- published local HTTP port for Temporal UI
- deterministic service names so docs and scripts stay stable

Recommended defaults:

- Temporal gRPC: `localhost:7233`
- Temporal UI: `http://localhost:8080`
- namespace: `default`

Port collision rule:

- the compose file may expose host-port overrides through environment variables
- if the host gRPC port is changed, the worker and status command must follow it through `TEMPORAL_ADDRESS` or its documented alias
- if the host UI port is changed, the documentation must explain where the UI will be reachable

Compose invocation rule:

- prefer `docker compose`
- fallback to `docker-compose` only when the plugin form is unavailable
- the wrapper must use one detection path consistently rather than branching unpredictably per command

Restricted first-slice behavior:

- do not add BEADS, git, or metaswarm worker containers
- do not add reverse proxies, ingress, or secrets infrastructure
- do not add a production-style persistence design

If the compose stack includes persistent volumes, they should be local-dev convenience only.

## Worker Contract

The host worker startup path should support:

- check mode for bootstrap inspection
- run mode for real polling
- graceful shutdown on `SIGINT` and `SIGTERM`
- reuse of one connection for worker polling and activity-side Temporal client needs
- bounded connection attempts so startup fails in a clear amount of time when the local Temporal server is unreachable

The worker command should fail clearly when:

- Docker services are not reachable
- required runtime dependencies are missing
- the repo root is invalid

The worker command should not silently fall back to test-only or fake local environments.

## Validation Flow

The restricted slice should document one concrete local validation flow:

1. start local Temporal infrastructure
2. start the real metaswarm worker
3. register or launch a delayed scheduled run against the local stack
4. inspect the run through `metaswarm temporal status`
5. inspect the same run in Temporal UI
6. stop the worker and optionally stop the local stack

This must prove the local stack is useful for real developer verification, not just for unit tests.

The documented flow should also make one point explicit:

- `docker compose up` does not mean the worker is already running
- the host worker is a separate process in this slice unless the optional convenience wrapper starts it

## Important Limits

The restricted slice intentionally defers:

- worker containerization
- BEADS or git services in Compose
- production deployment manifests
- remote shared development environments
- automated launch CLI beyond what already exists in the runtime
- watch mode or richer runtime event streaming

Those belong to later operational or deployment slices.

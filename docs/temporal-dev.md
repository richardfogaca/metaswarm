# Temporal Local Development

This repo can run the Temporal-backed metaswarm runtime against a local Docker Compose stack.

For the current runtime model and artifact conventions, see [guides/temporal-runtime.md](/Users/richard/git/personal/metaswarm/guides/temporal-runtime.md).

The development boundary is intentional:

- Temporal services run in Docker
- the metaswarm worker runs on the host
- the worker uses the real repo, `.metaswarm/runtime`, `.beads`, and host CLI tools

## Commands

Start local Temporal services:

```bash
npm run temporal:dev:up
```

Check service status:

```bash
npm run temporal:dev:status
```

Start the host worker in the current repo:

```bash
npm run temporal:worker
```

Start the host worker for another checkout:

```bash
npm run temporal:worker -- --repo-root /path/to/repo
```

Stop the local Temporal services:

```bash
npm run temporal:dev:down
```

## Defaults

- Temporal gRPC: `localhost:7233`
- Temporal UI: `http://localhost:8080`
- namespace: `default`

If those host ports are already in use, override them when starting the stack:

```bash
METASWARM_TEMPORAL_PORT=8233 METASWARM_TEMPORAL_UI_PORT=9080 npm run temporal:dev:up
TEMPORAL_ADDRESS=localhost:8233 npm run temporal:worker
```

Override the worker connection with:

- `TEMPORAL_ADDRESS`
- `TEMPORAL_NAMESPACE`
- `METASWARM_TEMPORAL_ADDRESS`
- `METASWARM_TEMPORAL_NAMESPACE`

## Validation

One honest local validation flow is:

1. `npm run temporal:dev:up`
2. `npm run temporal:worker`
3. launch a delayed scheduled run against the same repo root
4. inspect it with `metaswarm temporal status`
5. inspect it in Temporal UI at `http://localhost:8080`
6. stop the worker and run `npm run temporal:dev:down`

`npm run temporal:dev:up` starts infrastructure only. It does not start the host worker unless you run the worker command separately.

#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ADAPTER="${REPO_ROOT}/skills/external-tools/adapters/codex.sh"

TMP_DIR="$(mktemp -d -t metaswarm-codex-adapter-XXXXXX)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

FAKE_HOME="${TMP_DIR}/home"
FAKE_BIN="${TMP_DIR}/bin"
FAKE_LOG="${TMP_DIR}/codex-args.log"
WORKTREE="${TMP_DIR}/repo"
PROMPT_FILE="${TMP_DIR}/prompt.md"
RUBRIC_FILE="${TMP_DIR}/rubric.md"
SPEC_FILE="${TMP_DIR}/spec.md"

mkdir -p "$FAKE_HOME/.codex" "$FAKE_BIN" "$WORKTREE"

cat > "${FAKE_HOME}/.codex/config.toml" <<'EOF'
model = "gpt-5.4"
EOF

cat > "${FAKE_BIN}/codex" <<EOF
#!/bin/bash
set -euo pipefail
LOG_FILE="${FAKE_LOG}"
case "\${1:-}" in
  --version)
    printf 'codex-cli 0.0.0-test\n'
    ;;
  login)
    if [[ "\${2:-}" == "status" ]]; then
      exit 0
    fi
    ;;
  exec)
    printf '%s\n' "\$*" >> "\$LOG_FILE"
    printf '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}\n'
    ;;
  *)
    printf 'unexpected invocation: %s\n' "\$*" >&2
    exit 1
    ;;
esac
EOF
chmod +x "${FAKE_BIN}/codex"

git -C "$WORKTREE" init -q
git -C "$WORKTREE" config user.name "Test User"
git -C "$WORKTREE" config user.email "test@example.com"
printf 'seed\n' > "${WORKTREE}/README.md"
git -C "$WORKTREE" add README.md
git -C "$WORKTREE" commit -qm "seed"

printf 'Implement this change.\n' > "$PROMPT_FILE"
printf 'Review rubric.\n' > "$RUBRIC_FILE"
printf 'Specification.\n' > "$SPEC_FILE"

health_json="$(
  HOME="$FAKE_HOME" PATH="${FAKE_BIN}:$PATH" OPENAI_API_KEY="test-key" \
    bash "$ADAPTER" health
)"

if ! printf '%s' "$health_json" | jq -e '.model == "gpt-5.4"' >/dev/null; then
  printf 'FAIL: health did not report model from ~/.codex/config.toml\n' >&2
  exit 1
fi

HOME="$FAKE_HOME" PATH="${FAKE_BIN}:$PATH" OPENAI_API_KEY="test-key" \
  bash "$ADAPTER" implement --worktree "$WORKTREE" --prompt-file "$PROMPT_FILE" >/dev/null

HOME="$FAKE_HOME" PATH="${FAKE_BIN}:$PATH" OPENAI_API_KEY="test-key" CODEX_MODEL="gpt-5-codex" \
  bash "$ADAPTER" review --worktree "$WORKTREE" --rubric-file "$RUBRIC_FILE" --spec-file "$SPEC_FILE" >/dev/null

if ! grep -F -- '--full-auto --json --model gpt-5.4' "$FAKE_LOG" >/dev/null; then
  printf 'FAIL: implement did not pass --model gpt-5.4\n' >&2
  exit 1
fi

if ! grep -F -- '--sandbox read-only --json --model gpt-5-codex' "$FAKE_LOG" >/dev/null; then
  printf 'FAIL: review did not honor CODEX_MODEL override\n' >&2
  exit 1
fi

printf 'PASS: codex adapter uses explicit model selection and honors overrides\n'

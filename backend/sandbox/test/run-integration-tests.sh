#!/usr/bin/env bash
# Docker-based integration check for backend/sandbox — NOT part of `npx vitest run`. Builds the
# real image and runs it via `docker run` (not Cloud Run) with the same env-var protocol
# CloudRunSandboxClient uses, asserting the runner's actual behavior: the exact result-line
# protocol, process-group cleanup on timeout, streaming output capture, and non-root execution.
set -euo pipefail

cd "$(dirname "$0")/.."
IMAGE=arcnave-python-sandbox:integration-test
docker build -t "$IMAGE" .

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

b64() {
  printf '%s' "$1" | base64 | tr -d '\n'
}

run_case() {
  local name="$1" code="$2" timeout_ms="$3"
  docker run --rm \
    -e RUN_PYTHON_CODE_B64="$(b64 "$code")" \
    -e RUN_PYTHON_CODE_TIMEOUT_MS="$timeout_ms" \
    -e RUN_PYTHON_EXECUTION_ID="test-$name" \
    "$IMAGE"
}

echo "== success =="
OUT=$(run_case success 'print("hello")' 5000)
echo "$OUT" | grep -q 'ARCNAVE_SANDBOX_RESULT:' || fail "success: no result line"
echo "$OUT" | grep -q '"ok": true' || fail "success: expected ok: true"
echo "$OUT" | grep -q 'hello' || fail "success: expected stdout to contain hello"

echo "== exception =="
OUT=$(run_case exception 'raise ValueError("boom")' 5000)
echo "$OUT" | grep -q '"ok": false' || fail "exception: expected ok: false"
echo "$OUT" | grep -q 'ValueError' || fail "exception: expected stderr to mention ValueError"

echo "== timeout =="
OUT=$(run_case timeout 'import time; time.sleep(30)' 2000)
echo "$OUT" | grep -q '"timedOut": true' || fail "timeout: expected timedOut: true"

echo "== process-group cleanup on timeout =="
# Spawns a detached grandchild that outlives a naive single-process kill; if killpg works, the
# container exits promptly instead of hanging on the orphaned sleep.
START=$(date +%s)
OUT=$(run_case pgroup 'import subprocess, time; subprocess.Popen(["sleep", "30"]); time.sleep(30)' 2000)
END=$(date +%s)
DURATION=$((END - START))
echo "$OUT" | grep -q '"timedOut": true' || fail "pgroup: expected timedOut: true"
[ "$DURATION" -lt 10 ] || fail "pgroup: container took ${DURATION}s to exit — killpg likely didn't reap the child"

echo "== streaming output capture (no OOM on unbounded print) =="
OUT=$(docker run --rm --memory=128m \
  -e RUN_PYTHON_CODE_B64="$(b64 'i = 0
while i < 200:
    print("X" * 100000)
    i += 1')" \
  -e RUN_PYTHON_CODE_TIMEOUT_MS=10000 \
  -e RUN_PYTHON_EXECUTION_ID=test-stdout-cap \
  -e MAX_STDOUT_BYTES=65536 \
  "$IMAGE")
echo "$OUT" | grep -q '"stdoutTruncated": true' || fail "stdout cap: expected stdoutTruncated: true"

echo "== non-root execution =="
UID_OUTPUT=$(docker run --rm --entrypoint id "$IMAGE" -u)
[ "$UID_OUTPUT" != "0" ] || fail "container is running as root (uid 0)"

echo "ALL SANDBOX INTEGRATION CHECKS PASSED"

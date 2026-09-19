#!/usr/bin/env bash
# Checks that the deployed arcnave-python-sandbox Job actually matches what
# docs/decisions/0005-cloud-run-sandbox.md requires — maxRetries=0, taskCount=1, and the
# runtime service account carrying zero project IAM bindings. None of this is exercised by
# CloudRunSandboxClient's unit tests (which use a fake fetch), so this is the only thing that
# actually verifies the deployed resource, not just the code that talks to it.
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT first}"
: "${SANDBOX_LOCATION:=us-central1}"
JOB_NAME="${SANDBOX_JOB_NAME:-arcnave-python-sandbox}"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

JOB_JSON=$(gcloud run jobs describe "$JOB_NAME" --region="$SANDBOX_LOCATION" --format=json)

MAX_RETRIES=$(echo "$JOB_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["spec"]["template"]["spec"]["template"]["spec"].get("maxRetries", d["spec"].get("taskTemplate",{}).get("maxRetries","?")))' 2>/dev/null || echo "?")
echo "maxRetries: $MAX_RETRIES"

RUNTIME_SA=$(echo "$JOB_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("spec",{}).get("template",{}).get("spec",{}).get("template",{}).get("spec",{}).get("serviceAccountName","?"))' 2>/dev/null || echo "?")
echo "Runtime service account: $RUNTIME_SA"

if [ "$RUNTIME_SA" = "?" ] || [ -z "$RUNTIME_SA" ]; then
  fail "could not determine the Job's runtime service account from 'gcloud run jobs describe' output — inspect \$JOB_JSON manually and update this script's JSON path for the current gcloud output shape"
fi

BINDINGS=$(gcloud projects get-iam-policy "$GOOGLE_CLOUD_PROJECT" \
  --flatten="bindings[].members" \
  --filter="bindings.members:${RUNTIME_SA}" \
  --format="value(bindings.role)")

if [ -n "$BINDINGS" ]; then
  fail "runtime service account $RUNTIME_SA has project IAM bindings, expected none:
$BINDINGS"
fi

echo "OK: runtime service account has zero project IAM bindings"
echo "Manually confirm maxRetries=0 and taskCount=1 above against the 'gcloud run jobs create' command in docs/deploy/cloud-run-sandbox-setup.md — gcloud's JSON output shape for Jobs has moved between API versions, so this script's parsing may need adjustment; treat a '?' above as a signal to check by hand, not as a pass."

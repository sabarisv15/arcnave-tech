# Cloud Run sandbox setup — one-time infrastructure for `run_python`

Manual setup, run once per environment (not part of the automated deploy — ArcNave's Cloud Build
trigger deploys the backend *service*, not this Job or its IAM). See
[ADR-0005](../decisions/0005-cloud-run-sandbox.md) for why this shape.

## 1. Sandbox runtime service account — zero project IAM

```bash
gcloud iam service-accounts create arcnave-sandbox-runtime \
  --display-name="ArcNave run_python sandbox runtime (no project IAM)"
```

Do not grant this account any role. That is the point — verify with:

```bash
gcloud projects get-iam-policy "$GOOGLE_CLOUD_PROJECT" \
  --flatten="bindings[].members" \
  --filter="bindings.members:arcnave-sandbox-runtime@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com"
```
Expected: no output.

## 2. Backend service account — custom role

```bash
gcloud iam roles create arcnave_sandbox_launcher \
  --project="$GOOGLE_CLOUD_PROJECT" \
  --title="ArcNave sandbox launcher" \
  --description="Launch and read arcnave-python-sandbox Job executions; read their logs" \
  --permissions=run.jobs.run,run.jobs.runWithOverrides,run.operations.get,run.executions.get

gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" \
  --member="serviceAccount:<existing-backend-sa>@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" \
  --role="projects/${GOOGLE_CLOUD_PROJECT}/roles/arcnave_sandbox_launcher"

# Logging read, scoped as narrowly as a built-in role allows — NOT roles/logging.viewer.
# A dedicated log view is a v1 gap (see ADR-0005), not built here.
gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" \
  --member="serviceAccount:<existing-backend-sa>@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" \
  --role="roles/logging.viewAccessor"
```

Replace `<existing-backend-sa>` with the backend Cloud Run service's actual service account name
before running.

## 3. Cloud Run Job resource

```bash
gcloud run jobs create arcnave-python-sandbox \
  --image="<SANDBOX_IMAGE_URL>" \
  --region="$SANDBOX_LOCATION" \
  --service-account="arcnave-sandbox-runtime@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" \
  --tasks=1 \
  --max-retries=0 \
  --parallelism=1 \
  --cpu=1 \
  --memory=512Mi \
  --task-timeout=15s
```

`--task-timeout` here (15s) is deliberately just above `RUN_PYTHON_CODE_TIMEOUT_MS`'s default
(10s) — a backstop, not the primary timeout enforcement (that's `runner.py`'s own in-container
deadline). `<SANDBOX_IMAGE_URL>` is the image built from `backend/sandbox/Dockerfile`
(`docker build -t <SANDBOX_IMAGE_URL> backend/sandbox`), pushed to Artifact Registry — not part
of the main backend's Cloud Build trigger; push it manually or add a separate trigger when this
graduates past manual setup.

## 4. Verify

Run `backend/sandbox/verify-deployment-config.sh` after any change to the Job resource or either
service account — see that script for exactly what it checks and why.

## Explicitly not built here

- A dedicated Cloud Logging log view scoped to only this Job, for tighter log-read isolation than
  `roles/logging.viewAccessor` gives — accepted v1 gap, see ADR-0005.
- Cloud Run's `--sandbox-launcher` (Sandboxes) feature — Preview as of 2026-09-19, recorded as
  future hardening, not built now.

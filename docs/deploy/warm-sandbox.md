# Warm sandbox service and background runs: one-time setup

Run these steps once per environment, from Cloud Shell, with the repo checked out at this
commit. They are not part of the automated backend deploy. Why this shape:
[ADR-0010](../decisions/0010-warm-sandbox-service.md) (sandbox) and
[ADR-0009](../decisions/0009-runs-outlive-connections.md) (background runs).

```bash
export GOOGLE_CLOUD_PROJECT=$(gcloud config get-value project)
export REGION=asia-south1
export BACKEND=arcnave-sandbox-service    # the backend's Cloud Run service (historical name)
export BACKEND_SA=$(gcloud run services describe $BACKEND --region=$REGION \
  --format='value(spec.template.spec.serviceAccountName)')
echo "backend runs as: $BACKEND_SA"      # must not be empty
```

## 1. Build the sandbox image

```bash
gcloud builds submit backend/sandbox --config backend/sandbox/cloudbuild.service.yaml
```

## 2. Deploy the sandbox service

It uses the existing zero-IAM runtime account `arcnave-sandbox-runtime`. If that account does
not exist yet, create it first: [cloud-run-sandbox-setup.md §1](cloud-run-sandbox-setup.md).

```bash
gcloud run deploy arcnave-python-runner \
  --image=$REGION-docker.pkg.dev/$GOOGLE_CLOUD_PROJECT/cloud-run-source-deploy/arcnave-python-runner:latest \
  --region=$REGION \
  --service-account=arcnave-sandbox-runtime@$GOOGLE_CLOUD_PROJECT.iam.gserviceaccount.com \
  --no-allow-unauthenticated \
  --execution-environment=gen2 \
  --min-instances=1 --max-instances=1 \
  --concurrency=16 --cpu=2 --memory=4Gi --timeout=900 \
  --no-cpu-throttling \
  --set-env-vars=MAX_WORKSPACES=12,MAX_WORKSPACE_BYTES=268435456,WORKSPACE_TTL_S=7200
```

What each setting is for:

- `--max-instances=1`: every call for a chat reaches the instance that holds that chat's files.
  Going above 1 first needs routing by workspace. Until then this one instance is the capacity
  limit.
- `--min-instances=1` and `--no-cpu-throttling`: the service stays warm, so there is no cold
  start per call.
- `--memory=4Gi` with `MAX_WORKSPACES=12` × 256 MiB: Cloud Run's disk is memory. The workspace
  caps keep the files within what the instance has.
- `--no-allow-unauthenticated`: only callers with `run.invoker` on this service can reach it.

## 3. Let the backend call it

```bash
gcloud run services add-iam-policy-binding arcnave-python-runner --region=$REGION \
  --member="serviceAccount:$BACKEND_SA" --role=roles/run.invoker
export RUNNER_URL=$(gcloud run services describe arcnave-python-runner --region=$REGION --format='value(status.url)')
echo $RUNNER_URL
```

## 4. Point the backend at it, and let runs outlive connections

`--update-env-vars` changes only the variables named here, unlike `--set-env-vars` (see
mistakes.md, 2026-09-17).

```bash
gcloud run services update $BACKEND --region=$REGION \
  --no-cpu-throttling --min-instances=1 \
  --update-env-vars=SANDBOX_ENGINE=warm,SANDBOX_SERVICE_URL=$RUNNER_URL,ENABLE_RUN_PYTHON=true
```

`--no-cpu-throttling` is required for background runs (ADR-0009). Without it, Cloud Run
throttles the CPU once the browser's connection closes, and a detached run stalls until someone
reconnects.

## 5. Verify

1. The backend log shows `run_python uses the warm sandbox service` after the new revision
   starts.
2. In a new chat, upload the KVB PDF and ask: "run python: print the size of the uploaded PDF
   and the first 200 characters of pdftotext output". The first call should answer in seconds,
   not 20–40 s. A second call in the same chat that reads a file the first one wrote should find
   it.
3. Start a long request, then close the tab. Reopen the chat after a minute. The reply should
   still be generating, or be finished, not "Connection interrupted".

## Not done here

- **No-egress networking (ADR-0007).** The service still has open outbound internet, like the
  Job. Closing it takes a VPC with no NAT (`--network … --subnet … --vpc-egress=all-traffic`)
  and a probe that an outbound call from `run_python` fails. The service needs no Google APIs,
  so the fully closed form works.
- **Workspaces are in memory on one instance.** A redeploy or an instance restart loses them.
  The next call re-sends its inputs automatically (409 → upload), but files a previous call
  wrote are gone.

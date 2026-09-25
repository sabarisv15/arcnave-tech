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
  --concurrency=16 --cpu=2 --memory=8Gi --timeout=900 \
  --no-cpu-throttling \
  --set-env-vars=MAX_WORKSPACES=5,MAX_WORKSPACE_BYTES=1932735283,WORKSPACE_TTL_S=7200
```

What each setting is for:

- `--max-instances=1`: every call for a chat reaches the instance that holds that chat's files.
  Going above 1 first needs routing by workspace. Until then this one instance is the capacity
  limit.
- `--min-instances=1` and `--no-cpu-throttling`: the service stays warm, so there is no cold
  start per call.
- `--memory=8Gi`: for the code itself. Workspaces are on the ephemeral disk (step 7), not in
  memory, so memory no longer bounds how many files a chat holds. Each run may use 3 GiB
  (`RUN_MEMORY_BYTES`) and at most 2 run at once (`MAX_CONCURRENT_RUNS`), both image defaults
  ([ADR-0014](../decisions/0014-sandbox-resources-per-chat.md)).
- `MAX_WORKSPACES=5` × `MAX_WORKSPACE_BYTES=1932735283` (1.8 GiB): what fits the 10 GiB disk.
  ext4 keeps about 5% for root and the per-chat uids are not root, so about 9.3 GiB is usable.
  A workspace is per chat, not per user. When all five are taken, the one idle the longest is
  dropped; its inputs are re-sent on its next call, and files its code wrote are gone.
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

## 6. Close outbound internet (ADR-0007)

The service needs no Google APIs (files come in the request body), so it goes on a VPC with no
NAT and a deny-all egress rule. The backend must never be attached to this VPC: it would lose
Postgres and Vertex (mistakes.md, 2026-09-17).

```bash
gcloud compute networks create arcnave-sandbox-vpc --subnet-mode=custom
gcloud compute networks subnets create arcnave-sandbox-subnet \
  --network=arcnave-sandbox-vpc --region=$REGION --range=10.20.0.0/26
gcloud compute firewall-rules create arcnave-sandbox-deny-egress \
  --network=arcnave-sandbox-vpc --direction=EGRESS --action=DENY \
  --rules=all --destination-ranges=0.0.0.0/0 --priority=1000
gcloud run services update arcnave-python-runner --region=$REGION \
  --network=arcnave-sandbox-vpc --subnet=arcnave-sandbox-subnet --vpc-egress=all-traffic
```

Verify: in a chat, ask it to run
`import urllib.request; print(urllib.request.urlopen("https://example.com", timeout=10).status)`.
It must fail with `Network is unreachable`, and the reply must still arrive (the backend is
unaffected). Done live on 2026-09-25.

## 7. Put workspaces on disk, not in memory

Cloud Run's own filesystem is memory. An ephemeral disk (Preview, $0.000109589 per GiB-hour in
Tier 1 regions such as asia-south1, about $0.80 a month for 10 GiB) is instance-local ext4 that
needs no network and no IAM, so ADR-0007's closed network is unaffected. The server already
keeps workspaces under `WORK_ROOT=/work`.

```bash
gcloud beta run services update arcnave-python-runner --region=$REGION \
  --add-volume=name=work,type=ephemeral-disk,size=10Gi \
  --add-volume-mount=volume=work,mount-path=/work \
  --update-env-vars=MAX_WORKSPACES=5,MAX_WORKSPACE_BYTES=1932735283
```

10 GiB is the most a service instance may have: 30 GiB was refused with "Total size of
'ephemeral-disk' volumes cannot exceed 10 GiB". A Cloud Storage volume mount was rejected: it
needs Private Google Access and bucket IAM on the sandbox, and it is not POSIX. Verify: the
service shows `emptyDir: {medium: Disk, sizeLimit: 10Gi}` mounted at `/work`, and in a chat
`shutil.disk_usage("/work")` reports about 10 GB and a 1.5 GB file can be written.

## 8. Memory per run (ADR-0014)

Rebuild the image (step 1) and point the service at it; volumes, network and variables stay.

```bash
gcloud run services update arcnave-python-runner --region=$REGION \
  --image=$REGION-docker.pkg.dev/$GOOGLE_CLOUD_PROJECT/cloud-run-source-deploy/arcnave-python-runner:latest
```

Verify in a chat: `bytearray(4 * 2**30)` fails with `MemoryError`, and the next run in the same
chat works.

## Not done here

- **Workspaces are on one instance.** A redeploy or an instance restart loses them.
  The next call re-sends its inputs automatically (409 → upload), but files a previous call
  wrote are gone.

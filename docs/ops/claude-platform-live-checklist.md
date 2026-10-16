# Claude Platform switch — owner steps and live checklist

Claude calls use `ANTHROPIC_API_KEY` ([ADR-0064](../decisions/0064-claude-platform-gemini-vertex.md)).
The Cloud Run service config is not in this repo (the Cloud Build trigger and service are set in
the console), so these are your steps.

## Before you merge

1. Create the secret (the one command; paste the key when it asks, it is not echoed to history):
   ```bash
   read -rs K && printf %s "$K" | gcloud secrets create ANTHROPIC_API_KEY --data-file=- --project=<PROJECT>; unset K
   ```
2. Let the Cloud Run runtime service account read it:
   ```bash
   gcloud secrets add-iam-policy-binding ANTHROPIC_API_KEY --member=serviceAccount:<RUNTIME_SA> --role=roles/secretmanager.secretAccessor --project=<PROJECT>
   ```
3. In Cloud Run → the backend service → Edit & deploy new revision → Variables & Secrets →
   *Reference a secret*: name `ANTHROPIC_API_KEY`, secret `ANTHROPIC_API_KEY`, version `latest`,
   exposed as an environment variable. Keep `GOOGLE_CLOUD_PROJECT` (Gemini still needs it).
4. Merge the branch (merge = deploy; owner only).

## Live check after the deploy

| Step | Expect | Failure looks like |
| --- | --- | --- |
| `GET /readyz` | `status: ready`, `vertexConfigured: true`, `anthropicConfigured: true` | `degraded` or `anthropicConfigured: false`: the secret is not mounted |
| Settings → models | Sonnet 5.5, Opus 5.5, Gemini 3.8 Flash available | A Claude alias shows `anthropic_not_configured`, or `probe_failed` with a key/billing message |
| Ask Sonnet 5.5 a short question | Answer streams; usage shows exact tokens | Typed error `model_unavailable` |
| Ask Gemini 3.8 Flash the same | Answer streams as before | `vertex_not_configured` |

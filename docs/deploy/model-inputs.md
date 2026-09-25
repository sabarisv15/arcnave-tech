# Page images by URI for Gemini: one-time setup (ADR-0016)

From Cloud Shell. Nothing here is needed for Claude, which takes page images inline.

```bash
export PROJECT=$(gcloud config get-value project)
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
export BACKEND_SA=$(gcloud run services describe arcnave-sandbox-service --region=asia-south1 \
  --format='value(spec.template.spec.serviceAccountName)')
echo "backend: $BACKEND_SA"   # must not be empty
```

## 1. The bucket, with a 7-day lifecycle

```bash
gcloud storage buckets create gs://arcnave-model-inputs --location=asia-south1 \
  --uniform-bucket-level-access --public-access-prevention
printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":7}}]}' > /tmp/lifecycle.json
gcloud storage buckets update gs://arcnave-model-inputs --lifecycle-file=/tmp/lifecycle.json
```

7 days is `LIFECYCLE_DAYS` in `modelInputStore.ts`. Change both together.

## 2. Who may read and write

```bash
# Vertex reads the pages.
gcloud storage buckets add-iam-policy-binding gs://arcnave-model-inputs \
  --member="serviceAccount:service-$PROJECT_NUMBER@gcp-sa-aiplatform.iam.gserviceaccount.com" \
  --role=roles/storage.objectViewer
# The backend writes them and reads their metadata.
gcloud storage buckets add-iam-policy-binding gs://arcnave-model-inputs \
  --member="serviceAccount:$BACKEND_SA" --role=roles/storage.objectUser
```

## 3. Probe before relying on it

Store a page image and ask Gemini about it by URI:

```bash
curl -sL -o /tmp/probe.jpg https://upload.wikimedia.org/wikipedia/commons/3/3a/Cat03.jpg
gcloud storage cp /tmp/probe.jpg gs://arcnave-model-inputs/pages/probe.jpg
# The model the backend uses for Gemini, from its MODEL_GEMINI_FLASH setting.
MODEL=$(gcloud run services describe arcnave-sandbox-service --region=asia-south1 --format=json \
  | python3 -c "import json,sys; print(next(e['value'] for e in json.load(sys.stdin)['spec']['template']['spec']['containers'][0]['env'] if e['name']=='MODEL_GEMINI_FLASH'))")
curl -s -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
  "https://aiplatform.googleapis.com/v1/projects/$PROJECT/locations/global/publishers/google/models/$MODEL:generateContent" \
  -d '{"contents":[{"role":"user","parts":[{"fileData":{"mimeType":"image/jpeg","fileUri":"gs://arcnave-model-inputs/pages/probe.jpg"}},{"text":"What animal is this? One word."}]}]}' \
  | grep -o '"text": "[^"]*"'
```

The answer must name the animal. A permission error names the identity that needs
`storage.objectViewer`. Grant it that role, not the one in step 2.

## 4. Turn it on (a backend change: needs deployment approval)

```bash
gcloud run services update arcnave-sandbox-service --region=asia-south1 \
  --update-env-vars=MODEL_INPUT_BUCKET=arcnave-model-inputs
```

Verify: send a PDF to Gemini in a chat. Objects appear under `gs://arcnave-model-inputs/pages/`,
and the answer reads the pages.

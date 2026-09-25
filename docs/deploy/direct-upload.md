# Direct uploads to the attachments bucket

Chat attachments of up to 500 MB go from the browser straight to the GCS bucket, through a
resumable-upload session that the backend opens
([ADR-0011](../decisions/0011-upload-follows-claude.md)). This is a one-time setup, done before
the deploy that ships the feature.

## 1. Let the site's origin PUT to the bucket

The bucket is `arcnave-attachments`. Add every origin the frontend is served from:

```bash
cat > /tmp/cors.json <<'EOF'
[
  {
    "origin": ["https://arcnave.tech", "https://www.arcnave.tech"],
    "method": ["PUT", "POST", "OPTIONS"],
    "responseHeader": ["Content-Type", "Content-Range", "Range", "x-goog-resumable"],
    "maxAgeSeconds": 3600
  }
]
EOF
gcloud storage buckets update gs://arcnave-attachments --cors-file=/tmp/cors.json
gcloud storage buckets describe gs://arcnave-attachments --format="default(cors_config)"
```

The session URI is the only credential the browser gets. It can write one object, and it
expires after a week. The bucket stays private: CORS decides which pages may send requests,
not who may read.

## 2. Nothing else changes on the backend service

- Opening a resumable session uses the service's own identity, which can already write to the
  bucket. No signing permission is needed.
- `ATTACHMENT_MAX_BYTES` (default 500 MB) and `ATTACHMENT_PROCESS_MAX_BYTES` (default 100 MB)
  can be left at their defaults. Raise the second one only together with the service's
  memory: extracting text holds the file in memory.
- The migration `0009` adds `attachments.page_count`. It runs with the other migrations.

## 3. Verify live

1. Attach a PDF larger than 32 MB. The chip counts up in percent, then shows its page count.
2. Attach a PDF of over 1,000 pages. It is refused with the page count in the message.
3. In DevTools → Network, the PUT goes to `storage.googleapis.com`, not to the API.

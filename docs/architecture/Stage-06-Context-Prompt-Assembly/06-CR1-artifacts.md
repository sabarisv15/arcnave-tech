# ArcNave – Change request CR-1: Artifacts in MVP
_2026-10-01 · User decision: artifacts = MVP, all 4 types · Reopens locked items in Stage 4/5 (listed below) · Detailed design in Stages 8, 9, 16, 18_

> **Doc-sync 2026-10-03 (Stage 14) – see Stage-14-Streaming-Rendering/00-checkpoint-stage14.md:**
> - A4 HTML preview: web iframe sandbox + usercontent origin + CSP (RN10); **Android WebView rules decided (RN11)** – open item closed. Artifact in share snapshot = name + type only (review G-H).

## Scope (user OK)
| Type | What | Built by |
|---|---|---|
| A1 Documents | Doc/report in side panel, editable, download .docx/PDF | Model writes Markdown → server converts |
| A2 File downloads | xlsx / pptx / csv generated | Code sandbox (own, no egress – R9) with python-docx/openpyxl/python-pptx |
| A3 Charts / tables | Data → chart rendered by client from JSON spec (no raw HTML) | Model outputs chart spec; client chart lib |
| A4 HTML / code preview | Mini page/app in sandboxed iframe | Separate user-content origin, strict CSP |

## Impact on locked docs
| Layer/doc | Change | Stage to detail |
|---|---|---|
| L1 client | Side panel, artifact viewer, version switcher, download; A4 in sandboxed iframe (no allow-same-origin) on separate origin | 16 |
| L2 edge | New origin e.g. `usercontent` domain, noindex, no cookies | 16 |
| L3 API | Artifact endpoints (get, versions, download); ownership check R12 | 8 |
| L4 orchestration | New step: artifact create/update via tool call; stream artifact events | 8, 14 |
| L5e tools | `artifact_create` / `artifact_update` tools; file-gen in sandbox | 8, 9 |
| L5g safety | Scan generated HTML/files; no external loads (R9) | 16 |
| L7 data | `artifact` + `artifact_version` tables; files in GCS; data map + deletion cascade (R8) | 5.1 update |
| F6 share | Artifact in share snapshot? (decide) | 5.2 update |
| Prompt | New `<artifacts>` section: when to make an artifact vs answer inline; types; limits | 6 (now) |
| Cost | Sandbox CPU + storage + extra output tokens | 18 |

## Prompt section `<artifacts>` – rules to write (failure each prevents)
| Rule | Failure prevented |
|---|---|
| Inline answer by default; artifact only for content user will keep, edit, download or reuse (doc, file, chart, page) | Over-creating artifacts for simple answers |
| Pick type: report → document; table to compute → xlsx; slides → pptx; numbers trend → chart; interactive → HTML | Wrong format |
| User names a format → use it | Ignoring request |
| Edit request → update the existing artifact (new version), change only what was asked | Rewriting whole thing |
| Never claim a file was created unless the tool returned success | Fake "file ready" |
| HTML: self-contained, no external network/data, no forms collecting passwords/payments | Exfiltration, phishing (R9) |
| After creating: 1–2 lines on what it is; don't paste full content again in chat | Duplicate output |

## Open (to verify via Astra, Stage 8)
- ⚠️ Claude code execution tool availability on Vertex; Gemini code execution file output limits → own sandbox works for both (rec).
- Chart library + spec format; A4 allowed CDNs (or none).

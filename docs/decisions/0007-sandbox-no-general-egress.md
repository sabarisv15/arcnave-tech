# ADR-0007: The execution sandbox has no general outbound internet

- Status: accepted, not yet implemented (Phase 6 of the tools pipeline plan)
- Date: 2026-09-24
- Supersedes: the network-egress sentence in [ADR-0005](0005-cloud-run-sandbox.md), section
  "Runtime image" ("Outbound network egress is **allowed** … accepted as the trade-off against
  a fully air-gapped sandbox"). The rest of ADR-0005 stands.

## Context

ADR-0005 left the Cloud Run sandbox on default networking so that code could reach package
indexes or external APIs at runtime. The locked ArcNave architecture separates the two concerns:

```
Web access         → controlled web/search tools (web_search, web_fetch)
Execution sandbox  → restricted network
```

The sandbox runs model-written code on user files. Open egress lets that code send file contents
anywhere, and lets a runtime `pip install` or HTTP download change what the sandbox is. That
breaks the "deterministic, trusted capabilities" the runtime promises. Everything the runtime
is meant to run (Python with the baked-in data packages, LibreOffice, poppler, pandoc, skill
scripts) works offline.

## Decision

1. The sandbox has **no general outbound internet**. No runtime `pip install`, no arbitrary
   HTTP.
2. Packages come only from the image, installed at build time (`backend/sandbox/Dockerfile`).
   A new package means a new image.
3. Web access for the model stays with the controlled web tools, which run in the backend with
   their own policy.
4. The only egress the job keeps is what its own plumbing needs: the staging bucket
   (signed-URL input and output) and Cloud Logging. Those go through Private Google Access,
   not the public internet.
5. Any capability that needs a network call, such as a vision-model call during table extraction,
   runs in a trusted backend handler and never inside the sandbox.

## Consequences

- Implementation is an infrastructure change (VPC connector plus a deny-all egress firewall, with
  Private Google Access for the staging bucket and logging), so it needs deployment approval.
  It is verified live by a probe that an outbound HTTP call from the job fails while staging
  still works.
- Until then the running sandbox still has open egress. This ADR records the decision; the
  gap stays open as G21 in `docs/tools-skills-architecture.md` until the probe passes.
- Code that assumed runtime installs must use the baked-in set. Nothing in the repo does this
  today.
- Phase 3's table extraction is split accordingly: the sandbox renders pages and does the
  deterministic post-processing; the backend makes the vision call.

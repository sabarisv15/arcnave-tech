# Question for Google: Vertex AI Agent Engine Code Execution — which `executeCode` is real?

I'm trying to call the Preview "Code Execution" sandbox on Vertex AI Agent Engine from raw REST
(Node.js/TypeScript, no SDK available for this language — `googleapis/js-genai#2185` is still
open). Your own documentation gives me two different, incompatible answers for how to actually
run code, and neither works as documented. I need to know which one is real, or what I'm missing.

## Setup

- Project: `project-8bcf740a-a7bd-4aea-974`, region `us-central1` (the only region this feature
  supports, per your troubleshooting docs)
- Auth: Application Default Credentials, `https://www.googleapis.com/auth/cloud-platform` scope
- I successfully create a reasoning engine:
  `POST https://us-central1-aiplatform.googleapis.com/v1/projects/{project}/locations/us-central1/reasoningEngines`
  with body `{"displayName": "arcnave-run-python"}` — this returns a real resource name via a
  long-running operation, every time.

## Attempt 1 — your REST reference page

`projects.locations.reasoningEngines.sandboxEnvironments` (REST reference) documents `create`,
`list`, `resume`, `delete`, and `bidiExecute` (streaming) — no plain `execute`. So I created a
sandbox (`POST {reasoningEngineName}/sandboxEnvironments` with
`{"spec": {"codeExecutionEnvironment": {"codeLanguage": "LANGUAGE_PYTHON"}}}`, which succeeds),
then tried:

```
POST https://us-central1-aiplatform.googleapis.com/v1/{reasoningEngineName}/sandboxEnvironments/{sandboxId}:execute
```

**Result:** `400 INVALID_ARGUMENT: "Request contains an invalid argument."` — no field detail.

## Attempt 2 — a different REST reference page

`projects.locations.reasoningEngines.executeCode` (a separate, stable non-beta reference page)
documents a stateless `executeCode` method called directly on the reasoning engine (no separate
sandbox resource at all), with body `{"inputs": [{"mimeType": "text/x-python", "data": "<base64>"}]}`
(a `Chunk` object). I tried:

```
POST https://us-central1-aiplatform.googleapis.com/v1/{reasoningEngineName}:executeCode
Body: {"inputs": [{"mimeType": "text/x-python", "data": "cHJpbnQoMSsxKQ=="}]}
```

**Result:** `400 INVALID_ARGUMENT: "Request contains an invalid argument."` — again no field
detail. I also tried adding `"spec": {"codeExecutionEnvironment": {...}}` to the *reasoning
engine's own creation body* (guessing the capability belongs there) — that got a more specific
rejection, `Unknown name "codeExecutionEnvironment" at 'reasoning_engine.spec'`, so that guess is
confirmed wrong.

## Attempt 3 — your own quickstart notebook / Python SDK

`GoogleCloudPlatform/generative-ai/.../tutorial_get_started_with_code_execution.ipynb` and the
`vertexai` Python SDK show a *third* shape, targeting the **sandbox**, not the reasoning engine:

```python
response = client.agent_engines.sandboxes.execute_code(
    name=sandbox_name,
    input_data={"code": python_code},
)
```

Translating this literally to REST (sandbox resource, `executeCode` suffix, `inputData.code`
body):

```
POST https://us-central1-aiplatform.googleapis.com/v1/{reasoningEngineName}/sandboxEnvironments/{sandboxId}:executeCode
Body: {"inputData": {"code": "print(1+1)"}}
```

**Result:** `404`, empty body — a different failure mode from the first two (looks like the URL
itself doesn't route to anything, not a body-validation failure).

## The actual question

Your REST reference (`reasoningEngines.executeCode`) and your own product quickstart
(`sandboxes.execute_code`) **disagree about which resource `executeCode` is called on** —
the reasoning engine, or the sandbox — and neither shape I derived from either source actually
works. Which is correct?

- Is `executeCode` only valid on a reasoning engine that has a real deployed agent
  (`packageSpec`/`deploymentSpec`/`agentFramework`), and does it reject a bare reasoning engine
  created with just `displayName`?
- Does the Python SDK's `sandboxes.execute_code()` actually call a REST method/path different
  from what a literal reading of its name suggests (e.g. does it call `reasoningEngines
  .executeCode` under the hood, passing the sandbox id some other way)?
- Is there a working `curl` example anywhere for this specific Preview API that I can diff
  against my requests field-by-field?

Happy to share full request/response logs (redacting the project id) if that helps.

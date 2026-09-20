---
name: python-sandbox-patterns
version: 1.0.0
description: Safe bounded computation, memory-aware transforms, stdout and stderr handling, and sandbox timeout awareness.
category: internal
requires:
  tools:
    - run_python
autoload: true
metadata:
  source: arcnave
---

# Python Sandbox Patterns & Execution Constraints

Internal skill automatically applied when preparing or executing Python code in ArcNave's sandbox.

## Sandbox Environment & Hard Limits

- **Execution Model**: Stateless ephemeral container. No state or files persist between independent `run_python` calls.
- **Output Ceilings**: Stdout and Stderr are truncated at configured byte limits. Keep print statements targeted and concise; avoid dumping entire raw DataFrames or massive lists.
- **Timeouts**: Execution is bounded by strict orchestration deadlines. Avoid unbounded loops or complex algorithmic bottlenecks.
- **Resource Constraints**: Avoid excessive memory allocation. Use chunked processing or iterators when processing large numeric sequences.

## Robust Execution Patterns

- Always wrap critical calculations with clean error handling.
- Print final summaries or JSON formatted outputs cleanly at the end of the script:
  ```python
  import json
  result = {"status": "success", "data": calculated_values}
  print(json.dumps(result))
  ```
- Do not attempt network socket calls or arbitrary host filesystem accesses outside the isolated container boundary.

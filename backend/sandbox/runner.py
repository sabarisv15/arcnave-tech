#!/usr/bin/env python3
"""Sandbox entrypoint. Decodes RUN_PYTHON_CODE_B64, runs it as a subprocess in its own process
group with a hard wall-clock timeout, captures stdout/stderr with a streaming byte cap (never
buffer-then-slice, which would let unbounded output OOM the container before any cap applied),
and emits exactly one ARCNAVE_SANDBOX_RESULT: line — the child's own stdout/stderr never reach
this process's stdout directly, so submitted code can never spoof the result line. See
docs/decisions/0005-cloud-run-sandbox.md.

Batch 2.2 Hardening:
- Separate runner authority from user code.
- Strict subprocess environment sanitization: user Python inherits zero GCP transfer credentials,
  zero signed URLs, zero internal orchestration values.
- Support for per-object signed URLs (inputs and outputs) and/or scoped transfer authority.
- Binary file bytes are NEVER emitted into stdout or Cloud Logging.
"""
import base64
import json
import mimetypes
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request

RESULT_PREFIX = "ARCNAVE_SANDBOX_RESULT:"


def _get_gcp_access_token() -> str:
    """Fetches the instance service account access token from the GCP metadata server."""
    req = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        return data["access_token"]


def _download_url(url: str, dest_path: str) -> None:
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=60) as resp:
        with open(dest_path, "wb") as f:
            while chunk := resp.read(65536):
                f.write(chunk)


def _upload_url(url: str, src_path: str, mime_type: str) -> None:
    with open(src_path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(
        url,
        data=data,
        method="PUT",
        headers={
            "Content-Type": mime_type,
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        resp.read()


def _download_staging_file(bucket: str, staging_ref: str, dest_path: str, token: str) -> None:
    encoded_ref = urllib.parse.quote(staging_ref, safe="")
    url = f"https://storage.googleapis.com/storage/v1/b/{bucket}/o/{encoded_ref}?alt=media"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        with open(dest_path, "wb") as f:
            while chunk := resp.read(65536):
                f.write(chunk)


def _upload_staging_file(bucket: str, staging_ref: str, src_path: str, mime_type: str, token: str) -> None:
    encoded_ref = urllib.parse.quote(staging_ref, safe="")
    url = f"https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=media&name={encoded_ref}"
    with open(src_path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": mime_type,
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        resp.read()


def _read_capped(pipe, cap_bytes: int, out: dict) -> None:
    """Reads `pipe` to EOF, keeping only the first `cap_bytes` bytes and setting
    out['truncated'] once the cap is hit. Keeps draining past the cap — stopping early would
    leave the child blocked on a full OS pipe buffer instead of letting it exit or be killed."""
    buf = bytearray()
    truncated = False
    while True:
        chunk = pipe.read(4096)
        if not chunk:
            break
        if not truncated:
            remaining = cap_bytes - len(buf)
            if remaining > 0:
                buf.extend(chunk[:remaining])
            if len(buf) >= cap_bytes:
                truncated = True
    out["data"] = bytes(buf)
    out["truncated"] = truncated


def main() -> None:
    code_b64 = os.environ["RUN_PYTHON_CODE_B64"]
    code_timeout_ms = int(os.environ["RUN_PYTHON_CODE_TIMEOUT_MS"])
    execution_id = os.environ["RUN_PYTHON_EXECUTION_ID"]
    max_stdout = int(os.environ.get("MAX_STDOUT_BYTES", "65536"))
    max_stderr = int(os.environ.get("MAX_STDERR_BYTES", "65536"))

    stage_bucket = os.environ.get("RUN_PYTHON_STAGE_BUCKET")
    run_id = os.environ.get("RUN_PYTHON_RUN_ID", "")
    inputs_json_raw = os.environ.get("RUN_PYTHON_INPUTS_JSON")
    output_urls_raw = os.environ.get("RUN_PYTHON_OUTPUT_URLS_JSON")

    # Materialize local workspace directories in container
    input_dir = "/home/sandbox/input"
    output_dir = "/home/sandbox/output"
    os.makedirs(input_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    output_urls: dict = {}
    if output_urls_raw:
        try:
            output_urls = json.loads(output_urls_raw)
        except Exception:
            pass

    token: str | None = None
    if stage_bucket and not output_urls:
        try:
            token = _get_gcp_access_token()
        except Exception as e:
            sys.stderr.write(f"Notice: Instance metadata token not used or unavailable: {e}\n")

    # 1. Download staged input files using per-object transfer authority
    if inputs_json_raw:
        try:
            inputs_list = json.loads(inputs_json_raw)
            for inp in inputs_list:
                fname = inp.get("name", "")
                safe_name = os.path.basename(fname).replace("/", "").replace("\\", "")
                dest_file = os.path.join(input_dir, safe_name)

                # Option A: Signed URL (preferred, zero container credentials)
                if inp.get("url"):
                    _download_url(inp["url"], dest_file)
                # Option B: GCS staging ref with token
                elif inp.get("stagingRef") and stage_bucket and token:
                    staging_ref = inp["stagingRef"]
                    expected_prefix = f"runs/{run_id}/input/"
                    if not staging_ref.startswith(expected_prefix):
                        sys.stderr.write(f"Security Warning: Rejected input ref outside run namespace: {staging_ref}\n")
                        continue
                    _download_staging_file(stage_bucket, staging_ref, dest_file, token)
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to download staged input files: {e}\n")
    elif os.environ.get("RUN_PYTHON_INPUT_FILES_JSON"):
        # Legacy fallback if staging bucket is not configured
        try:
            files_map = json.loads(os.environ["RUN_PYTHON_INPUT_FILES_JSON"])
            for fname, b64content in files_map.items():
                safe_name = os.path.basename(fname)
                with open(os.path.join(input_dir, safe_name), "wb") as infile:
                    infile.write(base64.b64decode(b64content))
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to materialize legacy input files: {e}\n")

    # 2. Decode user code to execute
    code = base64.b64decode(code_b64).decode("utf-8")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(code)
        script_path = f.name

    # 3. ENVIRONMENT SANITIZATION (Batch 2.2 Sections 4 & 5)
    # The child Python process MUST NOT inherit runner credentials, signed URLs,
    # bucket names, or internal orchestration settings.
    clean_env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": "/home/sandbox",
        "USER": "sandbox",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PYTHONUNBUFFERED": "1",
        "TMPDIR": "/tmp",
    }

    start = time.monotonic()
    proc = subprocess.Popen(
        [sys.executable, script_path],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,  # own process group, so a timeout can kill descendants too
        cwd="/home/sandbox",
        env=clean_env,  # STRICTLY SANITIZED MINIMAL ENVIRONMENT
    )

    stdout_out: dict = {}
    stderr_out: dict = {}
    stdout_thread = threading.Thread(target=_read_capped, args=(proc.stdout, max_stdout, stdout_out))
    stderr_thread = threading.Thread(target=_read_capped, args=(proc.stderr, max_stderr, stderr_out))
    stdout_thread.start()
    stderr_thread.start()

    timed_out = False
    try:
        exit_code = proc.wait(timeout=code_timeout_ms / 1000)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        exit_code = proc.wait()

    stdout_thread.join()
    stderr_thread.join()
    os.unlink(script_path)

    # 4. Output Collection by Runner (Parent process authority only)
    outputs_metadata = []
    undeclared_outputs = []

    if os.path.exists(output_dir):
        for fname in sorted(os.listdir(output_dir)):
            fpath = os.path.join(output_dir, fname)
            if not os.path.isfile(fpath):
                continue
            safe_name = os.path.basename(fname).replace("/", "").replace("\\", "")
            fsize = os.path.getsize(fpath)
            mime, _ = mimetypes.guess_type(fname)
            if not mime:
                mime = "application/octet-stream"

            # Check if signed PUT URL was provided for this output file
            if safe_name in output_urls:
                try:
                    _upload_url(output_urls[safe_name], fpath, mime)
                    outputs_metadata.append({
                        "name": safe_name,
                        "size": fsize,
                        "mimeType": mime,
                        "temporaryRef": f"runs/{run_id}/output/{safe_name}",
                    })
                except Exception as e:
                    sys.stderr.write(f"Warning: Failed to upload output via signed URL {fname}: {e}\n")
            else:
                # Batch 2.4: Do NOT base64 it. Do NOT log binary. Do NOT silently upload it.
                undeclared_outputs.append(safe_name)

    result = {
        "type": "arcnave.run_python.result.v1",
        "executionId": execution_id,
        "ok": exit_code == 0 and not timed_out,
        "exitCode": exit_code,
        "stdout": stdout_out["data"].decode("utf-8", errors="replace"),
        "stderr": stderr_out["data"].decode("utf-8", errors="replace"),
        "stdoutTruncated": stdout_out["truncated"],
        "stderrTruncated": stderr_out["truncated"],
        "timedOut": timed_out,
        "durationMs": int((time.monotonic() - start) * 1000),
    }

    if outputs_metadata:
        result["outputs"] = outputs_metadata
    if undeclared_outputs:
        result["undeclaredOutputs"] = undeclared_outputs

    print(RESULT_PREFIX + json.dumps(result), flush=True)


if __name__ == "__main__":
    main()

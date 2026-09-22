#!/usr/bin/env python3
"""Sandbox entrypoint. Decodes RUN_PYTHON_CODE_B64, runs it as a subprocess in its own process
group with a hard wall-clock timeout, captures stdout/stderr with a streaming byte cap (never
buffer-then-slice, which would let unbounded output OOM the container before any cap applied),
and emits exactly one ARCNAVE_SANDBOX_RESULT: line — the child's own stdout/stderr never reach
this process's stdout directly, so submitted code can never spoof the result line. See
docs/decisions/0005-cloud-run-sandbox.md."""
import base64
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time

RESULT_PREFIX = "ARCNAVE_SANDBOX_RESULT:"


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

    # Materialize input directory
    input_dir = "/home/sandbox/input"
    output_dir = "/home/sandbox/output"
    os.makedirs(input_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    input_files_raw = os.environ.get("RUN_PYTHON_INPUT_FILES_JSON")
    if input_files_raw:
        try:
            files_map = json.loads(input_files_raw)
            for fname, b64content in files_map.items():
                safe_name = os.path.basename(fname)
                with open(os.path.join(input_dir, safe_name), "wb") as infile:
                    infile.write(base64.b64decode(b64content))
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to materialize input files: {e}\n")

    code = base64.b64decode(code_b64).decode("utf-8")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(code)
        script_path = f.name

    start = time.monotonic()
    proc = subprocess.Popen(
        [sys.executable, script_path],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,  # own process group, so a timeout can kill descendants too
        cwd="/home/sandbox",
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

    # Collect output files
    output_files = {}
    if os.path.exists(output_dir):
        for fname in os.listdir(output_dir):
            fpath = os.path.join(output_dir, fname)
            if os.path.isfile(fpath) and os.path.getsize(fpath) <= 10 * 1024 * 1024:
                try:
                    with open(fpath, "rb") as outf:
                        output_files[fname] = base64.b64encode(outf.read()).decode("ascii")
                except Exception:
                    pass

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
        "outputFiles": output_files,
    }
    print(RESULT_PREFIX + json.dumps(result), flush=True)


if __name__ == "__main__":
    main()

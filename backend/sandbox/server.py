#!/usr/bin/env python3
"""Warm run_python sandbox: a long-lived Cloud Run service with one workspace per chat.

ADR-0010. The single-use Job (runner.py) paid a 20-40 s cold start per call and forgot every
file between calls, so a model working on a PDF spent its rounds re-probing an empty machine.
This server stays up, keeps each chat's files, and answers in about the time the code takes.

Isolation between chats is the Unix kind, enforced by the kernel rather than by this process:

- The server runs as root and never runs submitted code as root. Each workspace gets its own
  uid from a pool; its directory is mode 0700 and owned by that uid, so one chat's code cannot
  read another chat's files or /proc entries.
- Code runs in a new session with a clean environment (no server variables, no credentials),
  under resource limits, and every process left behind by that uid is killed after the run.
- The container itself carries no project IAM and is reachable only through Cloud Run IAM from
  the backend's service account.

Endpoints (all JSON unless noted; `ws` is 32 lowercase hex characters chosen by the backend):

  GET    /healthz
  PUT    /v1/workspaces/<ws>/input/<name>?offset=N&total=T&sha256=H   raw bytes, in chunks
  POST   /v1/workspaces/<ws>/run      {code, timeoutMs, inputs:[{name, sha256}]}
                                       409 {missing:[name]} when an input is absent or stale
  GET    /v1/workspaces/<ws>/{output,view}/<name>?offset=N&length=L   raw bytes
  DELETE /v1/workspaces/<ws>

Transfers are chunked because Cloud Run caps an HTTP/1 request at 32 MiB; no file size limit
is implied by the transport.
"""
import ctypes
import hashlib
import json
import mimetypes
import os
import re
import resource
import shutil
import signal
import stat
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

WORK_ROOT = os.environ.get("WORK_ROOT", "/work")
UID_BASE = int(os.environ.get("SANDBOX_UID_BASE", "20000"))
MAX_WORKSPACES = int(os.environ.get("MAX_WORKSPACES", "64"))
WORKSPACE_TTL_S = int(os.environ.get("WORKSPACE_TTL_S", str(3 * 3600)))
MAX_WORKSPACE_BYTES = int(os.environ.get("MAX_WORKSPACE_BYTES", str(2 * 1024**3)))
MAX_CHUNK_BYTES = 16 * 1024 * 1024
MAX_CODE_BYTES = 1024 * 1024
MAX_TIMEOUT_MS = int(os.environ.get("MAX_CODE_TIMEOUT_MS", str(15 * 60_000)))
MAX_STDOUT_BYTES = int(os.environ.get("MAX_STDOUT_BYTES", "262144"))
MAX_STDERR_BYTES = int(os.environ.get("MAX_STDERR_BYTES", "65536"))
MAX_OUTPUT_FILES = 50
PYTHON = os.environ.get("SANDBOX_PYTHON", sys.executable)
# Local development only: every workspace shares the server's own uid. Refused as root.
SINGLE_UID = os.environ.get("SANDBOX_SINGLE_UID") == "1"

WS_RE = re.compile(r"^[a-f0-9]{32}$")
NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,200}$")
SHA_RE = re.compile(r"^[a-f0-9]{64}$")


class Workspace:
    def __init__(self, ws_id: str, uid: int):
        self.id = ws_id
        self.uid = uid
        self.path = os.path.join(WORK_ROOT, ws_id)
        self.lock = threading.Lock()
        self.last_used = time.time()
        # name -> sha256 of the complete input file, as verified on upload.
        self.inputs: dict = {}
        self.busy = False


class Registry:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.by_id: dict = {}

    def get(self, ws_id: str, create: bool) -> "Workspace | None":
        with self.lock:
            self._expire()
            ws = self.by_id.get(ws_id)
            if ws or not create:
                if ws:
                    ws.last_used = time.time()
                return ws
            if len(self.by_id) >= MAX_WORKSPACES:
                idle = [w for w in self.by_id.values() if not w.busy]
                if not idle:
                    return None
                self._drop(min(idle, key=lambda w: w.last_used))
            used = {w.uid for w in self.by_id.values()}
            uid = os.getuid() if SINGLE_UID else next(UID_BASE + i for i in range(MAX_WORKSPACES) if UID_BASE + i not in used)
            ws = Workspace(ws_id, uid)
            _make_workspace(ws)
            self.by_id[ws_id] = ws
            return ws

    def delete(self, ws_id: str) -> None:
        with self.lock:
            ws = self.by_id.get(ws_id)
            if ws and not ws.busy:
                self._drop(ws)

    def _expire(self) -> None:
        now = time.time()
        for ws in [w for w in self.by_id.values() if not w.busy and now - w.last_used > WORKSPACE_TTL_S]:
            self._drop(ws)

    def _drop(self, ws: Workspace) -> None:
        self.by_id.pop(ws.id, None)
        if not SINGLE_UID:
            _kill_uid(ws.uid)
        shutil.rmtree(ws.path, ignore_errors=True)


def _make_workspace(ws: Workspace) -> None:
    shutil.rmtree(ws.path, ignore_errors=True)
    for sub in ("", "input", "output", "view", ".tmp"):
        os.makedirs(os.path.join(ws.path, sub), exist_ok=True)
        if not SINGLE_UID:
            os.chown(os.path.join(ws.path, sub), ws.uid, ws.uid)
    os.chmod(ws.path, 0o700)


def _kill_uid(uid: int) -> None:
    """Kills every process owned by `uid`: code that forked, daemonised, or left a new session
    behind must not outlive its run or keep reading the workspace. The server is the child
    subreaper (main), so those orphans are its children and are reaped here by pid; reaping by
    pid, never waitpid(-1), leaves other workspaces' runs to their own Popen.wait."""
    for _ in range(20):
        found = False
        for pid in os.listdir("/proc"):
            if not pid.isdigit():
                continue
            try:
                if os.stat(f"/proc/{pid}").st_uid != uid:
                    continue
                found = True
                os.kill(int(pid), signal.SIGKILL)
                os.waitpid(int(pid), os.WNOHANG)
            except (FileNotFoundError, ProcessLookupError, PermissionError, ChildProcessError):
                pass
        if not found:
            return
        time.sleep(0.05)


def _subdir(ws: Workspace, sub: str) -> int:
    """A descriptor for input/ or output/ that refuses to follow a symlink. Submitted code owns
    these directories and could swap one for a link to somewhere only root can reach; every
    root-side file operation goes through this descriptor, never through a joined path."""
    path = os.path.join(ws.path, sub)
    if not os.path.lexists(path):
        os.mkdir(path)
        if not SINGLE_UID:
            os.chown(path, ws.uid, ws.uid)
    return os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)


def _is_plain_file(name: str, dir_fd: int) -> bool:
    try:
        return stat.S_ISREG(os.stat(name, dir_fd=dir_fd, follow_symlinks=False).st_mode)
    except FileNotFoundError:
        return False


def _dir_bytes(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.lstat(os.path.join(root, f)).st_size
            except FileNotFoundError:
                pass
    return total


def _sha256_file(name: str, dir_fd: int) -> str:
    h = hashlib.sha256()
    with os.fdopen(os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dir_fd), "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def _read_capped(pipe, cap: int, out: dict) -> None:
    buf = bytearray()
    truncated = False
    while chunk := pipe.read(65536):
        if len(buf) < cap:
            buf.extend(chunk[: cap - len(buf)])
        if len(buf) >= cap:
            truncated = True
    out["data"] = bytes(buf)
    out["truncated"] = truncated


def _snapshot(dir_fd: int) -> dict:
    snap = {}
    with os.scandir(dir_fd) as it:
        for entry in it:
            if NAME_RE.match(entry.name) and entry.is_file(follow_symlinks=False):
                st = entry.stat(follow_symlinks=False)
                snap[entry.name] = (st.st_mtime_ns, st.st_size)
    return snap


RETURNED_DIRS = ("output", "view")  # output/: files for the user; view/: images for the model


def _run(ws: Workspace, code: str, timeout_ms: int) -> dict:
    before = {}
    for sub in RETURNED_DIRS:
        fd = _subdir(ws, sub)
        try:
            before[sub] = _snapshot(fd)
        finally:
            os.close(fd)
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": ws.path,
        "TMPDIR": os.path.join(ws.path, ".tmp"),
        "LANG": "C.UTF-8",
        "MPLBACKEND": "Agg",
        "PYTHONUNBUFFERED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
    }

    def demote() -> None:
        os.setsid()
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_WORKSPACE_BYTES, MAX_WORKSPACE_BYTES))
        if not SINGLE_UID:
            resource.setrlimit(resource.RLIMIT_NPROC, (256, 256))
            os.setgroups([])
            os.setgid(ws.uid)
            os.setuid(ws.uid)

    started = time.time()
    proc = subprocess.Popen(
        [PYTHON, "-"],
        cwd=ws.path,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        preexec_fn=demote,
        close_fds=True,
    )
    out: dict = {}
    err: dict = {}
    t_out = threading.Thread(target=_read_capped, args=(proc.stdout, MAX_STDOUT_BYTES, out))
    t_err = threading.Thread(target=_read_capped, args=(proc.stderr, MAX_STDERR_BYTES, err))
    t_out.start()
    t_err.start()
    try:
        proc.stdin.write(code.encode("utf-8"))
        proc.stdin.close()
    except BrokenPipeError:
        pass
    timed_out = False
    try:
        proc.wait(timeout=timeout_ms / 1000)
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()
    if not SINGLE_UID:
        _kill_uid(ws.uid)
    t_out.join(5)
    t_err.join(5)

    # The code may have replaced a directory with a link; _subdir refuses it rather than follow.
    outputs = []
    omitted = 0
    for sub in RETURNED_DIRS:
        try:
            fd = _subdir(ws, sub)
        except OSError:
            continue
        try:
            after = _snapshot(fd)
            changed = sorted(n for n, meta in after.items() if before[sub].get(n) != meta)
            omitted += max(0, len(changed) - MAX_OUTPUT_FILES)
            for name in changed[:MAX_OUTPUT_FILES]:
                outputs.append({
                    "dir": sub,
                    "name": name,
                    "sizeBytes": after[name][1],
                    "sha256": _sha256_file(name, fd),
                    "mimeType": mimetypes.guess_type(name)[0] or "application/octet-stream",
                })
        finally:
            os.close(fd)
    stderr = err.get("data", b"").decode("utf-8", "replace")
    if timed_out:
        stderr += f"\nTimed out after {timeout_ms} ms; the process was killed."
    return {
        "msg_out": out.get("data", b"").decode("utf-8", "replace"),
        "msg_err": stderr,
        "exit_code": proc.returncode,
        "timed_out": timed_out,
        "truncated": bool(out.get("truncated") or err.get("truncated")),
        "duration_ms": int((time.time() - started) * 1000),
        "outputs": outputs,
        "outputs_omitted": omitted,
    }


REGISTRY = Registry()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "arcnave-sandbox"

    def handle_one_request(self) -> None:
        # A failure in one request is that request's 500, never a dropped connection with no
        # answer, which the client could only report as a network error.
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception as e:  # noqa: BLE001
            self.close_connection = True
            try:
                self._error(500, "internal_error", type(e).__name__)
            except Exception:  # noqa: BLE001
                pass

    def log_message(self, fmt: str, *args) -> None:  # one JSON line per request, no bodies
        sys.stderr.write(json.dumps({"msg": fmt % args}) + "\n")

    def _send(self, status: int, body, content_type: str = "application/json") -> None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _error(self, status: int, code: str, detail: str) -> None:
        self._send(status, {"error": code, "detail": detail})

    def _body(self, limit: int) -> "bytes | None":
        length = int(self.headers.get("Content-Length") or 0)
        if length > limit:
            self._error(413, "too_large", f"Body is {length} bytes; the limit is {limit}.")
            return None
        return self.rfile.read(length)

    def _route(self):
        url = urlparse(self.path)
        parts = url.path.strip("/").split("/")
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        return parts, query

    def _workspace(self, parts, create: bool):
        if len(parts) < 3 or parts[0] != "v1" or parts[1] != "workspaces" or not WS_RE.match(parts[2]):
            self._error(404, "not_found", "Unknown path.")
            return None
        ws = REGISTRY.get(parts[2], create)
        if ws is None:
            if create:
                self._error(503, "busy", "Every workspace slot is running code. Retry shortly.")
            else:
                self._error(404, "no_workspace", "This workspace does not exist.")
        return ws

    def do_GET(self) -> None:
        parts, query = self._route()
        if parts == ["healthz"]:
            return self._send(200, {"ok": True})
        if len(parts) == 5 and parts[3] in RETURNED_DIRS and NAME_RE.match(parts[4]):
            ws = self._workspace(parts, create=False)
            if not ws:
                return
            offset = int(query.get("offset", "0"))
            length = min(int(query.get("length", str(MAX_CHUNK_BYTES))), MAX_CHUNK_BYTES)
            with ws.lock:
                try:
                    fd = _subdir(ws, parts[3])
                except OSError:
                    return self._error(404, "no_output", "No such output file.")
                try:
                    if not _is_plain_file(parts[4], fd):
                        return self._error(404, "no_output", "No such output file.")
                    with os.fdopen(os.open(parts[4], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd), "rb") as f:
                        f.seek(offset)
                        data = f.read(length)
                finally:
                    os.close(fd)
            return self._send(200, data, "application/octet-stream")
        self._error(404, "not_found", "Unknown path.")

    def do_PUT(self) -> None:
        parts, query = self._route()
        if not (len(parts) == 5 and parts[3] == "input" and NAME_RE.match(parts[4])):
            return self._error(404, "not_found", "Unknown path.")
        sha = query.get("sha256", "")
        try:
            offset, total = int(query.get("offset", "0")), int(query["total"])
        except (KeyError, ValueError):
            return self._error(400, "bad_request", "offset and total are required integers.")
        if not SHA_RE.match(sha) or total > MAX_WORKSPACE_BYTES or offset < 0:
            return self._error(400, "bad_request", "A sha256 and a total within the workspace limit are required.")
        ws = self._workspace(parts, create=True)
        if not ws:
            return
        chunk = self._body(MAX_CHUNK_BYTES)
        if chunk is None:
            return
        name = parts[4]
        part = name + ".part"
        with ws.lock:
            ws.last_used = time.time()
            try:
                fd = _subdir(ws, "input")
            except OSError:
                return self._error(409, "workspace_tampered", "input/ is not a plain directory.")
            try:
                if os.path.lexists(os.path.join(ws.path, "input", part)) and not _is_plain_file(part, fd):
                    os.unlink(part, dir_fd=fd)  # removes a planted link itself, never its target
                size = os.stat(part, dir_fd=fd, follow_symlinks=False).st_size if _is_plain_file(part, fd) else 0
                if offset == 0:
                    size = 0
                if offset != size:
                    return self._send(409, {"error": "offset_mismatch", "expectedOffset": size})
                if _dir_bytes(ws.path) + len(chunk) > MAX_WORKSPACE_BYTES:
                    return self._error(413, "workspace_full", "This chat's sandbox workspace is full.")
                flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | (os.O_TRUNC if offset == 0 else os.O_APPEND)
                with os.fdopen(os.open(part, flags, 0o600, dir_fd=fd), "wb") as f:
                    f.write(chunk)
                size += len(chunk)
                if size < total:
                    return self._send(200, {"received": size})
                if size > total or _sha256_file(part, fd) != sha:
                    os.unlink(part, dir_fd=fd)
                    return self._error(422, "checksum_mismatch", "The uploaded bytes do not match sha256.")
                os.replace(part, name, src_dir_fd=fd, dst_dir_fd=fd)
                if not SINGLE_UID:
                    os.chown(name, ws.uid, ws.uid, dir_fd=fd, follow_symlinks=False)
                ws.inputs[name] = sha
                return self._send(200, {"received": size, "complete": True})
            finally:
                os.close(fd)

    def do_POST(self) -> None:
        parts, _query = self._route()
        if not (len(parts) == 4 and parts[3] == "run"):
            return self._error(404, "not_found", "Unknown path.")
        raw = self._body(MAX_CODE_BYTES + 64 * 1024)
        if raw is None:
            return
        try:
            req = json.loads(raw)
            code = req["code"]
            timeout_ms = min(int(req.get("timeoutMs", 60_000)), MAX_TIMEOUT_MS)
            inputs = req.get("inputs", [])
            assert isinstance(code, str) and isinstance(inputs, list)
        except Exception:
            return self._error(400, "bad_request", "Expected {code, timeoutMs, inputs}.")
        ws = self._workspace(parts, create=True)
        if not ws:
            return
        with ws.lock:
            try:
                fd = _subdir(ws, "input")
            except OSError:
                return self._error(409, "workspace_tampered", "input/ is not a plain directory.")
            try:
                # An input the code deleted or replaced since upload is sent again, so every run
                # sees exactly the bytes the backend holds.
                missing = [
                    i.get("name") for i in inputs
                    if not NAME_RE.match(str(i.get("name", "")))
                    or ws.inputs.get(i["name"]) != i.get("sha256")
                    or not _is_plain_file(i["name"], fd)
                    or _sha256_file(i["name"], fd) != i.get("sha256")
                ]
            finally:
                os.close(fd)
            if missing:
                return self._send(409, {"error": "missing_inputs", "missing": missing})
            ws.busy = True
            try:
                result = _run(ws, code, timeout_ms)
            finally:
                ws.busy = False
                ws.last_used = time.time()
        self._send(200, result)

    def do_DELETE(self) -> None:
        parts, _query = self._route()
        if len(parts) == 3 and parts[0] == "v1" and parts[1] == "workspaces" and WS_RE.match(parts[2]):
            REGISTRY.delete(parts[2])
            return self._send(200, {"deleted": True})
        self._error(404, "not_found", "Unknown path.")


def main() -> None:
    if SINGLE_UID and os.geteuid() == 0:
        sys.exit("SANDBOX_SINGLE_UID=1 would run submitted code as root; refusing to start.")
    if not SINGLE_UID and os.geteuid() != 0:
        sys.exit("The sandbox server needs root to give each workspace its own uid; refusing to start.")
    os.makedirs(WORK_ROOT, exist_ok=True)
    os.chmod(WORK_ROOT, 0o711)
    # Orphans of submitted code re-parent to this process instead of PID 1, so _kill_uid can
    # reap them; otherwise each run could leave zombies behind for the life of the instance.
    PR_SET_CHILD_SUBREAPER = 36
    if ctypes.CDLL(None, use_errno=True).prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        sys.exit("prctl(PR_SET_CHILD_SUBREAPER) failed; refusing to start.")
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.daemon_threads = True
    sys.stderr.write(json.dumps({"msg": f"sandbox server listening on {port}"}) + "\n")
    server.serve_forever()


if __name__ == "__main__":
    main()

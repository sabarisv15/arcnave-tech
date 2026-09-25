"""Tests for the warm sandbox server (ADR-0010). Run as root, as the server runs in production:

    sudo python3 -m unittest backend/sandbox/test/test_server.py

Each test talks HTTP to a real server process, so the uid separation, symlink refusal and
process cleanup below are the kernel's behaviour, not a mock's.
"""
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

SERVER = os.path.join(os.path.dirname(__file__), "..", "server.py")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@unittest.skipUnless(os.geteuid() == 0, "the server gives each workspace its own uid, which needs root")
class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.root = tempfile.mkdtemp()
        os.chmod(cls.root, 0o755)
        cls.port = _free_port()
        env = {
            **os.environ,
            "PORT": str(cls.port),
            "WORK_ROOT": os.path.join(cls.root, "work"),
            "SECRET_TOKEN": "server-only",
            # Small, so the memory tests are quick; one slot, so the queueing test can see a wait.
            "RUN_MEMORY_BYTES": str(400 * 1024**2),
            "MAX_CONCURRENT_RUNS": "1",
        }
        cls.proc = subprocess.Popen([sys.executable, SERVER], env=env, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/healthz", timeout=1)
                return
            except Exception:
                time.sleep(0.05)
        raise RuntimeError("server did not start")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.proc.kill()
        cls.proc.wait()

    def call(self, method: str, path: str, body=None, raw: bytes = None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                payload = r.read()
                status = r.status
        except urllib.error.HTTPError as e:
            payload, status = e.read(), e.code
        try:
            return status, json.loads(payload)
        except ValueError:
            return status, payload

    def upload(self, ws: str, name: str, data: bytes, chunk: int = 5):
        sha = hashlib.sha256(data).hexdigest()
        for off in range(0, max(len(data), 1), chunk):
            status, body = self.call(
                "PUT",
                f"/v1/workspaces/{ws}/input/{name}?offset={off}&total={len(data)}&sha256={sha}",
                raw=data[off : off + chunk],
            )
            self.assertEqual(status, 200, body)
        return sha

    def run_code(self, ws: str, code: str, inputs=(), timeout_ms: int = 10_000):
        return self.call("POST", f"/v1/workspaces/{ws}/run", {"code": code, "timeoutMs": timeout_ms, "inputs": list(inputs)})

    def test_chunked_input_is_readable_and_output_comes_back(self):
        ws = "a" * 32
        data = b"hello sandbox, in several chunks"
        sha = self.upload(ws, "note.txt", data)
        status, res = self.run_code(
            ws,
            "t=open('input/note.txt').read()\nopen('output/out.txt','w').write(t.upper())\nprint(len(t))",
            [{"name": "note.txt", "sha256": sha}],
        )
        self.assertEqual(status, 200)
        self.assertEqual(res["msg_out"].strip(), str(len(data)))
        self.assertEqual([o["name"] for o in res["outputs"]], ["out.txt"])
        status, got = self.call("GET", f"/v1/workspaces/{ws}/output/out.txt?offset=0&length=1000")
        self.assertEqual(got, data.upper())

    def test_files_persist_between_runs_and_unchanged_outputs_are_not_resent(self):
        ws = "b" * 32
        self.run_code(ws, "open('state.json','w').write('42')\nopen('output/r.txt','w').write('x')")
        status, res = self.run_code(ws, "print(open('state.json').read())")
        self.assertEqual(res["msg_out"].strip(), "42")
        self.assertEqual(res["outputs"], [])

    def test_missing_or_stale_input_is_409(self):
        ws = "c" * 32
        status, res = self.run_code(ws, "print(1)", [{"name": "absent.pdf", "sha256": "0" * 64}])
        self.assertEqual(status, 409)
        self.assertEqual(res["missing"], ["absent.pdf"])
        sha = self.upload(ws, "f.bin", b"abc")
        self.run_code(ws, "open('input/f.bin','wb').write(b'tampered')", [{"name": "f.bin", "sha256": sha}])
        status, res = self.run_code(ws, "print(1)", [{"name": "f.bin", "sha256": sha}])
        self.assertEqual((status, res["missing"]), (409, ["f.bin"]))

    def test_one_chat_cannot_read_another(self):
        a, b = "d" * 32, "e" * 32
        self.run_code(a, "open('secret.txt','w').write('only a')")
        work = os.path.join(self.root, "work")
        status, res = self.run_code(
            b,
            f"import os\ntry:\n    print(open('{work}/{a}/secret.txt').read())\nexcept PermissionError:\n    print('denied')\n"
            f"try:\n    os.listdir('{work}')\nexcept PermissionError:\n    print('no listing')",
        )
        self.assertEqual(res["msg_out"].split(), ["denied", "no", "listing"])

    def test_code_runs_unprivileged_with_a_clean_environment(self):
        status, res = self.run_code("f" * 32, "import os\nprint(os.getuid())\nprint('SECRET_TOKEN' in os.environ)")
        uid, leaked = res["msg_out"].split()
        self.assertNotEqual(uid, "0")
        self.assertEqual(leaked, "False")

    def test_symlinked_output_dir_is_not_followed(self):
        ws = "1" * 32
        status, res = self.run_code(ws, "import os,shutil\nshutil.rmtree('output')\nos.symlink('/etc','output')")
        self.assertEqual(res["outputs"], [])
        status, _ = self.call("GET", f"/v1/workspaces/{ws}/output/passwd")
        self.assertEqual(status, 404)

    def test_symlinked_input_file_is_not_written_through(self):
        ws = "2" * 32
        target = os.path.join(self.root, "victim.txt")
        with open(target, "w") as f:
            f.write("untouched")
        self.run_code(ws, f"import os\nos.symlink('{target}','input/x.txt.part')")
        self.upload(ws, "x.txt", b"overwrite?", chunk=100)
        with open(target) as f:
            self.assertEqual(f.read(), "untouched")

    def test_timeout_kills_the_run_and_anything_it_left_behind(self):
        ws = "3" * 32
        status, res = self.run_code(
            ws,
            "import subprocess,time\np=subprocess.Popen(['sleep','300'], start_new_session=True)\n"
            "open('pid','w').write(str(p.pid))\ntime.sleep(60)",
            timeout_ms=500,
        )
        self.assertTrue(res["timed_out"])
        status, res = self.run_code(
            ws,
            "import os\ntry:\n    os.kill(int(open('pid').read()),0)\n    print('alive')\nexcept ProcessLookupError:\n    print('gone')",
        )
        self.assertEqual(res["msg_out"].strip(), "gone")

    def test_a_run_over_its_memory_is_stopped_and_other_chats_keep_their_files(self):
        other, greedy = "4" * 32, "5" * 32
        self.run_code(other, "open('keep.txt','w').write('still here')")
        # Three processes of 200 MiB each: no one process passes the limit, together they do.
        status, res = self.run_code(
            greedy,
            "import subprocess,sys\n"
            "ps=[subprocess.Popen([sys.executable,'-c','b=bytearray(200*2**20);import time;time.sleep(30)']) for _ in range(3)]\n"
            "[p.wait() for p in ps]",
            timeout_ms=20_000,
        )
        self.assertEqual(status, 200)
        self.assertTrue(res["memory_exceeded"], res)
        self.assertNotEqual(res["exit_code"], 0)
        self.assertFalse(res["timed_out"])
        self.assertIn("more than 400 MiB", res["msg_err"])
        status, res = self.run_code(other, "print(open('keep.txt').read())")
        self.assertEqual(res["msg_out"].strip(), "still here")

    def test_one_process_cannot_allocate_past_the_limit(self):
        status, res = self.run_code("6" * 32, "b = bytearray(600 * 2**20)")
        self.assertEqual(status, 200)
        self.assertIn("MemoryError", res["msg_err"])

    def test_runs_beyond_the_slot_count_wait_instead_of_failing(self):
        first = {}
        t = threading.Thread(target=lambda: first.update(r=self.run_code("7" * 32, "import time; time.sleep(1.5)")))
        t.start()
        time.sleep(0.3)
        started = time.time()
        status, res = self.run_code("8" * 32, "print('ran')")
        waited = time.time() - started
        t.join()
        self.assertEqual((status, res["msg_out"].strip()), (200, "ran"))
        self.assertGreater(waited, 0.9)
        self.assertEqual(first["r"][0], 200)

    def put_state(self, ws: str, rel: str, data: bytes, mtime_ns: int, chunk: int = 7):
        sha = hashlib.sha256(data).hexdigest()
        for off in range(0, max(len(data), 1), chunk):
            status, body = self.call(
                "PUT",
                f"/v1/workspaces/{ws}/state/file?path={rel}&offset={off}&total={len(data)}&sha256={sha}&mtime_ns={mtime_ns}",
                raw=data[off : off + chunk],
            )
            if status != 200:
                return status, body
        return status, body

    def test_state_lists_what_the_code_wrote_but_not_inputs_or_links(self):
        ws = "9" * 32
        sha = self.upload(ws, "in.txt", b"input bytes")
        self.run_code(
            ws,
            "import os\nos.makedirs('data', exist_ok=True)\nopen('state.json','w').write('1')\n"
            "open('data/clean.csv','w').write('a,b')\nopen('output/r.txt','w').write('r')\n"
            "os.symlink('/etc/passwd', 'link')",
            [{"name": "in.txt", "sha256": sha}],
        )
        status, listing = self.call("GET", f"/v1/workspaces/{ws}/state")
        self.assertEqual(status, 200)
        paths = [f["path"] for f in listing["files"]]
        self.assertEqual(paths, ["data/clean.csv", "output/r.txt", "state.json"])
        self.assertEqual(listing["skipped"], 1)
        status, got = self.call("GET", f"/v1/workspaces/{ws}/state/file?path=data/clean.csv")
        self.assertEqual(got, b"a,b")

    def test_state_paths_cannot_leave_the_workspace(self):
        ws = "a1" * 16
        self.run_code(ws, "import os\nos.symlink('/etc', 'd')")
        for rel in ("../etc/passwd", "input/in.txt", "/etc/passwd", "d/passwd"):
            status, _ = self.call("GET", f"/v1/workspaces/{ws}/state/file?path={rel}")
            self.assertIn(status, (400, 404), rel)

    def test_a_checkpoint_goes_back_into_a_fresh_workspace_only(self):
        ws = "b2" * 16
        # The workspace was lost (instance restart): a run that knows of a checkpoint is refused
        # until the checkpoint is back.
        status, res = self.call("POST", f"/v1/workspaces/{ws}/run", {"code": "print(1)", "inputs": [], "restoreState": True})
        self.assertEqual((status, res["error"]), (409, "restore_state"))
        status, _ = self.put_state(ws, "data/x.txt", b"kept across instances", 1_700_000_000_000_000_000)
        self.assertEqual(status, 200)
        self.call("POST", f"/v1/workspaces/{ws}/state/restored")
        status, res = self.call("POST", f"/v1/workspaces/{ws}/run", {"code": "print(open('data/x.txt').read())", "inputs": [], "restoreState": True})
        self.assertEqual(res["msg_out"].strip(), "kept across instances")
        status, listing = self.call("GET", f"/v1/workspaces/{ws}/state")
        self.assertEqual(listing["files"][0]["mtime_ns"], "1700000000000000000")
        # Once it has run, its files are newer than any checkpoint.
        status, res = self.put_state(ws, "data/x.txt", b"old", 1)
        self.assertEqual((status, res["error"]), (409, "not_fresh"))

    def test_unsaved_runs_are_listed_until_checkpointed(self):
        ws = "c3" * 16
        listed = lambda: [w for w in self.call("GET", "/v1/workspaces?idle_s=0")[1]["workspaces"] if w["id"] == ws]
        self.run_code(ws, "open('f','w').write('1')")
        [entry] = listed()
        self.call("POST", f"/v1/workspaces/{ws}/state/saved?generation={entry['generation']}")
        self.assertEqual(listed(), [])
        self.run_code(ws, "open('f','w').write('2')")
        self.assertEqual(len(listed()), 1)
        status, _ = self.call("GET", "/v1/workspaces?idle_s=3600")
        self.assertEqual([w for w in _["workspaces"] if w["id"] == ws], [])



@unittest.skipUnless(os.geteuid() == 0, "the server gives each workspace its own uid, which needs root")
class EvictionTest(unittest.TestCase):
    """Two slots, so a third chat must drop one: the checkpointed one, never unsaved work."""

    def test_a_full_server_drops_a_checkpointed_workspace_before_one_with_unsaved_runs(self):
        root = tempfile.mkdtemp()
        os.chmod(root, 0o755)
        port = _free_port()
        env = {**os.environ, "PORT": str(port), "WORK_ROOT": os.path.join(root, "work"), "MAX_WORKSPACES": "2"}
        proc = subprocess.Popen([sys.executable, SERVER], env=env, stderr=subprocess.DEVNULL)
        try:
            call = ServerTest.call
            self.port = port
            for _ in range(100):
                try:
                    urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1)
                    break
                except Exception:
                    time.sleep(0.05)
            run = lambda ws, code: call(self, "POST", f"/v1/workspaces/{ws}/run", {"code": code, "inputs": []})
            unsaved, saved = "d4" * 16, "e5" * 16
            run(unsaved, "open('f','w').write('unsaved')")
            time.sleep(0.05)  # `unsaved` is the least recently used
            run(saved, "open('f','w').write('saved')")
            call(self, "POST", f"/v1/workspaces/{saved}/state/saved?generation=1")
            run("f6" * 16, "print(1)")
            self.assertEqual(run(unsaved, "print(open('f').read())")[1]["msg_out"].strip(), "unsaved")
        finally:
            proc.kill()
            proc.wait()


if __name__ == "__main__":
    unittest.main()

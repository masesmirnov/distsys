import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import zlib
from pathlib import Path

LIMIT_MIB = 128
PORT = 18190
POST_SIZE = 191 << 20
GET_SIZE = 160 << 20
BLOCK = 1 << 20
PAUSE = 0.02
CRLF = b"\r\n"

VARIANTS = {
    "solution": [],
    "whole-body": [("chunk = self.rfile.read(min(CHUNK_SIZE, self.body_left))", "chunk = self.rfile.read(self.body_left)")],
    "whole-file": [("shutil.copyfileobj(source, self.wfile, CHUNK_SIZE)", "self.wfile.write(source.read())")],
    "gzip-in-memory": [("compressed = tempfile.TemporaryFile()", "compressed = io.BytesIO()")],
}

SCENARIOS = [
    {"id": "post", "variant": "solution", "method": "POST", "size": POST_SIZE, "gzip": False},
    {"id": "post", "variant": "whole-body", "method": "POST", "size": POST_SIZE, "gzip": False},
    {"id": "get", "variant": "solution", "method": "GET", "size": GET_SIZE, "gzip": False},
    {"id": "get", "variant": "whole-file", "method": "GET", "size": GET_SIZE, "gzip": False},
    {"id": "gzip", "variant": "solution", "method": "GET", "size": GET_SIZE, "gzip": True},
    {"id": "gzip", "variant": "gzip-in-memory", "method": "GET", "size": GET_SIZE, "gzip": True},
]


def docker(*args, check=True):
    return subprocess.run(["docker", *args], capture_output=True, text=True, check=check).stdout.strip()


def build(solution: Path, variant: str) -> str:
    image = f"distsys-http-memory-{variant}"
    with tempfile.TemporaryDirectory() as temporary:
        target = Path(temporary) / "solution"
        shutil.copytree(solution, target, ignore=shutil.ignore_patterns("__pycache__", "readme.md"))
        source = (target / "server.py").read_text(encoding="utf-8")
        for old, new in VARIANTS[variant]:
            if source.count(old) != 1:
                raise ValueError(f"{variant}: строка не найдена: {old}")
            source = source.replace(old, new)
        (target / "server.py").write_bytes(source.encode("utf-8"))
        docker("build", "-q", "-t", image, str(target))
    return image


def anon_mib(container: str):
    result = subprocess.run(["docker", "exec", container, "cat", "/sys/fs/cgroup/memory.stat"], capture_output=True, text=True)
    for line in result.stdout.splitlines():
        name, _, value = line.partition(" ")
        if name == "anon":
            return int(value) / (1 << 20)
    return None


def wait_ready(timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=1) as probe:
                probe.sendall(b"GET / HTTP/1.1" + CRLF + b"Host: localhost" + CRLF + CRLF)
                if probe.recv(16).startswith(b"HTTP/1.1"):
                    return
        except OSError:
            pass
        time.sleep(0.2)
    raise RuntimeError("сервер не поднялся")


def post(progress, size):
    connection = socket.create_connection(("127.0.0.1", PORT), timeout=60)
    head = b"POST /big HTTP/1.1" + CRLF + b"Host: localhost" + CRLF + b"Content-Length: " + str(size).encode() + CRLF + CRLF
    connection.sendall(head)
    block = os.urandom(BLOCK)
    try:
        while progress["bytes"] < size:
            piece = block[:min(BLOCK, size - progress["bytes"])]
            connection.sendall(piece)
            progress["bytes"] += len(piece)
            time.sleep(PAUSE)
        reply = b""
        while True:
            chunk = connection.recv(65536)
            if not chunk:
                break
            reply += chunk
        return {"response": reply.split(CRLF)[0].decode() if reply else "соединение закрыто без ответа"}
    except OSError as error:
        return {"response": f"обрыв: {type(error).__name__}"}
    finally:
        connection.close()


def get(progress, compressed):
    connection = socket.create_connection(("127.0.0.1", PORT), timeout=60)
    head = b"GET /big HTTP/1.1" + CRLF + b"Host: localhost" + CRLF + (b"Accept-Encoding: gzip" + CRLF if compressed else b"") + CRLF
    connection.sendall(head)
    buffer = b""
    try:
        while CRLF + CRLF not in buffer:
            chunk = connection.recv(65536)
            if not chunk:
                return {"response": "соединение закрыто без ответа"}
            buffer += chunk
        header, _, rest = buffer.partition(CRLF + CRLF)
        lines = header.split(CRLF)
        length = int(next(line.split(b":", 1)[1] for line in lines if line.lower().startswith(b"content-length")))
        unpack = zlib.decompressobj(31) if compressed else None
        payload = len(unpack.decompress(rest)) if unpack else len(rest)
        progress["bytes"] += len(rest)
        while True:
            chunk = connection.recv(BLOCK)
            if not chunk:
                break
            progress["bytes"] += len(chunk)
            payload += len(unpack.decompress(chunk)) if unpack else len(chunk)
            time.sleep(PAUSE)
        return {"response": lines[0].decode(), "content_length": length, "received": progress["bytes"], "payload": payload}
    except OSError as error:
        return {"response": f"обрыв: {type(error).__name__}"}
    finally:
        connection.close()


def measure(image: str, scenario: dict) -> dict:
    volume = docker("volume", "create")
    container = "distsys-http-memory"
    docker("rm", "-f", container, check=False)
    try:
        if scenario["method"] == "GET":
            docker("run", "--rm", "-v", f"{volume}:/files", "--entrypoint", "python3", image, "-c",
                   f"import os\nwith open('/files/big', 'wb') as f:\n    for _ in range({scenario['size'] // BLOCK}):\n        f.write(os.urandom({BLOCK}))")
        docker("run", "-d", "--name", container, "--memory=128m", "--memory-swap=128m", "--memory-swappiness=0",
               "-v", f"{volume}:/files", "-p", f"{PORT}:{PORT}", image, f"--port={PORT}", "--working-directory=/files")
        wait_ready()
        progress = {"bytes": 0}
        samples = []
        done = threading.Event()
        started = time.time()

        def sample():
            while not done.is_set():
                value = anon_mib(container)
                if value is not None:
                    samples.append([round(time.time() - started, 2), round(progress["bytes"] / (1 << 20), 1), round(value, 1)])
                elif docker("inspect", "-f", "{{.State.Running}}", container, check=False) != "true":
                    return
                time.sleep(0.05)

        sampler = threading.Thread(target=sample, daemon=True)
        sampler.start()
        outcome = post(progress, scenario["size"]) if scenario["method"] == "POST" else get(progress, scenario["gzip"])
        time.sleep(0.6)
        done.set()
        sampler.join(timeout=5)
        state = docker("inspect", "-f", "{{.State.OOMKilled}} {{.State.ExitCode}} {{.State.Running}}", container).split()
        return {
            **scenario,
            **outcome,
            "seconds": round(time.time() - started, 1),
            "killed": state[0] == "true",
            "exit_code": int(state[1]) if state[2] != "true" else None,
            "peak_mib": max((row[2] for row in samples), default=None),
            "samples": samples,
        }
    finally:
        docker("rm", "-f", container, check=False)
        docker("volume", "rm", "-f", volume, check=False)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    solution = Path(sys.argv[1])
    images = {variant: build(solution, variant) for variant in VARIANTS}
    results = [measure(images[scenario["variant"]], scenario) for scenario in SCENARIOS]
    report = {
        "limit_mib": LIMIT_MIB,
        "docker": "--memory=128m --memory-swap=128m --memory-swappiness=0, как у тестера",
        "metric": "anon из memory.stat контейнера: память процесса без страничного кэша",
        "variants": {name: [new for _, new in patches] for name, patches in VARIANTS.items()},
        "scenarios": results,
    }
    json.dump(report, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

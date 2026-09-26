import json
import re
import sys
from pathlib import Path

GUARANTEES = {
    "AT MOST ONCE": "AMO",
    "AT LEAST ONCE": "ALO",
    "EXACTLY ONCE": "EO",
    "EXACTLY ONCE ORDERED": "EOO",
}
ROW = re.compile(
    r"(\d+)\s+Send Mem: (\d+)\s+Recv Mem: (\d+)\s+Messages: (\d+)\s+Traffic: (\d+)\s+Throughput: ([\d.]+)"
)
METRICS = ["send", "recv", "messages", "traffic", "throughput"]


def parse_log(path: Path) -> dict:
    tests, current, summary = [], None, {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        header = re.match(r"--- \[(.+?)\] (.+) ---", line)
        if header:
            current = {"g": GUARANTEES[header[1]], "name": header[2], "status": None, "rows": []}
            tests.append(current)
            continue
        row = ROW.match(line)
        if row and current:
            values = [int(row[i]) for i in range(1, 6)] + [float(row[6])]
            current["rows"].append(dict(zip(["n"] + METRICS, values)))
        elif line.startswith(("PASSED", "FAILED")) and current:
            current["status"] = line.strip()
        elif match := re.match(r"Passed (\d+) from (\d+) tests", line):
            summary["passed"], summary["total"] = int(match[1]), int(match[2])
        elif match := re.match(r"SCORE: ([\d.]+)", line):
            summary["score"] = float(match[1])
    return {"tests": tests, "summary": summary}


def parse_limits(common_rs: Path) -> dict:
    source = common_rs.read_text(encoding="utf-8")
    body = source[source.index("fn check_overhead"):]
    limits = {}
    blocks = re.finditer(r'"(AMO|ALO|EO|EOO)" => match message_count \{(.*?)\n\s*_ =>', body, re.S)
    for block in blocks:
        cases = re.finditer(
            r"(\d+) => \{\s*if !faulty \{\s*\(([^)]*)\)\s*\} else \{\s*\(([^)]*)\)", block[2], re.S
        )
        for case in cases:
            for kind, raw in (("NORMAL", case[2]), ("FAULTY", case[3])):
                numbers = [float(value) if "." in value else int(value) for value in raw.split(", ")]
                limits.setdefault(block[1], {}).setdefault(kind, {})[case[1]] = dict(zip(METRICS, numbers))
    return limits


def overhead(parsed: dict) -> dict:
    table = {}
    for test in parsed["tests"]:
        if test["name"].startswith("OVERHEAD "):
            kind = test["name"].split(" ", 1)[1]
            table.setdefault(test["g"], {})[kind] = {"rows": test["rows"], "status": test["status"]}
    return table


def main() -> None:
    logs, common_rs, image = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    solution = parse_log(logs / "full-4.0.log")
    variants = {}
    for path in sorted(logs.glob("overhead-*.log")):
        parsed = parse_log(path)
        variants[path.stem.removeprefix("overhead-")] = {
            "overhead": overhead(parsed),
            "failures": [f'{t["g"]} {t["name"]}: {t["status"]}' for t in parsed["tests"] if t["status"] != "PASSED"],
            "tests": [{"g": t["g"], "name": t["name"], "status": t["status"]} for t in parsed["tests"]],
        }
    result = {
        "image": image,
        "command": "-m 100 -c -o",
        "summary": solution["summary"],
        "tests": [{"g": t["g"], "name": t["name"], "status": t["status"]} for t in solution["tests"]],
        "overhead": overhead(solution),
        "limits": parse_limits(common_rs),
        "variants": variants,
    }
    json.dump(result, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

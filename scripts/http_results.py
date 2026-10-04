import json
import re
import sys
from pathlib import Path


def parse_log(text: str) -> list:
    groups = {}
    current = None
    for line in text.splitlines():
        score = re.search(r"Score for group \[(G\d)\]: (\d+) / (\d+)", line)
        if score:
            groups.setdefault(score[1], {"runs": {}, "contract": 0, "exit_check": False})
            groups[score[1]].update({"score": int(score[2]), "max": int(score[3])})
            continue
        started = re.match(r"INFO\tTestHW/(G\d)/(contract|\d+)\tRunning command\t(.*)$", line)
        if started:
            group = groups.setdefault(started[1], {"runs": {}, "contract": 0, "exit_check": False})
            current = (started[1], started[2])
            if started[2] == "contract":
                group["contract"] = -1
            elif "--working-directory" not in started[3] and "SERVER_WORKING_DIRECTORY" not in started[3]:
                group["exit_check"] = True
            else:
                group["runs"][started[2]] = 0
            continue
        query = re.match(r"DEBUG\tTestHW/(G\d)/(\d+)/\d+\tSending query", line)
        if query:
            groups[query[1]]["runs"][query[2]] += 1
            continue
        if current and current[1] == "contract" and line.startswith("INFO:__main__:Handle connection"):
            groups[current[0]]["contract"] += 1
    return [
        {
            "name": name,
            "score": group["score"],
            "max": group["max"],
            "runs": [{"seed": int(seed), "queries": count} for seed, count in group["runs"].items()],
            "contract": group["contract"],
            "exit_check": group["exit_check"],
        }
        for name, group in sorted(groups.items())
    ]


def main() -> None:
    log, image = Path(sys.argv[1]), sys.argv[2]
    text = log.read_text(encoding="utf-8", errors="replace")
    total = re.search(r"^SCORE: (\d+)$", text, re.M)
    result = {"image": image, "score": int(total[1]), "groups": parse_log(text)}
    json.dump(result, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

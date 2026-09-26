import json
import re
import sys
from pathlib import Path

COMPONENTS = {"proto": "Proto", "server": "Server", "client": "Client"}


def parse_log(text: str) -> list:
    components = []
    for name, title in COMPONENTS.items():
        tests = [
            {"name": match[1], "status": match[2]}
            for match in re.finditer(rf"tests/test_{name}\.py::(\w+) (PASSED|FAILED|ERROR)", text)
        ]
        score = re.search(rf"^{title}: (\d+)/(\d+)$", text, re.M)
        components.append({"name": name, "score": int(score[1]), "max": int(score[2]), "tests": tests})
    return components


def main() -> None:
    log, image = Path(sys.argv[1]), sys.argv[2]
    text = log.read_text(encoding="utf-8", errors="replace")
    total = re.search(r"^SCORE: (\d+)$", text, re.M)
    result = {"image": image, "score": int(total[1]), "components": parse_log(text)}
    json.dump(result, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

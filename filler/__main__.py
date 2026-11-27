import argparse
import json
from pathlib import Path
from .meeting import validate, render


def main():
    parser = argparse.ArgumentParser(description="Validate a meeting record and render its report.")
    parser.add_argument("meeting", type=Path)
    args = parser.parse_args()
    try:
        record = json.loads(args.meeting.read_text(encoding="utf-8"))
        validate(record)
    except (OSError, ValueError) as exc:
        parser.exit(2, f"Invalid meeting: {exc}\n")
    print(render(record))


if __name__ == "__main__":
    main()

import json


def main() -> str:
    return json.dumps({"ok": True})


if __name__ == "__main__":
    print(main())

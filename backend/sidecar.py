from __future__ import annotations

import argparse

import uvicorn

try:
    from backend.main import app
except ModuleNotFoundError:
    from main import app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="英语阅读工具本地 API 服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18432)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
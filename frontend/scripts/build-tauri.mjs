import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["./node_modules/vite/bin/vite.js", "build"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITE_API_BASE_URL: "http://127.0.0.1:18432"
    },
    stdio: "inherit"
  }
);

process.exit(result.status ?? 1);

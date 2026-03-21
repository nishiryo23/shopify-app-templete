import { spawn } from "node:child_process";
import process from "node:process";

function resolveCommand(command) {
  return process.platform === "win32" ? `${command}.cmd` : command;
}

function spawnCommand(command, args, { env = process.env } = {}) {
  return spawn(resolveCommand(command), args, {
    env,
    stdio: "inherit",
  });
}

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
        resolve();
        return;
      }

      reject(new Error(`${label} exited with code ${code ?? "null"} signal ${signal ?? "null"}`));
    });
  });
}

function terminateChild(child, signal = "SIGTERM") {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill(signal);
}

async function main() {
  const migrate = spawnCommand("pnpm", ["run", "prisma:migrate:deploy"]);
  await waitForExit(migrate, "prisma:migrate:deploy");

  const web = spawnCommand("pnpm", ["run", "dev:web"]);
  const worker = spawnCommand("pnpm", ["run", "dev:worker"], {
    env: process.env,
  });
  const children = [web, worker];

  const shutdown = (signal) => {
    for (const child of children) {
      terminateChild(child, signal);
    }
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await Promise.all([
      waitForExit(web, "dev:web"),
      waitForExit(worker, "dev:worker"),
    ]);
  } catch (error) {
    shutdown("SIGTERM");
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";
import { loadProfile } from "./lib/rigg-profile.mjs";

const profilePath = process.argv[2];
if (!profilePath) {
  console.error("usage: node scripts/rigg-run-verify.mjs <profile-path>");
  process.exit(2);
}

try {
  const profile = loadProfile(profilePath);
  const commands = [];
  let ok = true;

  for (const command of profile.verifyCommands) {
    const result = spawnSync(command, {
      shell: true,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });

    commands.push({
      command,
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    });

    if (result.status !== 0) {
      ok = false;
      break;
    }
  }

  process.stdout.write(`${JSON.stringify({ ok, commands }, null, 2)}\n`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

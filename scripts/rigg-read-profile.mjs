#!/usr/bin/env node
import process from "node:process";
import { loadProfile } from "./lib/rigg-profile.mjs";

const args = process.argv.slice(2);
const profilePath = args[0];
const checkDocs = args.includes("--check-docs");

if (!profilePath) {
  console.error("usage: node scripts/rigg-read-profile.mjs <profile-path> [--check-docs]");
  process.exit(2);
}

try {
  const profile = loadProfile(profilePath, { checkDocs });
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

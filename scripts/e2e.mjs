#!/usr/bin/env node

/**
 * Entry point for `npm run test:e2e`.
 *
 *   1. Locates a JDK >= 21 (see scripts/java-home.mjs) and puts it on the
 *      environment for the child process, so the Firebase emulators start even
 *      when the ambient PATH points at an old or broken Java.
 *   2. Refuses to run if the emulator ports are already taken — this command
 *      owns a throwaway emulator and must not seed into one you are using.
 *   3. Runs `firebase emulators:exec` (Auth + Firestore, demo project), which
 *      invokes scripts/e2e-run.mjs to seed the fixture and run Playwright.
 *
 * Extra CLI args are forwarded to `playwright test`:
 *   npm run test:e2e -- --headed
 *   npm run test:e2e -- smoke.spec.mjs
 */

import { spawnSync } from "node:child_process";
import net from "node:net";
import { delimiter, join } from "node:path";
import { resolveJavaHome } from "./java-home.mjs";

const EMULATOR_PORTS = [8080, 9099];

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(600, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const jdk = resolveJavaHome();
const env = { ...process.env };
if (jdk.home) {
  env.JAVA_HOME = jdk.home;
  env.PATH = join(jdk.home, "bin") + delimiter + (env.PATH || "");
  console.log(`test:e2e: using JDK ${jdk.major} at ${jdk.home}`);
} else {
  console.error("test:e2e: no JDK >= 21 found. Checked:");
  for (const line of jdk.tried) console.error(`  - ${line}`);
  console.error("Install Temurin 21+ (https://adoptium.net) or set JAVA_HOME.");
  process.exit(1);
}

const busy = [];
for (const port of EMULATOR_PORTS) if (await portInUse(port)) busy.push(port);
if (busy.length) {
  console.error(`test:e2e: port ${busy.join(", ")} already in use.`);
  console.error("This command starts its own throwaway emulator. Stop your running");
  console.error("`firebase emulators:start` (Ctrl+C in that terminal) and re-run.");
  process.exit(1);
}

env.E2E_PLAYWRIGHT_ARGS = JSON.stringify(process.argv.slice(2));

// `emulators:exec` takes the inner command as a single quoted argument; pass
// the whole line as one shell string so the quoting survives.
const command =
  'npx firebase emulators:exec --project demo-mapair-local --only auth,firestore "node scripts/e2e-run.mjs"';

const result = spawnSync(command, { stdio: "inherit", shell: true, env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);

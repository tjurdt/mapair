import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The Firebase emulators require a modern JDK, but a working install is often
// not on PATH (a stale Oracle `javapath` stub, or JAVA_HOME only set at the
// machine level and not inherited by the current process tree). This module
// locates a usable JDK without depending on the ambient environment.

const WINDOWS_JDK_ROOTS = [
  "C:\\Program Files\\Eclipse Adoptium",
  "C:\\Program Files\\Java",
  "C:\\Program Files\\Microsoft",
  "C:\\Program Files\\Amazon Corretto",
  "C:\\Program Files\\Zulu",
  "C:\\Program Files\\BellSoft",
  "C:\\Program Files\\Semeru",
  "C:\\Program Files\\Android\\Android Studio\\jbr",
];

const UNIX_JDK_ROOTS = ["/usr/lib/jvm", "/usr/java", "/Library/Java/JavaVirtualMachines", "/opt"];

function javaExe(home) {
  return process.platform === "win32" ? join(home, "bin", "java.exe") : join(home, "bin", "java");
}

// Feature version from `java -version` output ("21.0.2" -> 21, "1.8.0_321" -> 8).
function javaMajor(exe) {
  const result = spawnSync(exe, ["-version"], { encoding: "utf8" });
  const text = `${result.stdout || ""}${result.stderr || ""}`;
  const match = text.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return 0;
  const first = Number(match[1]);
  return first === 1 ? Number(match[2] || 0) : first;
}

function javaHomeFromRegistry() {
  if (process.platform !== "win32") return null;
  const hives = [
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
    "HKCU\\Environment",
  ];
  for (const hive of hives) {
    const result = spawnSync("reg", ["query", hive, "/v", "JAVA_HOME"], { encoding: "utf8" });
    const match = (result.stdout || "").match(/JAVA_HOME\s+REG(?:_EXPAND)?_SZ\s+(.+)/);
    if (!match) continue;
    const value = match[1].trim().replace(/%([^%]+)%/g, (whole, name) => process.env[name] || whole);
    if (existsSync(javaExe(value))) return value;
  }
  return null;
}

function scannedJdkHomes() {
  const roots = process.platform === "win32" ? WINDOWS_JDK_ROOTS : UNIX_JDK_ROOTS;
  const homes = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    if (existsSync(javaExe(root))) homes.push(root); // some layouts put bin/ directly under the root
    let entries = [];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const home = join(root, entry);
      if (existsSync(javaExe(home))) homes.push(home);
      const macHome = join(home, "Contents", "Home");
      if (existsSync(javaExe(macHome))) homes.push(macHome);
    }
  }
  return homes;
}

/**
 * @param {{ minMajor?: number }} [options]
 * @returns {{ home?: string, exe?: string, major?: number, tried: string[] }}
 */
export function resolveJavaHome({ minMajor = 21 } = {}) {
  const tried = [];
  const consider = (home, label) => {
    if (!home) return null;
    const exe = javaExe(home);
    if (!existsSync(exe)) return null;
    const major = javaMajor(exe);
    tried.push(`${label}: ${home} (Java ${major || "?"})`);
    return major >= minMajor ? { home, exe, major } : null;
  };

  let hit = consider(process.env.JAVA_HOME, "JAVA_HOME env");
  if (!hit) hit = consider(javaHomeFromRegistry(), "JAVA_HOME (registry)");

  if (!hit) {
    const ranked = scannedJdkHomes()
      .map((home) => ({ home, major: javaMajor(javaExe(home)) }))
      .filter((entry) => entry.major >= minMajor)
      .sort((a, b) => b.major - a.major);
    for (const entry of ranked) tried.push(`scan: ${entry.home} (Java ${entry.major})`);
    if (ranked[0]) hit = { home: ranked[0].home, exe: javaExe(ranked[0].home), major: ranked[0].major };
  }

  if (!hit) {
    const locator = process.platform === "win32" ? "where" : "which";
    const found = spawnSync(locator, ["java"], { encoding: "utf8" });
    const path = (found.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (path) {
      const major = javaMajor(path);
      tried.push(`PATH: ${path} (Java ${major || "?"})`);
      if (major >= minMajor) hit = { home: join(path, "..", ".."), exe: path, major };
    }
  }

  return hit ? { ...hit, tried } : { tried };
}

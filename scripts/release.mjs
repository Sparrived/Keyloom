import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const noPush = args.includes("--no-push");
const confirmed = args.includes("--yes");
const releaseType = valueAfter("--type");
const requestedVersion = valueAfter("--version");

const executable = (command) => process.platform === "win32" && ["npm", "npx"].includes(command) ? `${command}.cmd` : command;
const run = (command, commandArgs, options = {}) => (execFileSync(executable(command), commandArgs, {
  cwd: root,
  encoding: "utf8",
  stdio: options.capture ? "pipe" : "inherit",
}) ?? "").trim();
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const parseVersion = (value) => {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) throw new Error(`不支持的版本号: ${value}`);
  return match.slice(1).map(Number);
};

const packagePath = join(root, "package.json");
const lockPath = join(root, "package-lock.json");
const tauriPath = join(root, "src-tauri", "tauri.conf.json");
const cargoPath = join(root, "src-tauri", "Cargo.toml");
const packageData = readJson(packagePath);
const current = parseVersion(packageData.version);
let nextVersion = requestedVersion;
if (!nextVersion) {
  if (!['patch', 'minor', 'major'].includes(releaseType)) {
    throw new Error("请使用 --type patch|minor|major 或 --version x.y.z 指定版本。");
  }
  const [major, minor, patch] = current;
  nextVersion = releaseType === "major" ? `${major + 1}.0.0` : releaseType === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}
parseVersion(nextVersion);
if (nextVersion === packageData.version) throw new Error("目标版本与当前版本相同。");

console.log(`Keyloom ${packageData.version} -> ${nextVersion}`);
if (dryRun) process.exit(0);
if (!confirmed) throw new Error("发布会提交、打标签并推送；确认后请加 --yes。");
if (run("git", ["status", "--porcelain"], { capture: true })) throw new Error("工作区不干净，发布已中止。");
if (run("git", ["branch", "--show-current"], { capture: true }) !== "main") throw new Error("只能从 main 分支发布。");
run("git", ["remote", "get-url", "origin"], { capture: true });
if (run("git", ["tag", "--list", `v${nextVersion}`], { capture: true })) throw new Error(`标签 v${nextVersion} 已存在。`);

packageData.version = nextVersion;
writeJson(packagePath, packageData);
const lockData = readJson(lockPath);
lockData.version = nextVersion;
lockData.packages[""].version = nextVersion;
writeJson(lockPath, lockData);
const tauriData = readJson(tauriPath);
tauriData.version = nextVersion;
writeJson(tauriPath, tauriData);
const cargo = readFileSync(cargoPath, "utf8");
writeFileSync(cargoPath, cargo.replace(/(\[package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/, `$1"${nextVersion}"`));

run("cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"]);
run("npm", ["test", "--", "--run"]);
run("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"]);
run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tests/release-version-contract.ps1", "-Tag", `v${nextVersion}`]);
run("npm", ["run", "build"]);
run("git", ["diff", "--check"]);
run("git", ["add", "package.json", "package-lock.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]);
run("git", ["commit", "-m", `chore(release): 发布 Keyloom v${nextVersion}`]);
run("git", ["tag", "-a", `v${nextVersion}`, "-m", `Keyloom v${nextVersion}`]);
if (!noPush) run("git", ["push", "origin", "HEAD", "--follow-tags"]);

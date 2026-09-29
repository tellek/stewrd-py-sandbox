// Pure helpers for Sandbox environments. Kept free of host APIs so they can be
// unit tested. `api.fs.*` takes sandbox-relative paths; shell commands take
// absolute ones, hence the two path builders.
export type EnvStatus = "ready" | "building" | "error";

export type EnvKind = "venv" | "docker";

export interface Env {
  name: string;
  dir: string;
  status: EnvStatus;
  /** Missing on envs saved before Docker support, which are venvs. */
  kind?: EnvKind;
  image?: string;
}

export interface Command {
  cmd: string;
  args: string[];
}

const NAME_RE = /^[A-Za-z0-9_-]+$/;
const VERSION_RE = /^\d+(\.\d+){0,2}(-\d+)?$/;

export function isValidName(name: string): boolean {
  return NAME_RE.test(name);
}

export function isValidVersion(version: string): boolean {
  return VERSION_RE.test(version);
}

function assertName(name: string): void {
  if (!isValidName(name)) throw new Error(`Invalid environment name: ${name}`);
}

// A drive-rooted Windows path with no traversal and no characters cmd treats specially.
export function isValidParentPath(path: string): boolean {
  const p = path.trim();
  return /^[A-Za-z]:\\/.test(p) && !/["&|<>^%]/.test(p) && !p.split("\\").includes("..");
}

function trimSlash(path: string): string {
  return path.trim().replace(/[\\/]+$/, "");
}

export function absEnvsDir(root: string): string {
  return `${trimSlash(root)}\\envs`;
}

export function envDir(parent: string, name: string): string {
  assertName(name);
  if (!isValidParentPath(parent)) throw new Error(`Invalid path: ${parent}`);
  return `${trimSlash(parent)}\\${name}`;
}

// The requirements file lives in the plugin's sandbox (api.fs is relative-only),
// wherever the environment itself is created.
export function relRequirementsPath(name: string): string {
  assertName(name);
  return `requirements/${name}.txt`;
}

export function absRequirementsPath(root: string, name: string): string {
  return `${trimSlash(root)}\\${relRequirementsPath(name).replace("/", "\\")}`;
}

export function hasPackages(text: string): boolean {
  return text.split(/\r?\n/).some((line) => {
    const t = line.trim();
    return t !== "" && !t.startsWith("#");
  });
}

// Parses `py -0p` output (" -V:3.14 *   C:\...\python.exe") into launcher tags.
export function parseInstalledVersions(output: string): string[] {
  const tags = [...output.matchAll(/^\s*-V:(\S+)/gm)].map((m) => m[1]);
  return tags.filter(isValidVersion);
}

export function venvCreateCommand(dir: string, version?: string): Command {
  const v = version?.trim();
  if (v) {
    if (!isValidVersion(v)) throw new Error(`Invalid Python version: ${v}`);
    return { cmd: "py", args: [`-${v}`, "-m", "venv", dir] };
  }
  return { cmd: "python", args: ["-m", "venv", dir] };
}

export function pipInstallCommand(dir: string, requirementsFile: string): Command {
  return { cmd: `${dir}\\Scripts\\python.exe`, args: ["-m", "pip", "install", "-r", requirementsFile] };
}

export function consoleCommand(dir: string): Command {
  return { cmd: "cmd", args: ["/c", "start", "cmd", "/k", `${dir}\\Scripts\\activate.bat`] };
}

// `dir dir` exits non-zero when the folder is missing.
export function existsCommand(dir: string): Command {
  return { cmd: "cmd", args: ["/c", "dir", "/b", dir] };
}

// Only removes a folder whose last segment is the env name, so a bad path can't widen the delete.
export function rmdirCommand(dir: string, name: string): Command {
  assertName(name);
  if (!isValidParentPath(dir) || !dir.endsWith(`\\${name}`)) throw new Error(`Refusing to delete ${dir}`);
  return { cmd: "cmd", args: ["/c", "rmdir", "/s", "/q", dir] };
}

// Drops stored envs whose folder no longer exists so manual deletes leave no ghosts.
export function reconcile(stored: Env[], existingDirs: string[]): Env[] {
  const onDisk = new Set(existingDirs);
  return stored.filter((e) => onDisk.has(e.dir));
}

// --- Docker kind: the env folder is mounted at /work and holds the venv at /work/venv. ---
export const DEFAULT_IMAGE = "python:3.12-slim";

const IMAGE_RE = /^[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9._-]+)?$/;

export function isValidImage(image: string): boolean {
  return IMAGE_RE.test(image);
}

export function containerName(name: string): string {
  assertName(name);
  return `stewrd-${name}`;
}

export function dockerRunCommand(name: string, dir: string, image: string, allowNetwork: boolean): Command {
  if (!isValidImage(image)) throw new Error(`Invalid Docker image: ${image}`);
  const args = ["run", "-d", "--name", containerName(name), "-v", `${dir}:/work`, "-w", "/work"];
  if (!allowNetwork) args.push("--network", "none");
  return { cmd: "docker", args: [...args, image, "sleep", "infinity"] };
}

export function dockerVenvCommand(name: string): Command {
  return { cmd: "docker", args: ["exec", containerName(name), "python", "-m", "venv", "/work/venv"] };
}

export function dockerPipCommand(name: string): Command {
  return {
    cmd: "docker",
    args: ["exec", containerName(name), "/work/venv/bin/pip", "install", "-r", "/work/requirements.txt"],
  };
}

export function dockerStartCommand(name: string): Command {
  return { cmd: "docker", args: ["start", containerName(name)] };
}

export function dockerStopCommand(name: string): Command {
  return { cmd: "docker", args: ["stop", containerName(name)] };
}

export function dockerRemoveCommand(name: string): Command {
  return { cmd: "docker", args: ["rm", "-f", containerName(name)] };
}

// Opens bash with the venv on PATH so `python` and `pip` resolve to it.
export function dockerConsoleCommand(name: string): Command {
  return {
    cmd: "cmd",
    args: ["/c", "start", "cmd", "/k", "docker", "exec", "-it", "-e", "VIRTUAL_ENV=/work/venv",
      "-e", "PATH=/work/venv/bin:/usr/local/bin:/usr/bin:/bin", containerName(name), "bash"],
  };
}

export function mkdirCommand(dir: string): Command {
  return { cmd: "cmd", args: ["/c", "mkdir", dir] };
}

export function dockerListCommand(): Command {
  return { cmd: "docker", args: ["ps", "-a", "--format", "{{.Names}}"] };
}

export function parseContainerNames(output: string): string[] {
  return output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// Drops docker envs whose container is gone (removed outside the plugin).
export function reconcileDocker(envs: Env[], containers: string[]): Env[] {
  const have = new Set(containers);
  return envs.filter((e) => e.kind !== "docker" || have.has(containerName(e.name)));
}

// Copies the requirements file (kept in the plugin's sandbox) into the mounted env folder.
export function copyCommand(from: string, to: string): Command {
  return { cmd: "cmd", args: ["/c", "copy", "/y", from, to] };
}

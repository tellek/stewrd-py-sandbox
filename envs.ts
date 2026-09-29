// Pure helpers for Sandbox environments. Kept free of host APIs so they can be
// unit tested. `api.fs.*` takes sandbox-relative paths; shell commands take
// absolute ones, hence the two path builders.
export type EnvStatus = "ready" | "building" | "error";

export interface Env {
  name: string;
  dir: string;
  status: EnvStatus;
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

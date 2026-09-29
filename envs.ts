// Pure helpers for Sandbox environments. Kept free of host APIs so they can be
// unit tested. `api.fs.*` takes sandbox-relative paths; shell commands take
// absolute ones, hence the two path builders.
export type EnvStatus = "ready" | "building" | "error";

export interface Env {
  name: string;
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

export function relEnvsDir(): string {
  return "envs";
}

export function relEnvDir(name: string): string {
  assertName(name);
  return `envs/${name}`;
}

export function relRequirementsPath(name: string): string {
  return `${relEnvDir(name)}/requirements.txt`;
}

function trimRoot(root: string): string {
  return root.replace(/[\\/]+$/, "");
}

export function absEnvsDir(root: string): string {
  return `${trimRoot(root)}\\envs`;
}

export function absEnvDir(root: string, name: string): string {
  assertName(name);
  return `${absEnvsDir(root)}\\${name}`;
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

// The name is re-validated by absEnvDir, so a bad name can never widen the delete.
export function rmdirCommand(root: string, name: string): Command {
  return { cmd: "cmd", args: ["/c", "rmdir", "/s", "/q", absEnvDir(root, name)] };
}

// Drops stored envs whose folder no longer exists so manual deletes leave no ghosts.
export function reconcile(stored: Env[], dirNames: string[]): Env[] {
  const onDisk = new Set(dirNames);
  return stored.filter((e) => onDisk.has(e.name));
}

import { describe, expect, it } from "vitest";
import {
  absEnvsDir,
  containerPath,
  installPackageCommand,
  parseMissingModule,
  runFileCommand,
  containerName,
  dockerConsoleCommand,
  dockerRunCommand,
  isValidImage,
  parseContainerNames,
  reconcileDocker,
  absRequirementsPath,
  envDir,
  existsCommand,
  consoleCommand,
  hasPackages,
  isValidName,
  isValidParentPath,
  parseInstalledVersions,
  pipInstallCommand,
  reconcile,
  relRequirementsPath,
  rmdirCommand,
  venvCreateCommand,
} from "./envs";

describe("isValidName", () => {
  it("accepts letters, digits, dash, underscore", () => {
    expect(isValidName("my-env_1")).toBe(true);
  });

  it.each(["", "a b", "..", "a/b", "a\\b", "a;b"])("rejects %j", (name) => {
    expect(isValidName(name)).toBe(false);
  });
});

describe("paths", () => {
  it("builds a sandbox-relative and absolute requirements path", () => {
    expect(relRequirementsPath("demo")).toBe("requirements/demo.txt");
    expect(absRequirementsPath("C:\\data\\", "demo")).toBe("C:\\data\\requirements\\demo.txt");
  });

  it("joins the parent path and name, trimming a trailing slash", () => {
    expect(envDir("D:\\work\\", "demo")).toBe("D:\\work\\demo");
    expect(absEnvsDir("C:\\data\\")).toBe("C:\\data\\envs");
  });

  it("refuses a traversing name or a bad parent", () => {
    expect(() => envDir("C:\\data", "..")).toThrow();
    expect(() => envDir("relative\\dir", "demo")).toThrow();
    expect(() => envDir("C:\\a\\..\\b", "demo")).toThrow();
    expect(() => envDir("C:\\a&calc", "demo")).toThrow();
  });
});

describe("hasPackages", () => {
  it("is false for blank and comment-only text", () => {
    expect(hasPackages("")).toBe(false);
    expect(hasPackages("  \n# just a comment\n")).toBe(false);
  });

  it("is true when a requirement is present", () => {
    expect(hasPackages("# c\nrequests==2.0\n")).toBe(true);
  });
});

describe("commands", () => {
  it("uses python when no version is given", () => {
    expect(venvCreateCommand("D")).toEqual({ cmd: "python", args: ["-m", "venv", "D"] });
  });

  it("uses the py launcher when a version is given", () => {
    expect(venvCreateCommand("D", "3.12")).toEqual({ cmd: "py", args: ["-3.12", "-m", "venv", "D"] });
  });

  it("rejects a malformed version", () => {
    expect(() => venvCreateCommand("D", "3.12 && calc")).toThrow();
  });

  it("installs through the venv's own python", () => {
    expect(pipInstallCommand("D", "R")).toEqual({
      cmd: "D\\Scripts\\python.exe",
      args: ["-m", "pip", "install", "-r", "R"],
    });
  });

  it("opens an activated console", () => {
    expect(consoleCommand("D").args).toEqual(["/c", "start", "cmd", "/k", "D\\Scripts\\activate.bat"]);
  });

  it("builds a scoped rmdir", () => {
    expect(rmdirCommand("D:\\work\\demo", "demo").args).toEqual(["/c", "rmdir", "/s", "/q", "D:\\work\\demo"]);
  });

  it("refuses to rmdir a folder that isn't the named env", () => {
    expect(() => rmdirCommand("D:\\work", "demo")).toThrow();
    expect(() => rmdirCommand("D:\\work\\other", "demo")).toThrow();
    expect(() => rmdirCommand("D:\\work\\..\\demo", "demo")).toThrow();
  });

  it("checks existence with dir", () => {
    expect(existsCommand("D:\\work\\demo").args).toEqual(["/c", "dir", "/b", "D:\\work\\demo"]);
  });
});

describe("isValidParentPath", () => {
  it("wants a drive-rooted path", () => {
    expect(isValidParentPath("C:\\Users\\me\\envs")).toBe(true);
    expect(isValidParentPath("envs")).toBe(false);
    expect(isValidParentPath("\\\\server\\share")).toBe(false);
  });
});

describe("reconcile", () => {
  it("drops envs missing from disk and keeps the rest", () => {
    const stored = [
      { name: "a", dir: "C:\\a", status: "ready" as const },
      { name: "b", dir: "C:\\b", status: "error" as const },
    ];
    expect(reconcile(stored, ["C:\\b", "C:\\other"])).toEqual([{ name: "b", dir: "C:\\b", status: "error" }]);
  });
});

describe("parseInstalledVersions", () => {
  it("reads launcher tags and skips non-numeric ones", () => {
    const out = [
      " -V:3.14 *        C:\\Py314\\python.exe",
      " -V:3.12-32      C:\\Py312\\python.exe",
      " -V:ContinuumAnalytics/Anaconda3  C:\\a\\python.exe",
    ].join("\n");
    expect(parseInstalledVersions(out)).toEqual(["3.14", "3.12-32"]);
  });

  it("returns nothing for the launcher's no-runtime message", () => {
    expect(parseInstalledVersions("No installed Pythons found!")).toEqual([]);
  });
});

const BS = String.fromCharCode(92);

describe("docker", () => {
  it("names containers from the env name", () => {
    expect(containerName("demo")).toBe("stewrd-demo");
    expect(() => containerName("a b")).toThrow();
  });

  it("validates images", () => {
    expect(isValidImage("python:3.12-slim")).toBe(true);
    expect(isValidImage("ghcr.io/org/img:1.0")).toBe(true);
    expect(isValidImage("py; rm -rf /")).toBe(false);
    expect(isValidImage("-v")).toBe(false);
  });

  it("mounts the env folder and can cut the network", () => {
    const on = dockerRunCommand("demo", "D:" + BS + "work" + BS + "demo", "python:3.12", true).args;
    expect(on).toContain("D:" + BS + "work" + BS + "demo:/work");
    expect(on).not.toContain("--network");
    expect(dockerRunCommand("demo", "D:" + BS + "w", "python:3.12", false).args).toContain("none");
  });

  it("opens bash inside the container", () => {
    expect(dockerConsoleCommand("demo").args).toContain("stewrd-demo");
  });

  it("parses docker ps output", () => {
    expect(parseContainerNames("a" + String.fromCharCode(13, 10) + "b" + String.fromCharCode(10))).toEqual(["a", "b"]);
  });

  it("drops docker envs with no container but keeps venvs", () => {
    const envs = [
      { name: "v", dir: "C:" + BS + "v", status: "ready" as const },
      { name: "d", dir: "C:" + BS + "d", status: "ready" as const, kind: "docker" as const },
      { name: "e", dir: "C:" + BS + "e", status: "ready" as const, kind: "docker" as const },
    ];
    expect(reconcileDocker(envs, ["stewrd-e"]).map((e) => e.name)).toEqual(["v", "e"]);
  });
});

describe("run file", () => {
  const venv = { name: "v", dir: "D:" + BS + "e" + BS + "v", status: "ready" as const };
  const dock = { ...venv, kind: "docker" as const };

  it("runs a script with the venv python in the script's folder", () => {
    const r = runFileCommand(venv, "D:" + BS + "code" + BS + "main.py");
    expect(r.command).toEqual({
      cmd: venv.dir + BS + "Scripts" + BS + "python.exe",
      args: ["D:" + BS + "code" + BS + "main.py"],
    });
    expect(r.cwd).toBe("D:" + BS + "code");
  });

  it("rejects non-python and relative paths", () => {
    expect(() => runFileCommand(venv, "D:" + BS + "code" + BS + "x.txt")).toThrow();
    expect(() => runFileCommand(venv, "main.py")).toThrow();
  });

  it("maps a file under the env folder into /work for docker", () => {
    expect(containerPath(dock.dir, dock.dir + BS + "src" + BS + "a.py")).toBe("/work/src/a.py");
    expect(runFileCommand(dock, dock.dir + BS + "src" + BS + "a.py").command.args).toEqual([
      "exec", "-w", "/work/src", "stewrd-v", "/work/venv/bin/python", "/work/src/a.py",
    ]);
  });

  it("refuses docker files outside the mounted folder", () => {
    expect(() => runFileCommand(dock, "D:" + BS + "other" + BS + "a.py")).toThrow();
  });

  it("finds the missing top-level module", () => {
    expect(parseMissingModule("ModuleNotFoundError: No module named 'yaml.foo'")).toBe("yaml");
    expect(parseMissingModule("SyntaxError")).toBeNull();
  });

  it("installs a package with the right tool per kind", () => {
    expect(installPackageCommand(venv, "six").args).toEqual(["-m", "pip", "install", "six"]);
    expect(installPackageCommand(dock, "six").cmd).toBe("docker");
    expect(() => installPackageCommand(venv, "six; calc")).toThrow();
  });
});

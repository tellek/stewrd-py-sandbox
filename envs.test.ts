import { describe, expect, it } from "vitest";
import {
  absEnvDir,
  consoleCommand,
  hasPackages,
  isValidName,
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
  it("builds a relative requirements path for api.fs", () => {
    expect(relRequirementsPath("demo")).toBe("envs/demo/requirements.txt");
  });

  it("builds an absolute env dir and trims a trailing root slash", () => {
    expect(absEnvDir("C:\\plugins\\py-sandbox\\data\\", "demo")).toBe("C:\\plugins\\py-sandbox\\data\\envs\\demo");
  });

  it("refuses a traversing name", () => {
    expect(() => absEnvDir("C:\\data", "..")).toThrow();
    expect(() => rmdirCommand("C:\\data", "..\\x")).toThrow();
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
    expect(rmdirCommand("C:\\data", "demo").args).toEqual(["/c", "rmdir", "/s", "/q", "C:\\data\\envs\\demo"]);
  });
});

describe("reconcile", () => {
  it("drops envs missing from disk and keeps the rest", () => {
    const stored = [
      { name: "a", status: "ready" as const },
      { name: "b", status: "error" as const },
    ];
    expect(reconcile(stored, ["b", "other"])).toEqual([{ name: "b", status: "error" }]);
  });
});

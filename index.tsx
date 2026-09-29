/// <reference path="./.stewrd/plugin-api.d.ts" />
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { PluginContext, PluginApi } from "stewrd-plugin-api";
import {
  absEnvDir,
  consoleCommand,
  hasPackages,
  isValidName,
  parseInstalledVersions,
  pipInstallCommand,
  reconcile,
  relEnvsDir,
  relRequirementsPath,
  rmdirCommand,
  venvCreateCommand,
  type Command,
  type Env,
  type EnvStatus,
} from "./envs";

const STORAGE_KEY = "envs";

const STATUS_COLOR = { ready: "success", building: "in-progress", error: "error" } as const;

export function activate(ctx: PluginContext) {
  ctx.api.statusIcon.set("idle");
}

/** Copied from _template/demos/TextAreaDemo.tsx: themed thin scrollbar. */
function scrollbarStyle(palette: PluginApi["theme"]["palette"]): CSSProperties {
  return { scrollbarWidth: "thin", scrollbarColor: `${palette.border} ${palette.surface}` };
}

export function Component({ api }: { api: PluginApi }) {
  const [palette, setPalette] = useState(api.theme.palette);
  const [envs, setEnvs] = useState<Env[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [packages, setPackages] = useState("");
  const [installed, setInstalled] = useState<string[]>([]);
  const [root, setRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const envsRef = useRef<Env[]>([]);

  useEffect(() => api.theme.subscribe(setPalette), [api]);

  const commit = (next: Env[]) => {
    envsRef.current = next;
    setEnvs(next);
    void api.storage.set(STORAGE_KEY, next);
  };

  const setStatus = (envName: string, status: EnvStatus) =>
    commit(envsRef.current.map((e) => (e.name === envName ? { ...e, status } : e)));

  // Load stored envs, drop ghosts, and fail any build a crash left half-done.
  useEffect(() => {
    (async () => {
      const stored = (await api.storage.get<Env[]>(STORAGE_KEY)) ?? [];
      const dirs = (await api.fs.listDir(relEnvsDir())).filter((d) => d.isDir).map((d) => d.name);
      commit(
        reconcile(stored, dirs).map((e) => (e.status === "building" ? { ...e, status: "error" as const } : e)),
      );
    })().catch((err) => api.log.error(`Sandbox load failed: ${err}`));
  }, [api]);

  useEffect(() => {
    void api.fs.getRootPath().then(setRoot);
    api.shell
      .exec("py", ["-0p"])
      .then((r) => setInstalled(r.code === 0 ? parseInstalledVersions(r.stdout) : []))
      .catch(() => setInstalled([]));
  }, [api]);

  useEffect(() => {
    api.sidebar.setItems(
      envs.map((e) => ({ id: e.name, label: e.name, color: STATUS_COLOR[e.status], onClick: () => setSelected(e.name) })),
    );
    api.sidebar.setSelected(selected);
  }, [api, envs, selected]);

  // exec only rejects when the process can't start, so a non-zero exit is checked here.
  const run = async (c: Command) => {
    const r = await api.shell.exec(c.cmd, c.args);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || `Exit code ${r.code}`).trim());
  };

  const create = async () => {
    const envName = name.trim();
    if (!isValidName(envName)) {
      await api.modal.error({ title: "Invalid Name", message: "Use only letters, digits, dashes, and underscores." });
      return;
    }
    if (envsRef.current.some((e) => e.name === envName)) {
      await api.modal.error({ title: "Name In Use", message: `An environment named "${envName}" already exists.` });
      return;
    }
    setBusy(true);
    commit([...envsRef.current, { name: envName, status: "building" }]);
    setSelected(envName);
    try {
      const dir = absEnvDir(await api.fs.getRootPath(), envName);
      await run(venvCreateCommand(dir, version));
      if (hasPackages(packages)) {
        await api.fs.writeTextFile(relRequirementsPath(envName), packages);
        await run(pipInstallCommand(dir, `${dir}\\requirements.txt`));
      }
      setStatus(envName, "ready");
      setName("");
      setVersion("");
      setPackages("");
    } catch (err) {
      setStatus(envName, "error");
      await api.modal.error({ title: "Create Failed", message: String(err instanceof Error ? err.message : err) });
    } finally {
      setBusy(false);
    }
  };

  // Fire-and-forget: the console outlives this call, so `done` is never awaited.
  const openConsole = async (envName: string) => {
    try {
      const dir = absEnvDir(await api.fs.getRootPath(), envName);
      const c = consoleCommand(dir);
      api.shell.spawn(c.cmd, c.args);
    } catch (err) {
      await api.modal.error({ title: "Open Console Failed", message: String(err) });
    }
  };

  const remove = async (envName: string) => {
    const ok = await api.modal.confirm({
      title: "Delete Environment",
      message: `Delete "${envName}" and everything installed in it?`,
      confirmLabel: "Delete Environment",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const c = rmdirCommand(await api.fs.getRootPath(), envName);
      await api.shell.exec(c.cmd, c.args);
      // rmdir /s /q can exit 0 on a partial failure, so confirm the folder is really gone.
      if ((await api.fs.listDir(relEnvsDir())).some((d) => d.name === envName)) {
        throw new Error("The folder could not be fully removed. Close any open console using it and try again.");
      }
      commit(envsRef.current.filter((e) => e.name !== envName));
      setSelected(null);
    } catch (err) {
      await api.modal.error({ title: "Delete Failed", message: String(err instanceof Error ? err.message : err) });
    } finally {
      setBusy(false);
    }
  };

  const label: CSSProperties = { color: palette.textMuted, margin: "12px 0 4px" };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", ...scrollbarStyle(palette) }}>
      <h2>Sandbox</h2>
      {envs.length === 0 && <p style={{ color: palette.textMuted }}>No environments yet. Create one below.</p>}
      {envs.map((e) => (
        <div
          key={e.name}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: palette.surface,
            border: `1px solid ${e.name === selected ? palette.accent : palette.border}`,
            padding: "8px 12px",
            marginBottom: 8,
          }}
        >
          <api.ui.StatusDot color={STATUS_COLOR[e.status]} />
          <span>{e.name}</span>
          <span
            style={{ color: palette.textMuted, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {root ? absEnvDir(root, e.name) : ""}
          </span>
          <api.ui.TextButton
            label="Open Console"
            variant="primary"
            disabled={busy || e.status !== "ready"}
            onClick={() => void openConsole(e.name)}
          />
          <api.ui.TextButton label="Delete" variant="secondary" disabled={busy} onClick={() => void remove(e.name)} />
        </div>
      ))}

      <h3>Create New Environment</h3>
      <p style={label}>Name</p>
      <api.ui.TextBox value={name} onChange={setName} placeholder="my-env" rows={1} />
      <p style={label}>Python Version</p>
      <api.ui.Dropdown
        options={[{ label: "Default (python)", value: "" }, ...installed.map((v) => ({ label: v, value: v }))]}
        value={version}
        onChange={setVersion}
      />
      <p style={label}>Packages (requirements.txt Format)</p>
      <api.ui.CodeTextArea value={packages} onChange={setPackages} language="plain" height={160} />
      <div style={{ marginTop: 12 }}>
        <api.ui.TextButton label="Create Environment" variant="primary" disabled={busy} onClick={() => void create()} />
      </div>
    </div>
  );
}

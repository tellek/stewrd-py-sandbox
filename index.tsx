/// <reference path="./.stewrd/plugin-api.d.ts" />
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { PluginContext, PluginApi } from "stewrd-plugin-api";
import {
  absEnvsDir,
  absRequirementsPath,
  envDir,
  existsCommand,
  DEFAULT_IMAGE,
  consoleCommand,
  dockerConsoleCommand,
  dockerListCommand,
  dockerPipCommand,
  dockerRemoveCommand,
  dockerRunCommand,
  dockerStartCommand,
  dockerStopCommand,
  dockerVenvCommand,
  copyCommand,
  isValidImage,
  mkdirCommand,
  parseContainerNames,
  reconcileDocker,
  hasPackages,
  isValidName,
  isValidParentPath,
  parseInstalledVersions,
  pipInstallCommand,
  reconcile,
  relRequirementsPath,
  rmdirCommand,
  venvCreateCommand,
  type Command,
  type Env,
  type EnvKind,
  type EnvStatus,
} from "./envs";

const STORAGE_KEY = "envs";

const STATUS_COLOR = { ready: "success", building: "in-progress", error: "error" } as const;

export function activate(ctx: PluginContext) {
  ctx.api.statusIcon.set("idle");
  // Containers are stopped, not removed, when the plugin unloads.
  ctx.onDispose(() => {
    void ctx.api.storage.get<Env[]>(STORAGE_KEY).then((envs) => {
      for (const e of envs ?? []) {
        if (e.kind !== "docker") continue;
        const c = dockerStopCommand(e.name);
        ctx.api.shell.exec(c.cmd, c.args).catch(() => {});
      }
    });
  });
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
  const [kind, setKind] = useState<EnvKind>("venv");
  const [image, setImage] = useState(DEFAULT_IMAGE);
  const [allowNetwork, setAllowNetwork] = useState(true);
  const [packages, setPackages] = useState("");
  const [installed, setInstalled] = useState<string[]>([]);
  const [root, setRoot] = useState("");
  const [parent, setParent] = useState("");
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

  // exec only rejects when the process can't start, so a non-zero exit is checked here.
  const run = async (c: Command) => {
    const r = await api.shell.exec(c.cmd, c.args);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || `Exit code ${r.code}`).trim());
  };

  const exists = async (dir: string) => {
    const c = existsCommand(dir);
    return (await api.shell.exec(c.cmd, c.args)).code === 0;
  };

  // Load stored envs, drop ghosts (folders deleted by hand), and fail any build a crash left half-done.
  useEffect(() => {
    (async () => {
      const rootPath = await api.fs.getRootPath();
      setRoot(rootPath);
      setParent((p) => p || absEnvsDir(rootPath));
      // Envs saved before the Path field existed have no dir; they lived under <root>/envs.
      const stored = ((await api.storage.get<Env[]>(STORAGE_KEY)) ?? []).map((e) => ({
        ...e,
        dir: e.dir ?? envDir(absEnvsDir(rootPath), e.name),
      }));
      const present: string[] = [];
      for (const e of stored) if (await exists(e.dir)) present.push(e.dir);
      let kept = reconcile(stored, present);
      // Without Docker running we can't tell which containers are gone, so leave them be.
      if (kept.some((e) => e.kind === "docker")) {
        const c = dockerListCommand();
        const r = await api.shell.exec(c.cmd, c.args).catch(() => null);
        if (r && r.code === 0) kept = reconcileDocker(kept, parseContainerNames(r.stdout));
      }
      commit(kept.map((e) => (e.status === "building" ? { ...e, status: "error" as const } : e)));
    })().catch((err) => api.log.error(`Py Sandbox load failed: ${err}`));
  }, [api]);

  useEffect(() => {
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
    if (!isValidParentPath(parent)) {
      await api.modal.error({ title: "Invalid Path", message: "Use a full path that starts with a drive letter, such as C:\\Projects." });
      return;
    }
    const dir = envDir(parent, envName);
    const docker = kind === "docker";
    if (docker && !isValidImage(image.trim())) {
      await api.modal.error({ title: "Invalid Image", message: "Enter a Docker image such as python:3.12-slim." });
      return;
    }
    setBusy(true);
    try {
      // Never build into (and later delete) a folder that already exists.
      if (await exists(dir)) throw new Error(`${dir} already exists.`);
      commit([...envsRef.current, { name: envName, dir, status: "building", kind, ...(docker && { image: image.trim() }) }]);
      setSelected(envName);
      if (docker) {
        // The env folder is mounted at /work, so requirements.txt written there is visible in the container.
        await run(mkdirCommand(dir));
        await run(dockerRunCommand(envName, dir, image.trim(), allowNetwork));
        await run(dockerVenvCommand(envName));
        if (hasPackages(packages)) {
          await api.fs.writeTextFile(relRequirementsPath(envName), packages);
          await run(copyCommand(absRequirementsPath(root, envName), `${dir}\\requirements.txt`));
          await run(dockerPipCommand(envName));
        }
      } else {
        await run(venvCreateCommand(dir, version));
        if (hasPackages(packages)) {
          await api.fs.writeTextFile(relRequirementsPath(envName), packages);
          await run(pipInstallCommand(dir, absRequirementsPath(root, envName)));
        }
      }
      setStatus(envName, "ready");
      setName("");
      setVersion("");
      setPackages("");
    } catch (err) {
      if (envsRef.current.some((e) => e.name === envName)) setStatus(envName, "error");
      await api.modal.error({ title: "Create Failed", message: String(err instanceof Error ? err.message : err) });
    } finally {
      setBusy(false);
    }
  };

  // Fire-and-forget: the console outlives this call, so `done` is never awaited.
  const openConsole = async (env: Env) => {
    try {
      if (env.kind === "docker") await run(dockerStartCommand(env.name));
      const c = env.kind === "docker" ? dockerConsoleCommand(env.name) : consoleCommand(env.dir);
      api.shell.spawn(c.cmd, c.args);
    } catch (err) {
      void api.modal.error({ title: "Open Console Failed", message: String(err) });
    }
  };

  const remove = async (env: Env) => {
    const ok = await api.modal.confirm({
      title: "Delete Environment",
      message: `Delete "${env.name}" and everything installed in it?`,
      confirmLabel: "Delete Environment",
    });
    if (!ok) return;
    setBusy(true);
    try {
      if (env.kind === "docker") await run(dockerRemoveCommand(env.name));
      const c = rmdirCommand(env.dir, env.name);
      await api.shell.exec(c.cmd, c.args);
      // rmdir /s /q can exit 0 on a partial failure, so confirm the folder is really gone.
      if (await exists(env.dir)) {
        throw new Error("The folder could not be fully removed. Close any open console using it and try again.");
      }
      commit(envsRef.current.filter((e) => e.name !== env.name));
      setSelected(null);
    } catch (err) {
      await api.modal.error({ title: "Delete Failed", message: String(err instanceof Error ? err.message : err) });
    } finally {
      setBusy(false);
    }
  };

  const labelText: CSSProperties = { color: palette.textMuted };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", ...scrollbarStyle(palette) }}>
      <h2>Py Sandbox</h2>
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
            {e.dir}
          </span>
          <api.ui.TextButton
            label="Open Console"
            variant="primary"
            disabled={busy || e.status !== "ready"}
            onClick={() => void openConsole(e)}
          />
          <api.ui.TextButton label="Delete" variant="secondary" disabled={busy} onClick={() => void remove(e)} />
        </div>
      ))}

      <h3>Create New Environment</h3>
      <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", alignItems: "center", gap: "8px 12px" }}>
        <span style={labelText}>Name:</span>
        <api.ui.TextBox value={name} onChange={setName} placeholder="my-env" singleLine />
        <span style={labelText}>Path:</span>
        <api.ui.TextBox value={parent} onChange={setParent} placeholder="C:\\Projects\\envs" singleLine />
        <span style={labelText}>Kind:</span>
        <div style={{ width: "50%" }}>
          <api.ui.Dropdown
            options={[
              { label: "Python Venv", value: "venv" },
              { label: "Docker", value: "docker" },
            ]}
            value={kind}
            onChange={(v) => setKind(v as EnvKind)}
          />
        </div>
        {kind === "docker" ? (
          <>
            <span style={labelText}>Docker Image:</span>
            <api.ui.TextBox value={image} onChange={setImage} placeholder={DEFAULT_IMAGE} singleLine />
            <span style={labelText}>Network:</span>
            <api.ui.Checkbox checked={allowNetwork} onChange={setAllowNetwork} label="Allow Network" />
          </>
        ) : (
          <>
            <span style={labelText}>Python Version:</span>
            <div style={{ width: "50%" }}>
              <api.ui.Dropdown
                options={[{ label: "Default (python)", value: "" }, ...installed.map((v) => ({ label: v, value: v }))]}
                value={version}
                onChange={setVersion}
              />
            </div>
          </>
        )}
      </div>
      <p style={{ ...labelText, margin: "16px 0 4px" }}>Packages (requirements.txt Format)</p>
      <api.ui.CodeTextArea value={packages} onChange={setPackages} language="plain" height={160} />
      <div style={{ marginTop: 12 }}>
        <api.ui.TextButton label="Create Environment" variant="primary" disabled={busy} onClick={() => void create()} />
      </div>
    </div>
  );
}

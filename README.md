# Sandbox

A Stewrd plugin for isolated Python virtual environments. Create an
environment, optionally install packages into it, and open a console with it
already activated.

## Usage

- **Create New Environment**: give it a name (letters, digits, `-`, `_`), an
  Python version picked from the installed versions (detected with `py -0p`), and optional
  packages in `requirements.txt` format.
- Each environment appears as a sidebar sub-item with a status dot: green is
  ready, amber is building, red is an error.
- **Open Console** opens a separate `cmd` window with the venv activated.
- **Delete** removes the environment folder after confirmation.

Environments are created in `<Path>/<Name>`; Path defaults to the plugin's own `data/envs` folder. Creation is refused if that folder already exists.

## Docker Kind

Pick **Docker** as the kind to run the environment in a container (needs Docker
Desktop running). The env folder is mounted at `/work`, the venv lives at
`/work/venv`, and **Open Console** starts the container and opens `bash` in it.
Untick **Allow Network** to run with `--network none` (packages then can't be
installed). Containers are stopped when the plugin unloads and removed on
**Delete**.

## Development

```sh
npm install
npm test
npm run build
```

`build-release.bat` builds and copies the plugin to
`C:\Utilities\stewrd\plugins\py-sandbox`.

## Not Yet Built

An embedded terminal, Run File, and requirements auto-detect are deferred.

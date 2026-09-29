# Sandbox

A Stewrd plugin for isolated Python virtual environments. Create an
environment, optionally install packages into it, and open a console with it
already activated.

## Usage

- **Create New Environment**: give it a name (letters, digits, `-`, `_`), an
  optional Python version (uses the `py` launcher, e.g. `3.12`), and optional
  packages in `requirements.txt` format.
- Each environment appears as a sidebar sub-item with a status dot: green is
  ready, amber is building, red is an error.
- **Open Console** opens a separate `cmd` window with the venv activated.
- **Delete Environment** removes the environment folder after confirmation.

Environments live in the plugin's own `data/envs/<name>/` folder.

## Development

```sh
npm install
npm test
npm run build
```

`build-release.bat` builds and copies the plugin to
`C:\Utilities\stewrd\plugins\py-sandbox`.

## Not Yet Built

Docker-backed environments and an embedded terminal are deferred.

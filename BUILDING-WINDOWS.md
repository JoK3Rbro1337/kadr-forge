# Building Kadr for Windows (.exe)

This fork adds a Windows packaging path on top of upstream Kadr. The core
editor (import, GPU compositing/preview, WYSIWYG export via ffmpeg) runs on
Windows; the embedded Claude panel, Remotion fragments and Whisper
transcription were made cross-platform but still need their optional external
tools (`claude` CLI, `node`/`npm`, `python` + `faster-whisper`).

## What the Windows port changes

Source changes (committed):

- `electron/ffmpeg.ts` — resolves `ffmpeg`/`ffprobe` from a binary **bundled**
  with the packaged app (`resources/ffmpeg`) so the `.exe` is self-contained;
  falls back to `KADR_FFMPEG`/`KADR_FFPROBE` or `PATH`.
- `electron/claude.ts` — `which` via `where` on Windows; launches a `.cmd`
  shim (`claude`) through the command interpreter so node-pty/ConPTY can run it.
- `electron/fragments.ts` — runs `npm`/`npx` through the interpreter (they are
  `.cmd` shims), starts the Vite preview without the POSIX `sh`/`kill`
  watchdog, and tears the process tree down with `taskkill` on Windows.
- `electron/transcribe.ts` — uses `python` (override with `KADR_PYTHON`) and
  resolves `transcribe.py` from the unpacked asar location.
- `package.json` — adds `electron-builder`, a `dist` script and the build
  config (bundles ffmpeg via `extraResources`, unpacks the native `node-pty`,
  `mcp-bridge.cjs`, `transcribe.py` and the MCP SDK from the asar).

## Prerequisites

- **Node.js ≥ 20** and npm.
- **Visual Studio with "Desktop development with C++"** (needed to compile the
  native `node-pty`). VS 2022 or VS 2026 both work — see the gotchas below.
- **ffmpeg/ffprobe binaries** for Windows. Put `ffmpeg.exe`, `ffprobe.exe` and
  their DLLs into `resources/ffmpeg/` before packaging — they are bundled into
  the app and are **gitignored** (not stored in the repo). A shared build
  (e.g. from gyan.dev) is fine; copy the whole `bin/` content.
- **Bundled Python** (for transcription) in `resources/python/`, also bundled
  and gitignored. Assemble it once:
  ```powershell
  # a relocatable, self-contained CPython (not a venv — venvs aren't portable)
  $u = 'https://github.com/astral-sh/python-build-standalone/releases/latest'
  # download a cpython-3.12.x+...-x86_64-pc-windows-msvc-install_only.tar.gz asset,
  # then extract so that resources/python/python.exe exists:
  & "$env:SystemRoot\System32\tar.exe" -xzf cpython-...-install_only.tar.gz -C resources
  # install faster-whisper into it (uv or the bundled pip both work):
  uv pip install --python resources\python\python.exe faster-whisper
  ```
  Whisper models are **not** bundled — faster-whisper downloads the chosen model
  (base/medium/large-v3) on first use into `userData/whisper-models`. The app
  prefers this bundled interpreter; `KADR_PYTHON` still overrides it.

## Build

```powershell
npm install                 # compiles node-pty (postinstall: electron-rebuild)
npm run dist                # electron-vite build  +  electron-builder --win
```

Artifacts land in `release/`:

- `win-unpacked/` — portable folder: `Kadr.exe` plus every runtime file
  (Electron, `resources/ffmpeg`, `resources/app.asar.unpacked` with node-pty).
- `Kadr-<version>-win.zip` — the same folder zipped (upload this to Releases).
- `Kadr Setup <version>.exe` — NSIS installer.

## Known Windows build gotchas (VS 2026 / hardened environments)

These were hit on the build machine. They are toolchain/environment issues,
not code bugs, so they are documented here rather than worked around in source.
If `npm install`'s native rebuild of `node-pty` fails:

1. **`node-gyp` doesn't recognise Visual Studio 2026** (`unsupported version:
   18`, `invalid versionYear: undefined`). The bundled `@electron/node-gyp` has
   a version→year table that stops at VS 2022 (v17). Add VS 2026 (v18) to
   `node_modules/@electron/node-gyp/lib/find-visualstudio.js`:
   - in `getVersionInfo`: map `versionMajor === 18` → `versionYear = 2026`;
   - in `getToolset`: map `versionYear === 2026` → `'v145'`;
   - extend the supported-years arrays `[2019, 2022]` → `[2019, 2022, 2026]`.
   (Use an up-to-date node-gyp once it ships native VS 2026 support.)

2. **`MSB8040: Spectre-mitigated libraries are required`** — `node-pty` requests
   them in its gyp files. Either install the Spectre-mitigated VC++ libs from
   the VS installer, or set `'SpectreMitigation': 'false'` in
   `node_modules/node-pty/binding.gyp` and
   `node_modules/node-pty/deps/winpty/src/winpty.gyp` (2 places).

3. **`'GetCommitHash.bat' is not recognized`** — winpty runs a batch file from
   the current directory, which fails when `NoDefaultCurrentDirectoryInExePath`
   is set in the environment. Unset it for the build shell:
   `Remove-Item Env:\NoDefaultCurrentDirectoryInExePath`.

After applying these, re-run `npx electron-rebuild -f -w node-pty`, then
`npm run dist`. `npmRebuild` is disabled in the build config so packaging will
not re-trigger the native rebuild.

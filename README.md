# SOTP Dev Env

A mod-development workbench for **Sins of the Prophets** and other *Sins of a Solar Empire: Rebellion* mods.
It indexes every Sins text file in a mod (`.entity`, `.str`, `.manifest`, `.particle`, `.brushes`,
`.sounddata`, mesh headers) and gives you an IDE-style editor to change entities, follow references, catch
broken links before the game does, and compare units against their peers. It does not render 3D models or
simulate combat.

**Download:** the Windows installer is on [Releases](https://github.com/Billistic/SOTP-Dev-Toolset/releases).
Installed copies update themselves (Project → About & updates, or the banner under the tab bar).

## Features

- **Projects** - one database per mod; switch, add or remove projects in the Project view. A base-game
  root is optional and makes reference checks inherit vanilla entities, strings and assets.
- **Entity editor** - Form (driven by the Rebellion grammar: every key, legal enum values, missing / unknown
  keys), Tree, Weapons, Raw text, References, Peers and Buff impact views. Pickers for every reference field.
  Edits stay in the project until **Write**, which preserves the original bytes of untouched lines.
- **Diagnostics** - missing entities / strings / assets, manifest problems, grammar violations, count
  mismatches, research slot collisions, strings over 256 characters, and more.
- **Research tree and Relationships** - node graphs you can edit by dragging (tiers, slots, prerequisites,
  reference fields), with undo / redo.
- **Strings** - per-file editing (English.str, French.str ...), a translation view against English.str
  (untranslated filter, fill missing IDs, add a language) and a delta against disk.
- **Analytics and Balance** - typed metrics (DPS, EHP, cost ratios), peer-group outliers with suggested
  levers, faction symmetry, and an exclusion list for dev / debug / AI entities.
- **Factions** come from each mod's own Player entities, so non-SotP mods work too.

## Development

```
backend/   FastAPI + SQLAlchemy 2 + SQLite      http://localhost:8000
frontend/  React 19 + Vite + TypeScript         http://localhost:5173
desktop/   pywebview launcher, PyInstaller + Inno Setup build
```

```bash
# backend (Python 3.12+)
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
copy .env.example .env          # optional: SOTP_MOD_ROOT seeds a first project
.venv/Scripts/python -m uvicorn app.main:app --reload

# frontend (Node 20+)
cd frontend
npm install
npm run dev
```

Tests: `cd backend && .venv/Scripts/python -m pytest -q`. They read the mod folder (`SOTP_MOD_ROOT`) and never
write to it.

### Desktop build

```bash
backend/.venv/Scripts/pip install -r desktop/requirements-desktop.txt
backend/.venv/Scripts/python desktop/build.py --installer   # -> desktop/dist/SOTP-Dev-Env-Setup-<version>.exe
```

Needs [Inno Setup 6](https://jrsoftware.org/isinfo.php) for the installer (without it `desktop/dist/SOTP Dev Env/`
is a portable folder). The app is a frameless WebView2 window with the backend in-process on a free port; it
supports Windows Snap / Win+arrow / FancyZones and per-monitor display scaling (`desktop/native_window.py`).
User data lives in `%LOCALAPPDATA%\SOTP Dev Env`. Useful switches: `--devtools` (WebView2 inspector),
`SOTP_DATA_DIR` + `SOTP_ALLOW_MULTIPLE=1` (a second, isolated instance).

### Releasing

```bash
python desktop/bump_version.py 2.1.0     # version.py, package.json, installer.iss, CHANGELOG.md stub
# write the CHANGELOG entry, commit to main
git tag -a v2.1.0 -m "v2.1.0" && git push origin main v2.1.0
```

`.github/workflows/release.yml` builds on `windows-latest`, signs with the `SIGN_PFX_BASE64` /
`SIGN_PFX_PASSWORD` secrets and publishes the installer plus `latest.json`. Installed apps find it through the
public GitHub Releases API, check its SHA-256 and signature, and install it silently on **Restart to update**.

**Signing:** releases are signed with a self-signed certificate. Windows reports it as untrusted (SmartScreen
warns on first install), so the updater pins that certificate's thumbprint instead
(`SOTP_UPDATE_SIGNERS`, default in `backend/app/config.py`); tampered or differently signed installers are
refused. A CA-issued certificate (OV / EV, or Azure Trusted Signing) verifies as `Valid` and needs no pin.
`desktop/sign.ps1` also accepts `SOTP_SIGN_THUMBPRINT` for certificates in the Windows store.

## Architecture

| Backend (`backend/app`) | |
|---|---|
| `sins/` | Lossless Sins text format: lexer, schema-guided parser (the engine ignores indentation, so lines are adopted by structure), byte-identical writer, Rebellion grammar (`sins/defs/*.xml`). |
| `models/`, `dao/` | SQLAlchemy tables and the only code that queries them. |
| `services/` | Ingest, validation, editing, export, analytics, balance, graphs, factions, updates. |
| `api/` | Thin FastAPI routers. |
| `db/` | `DATABASE_URL` is the project registry; each project's data is in `<registry>.projects/project-<id>.db`. |

Frontend (`frontend/src`): one folder per component with its own CSS module, TanStack Query for server state,
zustand for UI state, and colour tokens in `styles/tokens.css` (dark and light themes; no literal colours in
components).

See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.

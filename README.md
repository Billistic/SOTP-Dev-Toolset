# SOTP Dev Env v2

A mod-development workbench for **Sins of the Prophets** (Sins of a Solar Empire: Rebellion). It parses every
Sins text file in the mod (`.entity`, `.str`, `.manifest`, `.particle`, `.brushes`, `.sounddata`, mesh headers),
indexes them into a database, and gives you an IDE-style UI to edit entities, chase references, find build
errors before the game does, and compare units statistically against their peers.

It deliberately does **not** render 3D models or simulate combat.

```
dev-env-v2/
  backend/   FastAPI + SQLAlchemy 2 (ORM) + SQLite   ->  http://localhost:8000
  frontend/  React 19 + Vite + TypeScript + CSS Modules -> http://localhost:5173
```

## Quick start

Backend (Python 3.12+):

```bash
cd dev-env-v2/backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
copy .env.example .env      # then set SOTP_MOD_ROOT (and optionally SINS_VANILLA_ROOT)
.venv/Scripts/python -m uvicorn app.main:app --reload
```

Frontend (Node 20+):

```bash
cd dev-env-v2/frontend
npm install
npm run dev
```

Open http://localhost:5173. If `SOTP_MOD_ROOT` is set the project is created and ingested on first start;
otherwise use **Project settings** (gear icon) to point at the mod folder and press **Ingest**.

Tests: `cd backend && .venv/Scripts/python -m pytest -q tests`. They run against the real mod folder read-only;
anything written goes to a temp output root.

## Desktop app (installer / .exe)

The tool also ships as a windowed desktop app: a native WebView2 window (`desktop/launcher.py`) hosting the
built UI, with the FastAPI backend running inside the same process on a free local port. User data lives in
`%LOCALAPPDATA%\SOTP Dev Env` (database, `.env`, `launcher.log`, window storage), so reinstalling keeps the
project. A second launch shows an "already running" notice instead of starting another backend.

```bash
backend/.venv/Scripts/pip install -r desktop/requirements-desktop.txt
backend/.venv/Scripts/python desktop/build.py            # UI build + PyInstaller -> desktop/dist/SOTP Dev Env/
backend/.venv/Scripts/python desktop/build.py --installer  # + Inno Setup -> desktop/dist/SOTP-Dev-Env-Setup-<ver>.exe
```

`--installer` needs [Inno Setup 6](https://jrsoftware.org/isinfo.php) (`ISCC.exe`); without it the app folder
is still fully portable (zip it). Run the exe with `--devtools` to get the WebView2 inspector. Set `PORT` to pin
the backend port. If WebView2 is unavailable the launcher falls back to the default browser.

### Code signing

`desktop/sign.ps1` Authenticode-signs (SHA-256, RFC 3161 timestamp) the app exe, the uninstaller and the setup
exe; the build calls it automatically when a certificate is configured, in this order:

| Source | How |
|---|---|
| `SOTP_SIGN_PFX` + `SOTP_SIGN_PFX_PASSWORD` | a `.pfx` file - what CI uses (secrets `SIGN_PFX_BASE64`, `SIGN_PFX_PASSWORD`) |
| `SOTP_SIGN_THUMBPRINT` | a certificate in the Windows store - hardware-token / EV certificates |
| `desktop/certs/dev-codesign.pfx` | self-signed dev certificate from `desktop/make_dev_cert.ps1` |

The dev certificate proves the pipeline but is **not trusted**: signatures verify as `UnknownError`, SmartScreen
still warns, and the in-app updater refuses to install such a build unless `SOTP_UPDATE_ALLOW_UNSIGNED=1`.
For real users you need a CA-issued code-signing certificate - an OV/EV certificate from DigiCert / Sectigo /
GlobalSign (token or cloud HSM; use `SOTP_SIGN_THUMBPRINT` locally or their CI signing action), or
[Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/) (subscription, identity check, drops
straight into the workflow). EV / Trusted Signing gives immediate SmartScreen reputation; OV builds it over time.

### Auto-update (Discord style)

Releases live on GitHub Releases for `SOTP_UPDATE_REPO` (default `Billistic/SOTP-Dev-Toolset`). The desktop
app checks on launch and from the status-bar version pill / Project settings, downloads the new installer in
the background with progress, verifies its SHA-256 (from `latest.json`, falling back to GitHub's asset digest)
**and** its Authenticode signature, then **Restart to update** runs the installer silently
(`/VERYSILENT /CLOSEAPPLICATIONS /UPDATE=1`), which closes the app, installs and relaunches it. "Skip this
version" hides that release's banner. Endpoints: `GET /api/updates/check`, `POST /api/updates/download`,
`GET /api/updates/status`, `POST /api/updates/install`.

Shipping a release:

```bash
python desktop/bump_version.py 2.1.0      # version.py, package.json, installer.iss, CHANGELOG.md
# write the CHANGELOG entry, commit
git tag v2.1.0 && git push && git push --tags
```

`.github/workflows/release.yml` then builds on `windows-latest`, signs with the repo secrets, compiles the
installer and publishes `SOTP-Dev-Env-Setup-2.1.0.exe` + `latest.json`; installed apps see it on their next
check. Test the whole loop locally with `python desktop/build.py --installer` (uses the dev cert if present).

## Architecture

### Backend (`backend/app`)

| Layer | What lives there |
|---|---|
| `sins/` | The Sins text format: `lexer` (lossless line model), `parser` (indent tree + schema-guided repair), `writer` (byte-identical round trip for untouched lines), `values`, `structure` (curated child map + count/item pairs), `schemas/` (per-entity-type field specs, reference rules, typed extractors). No DB or web code. |
| `models/` | SQLAlchemy ORM tables: `projects`, `entities`, `entity_fields` (flattened numeric fields), `weapons`, `prerequisites`, `research_modifiers`, `entity_references`, `faction_members`, `game_strings`, `assets`, `diagnostics`. |
| `dao/` | One DAO class per aggregate; the only place that issues queries. |
| `services/` | Use-cases: `ingest_service`, `validation_service` (+ `validation_rules`), `edit_service`, `export_service`, `analytics_service`, `balance_service`, `graph_service`, `asset_indexer`. |
| `api/` | Thin FastAPI routers (`projects`, `entities`, `catalog`, `insights`). |

Design points worth knowing:

- **The engine ignores indentation.** Sins reads a flat token stream, so the mod has hundreds of files whose
  nesting is visually wrong but load fine. The parser therefore uses `structure.CHILDREN_OF` to adopt lines into
  the parent the engine would use, and reports the drift as `INDENT_ADOPTED` rather than failing.
- **Lossless editing.** Every line is kept verbatim; only nodes you change are re-emitted. All 1040 mod files
  round-trip byte-for-byte. `mode='pretty'` re-indents on purpose.
- **Vanilla overlay.** A Sins mod inherits anything it does not override from the base game. Missing
  entity/string/asset references are only *errors* when a `SINS_VANILLA_ROOT` is indexed; otherwise they are
  downgraded to warnings/info because they may resolve at load time.
- **Write safety.** Edits live in the database (`is_dirty`) until you press **Write**. Writing to a separate
  `output_root` never clears the dirty flag; writing in place does.

### Frontend (`frontend/src`)

- `app/` shell, `layout/` (ActivityBar, Sidebar, EditorArea, BottomPanel, StatusBar), `components/` — one
  folder per component with its own `.module.css`.
- `api/` typed fetch wrappers, `store/` zustand (UI state persisted to `localStorage`), `hooks/`, `utils/`.
- **Theming**: every colour is a token in `styles/tokens.css` — an Unreal-Editor-style neutral palette (dark
  default, `html[data-theme="light"]` counterpart). The moon/sun/monitor button at the bottom of the activity
  bar cycles dark → light → system; `useResolvedTheme()` feeds React Flow's `colorMode` and recharts, which
  need literal colours. Node graphs use UE conventions: category-coloured header bands (`--node-*`), hollow
  pins that fill when connected, 16 px / 128 px grid. Add colours as tokens, never as literals in components.
- Server state is cached by TanStack Query; a successful edit invalidates the entity, diagnostics and tree.

Editor modes per entity: **Form** (schema-driven, collapsible tiles per group; the small ⚖ glyph marks
fields that feed the balance metrics), **Tree** (every node), **Weapons** (grid), **Raw** (text),
**References** (in/out links), **Peers** (metric ranks within the peer group).

### Research tree and the relationship builder

- **Research tree** shows the in-game screen layout per player and field. Dragging a node rewrites its
  `researchWindowLocation.pos` (snap toggle keeps it on the slot grid and warns on a slot clash); dragging
  from one node's port to another adds a `ResearchPrerequisite`; selecting a line and pressing Delete removes
  it; double-click opens the entity.
- **Relationships** is the global map. *Pathways* (Ships, Research, Abilities, Buffs, Squads, Modules,
  Planets, Players) are category filters over one graph whose edges are the entity references
  (`entity_references`). Anything a visible node points at outside the pathway appears as a dashed
  **reference stub** — the pipeline continues there; clicking a stub pulls the real node in. **Focus one
  entity** switches to pipeline mode: N hops downstream / upstream / both from that entity, optionally with
  meshes, particles, sounds, brushes and textures as leaf nodes.
- Every node exposes one input and one output port per reference field, empty slots included (`ability 3`
  hollow). Dragging a port onto a node **writes that field** (`set`); `+ prerequisite` inserts a
  `ResearchPrerequisite` block; selecting an edge and pressing Delete clears the field; the side panel has
  per-link unlink, *Focus here*, *Open* and *Delete entity*. **New entity** creates from a template as
  elsewhere. Node positions are saved per pathway / focus (`graph_layouts`); the grid button recomputes them.
- **Layout** (`utils/graphLayout.ts`): *pipeline* (default for pathways) puts each category in its own column,
  ordered by the data so links flow left → right (ships point at research, so research sits right of ships),
  expands chains inside a category into sub-columns (research prerequisite depth), orders rows by barycenter
  sweeps with factions kept contiguous, and wraps tall columns into a grid with the most-linked nodes nearest
  their targets. *compact* is plain dagre (default for a focus). Hovering or selecting a node lights its links
  and fades the rest; **declutter** hides unrelated links entirely; the faction dropdown cuts a pathway to one
  race or faction.

Endpoints: `GET /api/graph/relationships?categories=|focus=&depth=&direction=&incoming=&include=&asset_kinds=`,
`GET/PUT/DELETE /api/graph/layout/{view_key}`.

### Weapons

The **Weapons** tab is a full editor, not just the comparison grid: one collapsible card per `Weapon` block
with every field grouped (Identity enums, Damage per bank, Range & timing, Effects incl. type-specific
missile/beam parameters with particle/texture pickers) and the four sound lists (`muzzleSounds`,
`hitHullEffectSounds`, `hitShieldsEffectSounds`, `beamEffectSounds`) with add / pick / remove. Cards can be
moved up/down, duplicated and removed; **Add weapon** inserts a Projectile / Missile / Beam starter block
(`sins/schemas/weapons.py`). `NumWeapons` and every `soundCount` are re-synced automatically. The Form view
carries a Weapons tile summarising the loadout with a shortcut to the editor. The tab is enabled for any
entity with a `NumWeapons` key, so weaponless hulls can gain weapons.

Block-level edit ops behind this (usable from `POST /api/entities/{name}/edits` for any block):
`clone` (duplicate after itself), `move` (`offset` ±1 among same-key siblings) and `insertText`
(parse a Sins snippet and insert it under `parent` after a sibling).

### Creating, copying and deleting entities

- **New** (entity tree toolbar) or **Duplicate** (editor header) copies an existing entity of the chosen type
  under a new name. "Give it its own name / description strings" points `NameStringID` / `DescriptionStringID`
  at `<Name-without-faction-tag>_Name` / `_Desc` and creates placeholder strings for them.
- The copy exists only in the project database until you press **Write**; write the manifest from Project
  settings so the game loads it (the manifest writer keeps the file's existing order and appends new entries).
- **Delete** (bin icon) removes the entity from the project. A file already on disk is moved to
  `<mod>/.sotp-trash/GameInfo/` rather than destroyed; entities that referenced it get `MISSING_ENTITY`.

### Picking references instead of typing them

Every reference field — meshes, particles, textures, brushes/icons, sounds, music, explosions, abilities and
other entities, string IDs — has a folder icon that opens a searchable picker over the indexed mod (and base
game, when a vanilla root is set). Multi-word searches match every word; entity pickers pre-filter to the
type the key normally points at (`ability` → Ability, `Subject` → ResearchSubject…) and can be widened.
Free text is always allowed (**Use text**). The Form shows pickers for curated fields; the Tree view shows one
on every reference leaf (`refKinds` in the entity detail), so weapon sounds and effects are covered too.

### Strings from the form

- Every string-ID field shows the localised text beneath it and a speech-bubble icon that opens the string
  editor; **Save** keeps the change in the project, **Save & write .str** also rewrites `String/English.str`.
- Pointing a string-ID field at an ID that does not exist (in the mod or the base game) creates a placeholder
  string automatically and opens the editor so you can type the real text. Pass `?create_strings=false` to
  `POST /api/entities/{name}/edits` to opt out.
- New strings are appended at the end of the `.str` file; existing entries keep their order. Note the mod's
  own `English.str` says it is generated from a spreadsheet, so pick one source of truth.
- The Strings view's **Changes** tab is the delta against disk: new / edited / removed rows with a word-level
  diff of "on disk" vs "in the tool", per-row and bulk **Revert**. Deleting a string is a soft delete until
  the file is written (`GET /api/strings/changes`, `POST /api/strings/revert`).

## What the diagnostics mean

| Code | Meaning |
|---|---|
| `MISSING_<KIND>` (`MISSING_ENTITY`, `MISSING_STRING`, `MISSING_MESH`, `MISSING_BRUSH`, `MISSING_PARTICLE`, `MISSING_SOUND`, …) | A field points at something that is not in the mod (nor the base game, if indexed). |
| `MANIFEST_MISSING_FILE` / `NOT_IN_MANIFEST` / `MANIFEST_DUPLICATE` | `entity.manifest` and `GameInfo/` disagree. |
| `COUNT_MISMATCH` | A `numX` / `xCount` key does not match the number of items that follow it. |
| `DUPLICATE_STRING` / `UNUSED_STRING` / `VANILLA_STRING` | String-table hygiene. |
| `PLAYER_MISSING_MEMBER` / `PLAYER_DUPLICATE_MEMBER` / `UNREACHABLE_ENTITY` | Player build lists vs. what actually exists. |
| `RESEARCH_POS_COLLISION` / `PREREQ_LEVEL_TOO_HIGH` | Research tree layout and prerequisite problems. |
| `INDENT_ADOPTED` / `MIXED_INDENT` / `NO_FORMAT_HEADER` | File-format drift the engine tolerates but a human will trip over. |
| `ZERO_COST`, `ZERO_DAMAGE_WEAPON`, `ZERO_COOLDOWN`, `WRONG_ENTITY_TYPE`, `MISSING_REQUIRED_KEY` | Gameplay-logic smells; see `services/validation_rules.py`. |

## Analytics and balance

`entity_fields` flattens every numeric field, so any field can be charted or ranked. The typed metrics
(`dps_total`, `ehp`, `cost_total`, `dps_per_cost`, `ehp_per_cost`, `dps_per_supply`, …) are computed at ingest.

Units are compared within a **peer group** (same entity type and role across factions; research is grouped by
field and tier) using a robust z-score (median / MAD). A finding is raised when |z| exceeds the threshold, and
the report lists the **levers** — which underlying fields, moved by how much, would bring the metric to the
peer median. Treat these as starting points, not prescriptions: `ARMOR_WEIGHT` in `analytics_service.py` is a
tunable heuristic, and placeholder/flagship-only units are excluded from the candidate set.

## Notable findings in the current mod

Produced by the first ingest of `sotp-rebuild-master` — worth checking in the mod itself:

- 61 `entity.manifest` entries point at files that do not exist; 44 entity references are unresolved.
- 28 research subjects collide on the same field/tier/slot.
- `Research_UNSC_Combat_Epoch_Unlock_Stan` is defined twice (manifest, player list and strings).
- `English.str` declares `NumStrings 889` but contains 890.
- 78 of 105 Frigates have `WeaponEffects` at column 0; every CapitalShip has unindented level tables.

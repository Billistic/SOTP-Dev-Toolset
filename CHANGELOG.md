# Changelog

## 2.0.4

First release built and published by the release workflow; includes everything listed under 2.0.3 (QA issues #1-#5, #7, #10, #11, #13, #14).

- In-app updates now install: the updater accepts installers signed by the SOTP release certificate (pinned by thumbprint, still verified against GitHub's SHA-256 and rejected if tampered), instead of requiring a commercially trusted certificate. From this version on, "Restart to update" works; installs older than 2.0.4 need this one installed by hand once.
- Release workflow fixed (it had been rejected by GitHub since 2.0.1) and the CI build's signing step repaired.

## 2.0.3

QA pass (issues #1-#5, #7, #10, #11, #13, #14).

- One database per project with a project switcher (Project view: Switch / Remove / New project). Choosing a different mod folder offers a new project instead of mixing data. Existing databases are split automatically on first start (#4).
- Factions come from each project's Player entities instead of the built-in SotP2 list; faction filters and colours follow the project (#5).
- Research tree: game layout no longer locks up on hidden `[777, 777]` slots (they get an "Off-screen slot" column); long names wrap in the sidebar (#1, #2).
- Tree tab fields refresh after choosing an entity, undo or other edits (#10).
- Strings: per-file view and editing (English.str, French.str...), fixing edits that could land on another language; 256-character warning with counter, filter and STRING_TOO_LONG diagnostic (#11, #13).
- Translation workflow against English.str: side-by-side reference, untranslated / not-in-English filters, Fill from English, Add language (#14).
- Balance: exclude dev / debug / empty / AI-driver entities from the statistics, with an Excluded tab to restore them (#3).
- Desktop window: Windows Snap (drag to edges, Win+arrow, Win+Z, FancyZones), maximise within the work area, per-monitor display scaling, correct launch position at 125 % and above (#7).

## 2.0.2

- Launch splash: the emblem traces in while the backend boots, then the same window becomes the app (no second window, no flicker).
- Problems panel starts closed; welcome page keeps its logo in view on short windows.
- Form view consolidation: every field in exactly one tile, repeated blocks folded, closed enum dropdowns, integer-strict inputs.
- Buff impact: z vs peers column (peers under the same scenario), only changed metrics listed by default.
- Version is bumped with desktop/bump_version.py before tagging (the release workflow refuses a tag that does not match app/version.py).
- Undo / redo (Ctrl+Z / Ctrl+Y, and toolbar buttons) for graph gestures: connections, prerequisite links, tier and slot moves, dragged layouts.
- Dragging a port onto empty canvas offers "new entity connected here" (type pre-selected from the port) or "connect an existing entity"; the research tree offers the same for prerequisites.
- Tab bar shows chevrons with the number of tabs hidden past each edge; the active tab is kept in view. Entity explorer toolbar wraps at narrow widths.
- Assets: mod / base-game toggle (when a vanilla root is indexed) and a folder filter.
- Relationships: entity nodes carry an Assets section (one row per kind - meshes, particles, sounds, brushes, textures - expanding into the actual fields with a picker to change them, undoable). When a kind is shown as wires they leave from that row, one line per entity->asset pair with a xN badge; selecting an asset node shows its details instead of crashing the view. Asset wires fan out for the clicked node only, as a column of chips beside it in row order (no crossings), long kinds folded behind "+N more"; the fan comes from the entity's reference list so clicking never refetches the graph. Large graphs render visible elements only and hover / selection no longer re-render every edge and node. Chips can be dragged. The node side panel is trimmed to name, actions and a folded Links row.

## 2.0.1

- entity.manifest is maintained automatically: a new entity's first write adds its line, deleting an entity removes it (order, CRLF and hand-made entries preserved). Project view shows manifest status with a non-destructive Sync; entities not listed get an "add to manifest" chip. Malformed manifest lines are reported.
- Key/value entry (tree editor "Add key", new strings) uses in-app dialogs instead of browser prompts; block/weapon removal asks with a proper confirm dialog.
- Relationship builder: clear "Pathways" home / "Clear focus" breadcrumb, Reset view, "Add existing" to bring any entity into the scene (and remove it again); the pathway scene survives a focus round-trip.
- CSV export works in the desktop app (downloads open a Save dialog) and exports the metric table exactly as shown.
- Buff impact: per-ship "Buff impact" tab follows ability -> buff -> nested buffs, simulates hull-threshold conditions and ability level, and shows base vs buffed metrics with a robust z-score against the ship's peer class (peers under the same scenario); only changed metrics are listed by default. Analytics gained a fleet-wide Buff impact table. Metric tables stay unbuffed.
- Window can be resized from its edges and corners (frameless window). Launch shows a splash (emblem tracing in, boot status) that becomes the app window.
- Form view now covers the whole file: the Rebellion entity grammar (Sins Definition Viewer tables, shipped in `backend/app/sins/defs`) lays out every block and field of every entity type. Fields are consolidated into one place each - curated groups plus key-based grouping for the rest, repeated blocks folded into one tile, nested blocks as collapsible sub-blocks - with closed enum dropdowns, integer-strict inputs, add buttons for missing fields and further items, and unknown keys marked and removable. New diagnostics `UNKNOWN_KEY`, `INVALID_ENUM_VALUE`, `MISSING_FIELD`; grammar-typed references.

## 2.0.0

- First desktop release: windowed app (WebView2), installer, signed binaries, in-app updates.
- Lossless Sins entity parser/writer, ingest + diagnostics, form/tree/weapons editors, string management.
- Research tree editing, relationship builder with pathways, focus mode and live wiring.
- Analytics, peer comparison and balance recommendations.

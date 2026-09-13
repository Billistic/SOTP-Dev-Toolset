# Changelog

## 2.0.1

- entity.manifest is maintained automatically: a new entity's first write adds its line, deleting an entity removes it (order, CRLF and hand-made entries preserved). Project view shows manifest status with a non-destructive Sync; entities not listed get an "add to manifest" chip. Malformed manifest lines are reported.
- Key/value entry (tree editor "Add key", new strings) uses in-app dialogs instead of browser prompts; block/weapon removal asks with a proper confirm dialog.
- Relationship builder: clear "Pathways" home / "Clear focus" breadcrumb, Reset view, "Add existing" to bring any entity into the scene (and remove it again); the pathway scene survives a focus round-trip.
- CSV export works in the desktop app (downloads open a Save dialog) and exports the metric table exactly as shown.
- Buff impact: per-ship "Buff impact" tab follows ability -> buff -> nested buffs, simulates hull-threshold conditions and ability level, and shows base vs buffed metrics with a robust z-score against the ship's peer class (peers under the same scenario); only changed metrics are listed by default. Analytics gained a fleet-wide Buff impact table. Metric tables stay unbuffed.
- Window can be resized from its edges and corners (frameless window).
- Form view now covers the whole file: the Rebellion entity grammar (Sins Definition Viewer tables, shipped in `backend/app/sins/defs`) lays out every block and field of every entity type. Fields are consolidated into one place each - curated groups plus key-based grouping for the rest, repeated blocks folded into one tile, nested blocks as collapsible sub-blocks - with closed enum dropdowns, integer-strict inputs, add buttons for missing fields and further items, and unknown keys marked and removable. New diagnostics `UNKNOWN_KEY`, `INVALID_ENUM_VALUE`, `MISSING_FIELD`; grammar-typed references.

## 2.0.0

- First desktop release: windowed app (WebView2), installer, signed binaries, in-app updates.
- Lossless Sins entity parser/writer, ingest + diagnostics, form/tree/weapons editors, string management.
- Research tree editing, relationship builder with pathways, focus mode and live wiring.
- Analytics, peer comparison and balance recommendations.

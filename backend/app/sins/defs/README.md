# Sins entity grammar

XML descriptions of every Sins of a Solar Empire: Rebellion data-file format (entity types,
shared structures such as `Weapon` / `targetFilter` / `GenericLevel`, enum value lists and the
sub-fields each enum value implies). They originate from the community *Sins Definition Viewer*
(Eclipse RCP tool, 2017) and are the machine-readable equivalent of the wiki's `*Syntax` pages.

`app/sins/grammar.py` loads them at start-up (Rebellion view: `NotRebellion` / `*Only` entries
dropped, `Vanilla`-only entries treated as legacy) and uses them for the complete form layout,
the "add missing field" templates and the unknown-key / illegal-enum diagnostics.

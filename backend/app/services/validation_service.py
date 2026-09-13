"""
Runs every validation rule over a project (or a single entity) and stores
the findings as ``Diagnostic`` rows, updating per-entity error counts.
"""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..dao import AssetDAO, DiagnosticDAO, EntityDAO, StringDAO
from ..models import Asset, Diagnostic, Entity, Prerequisite, Project, Reference
from ..sins import Document
from . import asset_indexer, validation_rules as rules

ENTITY_SCOPES = ("entity", "reference")
PROJECT_SCOPES = ("manifest", "player", "research", "string", "asset")


class ValidationService:
    def __init__(self, db: Session):
        self.db = db
        self.entities = EntityDAO(db)
        self.strings = StringDAO(db)
        self.assets = AssetDAO(db)
        self.diags = DiagnosticDAO(db)

    # ── shared context ──────────────────────────────────────────────────
    def _context(self, project: Project) -> dict[str, Any]:
        entities = self.entities.all_for_project(project.id)
        return {
            "entities": entities,
            "by_id": {e.id: e for e in entities},
            "entity_index": {e.name.lower(): e.id for e in entities},
            "entity_types": {e.id: e.entity_type for e in entities},
            "string_ids": self.strings.id_set(project.id),
            "assets": self.assets.lookup(project.id),
            "vanilla_indexed": bool(project.vanilla_root and Path(project.vanilla_root).is_dir()),
        }

    # ── whole project ───────────────────────────────────────────────────
    def run(self, project: Project) -> dict[str, Any]:
        ctx = self._context(project)
        self.diags.clear(project.id)
        out: list[Diagnostic] = []
        used_strings: set[str] = set()

        for e in ctx["entities"]:
            refs = self.entities.references_out(e.id)
            used_strings.update(r.target for r in refs if r.kind == "string")
            out.extend(self._entity_rules(project, e, refs, ctx))

        out.extend(self._project_rules(project, ctx, used_strings))
        self.db.add_all(out)
        self.db.flush()
        self._update_counts(project, ctx["entities"])
        return self.diags.summary(project.id)

    # ── one entity (after an edit) ──────────────────────────────────────
    def run_entity(self, project: Project, entity: Entity) -> list[Diagnostic]:
        ctx = self._context(project)
        self.diags.clear(project.id, entity_id=entity.id, scopes=ENTITY_SCOPES)
        refs = self.entities.references_out(entity.id)
        out = self._entity_rules(project, entity, refs, ctx)
        self.db.add_all(out)
        self.db.flush()
        self._update_counts(project, [entity])
        return out

    # ── manifest only (after the tool edits entity.manifest) ────────────
    def run_manifest(self, project: Project) -> list[Diagnostic]:
        ctx = self._context(project)
        self.diags.clear(project.id, scopes=("manifest",))
        root = Path(project.mod_root)
        manifest = asset_indexer.read_manifest(root, "entity.manifest")
        out = list(rules.manifest_rules(project.id, root, manifest,
                                        {e.source_path: e for e in ctx["entities"] if not e.source_missing},
                                        ctx["assets"].get("entity", {}), ctx["vanilla_indexed"]))
        self.db.add_all(out)
        self.db.flush()
        self._update_counts(project, ctx["entities"])
        return out

    # ── internals ───────────────────────────────────────────────────────
    def _entity_rules(self, project: Project, e: Entity, refs: list[Reference], ctx: dict[str, Any]) -> list[Diagnostic]:
        doc = Document.from_json(e.tree_json)
        out: list[Diagnostic] = list(rules.parse_diagnostics(project.id, e, doc))
        out.extend(rules.count_rules(project.id, e, doc))
        out.extend(rules.required_keys(project.id, e, doc))
        out.extend(rules.weapon_rules(project.id, e, doc))
        out.extend(rules.economy_rules(project.id, e))
        out.extend(rules.reference_rules(project.id, e, refs, entity_index=ctx["entity_index"], entity_types=ctx["entity_types"],
                                         string_ids=ctx["string_ids"], assets=ctx["assets"], vanilla_indexed=ctx["vanilla_indexed"]))
        return out

    def _project_rules(self, project: Project, ctx: dict[str, Any], used_strings: set[str]) -> list[Diagnostic]:
        root = Path(project.mod_root)
        out: list[Diagnostic] = []
        entities: list[Entity] = ctx["entities"]

        manifest = asset_indexer.read_manifest(root, "entity.manifest")
        out.extend(rules.manifest_rules(project.id, root, manifest, {e.source_path: e for e in entities if not e.source_missing},
                                        ctx["assets"].get("entity", {}), ctx["vanilla_indexed"]))

        members = self.entities.all_members(project.id)
        players = {e.id: e for e in entities if e.entity_type == "Player"}
        out.extend(rules.player_rules(project.id, members, ctx["entity_index"], entities, players))

        prereq_rows = self.db.execute(select(Prerequisite.entity_id, Prerequisite.subject, Prerequisite.level)).all()
        prereqs: dict[int, list[tuple[str, int]]] = defaultdict(list)
        for eid, subject, level in prereq_rows:
            prereqs[eid].append((subject, level))
        research = [e for e in entities if e.entity_type == "ResearchSubject"]
        out.extend(rules.research_rules(project.id, research, members, prereqs, ctx["entity_index"], ctx["by_id"]))

        out.extend(rules.string_rules(project.id, self.strings.list(project.id, limit=100000), used_strings))

        sound_defs = [(a.name, (a.meta or {}).get("file")) for a in self.assets.list(project.id, kind="sound", source="mod", limit=100000)]
        sound_defs += [(a.name, (a.meta or {}).get("file")) for a in self.assets.list(project.id, kind="music", source="mod", limit=100000)]
        out.extend(rules.asset_rules(project.id, sound_defs, ctx["assets"].get("ogg", {}), ctx["vanilla_indexed"]))
        return out

    def _update_counts(self, project: Project, entities: list[Entity]) -> None:
        counts = self.diags.counts_per_entity(project.id)
        for e in entities:
            e.error_count, e.warning_count = counts.get(e.id, (0, 0))

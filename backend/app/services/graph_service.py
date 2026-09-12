"""Relationship graphs: research trees per player and reference neighbourhoods."""
from __future__ import annotations

from collections import deque
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..dao import EntityDAO
from ..models import Entity, EntityField, FactionMember, Prerequisite, Project, Reference
from ..sins.schemas.references import ENTITY, classify_key

ASSET_KINDS = ("mesh", "particle", "texture", "brush", "sound", "music", "explosion", "texanim")


class GraphService:
    def __init__(self, db: Session):
        self.db = db
        self.entities = EntityDAO(db)

    def research_tree(self, project: Project, player_name: str) -> dict[str, Any]:
        """Nodes = research listed by the player; edges = prerequisites and what each research unlocks."""
        player = self.entities.by_name(project.id, player_name)
        if player is None:
            return {"nodes": [], "edges": []}
        members = [m for m in self.entities.all_members(project.id) if m.player_entity_id == player.id]
        research_names = {m.member_name for m in members if m.slot == "research"}
        listed = {m.member_name for m in members}
        ents = self.entities.by_names(project.id, research_names)
        nodes = []
        for name in sorted(research_names):
            e = ents.get(name)
            t = (e.typed_json or {}) if e else {}
            nodes.append({"id": name, "label": (e.display_name if e else None) or name, "exists": e is not None,
                          "field": t.get("field"), "tier": t.get("tier"), "block": t.get("window_block"),
                          "x": t.get("window_x"), "y": t.get("window_y"), "cost": t.get("cost_total"),
                          "time": t.get("base_time"), "levels": t.get("max_levels"), "errors": e.error_count if e else 0})
        edges = []
        ids = [e.id for e in ents.values()]
        if ids:
            for eid, subject, level, idx in self.db.execute(
                    select(Prerequisite.entity_id, Prerequisite.subject, Prerequisite.level, Prerequisite.index)
                    .where(Prerequisite.entity_id.in_(ids))).all():
                target = next((n for n, e in ents.items() if e.id == eid), None)
                edges.append({"source": subject, "target": target, "kind": "prerequisite", "level": level,
                              "path": f"Prerequisites.ResearchPrerequisite[{idx}].Subject",   # lets the UI remove exactly this block
                              "dangling": subject not in research_names})
        # units unlocked by research (their Prerequisites point at a research subject)
        unit_rows = self.db.execute(
            select(Entity.name, Entity.entity_type, Entity.display_name, Prerequisite.subject)
            .join(Prerequisite, Prerequisite.entity_id == Entity.id)
            .where(Entity.project_id == project.id, Entity.entity_type != "ResearchSubject", Prerequisite.subject.in_(research_names))).all()
        for name, et, disp, subject in unit_rows:
            if name in listed:
                nodes.append({"id": name, "label": disp or name, "exists": True, "unit": True, "entityType": et})
                edges.append({"source": subject, "target": name, "kind": "unlocks"})
        return {"player": player_name, "nodes": _dedupe(nodes), "edges": edges}

    def neighbourhood(self, project: Project, name: str, depth: int = 1, max_nodes: int = 200) -> dict[str, Any]:
        """Entities connected to ``name`` by entity references, breadth-first up to ``depth``."""
        start = self.entities.by_name(project.id, name)
        if start is None:
            return {"nodes": [], "edges": []}
        seen: dict[str, Entity | None] = {start.name: start}
        edges: list[dict[str, Any]] = []
        queue: deque[tuple[Entity, int]] = deque([(start, 0)])
        while queue and len(seen) < max_nodes:
            e, d = queue.popleft()
            if d >= depth:
                continue
            for ref in self.entities.references_out(e.id):
                if ref.kind != "entity":
                    continue
                edges.append({"source": e.name, "target": ref.target, "key": ref.key, "resolved": ref.resolved})
                if ref.target not in seen:
                    t = self.entities.by_name(project.id, ref.target)
                    seen[ref.target] = t
                    if t is not None:
                        queue.append((t, d + 1))
            for ref, src in self.entities.references_in(project.id, e.name):
                edges.append({"source": src.name, "target": e.name, "key": ref.key, "resolved": True})
                if src.name not in seen:
                    seen[src.name] = src
                    queue.append((src, d + 1))
        nodes = [{"id": n, "label": (e.display_name if e else None) or n, "entityType": e.entity_type if e else None,
                  "faction": e.faction if e else None, "exists": e is not None, "errors": e.error_count if e else 0}
                 for n, e in seen.items()]
        return {"root": name, "nodes": nodes, "edges": _dedupe(edges, key=lambda x: (x["source"], x["target"], x["key"]))}


    # ── global relationship map ─────────────────────────────────────────
    def relationships(self, project: Project, *, categories: set[str] | None = None, focus: str | None = None,
                      depth: int = 2, direction: str = "out", incoming: bool = False, include: set[str] | None = None,
                      factions: set[str] | None = None, asset_kinds: set[str] | None = None, max_nodes: int = 600) -> dict[str, Any]:
        """
        Entities as nodes, entity references as typed edges (``path`` on the source side).
        Filter mode: ``categories`` picks the core; anything linked from outside is a proxy node.
        Focus mode: breadth-first from ``focus`` along references (out / in / both) up to ``depth``.
        """
        ents = self.entities.all_for_project(project.id)
        by_name = {e.name: e for e in ents}
        by_id = {e.id: e for e in ents}
        refs = self._entity_refs(project.id, by_id)

        out_adj: dict[str, list[dict[str, Any]]] = {}
        in_adj: dict[str, list[dict[str, Any]]] = {}
        for r in refs:
            out_adj.setdefault(r["source"], []).append(r)
            in_adj.setdefault(r["target"], []).append(r)

        if focus:
            core = self._bfs(focus, depth, direction, out_adj, in_adj, by_name, max_nodes)
        else:
            wanted = categories or set()
            core = {e.name for e in ents if e.category in wanted}
        if factions:   # race or faction name, e.g. "UNSC" or "Cole"; entities with neither (shared) stay
            core = {n for n in core if n in by_name and (by_name[n].faction in factions or by_name[n].race in factions
                                                         or (by_name[n].faction is None and by_name[n].race is None))}
        core |= {n for n in (include or set()) if n in by_name}   # proxies the user expanded
        truncated = len(core) > max_nodes
        if truncated:
            core = set(sorted(core)[:max_nodes])

        edges = [r for r in refs if r["source"] in core or (incoming and r["target"] in core)]
        if asset_kinds:
            edges += self._asset_refs(project.id, {by_name[n].id for n in core if n in by_name}, by_id, asset_kinds)

        node_ids = set(core)
        for e in edges:
            node_ids.add(e["source"])
            node_ids.add(e["target"])
        free = self._free_ports(project.id, {by_name[n].id: n for n in core if n in by_name})

        nodes = []
        for name in sorted(node_ids):
            e = by_name.get(name)
            asset = next((x for x in edges if x["target"] == name and x["kind"] != "entity"), None)
            if e is None and asset is not None:
                nodes.append({"id": name, "label": name, "kind": asset["kind"], "exists": True, "asset": True, "proxy": True})
                continue
            ports = [{"path": r["path"], "key": r["key"], "target": r["target"]} for r in out_adj.get(name, [])]
            ports += [{"path": p, "key": p.split(".")[-1].split(":")[0], "target": None} for p in free.get(name, [])]
            ports.sort(key=lambda p: _natural(p["path"]))   # ability:0..4 in order, filled or not
            nodes.append({
                "id": name, "label": (e.display_name if e else None) or name, "exists": e is not None,
                "entityType": e.entity_type if e else None, "category": e.category if e else None,
                "race": e.race if e else None, "faction": e.faction if e else None,
                "errors": e.error_count if e else 0, "dirty": bool(e.is_dirty) if e else False,
                "proxy": name not in core, "ports": ports if name in core else [],
            })
        return {"focus": focus, "nodes": nodes, "truncated": truncated,
                "edges": _dedupe(edges, key=lambda x: (x["source"], x["path"], x["target"]))}

    def _entity_refs(self, project_id: int, by_id: dict[int, Entity]) -> list[dict[str, Any]]:
        rows = self.db.execute(select(Reference).join(Entity, Entity.id == Reference.entity_id)
                               .where(Entity.project_id == project_id, Reference.kind == "entity")).scalars().all()
        return [{"source": by_id[r.entity_id].name, "target": r.target, "path": r.path, "key": r.key, "kind": "entity",
                 "resolved": r.resolved} for r in rows if r.entity_id in by_id]

    def _asset_refs(self, project_id: int, entity_ids: set[int], by_id: dict[int, Entity], kinds: set[str]) -> list[dict[str, Any]]:
        if not entity_ids:
            return []
        rows = self.db.execute(select(Reference).where(Reference.entity_id.in_(entity_ids), Reference.kind.in_(kinds))).scalars().all()
        return [{"source": by_id[r.entity_id].name, "target": r.target, "path": r.path, "key": r.key, "kind": r.kind,
                 "resolved": r.resolved} for r in rows]

    def _free_ports(self, project_id: int, ids: dict[int, str]) -> dict[str, list[str]]:
        """Empty entity-reference slots (``ability:3 ""``) that a new connection could fill."""
        if not ids:
            return {}
        rows = self.db.execute(select(EntityField.entity_id, EntityField.path, EntityField.key)
                               .where(EntityField.entity_id.in_(ids), EntityField.value_text == '""')).all()
        out: dict[str, list[str]] = {}
        for eid, path, key in rows:
            if classify_key(key) == ENTITY:
                out.setdefault(ids[eid], []).append(path)
        return out

    @staticmethod
    def _bfs(start: str, depth: int, direction: str, out_adj, in_adj, by_name, max_nodes: int) -> set[str]:
        seen = {start}
        queue: deque[tuple[str, int]] = deque([(start, 0)])
        while queue and len(seen) < max_nodes:
            name, d = queue.popleft()
            if d >= depth:
                continue
            nxt: list[str] = []
            if direction in ("out", "both"):
                nxt += [r["target"] for r in out_adj.get(name, [])]
            if direction in ("in", "both"):
                nxt += [r["source"] for r in in_adj.get(name, [])]
            for n in nxt:
                if n not in seen and n in by_name:
                    seen.add(n)
                    queue.append((n, d + 1))
        return seen


def _natural(path: str) -> list:
    """Sort key that orders ``ability:2`` before ``ability:10`` and keeps prefixes together."""
    import re
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", path)]


def _dedupe(items: list[dict[str, Any]], key=lambda x: x["id"]) -> list[dict[str, Any]]:
    seen: set = set()
    out = []
    for it in items:
        k = key(it)
        if k not in seen:
            seen.add(k)
            out.append(it)
    return out

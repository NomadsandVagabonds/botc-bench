"""Role definitions and script loading for Blood on the Clocktower."""

from __future__ import annotations

import json
from pathlib import Path

from .types import Alignment, RoleDefinition, RoleType

# Path to script data files
SCRIPTS_DIR = Path(__file__).parent.parent / "scripts" / "data"


def _alignment_for(role_type: RoleType) -> Alignment:
    if role_type in (RoleType.TOWNSFOLK, RoleType.OUTSIDER):
        return Alignment.GOOD
    return Alignment.EVIL


def load_script(script_id: str) -> ScriptData:
    """Load a script definition from its JSON file."""
    path = SCRIPTS_DIR / f"{script_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Script not found: {path}")
    with open(path) as f:
        data = json.load(f)
    return ScriptData.from_dict(data)


class ScriptData:
    """Parsed script with all role definitions and night orders."""

    def __init__(
        self,
        script_id: str,
        name: str,
        roles: dict[str, RoleDefinition],
        roles_by_type: dict[RoleType, list[RoleDefinition]],
        first_night_order: list[str],
        other_nights_order: list[str],
    ):
        self.script_id = script_id
        self.name = name
        self.roles = roles
        self.roles_by_type = roles_by_type
        self.first_night_order = first_night_order
        self.other_nights_order = other_nights_order

    @classmethod
    def from_dict(cls, data: dict) -> ScriptData:
        roles: dict[str, RoleDefinition] = {}
        roles_by_type: dict[RoleType, list[RoleDefinition]] = {
            rt: [] for rt in RoleType
        }

        for type_key, role_type in [
            ("townsfolk", RoleType.TOWNSFOLK),
            ("outsiders", RoleType.OUTSIDER),
            ("minions", RoleType.MINION),
            ("demons", RoleType.DEMON),
        ]:
            for r in data["roles"].get(type_key, []):
                role_def = RoleDefinition(
                    id=r["id"],
                    name=r["name"],
                    role_type=role_type,
                    alignment=_alignment_for(role_type),
                    ability_text=r["ability"],
                    first_night_order=r.get("first_night_order"),
                    other_nights_order=r.get("other_nights_order"),
                    setup_modifies=r.get("setup_modifies", False),
                    acts_on_death=r.get("acts_on_death", False),
                )
                roles[role_def.id] = role_def
                roles_by_type[role_type].append(role_def)

        return cls(
            script_id=data["id"],
            name=data["name"],
            roles=roles,
            roles_by_type=roles_by_type,
            first_night_order=data.get("first_night_order", []),
            other_nights_order=data.get("other_nights_order", []),
        )

    @property
    def townsfolk(self) -> list[RoleDefinition]:
        return self.roles_by_type[RoleType.TOWNSFOLK]

    @property
    def outsiders(self) -> list[RoleDefinition]:
        return self.roles_by_type[RoleType.OUTSIDER]

    @property
    def minions(self) -> list[RoleDefinition]:
        return self.roles_by_type[RoleType.MINION]

    @property
    def demons(self) -> list[RoleDefinition]:
        return self.roles_by_type[RoleType.DEMON]

    @property
    def all_roles(self) -> list[RoleDefinition]:
        result = []
        for rt in RoleType:
            result.extend(self.roles_by_type[rt])
        return result

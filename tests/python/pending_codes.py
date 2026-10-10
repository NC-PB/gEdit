"""Code data a script golden needs before the shipped database has it (B1).

Not a test module (``unittest discover`` only collects ``test*.py``). A case folder's
``case.json`` may carry two members that change the database the case runs with:

``extraCodes``
    whole entries the database does not have yet (the Klartext ``VC`` cutting-speed entry,
    ``sets.speedUnit: 'surface'``). An entry the database already has wins.
``codeAttributes``
    ``{"<code>": {"<attribute>": value}}``, merged into the database's entry of that code
    where it does not set the attribute itself (``ownWords: ["F"]`` on Klartext ``M128``).
    A code the database does not have is left out.

Both are written so that the case runs unchanged once the shipped data has the entry or the
attribute: the shipped value always wins. The B1 code-data package adds them; after that
the members can be dropped from the cases.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Sequence


def extra_codes(options: Dict[str, Any]) -> List[Dict[str, Any]]:
    extra = options.get("extraCodes")
    return [entry for entry in extra if isinstance(entry, dict)] if isinstance(extra, list) else []


def code_attributes(options: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    found = options.get("codeAttributes")
    if not isinstance(found, dict):
        return {}
    return {code: attrs for code, attrs in found.items() if isinstance(code, str) and isinstance(attrs, dict)}


def with_pending(codes: Sequence[Dict[str, Any]], options: Dict[str, Any]) -> List[Dict[str, Any]]:
    """``codes`` with the case's ``extraCodes`` and ``codeAttributes`` (see the module text)."""
    attributes = code_attributes(options)
    out: List[Dict[str, Any]] = []
    for entry in codes:
        attrs = attributes.get(entry.get("code")) if isinstance(entry, dict) else None
        if attrs:
            entry = copy.deepcopy(entry)
            for key, value in attrs.items():
                entry.setdefault(key, copy.deepcopy(value))
        out.append(entry)
    known = {entry.get("code") for entry in out if isinstance(entry, dict)}
    out.extend(entry for entry in extra_codes(options) if entry.get("code") not in known)
    return out


def strip(context: Dict[str, Any]) -> None:
    """Takes the two members out of a context a case's options were copied into."""
    context.pop("extraCodes", None)
    context.pop("codeAttributes", None)

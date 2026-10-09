# /// gedit
# name = "Exit2 machine parameters"
# description = "Reports the effective machine parameters of the document and where each comes from."
# input = "document"
# output = "report"
# ///
"""Written for gEdit's Phase 2 exit criteria (X11 d). Not a bundled script.

One row per value ``gedit_nc.machine_params(ctx)`` answers: the machine and why it is the
document's (``choice``), the number input, the units, the diameter mode, every declared
variant and every power-on modal code (read from the effective profile the context
carries), each with its source (``machine``, ``detected`` or ``profile``).
"""

import json

import gedit_nc

context = gedit_nc.load_context()
machine = gedit_nc.machine_params(context)
params = machine["params"]
source = machine["source"]
rows = [
    {"key": "machine", "value": machine["name"] or "(none)", "source": machine["choice"]},
    {
        "key": "numberInput",
        "value": json.dumps(params["numberInput"], sort_keys=True) if params["numberInput"] else "(none)",
        "source": source["numberInput"],
    },
    {"key": "units", "value": params["units"], "source": source["units"]},
    {"key": "diameter", "value": params["diameter"] or "(none)", "source": source["diameter"]},
]
for name in sorted(params["variants"]):
    rows.append(
        {
            "key": "variant " + name,
            "value": params["variants"][name],
            "source": source["variants"].get(name, "profile"),
        }
    )
#: The power-on codes the effective profile carries (a machine's own, a variant's overlay or
#: the profile's), which is where a value not set by the machine comes from.
initial = ((context.get("profile") or {}).get("modal") or {}).get("initial") or {}
for group in sorted(source["modalInitial"]):
    rows.append(
        {
            "key": "power-on " + group,
            "value": params["modalInitial"].get(group) or initial.get(group) or "(none)",
            "source": source["modalInitial"][group],
        }
    )

gedit_nc.report(
    "Exit2 machine parameters",
    [{"key": "key", "label": "Parameter"}, {"key": "value", "label": "Value"}, {"key": "source", "label": "Source"}],
    rows,
)

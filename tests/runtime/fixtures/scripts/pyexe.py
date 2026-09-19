# Written for gEdit's runtime harness: reports which interpreter runs it.
import json
import os
import sys

sys.stdin.read()
print(
    json.dumps(
        {
            "executable": sys.executable,
            "version": sys.version.split()[0],
            "via": os.environ.get("GEDIT_RH_VIA"),
            "geditPython": os.environ.get("GEDIT_PYTHON"),
            "path": os.environ.get("PATH"),
            "shell": os.environ.get("SHELL"),
            "cwd": os.getcwd(),
        }
    )
)

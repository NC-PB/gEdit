# Written for gEdit's runtime harness: echoes what it got on stdin as JSON.
import json
import os
import sys

data = sys.stdin.read()
print(json.dumps({"len": len(data), "upper": data.upper(), "lines": data.count("\n"), "cwd": os.getcwd()}))

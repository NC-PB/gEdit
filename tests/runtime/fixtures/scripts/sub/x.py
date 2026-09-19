# Written for gEdit's runtime harness: a trap. It must never run, so it leaves a
# marker next to the scripts folder when it does.
import os

here = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(here, "..", "..", "PWNED"), "w").write("sub/x.py ran")

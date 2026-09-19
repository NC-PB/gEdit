# Written for gEdit's runtime harness: a trap outside the scripts folder. It must
# never run, so it leaves a marker when it does.
import os

here = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(here, "PWNED"), "w").write("evil.py ran")

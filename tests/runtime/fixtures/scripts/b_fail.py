# Written for gEdit's runtime harness: writes to stderr and exits nonzero.
import sys

sys.stderr.write("boom on stderr\n")
print("partial stdout")
sys.exit(1)

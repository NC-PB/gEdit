"""gEdit's Python tests (gate G4).

``unittest discover`` imports the modules in this folder as ``tests.python.*``, so the
package marker has to be here; ``tests/`` itself stays a namespace package, because it
also holds fixtures and the JavaScript-side test folders.

    python3 -m unittest discover -s tests/python -t .

Run it from the repository root. CI runs it on Python 3.9 and on 3.12.
"""

import sys

# No ``.pyc`` files. The tests import `gedit_nc` straight out of
# ``src-tauri/resources/scripts``, and that folder is copied into the app bundle as a
# resource: a ``__pycache__`` left behind there would be shipped, and a stale one would
# be shipped instead of the source. The real runner sets ``PYTHONDONTWRITEBYTECODE``
# for the same reason.
sys.dont_write_bytecode = True

"""The whole-line fast path in ``mask_comments`` (G7 perf regression). Mirrors
``mask.fastPath.test.ts``.

A wall-clock budget here would flake under load and would not say *why* it slowed down.
What actually regresses is the fast path silently stopping short: the character loop runs
again, at every position, for every line — exactly the per-character cost the fast path
exists to avoid (``_program_name_end_at`` sitting next to ``_comment_at`` in that loop is
the bug this fix undoes). So this counts calls to the loop's own expensive checks instead
of timing anything: a comment-free, name-free line must never reach ``_comment_at`` or
``_program_name_end_at``, and a line that does have something to mask still must, so the
fast path is not just short-circuiting everything.

The two functions are module globals of ``_nc_lex``, the module ``mask_comments`` is
defined in — ``gedit_nc`` only re-exports the name (its own docstring says so) — so they
are monkeypatched there, where ``mask_comments``'s own lookup of them resolves.
"""

from __future__ import annotations

import sys
import unittest

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()
nc_lex = sys.modules["_nc_lex"]


class TestMaskCommentsFastPath(unittest.TestCase):
    def setUp(self):
        self.fanuc = gedit_nc.compile_profile(helpers.load_profile("fanuc-gcode"))
        self.klartext = gedit_nc.compile_profile(helpers.load_profile("heidenhain-klartext"))

    def _counted(self, name):
        """Replaces ``_nc_lex.<name>`` with a call-counting wrapper for this test only."""
        original = getattr(nc_lex, name)
        calls = []

        def wrapper(*args, **kwargs):
            calls.append(1)
            return original(*args, **kwargs)

        setattr(nc_lex, name, wrapper)
        self.addCleanup(lambda: setattr(nc_lex, name, original))
        return calls

    def test_never_calls_the_character_loop_checks_on_a_plain_cam_line(self):
        comment_calls = self._counted("_comment_at")
        name_calls = self._counted("_program_name_end_at")
        gedit_nc.mask_comments("N10 G0 X10.5 Y-20.25 Z5. F500 S3000 M3", self.fanuc)
        self.assertEqual(comment_calls, [])
        self.assertEqual(name_calls, [])

    # Klartext has no `programNames`, so this also proves the fast path applies on a
    # profile where `_program_name_end_at` is always a no-op, not only where
    # `program_names` is `None` and the check is skipped for that reason alone.
    def test_never_calls_them_on_a_klartext_line_with_nothing_to_mask(self):
        comment_calls = self._counted("_comment_at")
        name_calls = self._counted("_program_name_end_at")
        gedit_nc.mask_comments("8 L X+10 Y+20 R0 FMAX M3", self.klartext)
        self.assertEqual(comment_calls, [])
        self.assertEqual(name_calls, [])

    def test_still_calls_comment_at_on_a_line_with_a_comment(self):
        comment_calls = self._counted("_comment_at")
        gedit_nc.mask_comments("N10 G0 X10. (ROUGH) Y20.", self.fanuc)
        self.assertTrue(comment_calls)

    def test_still_calls_program_name_end_at_on_a_line_with_a_name(self):
        name_calls = self._counted("_program_name_end_at")
        gedit_nc.mask_comments("<SHAFT_T12> (OD PIN)", self.fanuc)
        self.assertTrue(name_calls)


if __name__ == "__main__":
    unittest.main()

// The default shortcuts the app ships, as one table (plan §7.11 of Phase 1, and the rows
// Phase 2 adds in its §7.13). Two things hold it:
//
//   - the runtime scenario `m1-keys` compares it, both ways, with the keys the command
//     registry reports in the running app;
//   - `tests/unit/commandPins.test.ts` compares it, both ways, with the keys the
//     contribution sources declare, so a new binding that is not added here fails
//     `npm test` and not only the hosted runtime run.
//
// This module has no imports: the harness bundles it into the page, and the unit tests
// read it in Node.

/**
 * Every command that carries a default key, with the key as the registry reports it (a
 * string, or the JSON of a `{ mac, other }` pair). Add a row in the same change that adds
 * the binding, and give the plan's key table the row first.
 *
 * Phase 1 (§7.11): M1 and M2 registered most of them; M3 the three `nav.*` ones; M4 the three
 * `bookmark.*` ones; M5 `script.runPicker` (F9) and `script.runLast` (Mod+F9).
 * Phase 2 (§7.13): M10 (WP10.1) added `nav.selectToolSegment` (Mod+F7); M11 (WP11.1) `search.findAll` (Mod+Shift+F).
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const SHORTCUTS = [
  ['file.new', 'Mod+N'],
  ['file.open', 'Mod+O'],
  ['file.save', 'Mod+S'],
  ['file.saveAs', 'Mod+Shift+S'],
  ['file.saveAll', 'Mod+Alt+S'],
  ['file.close', 'Mod+W'],
  ['file.closeWindow', 'Mod+Shift+W'],
  ['view.nextTab', 'Ctrl+Tab'],
  ['view.prevTab', 'Ctrl+Shift+Tab'],
  ['view.switchTab', 'Mod+Alt+O'],
  ['view.commandPalette', 'F1'],
  ['compare.with', 'Mod+Alt+C'],
  ['compare.copyToModified', 'Mod+Alt+Right'],
  ['compare.copyToOriginal', 'Mod+Alt+Left'],
  ['settings.open', 'Mod+,'],
  ['nav.goto', 'Ctrl+G'],
  ['nav.nextTool', 'F7'],
  ['nav.prevTool', 'Shift+F7'],
  ['nav.selectToolSegment', 'Mod+F7'],
  ['bookmark.toggle', 'Mod+F2'],
  ['bookmark.next', 'F2'],
  ['bookmark.prev', 'Shift+F2'],
  ['script.runPicker', 'F9'],
  ['script.runLast', 'Mod+F9'],
  ['search.findAll', 'Mod+Shift+F'],
]

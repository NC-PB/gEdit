// What `nav.selectToolSegment` is expected to select (plan §6 M10, WP10.1), as pure
// functions so the unit tests can hold them to the cases a hosted run found.
//
// The outline's `endLine` for the last tool item is the document's last line, and a
// program file that ends in a newline has an empty line after the last block. The command
// leaves blank lines at the end of a segment out (`trimBlankEnd` in `contrib/segments.ts`,
// plan row 115), so the selection ends on the last line that is not blank, not on the
// outline's `endLine`. This module has no imports: the harness bundles it, Node reads it.

/**
 * The last line of the selection a segment should give: `last` without the blank lines at
 * the end, never above `first`.
 * @param {number} first
 * @param {number} last
 * @param {(line: number) => string} lineAt text of a 1-based line
 * @returns {number}
 */
export function expectedEnd(first, last, lineAt) {
  let end = Math.max(first, last)
  while (end > first && lineAt(end).trim() === '') end--
  return end
}

/**
 * Whether a selection is the segment `first..last` as the command selects it: from column
 * 1 of `first` to the end of the last line that is not blank.
 * @param {{ startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number }} selection
 * @param {number} first
 * @param {number} last
 * @param {(line: number) => string} lineAt text of a 1-based line
 * @returns {boolean}
 */
export function selectsSegment(selection, first, last, lineAt) {
  const end = expectedEnd(first, last, lineAt)
  return selection.startLineNumber === first && selection.startColumn === 1 && selection.endLineNumber === end && selection.endColumn === lineAt(end).length + 1
}

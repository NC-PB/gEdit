/** Cursor / selection state reported by MonacoEditor for the status bar. */
export interface CursorInfo {
  line: number;
  column: number;
  /** Characters selected across all selections (0 when nothing is selected). */
  selectedChars: number;
  /** Number of cursors / selections (1 unless multi-cursor is in use). */
  selections: number;
}

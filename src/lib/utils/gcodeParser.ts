export interface StructureItem {
  id: string;
  line: number;
  type: 'tool' | 'comment';
  text: string;
}

export function parseProgramStructure(code: string, language: string): StructureItem[] {
  const lines = code.split('\n');
  const items: StructureItem[] = [];

  lines.forEach((lineText, index) => {
    const lineNumber = index + 1;
    let trimmed = lineText.trim();

    if (!trimmed) return;

    if (language === 'fanuc-gcode') {
      // Fanuc Comment check: Line completely wrapped in parenthesis 
      if (/^\s*\([^)]*\)\s*$/.test(trimmed)) {
        items.push({ id: `fanuc-cmt-${lineNumber}`, line: lineNumber, type: 'comment', text: trimmed });
      } 
      // Fanuc Tool check: "T12 M6" or "M06 T01"
      else if (/(?:\bM0?6\s+T\d+\b)|(?:\bT\d+\s+M0?6\b)/i.test(trimmed)) {
        items.push({ id: `fanuc-tool-${lineNumber}`, line: lineNumber, type: 'tool', text: trimmed });
      }
    } else if (language === 'heidenhain-klartext') {
      // Heidenhain Comment check: ';' with no previous commands (optionally after the block number)
      if (/^(?:\d+\s*)?;/.test(trimmed)) {
        items.push({ id: `heid-cmt-${lineNumber}`, line: lineNumber, type: 'comment', text: trimmed });
      }
      // Heidenhain Tool check: "TOOL CALL..." (optionally after the block number, e.g. "5 TOOL CALL 1 Z S3000")
      else if (/^(?:\d+\s+)?TOOL\s+CALL\b/i.test(trimmed)) {
        items.push({ id: `heid-tool-${lineNumber}`, line: lineNumber, type: 'tool', text: trimmed });
      }
    }
  });

  return items;
}

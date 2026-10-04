// Tool segments: select the lines of one tool, from the outline's tool lines and their
// `endLine` (contrib/segments.ts). Owner: WP10.1 (plan §6 M10); `category`, `group` and
// `selectToolSegment` were pinned by the M10 prelude (P10, §7.13).
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'Navigate',
  /** Caption of the NC-tab ribbon group (`{ tab: 'nc', group: 'segments.group' }`). */
  group: 'Segments',
  /** `nav.selectToolSegment`, `Mod+F7` (§7.13): at the cursor, or for a tool number. */
  selectToolSegment: 'Select Tool Segment',

  /** The tool-number question, asked when the cursor is not inside a tool segment. */
  askTitle: 'Select Tool Segment',
  askLabel: 'Tool',
  askHelp: 'The cursor is not inside a tool segment. Choose the tool to select.',
  /** `tool` is the number as written in the program, `line` where its segment starts. */
  askChoice: 'Tool {tool} (line {line})',
  noTools: 'This program has no tool changes.',
  /** `tool` is the number the caller asked for. */
  noSuchTool: 'No tool segment for tool {tool}.',
  /** A tool used in several places. `count` is how many segments were found. */
  several_one: 'Tool {tool} has 1 segment.',
  several_other: 'Tool {tool} has {count} segments; selected the first after the cursor.',
  /** `tool`, `first` and `last` are the number and its line range. */
  selected: 'Selected the segment of tool {tool}: lines {first} to {last}.',
  selectedNoTool: 'Selected the tool segment: lines {first} to {last}.',
} as const satisfies Messages;

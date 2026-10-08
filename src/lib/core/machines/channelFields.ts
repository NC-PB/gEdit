// The fields of the Channels step (plan §7.15, §7.17, AD-32). Owner: WP12.3.
//
// The same discipline as `fields.ts`: **existing `FieldType`s only** (F46), generated and
// converted by pure functions, so the form (`ChannelsForm.svelte`) is `FormRenderer` over
// these specs and nothing in it is machine-shaped. Two layers, because of the owner's rule of
// 2026-10-07 — "something that makes sense but does not overwhelm the user; the average user
// will be a NC-programmer and not a software engineer":
//
//   plain     `layout`, `rule`   what an NC programmer can fill in: the wait codes as
//                                `M100-M199, M300` with a live preview, the `P` word from a
//                                short list with an example each, two ticks
//   advanced  `layoutAdvanced`,  the patterns (section start, file names, marker) and the
//             `ruleAdvanced`     pattern forms of a rule, behind a disclosure
//
// Two rules the conversions keep:
//
//   1. **Nothing the form does not show is lost.** `ruleFromValues` and `layoutFromValues`
//      start from the stored object and overwrite only what the fields express, so a member
//      a later version adds survives an edit.
//   2. **Nothing is corrected silently.** A wait-code list with a typo is stored as typed;
//      `codesPreview` says what is wrong with which item, and `validateChannels` keeps the
//      block from being saved or used.
//
// The word a control uses for one stream of blocks ("channel", "path", "turret") is read from
// the channel names (`channelNoun`): the first word of the names when every name begins with
// the same one ("Path 1", "Path 2"), else "channel".

import { t } from '$lib/i18n';
import { describeWaitCodes, mergeRanges, parseWaitCodes } from '$lib/core/channels/codes';
import type { ChannelParams, PartnerDecode, SyncRule, SyncSemantics, WhenAbsent } from '$lib/core/channels/types';
import type { FieldSpec } from '$lib/core/forms/types';

/** Field ids; stable, the runtime scenarios read `data-field` (§7.9). */
export const CF = {
  layout: 'layout',
  stopsAndEnds: 'stopsAndEndsWait',
  sectionStart: 'sectionStart',
  sectionEnd: 'sectionEnd',
  sectionSeparator: 'sectionSeparator',
  fileName: 'fileName',
  fileNameFor: 'fileNameFor',
  marker: 'marker',
  label: 'label',
  codes: 'codes',
  semantics: 'semantics',
  blocking: 'blocking',
  partners: 'partners',
  partnerChannels: 'partnerChannels',
  absent: 'whenAbsent',
  absentChannels: 'absentChannels',
  matchKind: 'matchKind',
  prefix: 'prefix',
  idMin: 'idMin',
  idMax: 'idMax',
  pattern: 'pattern',
  address: 'address',
  linePattern: 'linePattern',
  lineSeparator: 'lineSeparator',
  lineDecode: 'lineDecode',
} as const;

/** The layout choice's values; `none` means "remove the block". */
export type LayoutChoice = 'none' | 'single-file' | 'multi-file';
export type PartnersChoice = 'all' | 'fixed' | 'digits' | 'bitmask' | 'line';
export type MatchChoice = 'codes' | 'prefix' | 'regex';
export type AbsentChoice = 'none' | 'all' | 'fixed';

export interface ChannelFieldOptions {
  /** The address letter of a `word` partner rule; default `P`. */
  address?: string;
}

/** The two words a file-name template may hold, written out for the help texts. */
export const TEMPLATE_WORDS = { stem: '{{stem}}', channel: '{{channel}}' } as const;

/** The word of one control for a stream of blocks, from the channel names. */
export function channelNoun(p: Pick<ChannelParams, 'list'> | undefined): { noun: string; nouns: string; Noun: string } {
  let noun = 'channel';
  const names = (p?.list ?? []).map((c) => (typeof c.name === 'string' ? c.name.trim() : ''));
  if (names.length >= 2 && names.every((n) => n !== '')) {
    const first = /^[A-Za-z]+/.exec(names[0])?.[0].toLowerCase();
    if (first !== undefined && names.every((n) => n.toLowerCase().startsWith(first) && /^[A-Za-z]+\b/.test(n))) {
      noun = first;
    }
  }
  return { noun, nouns: `${noun}s`, Noun: noun.charAt(0).toUpperCase() + noun.slice(1) };
}

/** The placeholders every message of this step takes. */
export function nounParams(p: Pick<ChannelParams, 'list'> | undefined, address = 'P'): Record<string, string> {
  return { ...channelNoun(p), address };
}

// ---------------------------------------------------------------------------
// The specs
// ---------------------------------------------------------------------------

/**
 * The fields of the step. `layout` and `rule` are the plain ones; `layoutAdvanced` and
 * `ruleAdvanced` go behind the disclosure. Which of them apply to a given value is decided
 * by `layoutFieldsFor` and `ruleFieldsFor`.
 */
export function channelFields(
  p: ChannelParams | undefined,
  o: ChannelFieldOptions = {},
): { layout: FieldSpec[]; rule: FieldSpec[]; layoutAdvanced: FieldSpec[]; ruleAdvanced: FieldSpec[] } {
  const n = nounParams(p, o.address ?? 'P');
  const channelChoices = (p?.list ?? []).map((c) => ({ label: c.name, value: c.id }));
  const text = (id: string, label: string, help: string): FieldSpec => ({ id, type: 'text', label, help, default: '' });

  const layout: FieldSpec[] = [
    {
      id: CF.layout,
      type: 'choice',
      label: t('machines.channels.layout.label'),
      help: t('machines.channels.layout.help', n),
      default: 'none',
      choices: [
        { label: t('machines.channels.layout.none'), value: 'none' },
        { label: t('machines.channels.layout.singleFile', n), value: 'single-file' },
        { label: t('machines.channels.layout.multiFile', n), value: 'multi-file' },
      ],
    },
    {
      id: CF.stopsAndEnds,
      type: 'bool',
      label: t('machines.channels.stopsAndEnds.label'),
      help: t('machines.channels.stopsAndEnds.help', n),
      default: false,
    },
  ];

  const layoutAdvanced: FieldSpec[] = [
    text(CF.sectionStart, t('machines.channels.advanced.sectionStart'), t('machines.channels.advanced.sectionStartHelp', n)),
    text(CF.sectionEnd, t('machines.channels.advanced.sectionEnd'), t('machines.channels.advanced.sectionEndHelp')),
    text(CF.sectionSeparator, t('machines.channels.advanced.sectionSeparator'), t('machines.channels.advanced.sectionSeparatorHelp', n)),
    text(CF.fileName, t('machines.channels.advanced.fileName'), t('machines.channels.advanced.fileNameHelp')),
    text(CF.fileNameFor, t('machines.channels.advanced.fileNameFor'), t('machines.channels.advanced.fileNameForHelp', TEMPLATE_WORDS)),
    text(CF.marker, t('machines.channels.advanced.marker', n), t('machines.channels.advanced.markerHelp')),
  ];

  const rule: FieldSpec[] = [
    text(CF.label, t('machines.channels.rule.label'), t('machines.channels.rule.labelHelp')),
    text(CF.codes, t('machines.channels.rule.codes'), t('machines.channels.rule.codesHelp')),
    {
      id: CF.partners,
      type: 'choice',
      label: t('machines.channels.rule.partners', n),
      help: t('machines.channels.rule.partnersHelp', n),
      default: 'all',
      choices: [
        { label: t('machines.channels.partners.all', n), value: 'all' },
        { label: t('machines.channels.partners.fixed', n), value: 'fixed' },
        { label: t('machines.channels.partners.digits', n), value: 'digits' },
        { label: t('machines.channels.partners.bitmask', n), value: 'bitmask' },
        { label: t('machines.channels.partners.line', n), value: 'line' },
      ],
    },
    {
      id: CF.partnerChannels,
      type: 'address-list',
      label: t('machines.channels.rule.partnerChannels', n),
      choices: channelChoices,
      default: [],
    },
    {
      id: CF.absent,
      type: 'choice',
      label: t('machines.channels.rule.absent', n),
      help: t('machines.channels.rule.absentHelp', n),
      default: 'none',
      choices: [
        { label: t('machines.channels.absent.none', n), value: 'none' },
        { label: t('machines.channels.absent.all', n), value: 'all' },
        { label: t('machines.channels.absent.fixed', n), value: 'fixed' },
      ],
    },
    {
      id: CF.absentChannels,
      type: 'address-list',
      label: t('machines.channels.rule.absentChannels', n),
      choices: channelChoices,
      default: [],
    },
    {
      id: CF.semantics,
      type: 'choice',
      label: t('machines.channels.rule.semantics'),
      help: t('machines.channels.rule.semanticsHelp'),
      default: 'rendezvous',
      choices: (['rendezvous', 'count', 'ordered'] as const).map((value) => ({
        label: t(`machines.channels.semantics.${value}`, n),
        value,
      })),
    },
    {
      id: CF.blocking,
      type: 'bool',
      label: t('machines.channels.rule.blocking', n),
      help: t('machines.channels.rule.blockingHelp'),
      default: true,
    },
  ];

  const ruleAdvanced: FieldSpec[] = [
    {
      id: CF.matchKind,
      type: 'choice',
      label: t('machines.channels.advanced.matchKind'),
      default: 'codes',
      choices: [
        { label: t('machines.channels.advanced.matchCodes'), value: 'codes' },
        { label: t('machines.channels.advanced.matchPrefix'), value: 'prefix' },
        { label: t('machines.channels.advanced.matchRegex'), value: 'regex' },
      ],
    },
    text(CF.prefix, t('machines.channels.advanced.prefix'), t('machines.channels.advanced.prefixHelp')),
    { id: CF.idMin, type: 'integer', label: t('machines.channels.advanced.idMin'), min: 1, max: 8 },
    { id: CF.idMax, type: 'integer', label: t('machines.channels.advanced.idMax'), min: 1, max: 8 },
    text(CF.pattern, t('machines.channels.advanced.pattern'), t('machines.channels.advanced.patternHelp')),
    text(CF.address, t('machines.channels.advanced.address'), t('machines.channels.advanced.addressHelp', n)),
    text(CF.linePattern, t('machines.channels.advanced.linePattern', n), t('machines.channels.advanced.linePatternHelp')),
    text(CF.lineSeparator, t('machines.channels.advanced.lineSeparator'), t('machines.channels.advanced.lineSeparatorHelp', n)),
    {
      id: CF.lineDecode,
      type: 'choice',
      label: t('machines.channels.advanced.lineDecode'),
      default: 'split',
      choices: [
        { label: t('machines.channels.advanced.decodeSplit'), value: 'split' },
        { label: t('machines.channels.advanced.decodeDigits', n), value: 'digits' },
        { label: t('machines.channels.advanced.decodeBitmask'), value: 'bitmask' },
      ],
    },
  ];

  return { layout, rule, layoutAdvanced, ruleAdvanced };
}

const only = (fields: FieldSpec[], ids: readonly string[]): FieldSpec[] => fields.filter((f) => ids.includes(f.id));

/** The plain layout fields; the stops-and-ends tick only once there are channels. */
export function layoutFieldsFor(p: ChannelParams | undefined, o?: ChannelFieldOptions): FieldSpec[] {
  const { layout } = channelFields(p, o);
  return p === undefined ? only(layout, [CF.layout]) : layout;
}

/** The advanced layout fields this layout uses: the patterns, and only its own. */
export function layoutAdvancedFor(p: ChannelParams | undefined, o?: ChannelFieldOptions): FieldSpec[] {
  const { layoutAdvanced } = channelFields(p, o);
  if (p?.layout === 'single-file') return only(layoutAdvanced, [CF.sectionStart, CF.sectionEnd, CF.sectionSeparator]);
  if (p?.layout === 'multi-file') return only(layoutAdvanced, [CF.fileName, CF.fileNameFor, CF.marker]);
  return [];
}

/**
 * The plain fields of one rule, for the values it holds now: the code list when it matches
 * by codes, the channel pickers only when they are asked for, the "no P word" choice only
 * when the partners come from a word.
 */
export function ruleFieldsFor(p: ChannelParams | undefined, values: Record<string, unknown>, o?: ChannelFieldOptions): FieldSpec[] {
  const { rule } = channelFields(p, o);
  const kind = values[CF.matchKind] ?? 'codes';
  const partners = values[CF.partners];
  const ids: string[] = [CF.label];
  if (kind === 'codes') ids.push(CF.codes);
  ids.push(CF.partners);
  if (partners === 'fixed') ids.push(CF.partnerChannels);
  if (partners === 'digits' || partners === 'bitmask' || partners === 'line') {
    ids.push(CF.absent);
    if (values[CF.absent] === 'fixed') ids.push(CF.absentChannels);
  }
  ids.push(CF.semantics, CF.blocking);
  // The partner choice offers "found by a pattern" only for a rule that already is one.
  return only(rule, ids).map((f) =>
    f.id === CF.partners && partners !== 'line' ? { ...f, choices: f.choices?.filter((c) => c.value !== 'line') } : f,
  );
}

/** The advanced fields of one rule: how its codes are found and, for a pattern, the pattern. */
export function ruleAdvancedFor(p: ChannelParams | undefined, values: Record<string, unknown>, o?: ChannelFieldOptions): FieldSpec[] {
  const { ruleAdvanced } = channelFields(p, o);
  const ids: string[] = [CF.matchKind];
  const kind = values[CF.matchKind] ?? 'codes';
  if (kind === 'prefix') ids.push(CF.prefix, CF.idMin, CF.idMax);
  if (kind === 'regex') ids.push(CF.pattern);
  const partners = values[CF.partners];
  if (partners === 'digits' || partners === 'bitmask') ids.push(CF.address);
  if (partners === 'line') ids.push(CF.linePattern, CF.lineSeparator, CF.lineDecode);
  return only(ruleAdvanced, ids);
}

// ---------------------------------------------------------------------------
// Values <-> stored objects
// ---------------------------------------------------------------------------

/** The values record of the layout fields, advanced ones included. */
export function layoutToValues(p: ChannelParams | undefined): Record<string, unknown> {
  return {
    [CF.layout]: p?.layout ?? 'none',
    [CF.stopsAndEnds]: p?.stopsAndEndsWait === true,
    [CF.sectionStart]: p?.sectionStart ?? '',
    [CF.sectionEnd]: p?.sectionEnd ?? '',
    [CF.sectionSeparator]: p?.sectionSeparator ?? '',
    [CF.fileName]: p?.fileName ?? '',
    [CF.fileNameFor]: p?.fileNameFor ?? '',
    [CF.marker]: p?.marker ?? '',
  };
}

const PATTERN_MEMBERS = {
  'single-file': ['sectionStart', 'sectionEnd', 'sectionSeparator'],
  'multi-file': ['fileName', 'fileNameFor', 'marker'],
} as const;

const OPTIONAL_TEXT = ['sectionEnd', 'sectionSeparator', 'fileName', 'fileNameFor', 'marker'] as const;

/**
 * The block after one edit of the layout fields, or `undefined` for "No channels" (the
 * block is removed; it is the way to say a machine has none). Changing the layout drops the
 * members of the layout it leaves — they are invalid beside the new one — and keeps the
 * channels and the rules.
 */
export function layoutFromValues(values: Record<string, unknown>, base: ChannelParams | undefined): ChannelParams | undefined {
  const layout = values[CF.layout];
  if (layout !== 'single-file' && layout !== 'multi-file') return undefined;
  const next: ChannelParams = {
    list: [],
    syncMarks: [],
    ...(base ?? {}),
    layout,
  };
  const other = layout === 'single-file' ? PATTERN_MEMBERS['multi-file'] : PATTERN_MEMBERS['single-file'];
  const own = PATTERN_MEMBERS[layout] as readonly string[];
  const target = next as unknown as Record<string, unknown>;
  for (const key of other) delete target[key];
  if (layout === 'single-file') {
    next.list = next.list.map((c) => {
      const { fileName: dropped, ...rest } = c;
      void dropped;
      return rest;
    });
  }
  if (layout === 'single-file' && typeof next.sectionStart !== 'string') next.sectionStart = '';
  for (const key of OPTIONAL_TEXT) {
    if (!own.includes(key)) continue;
    const raw = values[key];
    if (raw === undefined) continue;
    if (typeof raw === 'string' && raw !== '') target[key] = raw;
    else delete target[key];
  }
  if (typeof values[CF.sectionStart] === 'string' && layout === 'single-file') next.sectionStart = values[CF.sectionStart] as string;
  if (values[CF.stopsAndEnds] === true) next.stopsAndEndsWait = true;
  else if (base?.stopsAndEndsWait !== undefined) next.stopsAndEndsWait = false;
  return next;
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function absentChoice(w: WhenAbsent | undefined): { choice: AbsentChoice; channels: string[] } {
  if (w === undefined || w.kind === 'none') return { choice: 'none', channels: [] };
  if (w.kind === 'all') return { choice: 'all', channels: [] };
  return { choice: 'fixed', channels: ids(w.channels) };
}

/** The values record of one rule's fields. */
export function ruleToValues(rule: SyncRule): Record<string, unknown> {
  const values: Record<string, unknown> = {
    [CF.label]: rule.label ?? '',
    [CF.semantics]: rule.semantics ?? 'rendezvous',
    [CF.blocking]: rule.blocking !== false,
    [CF.matchKind]: rule.match.kind,
    [CF.codes]: rule.match.kind === 'codes' ? rule.match.codes : '',
    [CF.prefix]: rule.match.kind === 'prefix' ? rule.match.prefix : '',
    [CF.idMin]: rule.match.kind === 'prefix' ? rule.match.idDigits?.min : undefined,
    [CF.idMax]: rule.match.kind === 'prefix' ? rule.match.idDigits?.max : undefined,
    [CF.pattern]: rule.match.kind === 'regex' ? rule.match.pattern : '',
    [CF.address]: 'P',
    [CF.linePattern]: '',
    [CF.lineSeparator]: '',
    [CF.lineDecode]: 'split',
    [CF.partnerChannels]: [],
    [CF.absent]: 'none',
    [CF.absentChannels]: [],
  };
  const partners = rule.partners;
  values[CF.partners] = partners.kind === 'word' ? partners.decode : partners.kind;
  if (partners.kind === 'fixed') values[CF.partnerChannels] = ids(partners.channels);
  if (partners.kind === 'word' || partners.kind === 'line') {
    const a = absentChoice(partners.whenAbsent);
    values[CF.absent] = a.choice;
    values[CF.absentChannels] = a.channels;
  }
  if (partners.kind === 'word') values[CF.address] = partners.address;
  if (partners.kind === 'line') {
    values[CF.linePattern] = partners.pattern;
    values[CF.lineSeparator] = partners.separator ?? '';
    values[CF.lineDecode] = partners.decode ?? 'split';
  }
  return values;
}

function whenAbsentOf(values: Record<string, unknown>): WhenAbsent {
  const choice = values[CF.absent];
  if (choice === 'all') return { kind: 'all' };
  if (choice === 'fixed') return { kind: 'fixed', channels: ids(values[CF.absentChannels]) };
  return { kind: 'none' };
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * The rule after an edit. Members the form does not show survive; `semantics` and `blocking`
 * are written only when they differ from their defaults or were already written, so a
 * plain rule stays short in the file.
 */
export function ruleFromValues(values: Record<string, unknown>, base?: SyncRule): SyncRule {
  const rule: SyncRule = { ...(base ?? { id: '', label: '', match: { kind: 'codes', codes: '' }, partners: { kind: 'all' } }) };
  rule.label = text(values[CF.label]);

  const kind = values[CF.matchKind];
  const oldMatch = base?.match as Record<string, unknown> | undefined;
  const keep = oldMatch !== undefined && oldMatch.kind === kind ? oldMatch : {};
  if (kind === 'prefix') {
    const min = values[CF.idMin];
    const max = values[CF.idMax];
    const match: Record<string, unknown> = { ...keep, kind: 'prefix', prefix: text(values[CF.prefix]) };
    if (typeof min === 'number' || typeof max === 'number') {
      match.idDigits = { min: typeof min === 'number' ? min : 1, max: typeof max === 'number' ? max : 8 };
    } else delete match.idDigits;
    rule.match = match as unknown as SyncRule['match'];
  } else if (kind === 'regex') {
    rule.match = { ...keep, kind: 'regex', pattern: text(values[CF.pattern]) } as SyncRule['match'];
  } else {
    rule.match = { ...keep, kind: 'codes', codes: text(values[CF.codes]) } as SyncRule['match'];
  }

  const choice = values[CF.partners];
  const oldPartners = base?.partners as Record<string, unknown> | undefined;
  const keepP = (k: string): Record<string, unknown> => (oldPartners !== undefined && oldPartners.kind === k ? oldPartners : {});
  if (choice === 'fixed') {
    rule.partners = { ...keepP('fixed'), kind: 'fixed', channels: ids(values[CF.partnerChannels]) } as SyncRule['partners'];
  } else if (choice === 'digits' || choice === 'bitmask') {
    rule.partners = {
      ...keepP('word'),
      kind: 'word',
      address: text(values[CF.address]) || 'P',
      decode: choice,
      whenAbsent: whenAbsentOf(values),
    } as SyncRule['partners'];
  } else if (choice === 'line') {
    const partners: Record<string, unknown> = {
      ...keepP('line'),
      kind: 'line',
      pattern: text(values[CF.linePattern]),
      decode: (values[CF.lineDecode] as PartnerDecode | undefined) ?? 'split',
      whenAbsent: whenAbsentOf(values),
    };
    const sep = text(values[CF.lineSeparator]);
    if (sep !== '') partners.separator = sep;
    else delete partners.separator;
    rule.partners = partners as unknown as SyncRule['partners'];
  } else {
    rule.partners = { ...keepP('all'), kind: 'all' } as SyncRule['partners'];
  }

  const sem = (values[CF.semantics] as SyncSemantics | undefined) ?? 'rendezvous';
  if (sem !== 'rendezvous' || base?.semantics !== undefined) rule.semantics = sem;
  else delete rule.semantics;
  if (values[CF.blocking] === false) rule.blocking = false;
  else if (base?.blocking !== undefined) rule.blocking = true;
  else delete rule.blocking;
  return rule;
}

// ---------------------------------------------------------------------------
// The live preview of the code list
// ---------------------------------------------------------------------------

export interface CodesPreview {
  state: 'empty' | 'ok' | 'error';
  /** `Matches M100 … M199 (100 codes), M300 — 101 codes in all`; `ok` only. */
  text: string;
  /** Plain-language errors, each quoting the bad item; `error` and `empty` only. */
  errors: string[];
  count: number;
}

/** What the wait-code field says under itself as the user types. */
export function codesPreview(source: string, letters?: readonly string[]): CodesPreview {
  const parsed = parseWaitCodes(source, { letters });
  if (parsed.errors.length > 0) {
    const empty = parsed.errors.length === 1 && parsed.errors[0].key === 'channels.codes.empty';
    return {
      state: empty ? 'empty' : 'error',
      text: '',
      errors: parsed.errors.map((e) => t(e.key, e.params)),
      count: 0,
    };
  }
  const merged = mergeRanges(parsed.ranges);
  const items = merged.map((r) => {
    if (r.from === r.to) return `${r.letter}${r.from}`;
    const n = r.to - r.from + 1;
    return `${r.letter}${r.from} … ${r.letter}${r.to} (${t('machines.channels.codes.many', { count: n })})`;
  });
  const { count } = describeWaitCodes(merged);
  let line = t('machines.channels.codes.matches', { items: items.join(', ') });
  if (merged.length > 1 || (merged[0] && merged[0].from !== merged[0].to)) {
    line += ` — ${t('machines.channels.codes.all', { count })}`;
  }
  return { state: 'ok', text: line, errors: [], count };
}

// ---------------------------------------------------------------------------
// Small builders the form uses
// ---------------------------------------------------------------------------

/** A channel id nobody has used, `1`, `2`, …, and its name in the control's own word. */
export function newChannel(p: ChannelParams | undefined): { id: string; name: string } {
  const used = new Set((p?.list ?? []).map((c) => String(c.id).toLowerCase()));
  let number = (p?.list.length ?? 0) + 1;
  while (used.has(String(number))) number++;
  const { Noun } = channelNoun(p);
  return { id: String(number), name: t('machines.channels.list.newName', { Noun, number }) };
}

/** A rule id nobody has used. */
export function newRuleId(p: ChannelParams | undefined): string {
  const used = new Set((p?.syncMarks ?? []).map((r) => r.id));
  let n = used.size + 1;
  while (used.has(`rule-${n}`)) n++;
  return `rule-${n}`;
}

/** A new wait rule: an empty code list, every channel, numbered waits. */
export function newRule(p: ChannelParams | undefined): SyncRule {
  const number = (p?.syncMarks.length ?? 0) + 1;
  return {
    id: newRuleId(p),
    label: t('machines.channels.rules.newLabel', { number }),
    match: { kind: 'codes', codes: '' },
    partners: { kind: 'all' },
  };
}

/** A block to start from once the user picks a layout: two channels, no rules. */
export function blankChannels(layout: 'single-file' | 'multi-file'): ChannelParams {
  const a = newChannel(undefined);
  const p: ChannelParams = { layout, list: [{ id: a.id, name: a.name }], syncMarks: [] };
  const b = newChannel(p);
  p.list.push({ id: b.id, name: b.name });
  if (layout === 'single-file') p.sectionStart = '';
  return p;
}

/** `(?<channel>…)` over every spelling of every channel, so the start line holds one of them. */
export function sectionStartFromNames(p: ChannelParams): string {
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
  const anyAlias = p.list.some((c) => (c.aliases ?? []).length > 0);
  const names = p.list.flatMap((c) => (anyAlias ? (c.aliases ?? []) : [c.id]));
  return `(?<![A-Za-z0-9_.])(?<channel>${[...new Set(names)].map(esc).join('|')})(?![A-Za-z0-9_.])`;
}

/** `G13, G14` ⇄ `['G13', 'G14']`: the "also written as" box. Blanks around items are dropped. */
export function aliasesFromText(text: string): string[] {
  return text
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter((a) => a !== '');
}

export function aliasesToText(aliases: readonly string[] | undefined): string {
  return (aliases ?? []).join(', ');
}

// ---------------------------------------------------------------------------
// The edits the form makes, pure so they are tested without a window
// ---------------------------------------------------------------------------

/** The block after the user changed one layout field; `undefined` = "No channels". */
export function applyLayoutEdit(value: ChannelParams | undefined, id: string, v: unknown): ChannelParams | undefined {
  if (id === CF.layout) {
    if (v !== 'single-file' && v !== 'multi-file') return undefined;
    if (value === undefined) return blankChannels(v);
  }
  return layoutFromValues({ ...layoutToValues(value), [id]: v }, value);
}

/** The block after the user changed one field of rule `index`. */
export function applyRuleEdit(value: ChannelParams, index: number, id: string, v: unknown): ChannelParams {
  const base = value.syncMarks[index];
  if (base === undefined) return value;
  const rule = ruleFromValues({ ...ruleToValues(base), [id]: v }, base);
  return { ...value, syncMarks: value.syncMarks.map((r, k) => (k === index ? rule : r)) };
}

/** A copy of `list` with item `i` moved by one place; the list itself when it cannot move. */
export function moveIn<T>(list: readonly T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  const out = [...list];
  if (i < 0 || i >= out.length || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

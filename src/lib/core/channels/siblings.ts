// The file names of the other channels of a `multi-file` document, and which channel a
// document is, pure (plan §7.17, AD-32, F57). Implemented by the M12 prelude (P12); owned
// and hardened by WP12.1.
//
// No I/O: the names are computed from the base name and the machine's patterns, and only
// then asked about, metadata only, through `channel_siblings` (§7.10). Three sources, per
// channel, in this order: the channel's own `list[].fileName` template, the shared
// `fileNameFor` template, the `fileName` pattern with its `channel` capture replaced by the
// other channel's id. A name that cannot be derived is answered `name: null` — reported by
// the caller, never guessed (§7.16 #150). Names are compared case-insensitively, as
// `docs.byPath` does on macOS and Windows.
//
// Never guessed either: a base name two per-channel templates explain equally well (the
// same literal length) is no channel file; a derived name that is the document's own name,
// or another sibling's, is `null`; a header `marker` that contradicts the file name wins,
// and the contradiction is a problem (`documentChannel`).

import type { CompiledProfile } from '$lib/core/profiles/types';
import { channelRefs, readMarker, resolveChannelToken } from './resolve';
import type { ChannelBudget, ChannelParams, ChannelProblem, ChannelRef } from './types';

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `{{stem}}` and `{{channel}}` filled in; anything else in braces is left as written. One pass
 *  with a callback (M12 review fix CODE-11): a stem holding `$&` or `{{channel}}` is inserted
 *  exactly as it is. */
export function fillTemplate(template: string, stem: string, channel: string): string {
  return template.replace(/\{\{(stem|channel)\}\}/g, (_, word: string) => (word === 'stem' ? stem : channel));
}

/** A template as a regex over a base name: the literal parts escaped, `{{stem}}` captured. */
function templateRe(template: string, channelId: string): RegExp | null {
  if (!template.includes('{{stem}}')) return null;
  const parts = template.split(/(\{\{stem\}\}|\{\{channel\}\})/);
  const source = parts
    .map((part) => (part === '{{stem}}' ? '(?<stem>.+)' : part === '{{channel}}' ? escapeRe(channelId) : escapeRe(part)))
    .join('');
  try {
    return new RegExp(`^${source}$`, 'i');
  } catch {
    return null;
  }
}

function plainName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[/\\:*?"<>|\u0000-\u001f]/.test(name);
}

function list(p: ChannelParams): ChannelParams['list'] {
  return Array.isArray(p.list) ? p.list : [];
}

/**
 * Which channel `baseName` is, and its stem: by the `fileName` pattern first, then by the
 * per-channel templates (the one with the longest literal part wins, so `PART_GS.MPF` is
 * the `{{stem}}_GS.MPF` channel and not the `{{stem}}.MPF` one with stem `PART_GS`). Two
 * templates of different channels that explain the name equally well answer null.
 */
export function fileChannel(
  baseName: string,
  p: ChannelParams,
): { channel: ChannelRef; stem: string; by: 'pattern' | 'template'; match?: RegExpExecArray } | null {
  if (p.layout !== 'multi-file') return null;
  if (typeof p.fileName === 'string') {
    try {
      const m = new RegExp(p.fileName, 'id').exec(baseName);
      const token = m?.groups?.channel;
      if (m && typeof token === 'string') {
        const ref = resolveChannelToken(p, token);
        if (ref !== null) return { channel: ref, stem: m.groups?.stem ?? '', by: 'pattern', match: m };
      }
    } catch {
      // A pattern that does not compile matches nothing; WP12.3 reports it.
    }
  }
  const refs = channelRefs(p);
  let best: { channel: ChannelRef; stem: string; literal: number } | null = null;
  let tie = false;
  list(p).forEach((c, i) => {
    if (typeof c?.fileName !== 'string') return;
    const re = templateRe(c.fileName, String(c.id));
    const stem = re?.exec(baseName)?.groups?.stem;
    if (typeof stem !== 'string') return;
    const literal = baseName.length - stem.length;
    if (best === null || literal > best.literal) {
      best = { channel: refs[i], stem, literal };
      tie = false;
    } else if (literal === best.literal && best.channel.index !== i) tie = true;
  });
  const found = best as { channel: ChannelRef; stem: string; literal: number } | null;
  return found && !tie ? { channel: found.channel, stem: found.stem, by: 'template' } : null;
}

/**
 * The names of the OTHER declared channels of `baseName`'s set, in declared order; `null`
 * when the name is not a channel file of this machine (the user may still assign it by
 * hand, WP12.5). `self` is the channel the document really is when that is not the one its
 * name says (a header `marker` that disagrees, or the user's assignment): that channel is
 * left out instead, and the name's own channel is listed like any other.
 *
 * A `name: null` entry could not be derived, and is never guessed: no template and no
 * `channel` capture to replace; a capture that holds an ALIAS rather than the id (`_A` for
 * channel `1`: which spelling the other file uses is not known, so a template is needed);
 * a name with a path separator or a character no file name may hold; or a name that is the
 * document's own or another sibling's (a template without `{{channel}}`).
 */
export function siblingNames(
  baseName: string,
  p: ChannelParams,
  self?: string,
): { channel: ChannelRef; name: string | null }[] | null {
  const named = fileChannel(baseName, p);
  if (named === null) return null;
  const selfRef = typeof self === 'string' ? (resolveChannelToken(p, self) ?? named.channel) : named.channel;
  const capture = named.match?.indices?.groups?.channel;
  const captured = named.match?.groups?.channel?.trim().toLowerCase();
  const derived = channelRefs(p)
    .filter((ref) => ref.id !== selfRef.id)
    .map((ref) => {
      const own = list(p)[ref.index]?.fileName;
      let name: string | null = null;
      if (typeof own === 'string') name = fillTemplate(own, named.stem, ref.id);
      else if (typeof p.fileNameFor === 'string') name = fillTemplate(p.fileNameFor, named.stem, ref.id);
      else if (capture && captured === named.channel.id.toLowerCase()) {
        const [from, to] = capture;
        name = baseName.slice(0, from) + ref.id + baseName.slice(to);
      }
      return { channel: ref, name: name !== null && plainName(name) ? name : null };
    });
  const seen = new Map<string, number>();
  seen.set(baseName.toLowerCase(), 2);
  for (const d of derived) if (d.name !== null) seen.set(d.name.toLowerCase(), (seen.get(d.name.toLowerCase()) ?? 0) + 1);
  return derived.map((d) => (d.name !== null && (seen.get(d.name.toLowerCase()) ?? 0) > 1 ? { ...d, name: null } : d));
}

/** Which channel a `multi-file` document is, without the user's own assignment (WP12.5). */
export interface DocumentChannel {
  channel: ChannelRef | null;
  /** `marker` when the header named it (it wins), `fileName` when only the name did. */
  by: 'fileName' | 'marker' | null;
  /** From the file name; `''` when the name is no channel file. */
  stem: string;
  /** The marker's own problems, and a marker that contradicts the file name. */
  problems: ChannelProblem[];
  /** M12 review fix CODE-1: the marker read ran past `o.deadline`; `channel` is then null. */
  abandoned?: boolean;
}

/**
 * The channel a `multi-file` document is, from its base name and its header (§7.17): the
 * `marker` wins over the file name when both answer, and a disagreement is a problem
 * (`channels.problems.markerDisagrees`), never a silent choice. The user's assignment by
 * hand (`channels.assign`) is the service's to put on top. A header that matched the
 * `marker` pattern but named no declared channel, or named two, answers no channel at all:
 * the file name does not stand in for a header that says something else.
 */
export function documentChannel(
  baseName: string,
  lines: readonly string[],
  cp: CompiledProfile,
  p: ChannelParams,
  o?: ChannelBudget,
): DocumentChannel {
  if (p.layout !== 'multi-file') return { channel: null, by: null, stem: '', problems: [] };
  const byName = fileChannel(baseName, p);
  const marker = readMarker(lines, cp, p, o);
  const problems = [...marker.problems];
  const stem = byName?.stem ?? '';
  if (marker.abandoned === true) return { channel: null, by: null, stem, problems, abandoned: true };
  if (marker.channel !== null) {
    if (byName !== null && byName.channel.id !== marker.channel.id) {
      problems.push({
        path: `line:${marker.line}`,
        message: {
          key: 'channels.problems.markerDisagrees',
          params: { line: marker.line ?? 0, marker: marker.channel.name, fileName: byName.channel.name },
        },
      });
    }
    return { channel: marker.channel, by: 'marker', stem, problems };
  }
  // The header spoke but named no channel for certain (an undeclared token, or two
  // channels): it would win if it could be read, so the file name does not stand in for it.
  if (marker.problems.some((problem) => problem.path.startsWith('line:'))) {
    return { channel: null, by: null, stem, problems };
  }
  return { channel: byName?.channel ?? null, by: byName ? 'fileName' : null, stem, problems };
}

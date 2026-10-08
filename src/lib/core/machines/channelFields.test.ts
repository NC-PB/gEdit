// The Channels step's field model (WP12.3, plan §7.15, §7.17): existing FieldTypes only, plain
// labels in the control's own word, a live preview of the wait codes with errors that quote the
// bad item, and conversions that lose nothing the form does not show.

import { describe, expect, it } from 'vitest';
import { profiles } from '$lib/stores/profiles';
import { hasKey } from '$lib/i18n';
import type { ChannelParams, SyncRule } from '$lib/core/channels/types';
import type { FieldType } from '$lib/core/forms/types';
import {
  CF,
  aliasesFromText,
  aliasesToText,
  applyLayoutEdit,
  applyRuleEdit,
  blankChannels,
  channelFields,
  channelNoun,
  codesPreview,
  layoutAdvancedFor,
  layoutFieldsFor,
  layoutFromValues,
  layoutToValues,
  moveIn,
  newChannel,
  newRule,
  ruleAdvancedFor,
  ruleFieldsFor,
  ruleFromValues,
  ruleToValues,
  sectionStartFromNames,
} from './channelFields';
import { validateChannels } from './validate';

const ALLOWED: FieldType[] = ['text', 'choice', 'integer', 'bool', 'address-list'];

const fanuc = (): ChannelParams => {
  const p = profiles.profile('fanuc-lathe').machineParams?.channels?.presets.find((x) => x.id === 'fanuc-3path-digits');
  return structuredClone(p!.value);
};
const okuma = (): ChannelParams =>
  structuredClone(profiles.profile('okuma-osp').machineParams!.channels!.presets[0].value);

describe('channelFields', () => {
  it('uses only existing field types and gives every field a label', () => {
    const f = channelFields(fanuc());
    for (const spec of [...f.layout, ...f.rule, ...f.layoutAdvanced, ...f.ruleAdvanced]) {
      expect(ALLOWED, spec.id).toContain(spec.type);
      expect(spec.label, spec.id).toMatch(/\S/);
    }
  });

  it('puts the plain things first: a code field, a P-word dropdown with an example each, two ticks', () => {
    const f = channelFields(fanuc());
    const codes = f.rule.find((x) => x.id === CF.codes)!;
    expect(codes.type).toBe('text');
    expect(codes.help).toContain('M100-M199, M300');
    const partners = f.rule.find((x) => x.id === CF.partners)!;
    expect(partners.type).toBe('choice');
    const labels = partners.choices!.map((c) => c.label);
    expect(labels.some((l) => l.includes('P12') && l.includes('0 = path 10'))).toBe(true);
    expect(labels.some((l) => l.includes('P3') && l.includes('1 + 2'))).toBe(true);
    expect(f.layout.find((x) => x.id === CF.stopsAndEnds)?.type).toBe('bool');
    expect(f.layout.find((x) => x.id === CF.stopsAndEnds)?.default).toBe(false);
  });

  it('says what each check kind checks', () => {
    const sem = channelFields(fanuc()).rule.find((x) => x.id === CF.semantics)!;
    expect(sem.choices!.map((c) => c.value)).toEqual(['rendezvous', 'count', 'ordered']);
    expect(sem.choices![1].label).toMatch(/without a number/);
    expect(sem.choices![2].label).toMatch(/must not go down/);
  });

  it('speaks the control’s own word: path, turret, channel', () => {
    expect(channelNoun(fanuc()).noun).toBe('path');
    expect(channelNoun(okuma()).noun).toBe('turret');
    expect(channelNoun({ list: [{ id: 'a', name: 'Main' }, { id: 'b', name: 'Sub' }] }).noun).toBe('channel');
    expect(channelNoun(undefined).noun).toBe('channel');
    expect(channelFields(okuma()).rule.find((x) => x.id === CF.partners)!.choices![2].label).toContain('turret numbers');
    expect(channelFields(fanuc()).rule.find((x) => x.id === CF.partners)!.choices![2].label).toContain('paths 1 and 2');
  });

  it('offers the address-list pickers over the declared channels', () => {
    const pick = channelFields(fanuc()).rule.find((x) => x.id === CF.partnerChannels)!;
    expect(pick.choices).toEqual([
      { label: 'Path 1', value: '1' },
      { label: 'Path 2', value: '2' },
      { label: 'Path 3', value: '3' },
    ]);
  });

  it('ends the layout choices with the control\'s own word, never with a dangling "for each" (CODE-3)', () => {
    const labels = (p: ChannelParams | undefined) => channelFields(p).layout.find((x) => x.id === CF.layout)!.choices!.map((c) => c.label);
    expect(labels(fanuc()).slice(1)).toEqual(['All in one program, one section for each path', 'One program for each path']);
    expect(labels(okuma()).slice(1).map((l) => l.split(' ').pop())).toEqual(['turret', 'turret']);
    expect(labels(undefined).slice(1).map((l) => l.split(' ').pop())).toEqual(['channel', 'channel']);
  });

  it('shows the layout fields: only the choice until there are channels', () => {
    expect(layoutFieldsFor(undefined).map((f) => f.id)).toEqual([CF.layout]);
    expect(layoutFieldsFor(fanuc()).map((f) => f.id)).toEqual([CF.layout, CF.stopsAndEnds]);
  });

  it('shows the patterns of the layout in use, and only those', () => {
    expect(layoutAdvancedFor(okuma()).map((f) => f.id)).toEqual([CF.sectionStart, CF.sectionEnd, CF.sectionSeparator]);
    expect(layoutAdvancedFor(fanuc()).map((f) => f.id)).toEqual([CF.fileName, CF.fileNameFor, CF.marker]);
    expect(layoutAdvancedFor(undefined)).toEqual([]);
  });

  it('shows a rule’s fields by what it holds', () => {
    const p = fanuc();
    const plain = (rule: SyncRule) => ruleFieldsFor(p, ruleToValues(rule)).map((f) => f.id);
    expect(plain({ id: 'r', label: 'R', match: { kind: 'codes', codes: 'M1' }, partners: { kind: 'all' } })).toEqual([
      CF.label, CF.codes, CF.partners, CF.semantics, CF.blocking,
    ]);
    expect(plain({ id: 'r', label: 'R', match: { kind: 'codes', codes: 'M1' }, partners: { kind: 'fixed', channels: ['1'] } })).toContain(CF.partnerChannels);
    const word = { id: 'r', label: 'R', match: { kind: 'codes', codes: 'M1' }, partners: { kind: 'word', address: 'P', decode: 'digits', whenAbsent: { kind: 'fixed', channels: ['1'] } } } as SyncRule;
    expect(plain(word)).toEqual([CF.label, CF.codes, CF.partners, CF.absent, CF.absentChannels, CF.semantics, CF.blocking]);
    const regex = { id: 'r', label: 'R', match: { kind: 'regex', pattern: 'x' }, partners: { kind: 'all' } } as SyncRule;
    expect(plain(regex)).not.toContain(CF.codes);
    expect(ruleAdvancedFor(p, ruleToValues(regex)).map((f) => f.id)).toEqual([CF.matchKind, CF.pattern]);
    expect(ruleAdvancedFor(p, ruleToValues(word)).map((f) => f.id)).toEqual([CF.matchKind, CF.address]);
    // "found by a pattern" is offered only to a rule that already is one
    const line = { id: 'r', label: 'R', match: { kind: 'codes', codes: 'M1' }, partners: { kind: 'line', pattern: '(?<channels>.)' } } as SyncRule;
    const choices = (rule: SyncRule) => ruleFieldsFor(p, ruleToValues(rule)).find((f) => f.id === CF.partners)!.choices!.map((c) => c.value);
    expect(choices(line)).toContain('line');
    expect(choices(word)).not.toContain('line');
  });

  it('has every message key it uses', () => {
    for (const key of ['machines.channels.title', 'machines.channels.preset.verify', 'machines.channels.codes.matches', 'machines.channels.advanced.regexHelp']) {
      expect(hasKey(key), key).toBe(true);
    }
  });
});

describe('codesPreview', () => {
  it('previews ranges with their size and the total', () => {
    const p = codesPreview('M100-M199, M300');
    expect(p.state).toBe('ok');
    expect(p.text).toBe('Matches M100 … M199 (100 codes), M300 — 101 codes in all');
    expect(p.count).toBe(101);
    expect(codesPreview('M300').text).toBe('Matches M300');
  });

  it('is empty for no text and quotes the bad item otherwise, in plain words', () => {
    expect(codesPreview('  ').state).toBe('empty');
    const bad = codesPreview('M100-M199, M3OO');
    expect(bad.state).toBe('error');
    expect(bad.errors).toEqual(['“M3OO”: not a number.']);
    expect(codesPreview('M199-M100').errors[0]).toContain('runs backwards');
    expect(codesPreview('X5', ['M']).errors[0]).toBe('“X5”: wait codes on this control use M.');
    expect(codesPreview('M1 M2O M3O').errors).toHaveLength(2);
  });
});

describe('values and stored objects', () => {
  it('round-trips a rule and keeps members the form does not show', () => {
    const rule = { id: 'x', label: 'L', match: { kind: 'codes', codes: 'M900-M999', future: 1 }, partners: { kind: 'word', address: 'P', decode: 'digits', whenAbsent: { kind: 'none' }, extra: true }, semantics: 'count', note: 'kept' } as unknown as SyncRule;
    expect(ruleFromValues(ruleToValues(rule), rule)).toEqual(rule);
  });

  it('writes semantics and blocking only when they differ from the defaults', () => {
    const base = newRule(undefined);
    const plain = ruleFromValues({ ...ruleToValues(base) }, base);
    expect('semantics' in plain).toBe(false);
    expect('blocking' in plain).toBe(false);
    const edited = ruleFromValues({ ...ruleToValues(base), [CF.semantics]: 'ordered', [CF.blocking]: false }, base);
    expect(edited).toMatchObject({ semantics: 'ordered', blocking: false });
  });

  it('converts the partner choices both ways', () => {
    const base = newRule(undefined);
    const to = (choice: string, extra: Record<string, unknown> = {}) => ruleFromValues({ ...ruleToValues(base), [CF.partners]: choice, ...extra }, base).partners;
    expect(to('all')).toEqual({ kind: 'all' });
    expect(to('fixed', { [CF.partnerChannels]: ['1', '2'] })).toEqual({ kind: 'fixed', channels: ['1', '2'] });
    expect(to('digits')).toEqual({ kind: 'word', address: 'P', decode: 'digits', whenAbsent: { kind: 'none' } });
    expect(to('bitmask', { [CF.absent]: 'fixed', [CF.absentChannels]: ['1', '2'] })).toEqual({
      kind: 'word', address: 'P', decode: 'bitmask', whenAbsent: { kind: 'fixed', channels: ['1', '2'] },
    });
    expect(to('line', { [CF.linePattern]: '(?<channels>.)', [CF.lineDecode]: 'digits', [CF.lineSeparator]: ';' })).toEqual({
      kind: 'line', pattern: '(?<channels>.)', decode: 'digits', whenAbsent: { kind: 'none' }, separator: ';',
    });
    expect(ruleToValues({ ...base, partners: { kind: 'word', address: 'P', decode: 'bitmask' } })[CF.partners]).toBe('bitmask');
  });

  it('converts the match choices: prefix digits and a pattern', () => {
    const base = newRule(undefined);
    const to = (extra: Record<string, unknown>) => ruleFromValues({ ...ruleToValues(base), ...extra }, base).match;
    expect(to({ [CF.matchKind]: 'prefix', [CF.prefix]: 'M1', [CF.idMin]: 2, [CF.idMax]: 2 })).toEqual({ kind: 'prefix', prefix: 'M1', idDigits: { min: 2, max: 2 } });
    expect(to({ [CF.matchKind]: 'prefix', [CF.prefix]: 'M1' })).toEqual({ kind: 'prefix', prefix: 'M1' });
    expect(to({ [CF.matchKind]: 'regex', [CF.pattern]: 'x(?<mark>1)' })).toEqual({ kind: 'regex', pattern: 'x(?<mark>1)' });
  });

  it('applies a rule edit and stores a typo as typed (the preview and validation say so)', () => {
    const p = fanuc();
    const next = applyRuleEdit(p, 0, CF.codes, 'M9O0');
    expect((next.syncMarks[0].match as { codes: string }).codes).toBe('M9O0');
    expect(validateChannels(next, 'c', null, { waitLetters: ['M'] })[0].message).toBe('“M9O0”: not a number.');
    expect(p.syncMarks[0].match).not.toEqual(next.syncMarks[0].match); // the input is not mutated
    expect(applyRuleEdit(p, 9, CF.codes, 'x')).toBe(p);
  });

  it('round-trips the layout and drops what the other layout owns', () => {
    const p = okuma();
    expect(layoutFromValues(layoutToValues(p), p)).toEqual(p);
    const toMulti = applyLayoutEdit(p, CF.layout, 'multi-file')!;
    expect(toMulti.layout).toBe('multi-file');
    expect('sectionStart' in toMulti).toBe(false);
    expect(toMulti.list).toEqual(p.list);
    expect(toMulti.syncMarks).toEqual(p.syncMarks);
    const back = applyLayoutEdit(fanuc(), CF.layout, 'single-file')!;
    expect(back.list.every((c) => !('fileName' in c))).toBe(true);
    expect('fileName' in back).toBe(false);
  });

  it('removes the block for "No channels" and starts a blank two-channel block otherwise', () => {
    expect(applyLayoutEdit(okuma(), CF.layout, 'none')).toBeUndefined();
    const blank = applyLayoutEdit(undefined, CF.layout, 'multi-file')!;
    expect(blank.list).toHaveLength(2);
    expect(blank.list.map((c) => c.id)).toEqual(['1', '2']);
    expect(validateChannels(blank, 'c', null)).toEqual([]);
    expect(blankChannels('single-file').sectionStart).toBe('');
  });

  it('writes the stops-and-ends tick, and leaves the member out while it was never set', () => {
    const p = okuma();
    delete p.stopsAndEndsWait;
    expect(applyLayoutEdit(p, CF.stopsAndEnds, false)!.stopsAndEndsWait).toBeUndefined();
    expect(applyLayoutEdit(p, CF.stopsAndEnds, true)!.stopsAndEndsWait).toBe(true);
    expect(applyLayoutEdit({ ...p, stopsAndEndsWait: true }, CF.stopsAndEnds, false)!.stopsAndEndsWait).toBe(false);
  });
});

describe('small builders', () => {
  it('numbers new channels in the control’s word, skipping used ids', () => {
    expect(newChannel(fanuc())).toEqual({ id: '4', name: 'Path 4' });
    expect(newChannel({ list: [{ id: '2', name: 'Turret A' }, { id: '3', name: 'Turret B' }] } as ChannelParams)).toEqual({ id: '4', name: 'Turret 4' });
  });

  it('gives new rules a fresh id', () => {
    const p = fanuc();
    const r = newRule(p);
    expect(p.syncMarks.map((x) => x.id)).not.toContain(r.id);
    expect(r.match).toEqual({ kind: 'codes', codes: '' });
  });

  it('builds a section start over every spelling of the channels, and it validates', () => {
    const p = okuma();
    const src = sectionStartFromNames(p);
    expect(src).toContain('(?<channel>G13|G013|G14|G014)');
    const re = new RegExp(src, 'i');
    expect(re.exec('G13')?.groups?.channel).toBe('G13');
    expect(re.test('G130')).toBe(false);
    expect(validateChannels({ ...p, sectionStart: src }, 'c', null, { waitLetters: ['M', 'P'] })).toEqual([]);
    const noAlias = sectionStartFromNames({ ...p, list: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
    expect(noAlias).toContain('(?<channel>a|b)');
  });

  it('reads and writes the aliases box', () => {
    expect(aliasesFromText(' G13 , G14;;')).toEqual(['G13', 'G14']);
    expect(aliasesFromText('')).toEqual([]);
    expect(aliasesToText(['G13', 'G14'])).toBe('G13, G14');
    expect(aliasesToText(undefined)).toBe('');
  });

  it('moves list items and leaves the edges alone', () => {
    expect(moveIn([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveIn([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveIn([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });
});

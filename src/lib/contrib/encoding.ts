// Encoding and line endings: the two status items and the pickers behind them
// (plan §5 WP1.6, §7.9, AD-7). One feature per file (plan AD-3); see ./README.md.
//
// Neither command re-reads the file: they change how the document is written back, which
// is why both mark it modified. A file that was read as Windows-1252 and is then written
// as UTF-8 keeps its characters; one written the other way round may not, and the save
// itself asks about that (`app/fileOps.ts`).
//
// The right-hand side of the status bar reads profile (10), encoding (20), EOL (30),
// cursor (40) — the order §7.9 lists.

import EncodingStatus from '$lib/components/status/EncodingStatus.svelte';
import EolStatus from '$lib/components/status/EolStatus.svelte';
import { files, EOL_LABELS } from '$lib/app/fileOps';
import { dialogs } from '$lib/app/dialogs';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { encodingLabel, keepsNulLeader } from '$lib/core/text';
import { docs } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type { Contribution, DocMeta, Eol, FileEncoding, QuickPickItem } from '$lib/app/types';

/** Every encoding the codec can write. UTF-16 always carries a byte order mark (§7.2). */
export const ENCODINGS: FileEncoding[] = [
  { encoding: 'utf-8', hasBom: false },
  { encoding: 'utf-8', hasBom: true },
  { encoding: 'windows-1252', hasBom: false },
  { encoding: 'utf-16le', hasBom: true },
  { encoding: 'utf-16be', hasBom: true },
];

export const EOLS: Eol[] = ['crlf', 'lf', 'cr'];

/** Literal `t()` keys, so `i18n/keys.test.ts` can scan them. */
function encodingDetail(e: FileEncoding): string {
  switch (e.encoding) {
    case 'windows-1252':
      return t('encoding.cp1252');
    case 'utf-16le':
      return t('encoding.utf16le');
    case 'utf-16be':
      return t('encoding.utf16be');
    default:
      return e.hasBom ? t('encoding.utf8Bom') : t('encoding.utf8');
  }
}

function eolDetail(eol: Eol): string {
  return eol === 'crlf' ? t('encoding.crlf') : eol === 'lf' ? t('encoding.lf') : t('encoding.cr');
}

function sameEncoding(a: FileEncoding, b: FileEncoding): boolean {
  return a.encoding === b.encoding && a.hasBom === b.hasBom;
}

/** The active document, or nothing to pick for. */
function active(): DocMeta | undefined {
  const id = docs.getActiveId();
  return id === null ? undefined : docs.get(id);
}

async function pickEncoding(): Promise<void> {
  const doc = active();
  if (!doc) return;
  const items: QuickPickItem<FileEncoding>[] = ENCODINGS.map((encoding) => ({
    label: encodingLabel(encoding),
    description: sameEncoding(encoding, doc.encoding) ? '✓' : undefined,
    detail: encodingDetail(encoding),
    value: encoding,
  }));
  const picked = await modals.quickPick(items, {
    placeholder: t('encoding.encodingPlaceholder'),
    initialIndex: Math.max(
      0,
      ENCODINGS.findIndex((e) => sameEncoding(e, doc.encoding)),
    ),
  });
  if (!picked || sameEncoding(picked, doc.encoding)) return;

  // A UTF-16 file has to begin with its byte order mark, so it cannot carry a punched-tape
  // leader — and the save resets the document's NUL record, so switching back afterwards
  // cannot bring one back. That is a destructive change to a program read off a DNC line,
  // and it used to be announced only by a four-second, non-error status line *after* the
  // bytes were written (G8 M5). It is asked about here, at the moment of choice, while the
  // answer still costs nothing.
  if (!keepsNulLeader(picked) && (doc.nul.leader > 0 || doc.nul.trailer > 0)) {
    const ok = await dialogs.confirm({
      title: t('encoding.tapeTitle'),
      message: t('encoding.tapeMessage', {
        name: doc.title,
        encoding: encodingLabel(picked),
        leader: doc.nul.leader,
        trailer: doc.nul.trailer,
      }),
      ok: t('encoding.tapeDropButton'),
      cancel: t('common.cancel'),
      kind: 'warning',
    });
    if (!ok) return;
  }

  files.setEncoding(doc.id, picked);
  status.show(t('encoding.encodingChanged', { name: doc.title, encoding: encodingLabel(picked) }));
}

async function pickEol(): Promise<void> {
  const doc = active();
  if (!doc) return;
  const items: QuickPickItem<Eol>[] = EOLS.map((eol) => ({
    label: EOL_LABELS[eol],
    description: eol === doc.eol ? '✓' : undefined,
    detail: eolDetail(eol),
    value: eol,
  }));
  const picked = await modals.quickPick(items, {
    placeholder: t('encoding.eolPlaceholder'),
    initialIndex: Math.max(0, EOLS.indexOf(doc.eol)),
  });
  if (!picked || picked === doc.eol) return;
  files.setEol(doc.id, picked);
  status.show(t('encoding.eolChanged', { name: doc.title, eol: EOL_LABELS[picked] }));
}

export default {
  id: 'encoding',
  commands: [
    {
      id: 'file.setEncoding',
      title: 'encoding.setEncoding',
      category: 'encoding.category',
      global: true,
      enabled: (c) => c.activeDocId !== null,
      run: () => pickEncoding(),
    },
    {
      id: 'file.setEol',
      title: 'encoding.setEol',
      category: 'encoding.category',
      global: true,
      enabled: (c) => c.activeDocId !== null,
      run: () => pickEol(),
    },
  ],
  statusItems: [
    { id: 'encoding', side: 'right', order: 20, component: EncodingStatus },
    { id: 'eol', side: 'right', order: 30, component: EolStatus },
  ],
} satisfies Contribution;

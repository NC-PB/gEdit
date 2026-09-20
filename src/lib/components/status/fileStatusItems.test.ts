// The markup contract of the WP1.6 status items (plan §7.9): `status-item` with
// `data-item` = `file` | `profile` | `encoding` | `eol`. Renaming one of these breaks the
// runtime scenarios in `tests/runtime/`, so they are pinned here.
//
// Rendered with `svelte/server`, which needs no DOM. The components are props-free and
// read the real document store, so a document is added to it first.

import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import EncodingStatus from './EncodingStatus.svelte';
import EolStatus from './EolStatus.svelte';
import FileStatus from './FileStatus.svelte';
import ProfileStatus from './ProfileStatus.svelte';
import { docs } from '$lib/stores/documents';
import type { DocId, NewDocMeta } from '$lib/app/types';

function addDoc(over: Partial<NewDocMeta> = {}): DocId {
  return docs.add({
    path: '/nc/a.nc',
    untitledIndex: null,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    ...over,
  });
}

afterEach(() => {
  for (const doc of [...docs.all()]) docs.remove(doc.id);
});

describe('FileStatus', () => {
  it('names the active document and its full path', () => {
    addDoc();
    const html = render(FileStatus).body;
    expect(html).toContain('data-testid="status-item"');
    expect(html).toContain('data-item="file"');
    expect(html).toContain('a.nc');
    expect(html).toContain('title="/nc/a.nc"');
    expect(html).not.toContain('Modified');
  });

  it('marks a modified document', () => {
    addDoc({ metaDirty: true });
    expect(render(FileStatus).body).toContain('Modified');
  });

  it('renders nothing but the slot when no document is open', () => {
    const html = render(FileStatus).body;
    expect(html).toContain('data-item="file"');
    expect(html).not.toContain('.nc');
  });
});

describe('EncodingStatus', () => {
  it.each([
    [{ encoding: 'utf-8', hasBom: false }, 'UTF-8'],
    [{ encoding: 'utf-8', hasBom: true }, 'UTF-8 BOM'],
    [{ encoding: 'windows-1252', hasBom: false }, 'Windows-1252'],
    [{ encoding: 'utf-16le', hasBom: true }, 'UTF-16 LE'],
  ] as const)('shows %o as %s', (encoding, label) => {
    addDoc({ encoding });
    const html = render(EncodingStatus).body;
    expect(html).toContain('data-item="encoding"');
    expect(html).toContain(`>${label}</button>`);
  });

  it('is disabled without a document', () => {
    expect(render(EncodingStatus).body).toContain('disabled');
  });
});

describe('EolStatus', () => {
  it.each([
    ['crlf', 'CRLF'],
    ['lf', 'LF'],
    ['cr', 'CR'],
  ] as const)('shows %s as %s', (eol, label) => {
    addDoc({ eol });
    const html = render(EolStatus).body;
    expect(html).toContain('data-item="eol"');
    expect(html).toContain(`>${label}</button>`);
  });

  it('says so while a file that arrived mixed has not been saved', () => {
    addDoc({ eol: 'crlf', eolMixedOnLoad: true });
    expect(render(EolStatus).body).toContain('CRLF (mixed)');
  });
});

describe('ProfileStatus', () => {
  it('shows the short name of the dialect', () => {
    addDoc({ profileId: 'heidenhain-klartext' });
    const html = render(ProfileStatus).body;
    expect(html).toContain('data-item="profile"');
    expect(html).toContain('>Heidenhain</button>');
  });

  it('falls back to the raw id for a profile it does not know yet', () => {
    addDoc({ profileId: 'siemens' });
    expect(render(ProfileStatus).body).toContain('>siemens</button>');
  });
});

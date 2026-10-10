// The `templates` member through the code database service (Phase 3 plan §6.11; P3b prelude):
// built-in parents and children merged by id, a user file laid over them (M13), and a broken
// user template that never hides the built-in one of the same id.

import { describe, expect, it } from 'vitest';
import { createCodeDbService } from './codes';

const BASE: Record<string, unknown> = {
  demo: {
    dialect: 'demo',
    version: 1,
    codes: [{ code: 'G0', label: 'Rapid' }],
    templates: [
      { id: 'program-start', label: 'Program start', group: 'Program', body: '%' },
      { id: 'program-end', label: 'Program end', group: 'Program', body: 'M30' },
    ],
  },
  'demo-b': {
    dialect: 'demo-b',
    version: 1,
    extends: 'demo',
    codes: [],
    templates: [{ id: 'program-end', label: 'Program end (B)', group: 'Program', body: 'M2' }],
  },
};

function service() {
  return createCodeDbService({ dialectOf: (id) => id, source: (d) => BASE[d], sources: () => BASE, warn: () => {} });
}

const file = (name: string, content: unknown) => ({ name, text: JSON.stringify(content) });
const labels = (db: { templates?: { id: string; label: string }[] }) => (db.templates ?? []).map((t) => `${t.id}:${t.label}`);

describe('templates in the code database service', () => {
  it('merges a child database over its parent by id, in the parent’s order', () => {
    const svc = service();
    expect(labels(svc.byId('demo'))).toEqual(['program-start:Program start', 'program-end:Program end']);
    expect(labels(svc.byId('demo-b'))).toEqual(['program-start:Program start', 'program-end:Program end (B)']);
  });

  it('lays a user file over the built-in: the same id replaces it in place, a new id is appended, and the child sees both', () => {
    const svc = service();
    const problems = svc.reload([
      file('demo.json', {
        dialect: 'demo',
        templates: [
          { id: 'program-start', label: 'My start', group: 'Program', body: '%\nO1000' },
          { id: 'drill', label: 'Drill', group: 'Drilling', body: 'G81' },
        ],
      }),
    ]);
    expect(problems).toEqual([]);
    expect(labels(svc.byId('demo'))).toEqual(['program-start:My start', 'program-end:Program end', 'drill:Drill']);
    expect(labels(svc.byId('demo-b'))).toEqual(['program-start:My start', 'program-end:Program end (B)', 'drill:Drill']);
  });

  it('reports a broken user template with its file and path, and keeps the built-in of that id', () => {
    const svc = service();
    const problems = svc.reload([
      file('demo.json', {
        dialect: 'demo',
        templates: [
          { id: 'program-start', label: 'Broken', group: 'Program', body: '{{x}}' },
          { id: 'program-start', label: 'Second', group: 'Program', body: 'O2' },
        ],
      }),
    ]);
    expect(problems.map((p) => [p.file, p.path])).toEqual([['demo.json', 'templates[0].body']]);
    // The first template that reads wins, as in the loader; the broken one replaced nothing.
    expect(labels(svc.byId('demo'))).toEqual(['program-start:Second', 'program-end:Program end']);
    svc.reload([file('demo.json', { dialect: 'demo', templates: [{ id: 'program-start', label: 'Broken', group: 'Program', body: '' }] })]);
    expect(labels(svc.byId('demo'))).toEqual(['program-start:Program start', 'program-end:Program end']);
  });
});

// The Insert tab: code blocks from `src/lib/data/blocks/*.json`. Owner: WP1.5.
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// The block *labels* on the ribbon come from the JSON, because they describe what the
// active dialect's block does ("Cancel cycle" in Fanuc, "Centering" in Klartext for the
// same block id) - dialect data, like profile and script names, which AD-14 does not
// translate. `name.<id>` below is the profile-independent command title the palette shows.

import type { Messages } from '../types';

export default {
  category: 'Insert',
  groupBlocks: 'Blocks',
  groupProgram: 'Program',
  moreBlocks: 'More Blocks…',
  noBlock: 'The active profile has no "{id}" block',
  noDocument: 'Open a document before inserting a block',
  name: {
    start: 'Program Header',
    drill: 'Drilling Cycle',
    example: 'Example Block',
  },
} as const satisfies Messages;

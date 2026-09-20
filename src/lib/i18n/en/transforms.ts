// The transform runner (app/transforms.ts). Owner: WP4.1.
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// Only what the *runner* says lives here. Every transform brings its own namespace for
// its title, its option labels and its summary (`ncNumbering`, `ncCleanup`), because the
// runner never knows which one it is running.

import type { Messages } from '../types';

export default {
  noDocument: 'Open a program before running this.',
  noProfile: 'The dialect profile "{profile}" is not available, so this cannot run.',
  failed: '{title} could not finish.',
  continue: 'Continue',
  inSelection: '{summary} (selection)',
  skipped_one: '1 line was left unchanged.',
  skipped_other: '{count} lines were left unchanged.',
} as const satisfies Messages;

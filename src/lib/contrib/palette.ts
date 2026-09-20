// The command palette (plan §7.11, AD-4). Owner: WP1.1.
// One feature per file (plan AD-3); see ./README.md.
//
// F1 opens Monaco's quick-command widget, which lists every `gedit.*` action the Monaco
// bridge mirrors from the command registry. `palette: false` keeps this command itself out
// of that list: it *is* the palette, so an entry for it would be a dead end.

import Command from 'lucide-svelte/icons/command';
import { asIcon } from '$lib/app/icons';
import { editor } from '$lib/monaco/editorService';
import type { Contribution } from '$lib/app/types';

export default {
  id: 'palette',
  commands: [
    {
      id: 'view.commandPalette',
      title: 'core.commandPalette',
      category: 'core.categoryView',
      icon: asIcon(Command),
      keys: 'F1',
      global: true,
      palette: false,
      run: () => {
        // The widget lives inside the editor, so it needs focus before it can open.
        editor.focus();
        editor.triggerAction('editor.action.quickCommand');
      },
    },
  ],
  ribbon: [
    { tab: 'view', group: 'core.groupCommands', command: 'view.commandPalette', order: 10 },
  ],
} satisfies Contribution;

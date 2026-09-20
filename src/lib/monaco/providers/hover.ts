// Hover help for the word under the pointer (plan §5 WP3.6). Owner: WP3.6.
//
// A thin shell around `core/codes/hoverText.ts`: this file reads the line out of the
// model and turns the markdown into a Monaco hover. Every rule about *what* is said lives
// in the core module, where node tests can reach it.
//
// Security (plan §3, rule 3): the contents are built with `isTrusted: false` and
// `supportHtml: false`, and the markdown is escaped in `hoverText`, because a profile, a
// code database and the open file are data, not app code.
//
// `assist.hover` is read on every call, not at registration: the setting can change while
// the app runs, and Monaco caches nothing here. Monaco's own `hover.enabled` option is
// switched by `monaco/editorOptions.ts` from the same setting, so the hover is off on
// both sides.

import { hoverAt } from '$lib/core/codes/hoverText';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { t } from '$lib/i18n';
import { codes } from '$lib/stores/codes';
import { profiles } from '$lib/stores/profiles';
import { settings } from '$lib/stores/settings';
import type { Monaco } from '$lib/monaco/setup';
import type { Disposable } from '$lib/app/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { LineState } from '$lib/core/nc/types';
import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';

/**
 * What the line above leaves behind, which is all the tokenizer needs from it: a Klartext
 * line that ends in `~` makes the next one its tail, with no block number of its own.
 */
export function stateBefore(
  model: MonacoApi.editor.ITextModel,
  lineNumber: number,
  cp: CompiledProfile,
): LineState | undefined {
  if (lineNumber <= 1) return undefined;
  return tokenizeLine(model.getLineContent(lineNumber - 1), cp).state;
}

/** Registers the hover provider for one profile (Monaco language id = profile id). */
export function registerHover(monaco: Monaco, profileId: string): Disposable {
  const registration = monaco.languages.registerHoverProvider(profileId, {
    provideHover(model, position) {
      if (!settings.get('assist.hover')) return null;

      const cp = profiles.compiled(profileId);
      const line = model.getLineContent(position.lineNumber);
      const info = hoverAt(
        line,
        position.column - 1,
        cp,
        codes.forProfile(profileId),
        t,
        stateBefore(model, position.lineNumber, cp),
      );
      if (!info) return null;

      return {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: info.start + 1,
          endLineNumber: position.lineNumber,
          endColumn: info.end + 1,
        },
        contents: [{ value: info.markdown, isTrusted: false, supportHtml: false }],
      };
    },
  });
  return () => registration.dispose();
}

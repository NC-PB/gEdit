// Which documents are NC programs (M13 review fix CODE-3). Pure.
//
// The typing options (upper case while typing, no accidental join of two blocks) are for NC
// programs. gEdit also opens the files it asks you to edit — a profile or a code file in the
// config folder, the settings and the machines file, a script in My Scripts — and in those
// an upper-cased letter is damage: JSON keys and ids are case-sensitive, and `import` is not
// `IMPORT`.
//
// A positive list of NC extensions is not possible: real programs come as `O0017`, as `.txt`,
// as `.tap`, as the extension-less file of a control, and as an untitled buffer. A short list
// of what is certainly not NC is: JSON and Python. No profile may claim these two either
// (`validateProfile`), so the two statements cannot drift apart.

/** Extensions of files that are not NC programs; lower case, no dot. */
export const NON_NC_EXTENSIONS: readonly string[] = ['json', 'py'];

/** The extension of a path, lower case, without the dot; '' when the file name has none. */
export function extensionOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * True for a document that is an NC program: every document except one whose file is a
 * `.json` or `.py` file. An untitled document (no path) is one.
 */
export function isNcDocumentPath(path: string | null | undefined): boolean {
  if (typeof path !== 'string' || path === '') return true;
  return !NON_NC_EXTENSIONS.includes(extensionOf(path));
}

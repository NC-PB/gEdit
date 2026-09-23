/** True when running inside the Tauri webview (false in a plain browser, e.g. `npm run dev`). */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** True on macOS, where the primary shortcut modifier is Cmd instead of Ctrl. */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** True on Windows, where paths are case-insensitive (as they are on macOS). */
export function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Win/i.test(navigator.platform || navigator.userAgent);
}

/** Last path segment ("C:\\nc\\a.h" and "/nc/a.h" both give "a.h"). */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

// ---------------------------------------------------------------------------
// How Windows spells a name (M8) — the mirror of `paths.rs`
// ---------------------------------------------------------------------------

/**
 * Whether `name` names one of DOS's devices rather than a file.
 *
 * `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9` and `LPT1`-`LPT9` are devices **whatever
 * the extension**: Microsoft's "Naming Files, Paths, and Namespaces" says `NUL.txt`
 * and `NUL.tar.gz` are both equivalent to `NUL`. So what decides is the part before
 * the **first** dot, with trailing spaces trimmed — normalization drops those before
 * it looks the name up — while a leading space makes it an ordinary file name again.
 *
 * `COM0` and `LPT0` are not on Microsoft's list and are refused with the rest, as a
 * margin: no documentation we can cite says whether the kernel stops at `1`, and both
 * directions of the over-reach are harmless. `paths::is_device_name` gives the whole
 * reason, and `scripts.nameDevice` tells the user the same `COM0`-`COM9`.
 *
 * The rule is `paths::is_device_name` in Rust, which is the authority; this is here
 * so the New Script prompt can say so under the field, and so `pathKey` does not fold
 * two spellings that name two different things.
 */
export function isDeviceName(name: string): boolean {
  const stem = (name.split('.')[0] ?? name).replace(/ +$/, '').toUpperCase();
  return /^(CON|PRN|AUX|NUL|(COM|LPT)[0-9\u00b9\u00b2\u00b3])$/.test(stem);
}

/** `\\?\` and `\\?\UNC\`: the prefixes `canonicalize` puts in front of a path. */
const VERBATIM = '\\\\?\\';
const VERBATIM_UNC = '\\\\?\\UNC\\';

/**
 * The ordinary spelling of a Windows path, `\\?\` removed when removing it names the
 * same file; anything else unchanged.
 *
 * The mirror of `paths::plain`, and for the same reason (M8): Rust hands the webview
 * the ordinary spelling, and this is the net under it, so that one file is one
 * document however its path reached us. A verbatim path is handed to the file system
 * as it stands while an ordinary one is normalized first, and normalization is what
 * trims trailing dots and spaces, turns `/` into a separator and maps the device
 * names — a component that any of those would change keeps its prefix.
 */
export function plainPath(path: string): string {
  const unc = path.startsWith(VERBATIM_UNC);
  let rest: string;
  let root: number;
  if (unc) {
    rest = path.slice(VERBATIM_UNC.length);
    root = 2; // server\share
  } else if (path.startsWith(VERBATIM)) {
    rest = path.slice(VERBATIM.length);
    // A drive, and only a drive: `\\?\Volume{…}` has no ordinary spelling at all.
    if (!/^[A-Za-z]:\\/.test(rest)) return path;
    root = 1;
  } else {
    return path;
  }
  const parts = rest.split('\\');
  // `<` rather than `<=`: a bare share root, `\\?\UNC\nas\cam`, has the two parts the
  // root needs and nothing below them, and Rust's `plain` folds it to `\\nas\cam`.
  // `<=` returned it unchanged, and the two sides then keyed one location two ways.
  if (parts.length < root || parts.slice(0, root).some((part) => part === '')) return path;
  // A trailing separator (`\\?\C:\`) leaves one empty last part, which is the root.
  const below = parts.slice(root, parts[parts.length - 1] === '' ? -1 : undefined);
  const same = (part: string): boolean =>
    part !== '' &&
    !part.endsWith('.') &&
    !part.endsWith(' ') &&
    !part.includes('/') &&
    !hasWin32Reserved(part) &&
    !isDeviceName(part);
  return below.every(same) ? `${unc ? '\\\\' : ''}${rest}` : path;
}

/** Win32's reserved characters: `< > : " | ? *`, the control characters 1-31 and NUL. */
const WIN32_RESERVED = '<>:"|?*';

/**
 * Whether `part` holds a character Win32 reads as something other than part of a name
 * — the mirror of `is_win32_reserved` in `paths.rs`.
 *
 * Only an unparsed verbatim path can carry one, which is why this decides whether the
 * `\\?\` may come off: a share holding `2026-01-05T10:30:00.nc`, written by a Linux
 * CAM seat, is that file at `\\?\UNC\nas\cam\…`, while `\\nas\cam\…` asks for the
 * alternate data stream `30:00.nc` of a file called `2026-01-05T10`.
 */
function hasWin32Reserved(part: string): boolean {
  for (let i = 0; i < part.length; i += 1) {
    if (part.charCodeAt(i) <= 31 || WIN32_RESERVED.includes(part[i])) return true;
  }
  return false;
}

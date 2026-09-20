// Content hash for the disk stamp (plan §7.2, AD-10). Pure: no Svelte, no Monaco, no Tauri.

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a over the raw bytes, as an unsigned 32-bit number. Not a cryptographic hash:
 * it only has to tell "the file on disk still holds the bytes we wrote" from a real
 * change, so that a new mtime alone does not raise an external-change banner.
 */
export function fnv1a32(bytes: Uint8Array): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < bytes.length; i++) {
    hash = Math.imul(hash ^ bytes[i], FNV_PRIME);
  }
  return hash >>> 0;
}

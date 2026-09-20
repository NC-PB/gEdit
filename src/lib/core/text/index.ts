// The text codec (plan §7.2, AD-7). `codec.ts`, `eol.ts` and `hash.ts` export the
// contract functions; `cp1252.ts` and `utf16.ts` are internal to this folder.

export { codePointLabel, decodeFile, encodeFile, encodeUtf8, encodingLabel, keepsNulLeader } from './codec';
export { detectEol, joinEol, toLf, EOL_TEXT } from './eol';
export { fnv1a32 } from './hash';

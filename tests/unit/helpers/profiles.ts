// Test support: a built-in profile, resolved and compiled, by id (P12; any test may use it).

import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';

export function profileOf(id: string): Profile {
  const raw = BUILTIN_PROFILE_JSON.find((p) => (p as { id?: string }).id === id);
  const result = validateProfile(raw);
  if (!result.ok) throw new Error(`${id}: ${result.errors.join('; ')}`);
  return result.profile;
}

export function cpOf(id: string): CompiledProfile {
  return compileProfile(profileOf(id));
}

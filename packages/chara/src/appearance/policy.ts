import type { AppearanceOptions, AppearancePolicy } from './types.js';

export const DEFAULT_APPEARANCE_POLICY: AppearancePolicy = Object.freeze({
  version: '1.1.0',
  offGridDeltaE: 6,
  eyeMatchDeltaE: 1,
  historicalEyeCorrection: true,
});
export class AppearanceInputError extends Error {
  readonly code = 'INVALID_APPEARANCE_OPTIONS';
  constructor() {
    super('Appearance options are invalid.');
    this.name = 'AppearanceInputError';
  }
}
export function appearancePolicy(options: AppearanceOptions): AppearancePolicy {
  if (
    typeof options !== 'object' ||
    options === null ||
    typeof options.palettes?.getColor !== 'function' ||
    (options.policy !== undefined &&
      (typeof options.policy !== 'object' ||
        options.policy === null ||
        Array.isArray(options.policy)))
  )
    throw new AppearanceInputError();
  const policy = { ...DEFAULT_APPEARANCE_POLICY };
  for (const key of ['offGridDeltaE', 'eyeMatchDeltaE'] as const) {
    if (!options.policy || !Object.hasOwn(options.policy, key)) continue;
    const value = options.policy[key];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100
    )
      throw new AppearanceInputError();
    policy[key] = value;
  }
  if (
    options.policy &&
    Object.hasOwn(options.policy, 'historicalEyeCorrection')
  ) {
    const value = options.policy.historicalEyeCorrection;
    if (typeof value !== 'boolean') throw new AppearanceInputError();
    policy.historicalEyeCorrection = value;
  }
  if (policy.eyeMatchDeltaE > policy.offGridDeltaE)
    throw new AppearanceInputError();
  return Object.freeze(policy);
}

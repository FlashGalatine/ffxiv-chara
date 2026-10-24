import type {
  AppearanceInspection,
  AppearanceSlot,
} from 'xivcharakit/appearance';
import type { DemoAppearance, DemoSlot } from './types.js';

/**
 * The page only shows a stored index by state and value. The stored subtrees (`raw`, and
 * `storedExtended` with its own `raw`) are the inspection's own objects, which the page already
 * holds; structured clone copies them again for every message, so they stay in the worker.
 */
export function projectAppearance(
  appearance: AppearanceInspection,
): DemoAppearance {
  const slots = {} as Record<AppearanceSlot, DemoSlot>;
  for (const key of Object.keys(appearance.slots) as AppearanceSlot[]) {
    const {
      storedIndex,
      storedExtended: _extended,
      ...rest
    } = appearance.slots[key];
    slots[key] = {
      ...rest,
      storedIndex:
        storedIndex.state === 'valid'
          ? { state: 'valid', value: storedIndex.value }
          : { state: storedIndex.state },
    };
  }
  return { ...appearance, slots };
}

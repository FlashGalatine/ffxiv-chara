// Interpretation rules adapted from XIV Dye Tools; see THIRD_PARTY_NOTICES.md.
import { IssueCollector } from '../issues.js';
import type {
  PaletteName,
  PaletteProvider,
  PaletteRequest,
} from '../palettes/types.js';
import type { CharaInspection, Field } from '../types.js';
import { clamp01, compositeHex, gamma2Hex, hexDeltaE } from './color-math.js';
import { appearancePolicy } from './policy.js';
import type {
  AppearanceCorrection,
  AppearanceInspection,
  AppearanceOptions,
  AppearancePolicy,
  AppearanceSlot,
  AppearanceSlotInspection,
} from './types.js';

type IndexKey = Exclude<
  keyof CharaInspection['appearance'],
  'EnableHighlights'
>;
type ExtendedKey =
  | 'LeftEyeColor'
  | 'RightEyeColor'
  | 'HairColor'
  | 'HairHighlight'
  | 'SkinColor'
  | 'LimbalRingColor'
  | 'MouthColor';
const DEFINITIONS: readonly [
  AppearanceSlot,
  IndexKey,
  ExtendedKey | null,
  PaletteName,
][] = [
  ['leftEye', 'LEyeColor', 'LeftEyeColor', 'eyes'],
  ['rightEye', 'REyeColor', 'RightEyeColor', 'eyes'],
  ['hair', 'HairTone', 'HairColor', 'hair'],
  ['highlights', 'Highlights', 'HairHighlight', 'highlights'],
  ['skin', 'Skintone', 'SkinColor', 'skin'],
  ['limbal', 'LimbalEyes', 'LimbalRingColor', 'features'],
  ['lip', 'LipsToneFurPattern', 'MouthColor', 'lipsDark'],
  ['facePaint', 'FacePaintColor', null, 'facePaintDark'],
];
const ZERO_KEYS: readonly ExtendedKey[] = [
  'SkinColor',
  'LeftEyeColor',
  'RightEyeColor',
  'LimbalRingColor',
  'HairColor',
  'HairHighlight',
  'MouthColor',
];
// Bit 0x80 of the Mouth byte enables lip color in Anamnesis, Ktisis and Brio.
const LIP_COLOR_ENABLED = 0x80;
// Bit 0x80 of the FacePaint byte mirrors the paint in Brio and Ktisis; the style is the low 7 bits.
const FACE_PAINT_FLIPPED = 0x80;
const current = <T>(field: Field<T>): T | null =>
  field.state === 'valid' ? field.value : null;

async function paletteHex(
  provider: PaletteProvider,
  request: PaletteRequest,
  issues: IssueCollector,
  path: string,
): Promise<string | null> {
  try {
    const result = await provider.getColor(request);
    if (result === null) return null;
    if (
      !result ||
      result.table !== request.table ||
      result.palette !== request.palette ||
      result.index !== request.index ||
      typeof result.hex !== 'string' ||
      !/^#[0-9A-F]{6}$/.test(result.hex) ||
      ((request.palette === 'skin' || request.palette === 'hair') &&
        (result.tribe !== request.tribe || result.gender !== request.gender))
    ) {
      issues.add(
        'INVALID_PALETTE_RESPONSE',
        [path],
        'Palette provider returned an invalid color association.',
      );
      return null;
    }
    return result.hex;
  } catch {
    issues.add(
      'PALETTE_UNAVAILABLE',
      [path],
      'Palette data could not be resolved.',
    );
    return null;
  }
}

function pairEyes(
  slots: AppearanceInspection['slots'],
  policy: AppearancePolicy,
  corrections: AppearanceCorrection[],
  issues: IssueCollector,
): void {
  const left = slots.leftEye,
    right = slots.rightEye;
  if (
    !left.extendedActive ||
    !right.extendedActive ||
    left.storedIndex.state !== 'valid' ||
    right.storedIndex.state !== 'valid' ||
    left.storedIndex.value === right.storedIndex.value ||
    !left.shaderHex ||
    !right.shaderHex ||
    !left.extendedHex ||
    !right.extendedHex
  )
    return;
  const lands = (first: string, second: string) =>
    hexDeltaE(first, second) <= policy.eyeMatchDeltaE;
  // Brio 0.7.2+ stores each eye's extended color under the other eye's name.
  const crossedLeft =
    lands(left.extendedHex, right.shaderHex) &&
    !lands(left.extendedHex, left.shaderHex);
  const crossedRight =
    lands(right.extendedHex, left.shaderHex) &&
    !lands(right.extendedHex, right.shaderHex);
  if (crossedLeft && crossedRight && policy.historicalEyeCorrection) {
    left.effectiveExtendedHex = right.extendedHex;
    right.effectiveExtendedHex = left.extendedHex;
    left.correction = right.correction = 'historicalEyePairSwap';
    corrections.push({
      code: 'HISTORICAL_EYE_PAIR_SWAP',
      slots: ['leftEye', 'rightEye'],
    });
    return;
  }
  // A custom color on one eye hides the second match, so one crossed match next
  // to a color that fits neither shader is the remaining evidence. Flag it
  // without swapping: no producer routing, and the colors stay as stored.
  const custom = (hex: string) =>
    !lands(hex, left.shaderHex as string) &&
    !lands(hex, right.shaderHex as string);
  if (crossedLeft && crossedRight)
    issues.add(
      'EYE_PAIRING_UNCONFIRMED',
      [],
      'Extended eye colors appear crossed relative to the stored indices; the historical correction is disabled.',
    );
  else if (
    (crossedLeft && custom(right.extendedHex)) ||
    (crossedRight && custom(left.extendedHex))
  )
    issues.add(
      'EYE_PAIRING_UNCONFIRMED',
      [],
      'Extended eye colors may be crossed relative to the stored indices and could not be confirmed.',
    );
}

export async function resolveAppearance(
  inspection: CharaInspection,
  options: AppearanceOptions,
): Promise<AppearanceInspection> {
  const policy = appearancePolicy(options);
  const issues = new IssueCollector();
  const valid = current(inspection.extended.IsExtendedAppearanceValid) === true;
  const ambiguous = ZERO_KEYS.every((key) => {
    const value = current(inspection.extended[key]);
    return value?.every((channel) => channel === 0) ?? false;
  });
  if (ambiguous)
    issues.add(
      'AMBIGUOUS_ZERO_BLOCK',
      [],
      'Complete zero-valued extended block has ambiguous capture semantics.',
    );
  const live = valid && !ambiguous;
  const race = inspection.identity.canonicalRace;
  const tribe = current(inspection.identity.tribe);
  const gender = current(inspection.identity.gender);
  // The bit gates a lip palette index only. A Hrothgar fur pattern has no such
  // index, so Hrothgar ignores it. With no race, the lip is known to be on only
  // when the bit is set: any other race with it clear is off, and a Hrothgar
  // would not be told apart.
  const mouth = current(inspection.appearance.Mouth);
  const bitSet = mouth !== null && (mouth & LIP_COLOR_ENABLED) !== 0;
  const lipEnabled =
    race === 'Hrothgar'
      ? true
      : race === null
        ? bitSet || null
        : mouth === null
          ? null
          : bitSet;
  const slots = Object.create(null) as AppearanceInspection['slots'];
  await Promise.all(
    DEFINITIONS.map(async ([slot, indexKey, extendedKey, palette]) => {
      const index = inspection.appearance[indexKey];
      const extended = extendedKey ? inspection.extended[extendedKey] : null;
      const components = extended ? current(extended) : null;
      const extendedHex = components ? gamma2Hex(components) : null;
      if (components?.slice(0, 3).some((channel) => channel < 0 || channel > 1))
        issues.add(
          'EXTENDED_CLAMPED',
          [extendedKey as string],
          'Extended channels were clipped for a bounded preview.',
        );
      const highlightFlag = current(inspection.appearance.EnableHighlights);
      const paint = current(inspection.appearance.FacePaint);
      const active =
        slot === 'highlights'
          ? highlightFlag
          : slot === 'facePaint'
            ? paint === null
              ? null
              : (paint & ~FACE_PAINT_FLIPPED) !== 0
            : slot === 'lip'
              ? lipEnabled
              : true;
      const alpha =
        slot === 'lip' && components ? (components[3] ?? null) : null;
      if (alpha !== null && (alpha < 0 || alpha > 1))
        issues.add(
          'ALPHA_CLAMPED',
          ['MouthColor'],
          'Opacity requires clipping for a bounded preview.',
        );
      const entry: AppearanceSlotInspection = {
        slot,
        kind:
          slot === 'limbal'
            ? race === 'Au Ra'
              ? 'limbal'
              : race === null
                ? 'limbalOrTattoo'
                : 'tattoo'
            : slot,
        storedIndex: index,
        storedExtended: extended,
        indexMeaning:
          slot === 'lip'
            ? race === 'Hrothgar'
              ? 'furPattern'
              : race === null
                ? 'unknown'
                : 'color'
            : 'color',
        sheetIndex: null,
        variant: null,
        gridAddress: null,
        creatorHex: null,
        shaderHex: null,
        extendedHex,
        effectiveExtendedHex: extendedHex,
        extendedActive: live && extendedHex !== null && active !== false,
        active,
        interpretation: 'unresolved',
        reason: 'missingColor',
        deltaE: null,
        displayHex: null,
        alpha,
        lipComposite: null,
        correction: null,
      };
      slots[slot] = entry;
      if (index.state === 'invalid' || index.state === 'unsupported') {
        entry.reason = 'invalidIndex';
        return;
      }
      if (index.state !== 'valid') return;
      if (entry.indexMeaning === 'unknown') {
        entry.reason = 'missingRace';
        return;
      }
      if (entry.indexMeaning === 'furPattern') {
        entry.reason = 'furPattern';
        return;
      }
      let sheetIndex = index.value;
      let creatorPalette = palette;
      if (slot === 'lip' || slot === 'facePaint') {
        if (index.value <= 95) entry.variant = 'dark';
        else if (index.value >= 128 && index.value <= 223) {
          entry.variant = 'light';
          sheetIndex -= 128;
        } else {
          entry.reason = 'indexOutOfRange';
          issues.add(
            'PALETTE_INDEX_OUT_OF_RANGE',
            [indexKey],
            'Index has no supported palette entry.',
          );
          return;
        }
        creatorPalette =
          slot === 'lip'
            ? entry.variant === 'light'
              ? 'lipsLight'
              : 'lipsDark'
            : entry.variant === 'light'
              ? 'facePaintLight'
              : 'facePaintDark';
      } else if (index.value >= 192) {
        entry.reason = 'indexOutOfRange';
        issues.add(
          'PALETTE_INDEX_OUT_OF_RANGE',
          [indexKey],
          'Index has no supported palette entry.',
        );
        return;
      }
      entry.sheetIndex = sheetIndex;
      entry.gridAddress = `R${Math.floor(sheetIndex / 8) + 1}·C${(sheetIndex % 8) + 1}`;
      if ((slot === 'skin' || slot === 'hair') && (!tribe || !gender)) {
        entry.reason = 'missingTribeGender';
        issues.add(
          'MISSING_PALETTE_CONTEXT',
          [indexKey],
          'Tribe and Gender are required for this palette.',
        );
        return;
      }
      const base = { index: sheetIndex, tribe, gender };
      const [creatorHex, shaderHex] = await Promise.all([
        paletteHex(
          options.palettes,
          { ...base, table: 'creator', palette: creatorPalette },
          issues,
          indexKey,
        ),
        slot === 'facePaint'
          ? Promise.resolve(null)
          : paletteHex(
              options.palettes,
              {
                ...base,
                table: 'shader',
                palette: slot === 'lip' ? 'lipsDark' : palette,
              },
              issues,
              indexKey,
            ),
      ]);
      entry.creatorHex = creatorHex;
      entry.shaderHex = shaderHex;
      entry.reason = creatorHex ? 'paletteOnly' : 'missingPaletteEntry';
    }),
  );
  const corrections: AppearanceCorrection[] = [];
  pairEyes(slots, policy, corrections, issues);
  for (const entry of Object.values(slots)) {
    if (entry.active === false) {
      entry.extendedActive = false;
      entry.interpretation = 'inactive';
      entry.reason =
        entry.slot === 'highlights'
          ? 'highlightsDisabled'
          : entry.slot === 'lip'
            ? 'lipDisabled'
            : 'facePaintNone';
      continue;
    }
    if (
      entry.slot === 'lip' &&
      entry.extendedActive &&
      entry.alpha !== null &&
      entry.alpha <= 0
    ) {
      entry.active = false;
      entry.interpretation = 'inactive';
      entry.reason = 'noLip';
      continue;
    }
    if (entry.indexMeaning === 'furPattern') {
      if (entry.extendedActive) {
        entry.interpretation = 'extendedOnly';
        entry.displayHex = entry.effectiveExtendedHex;
        entry.active = true;
        entry.reason = 'floatOnly';
      } else {
        entry.interpretation = 'inactive';
        entry.active = false;
        entry.reason = 'furPattern';
      }
      continue;
    }
    if (
      entry.storedIndex.state === 'absent' ||
      entry.storedIndex.state === 'null'
    ) {
      if (entry.extendedActive) {
        entry.interpretation = 'extendedOnly';
        entry.displayHex = entry.effectiveExtendedHex;
        entry.reason = 'floatOnly';
      }
      continue;
    }
    if (!entry.creatorHex) continue;
    if (entry.extendedActive && entry.effectiveExtendedHex) {
      if (!entry.shaderHex) {
        entry.reason = 'missingShaderReference';
        issues.add(
          'MISSING_SHADER_REFERENCE',
          [entry.slot],
          'Extended comparison requires a shader reference.',
        );
        continue;
      }
      entry.deltaE = hexDeltaE(entry.shaderHex, entry.effectiveExtendedHex);
      entry.interpretation =
        entry.deltaE > policy.offGridDeltaE ? 'offGrid' : 'palette';
      entry.displayHex =
        entry.interpretation === 'offGrid'
          ? entry.effectiveExtendedHex
          : entry.creatorHex;
      entry.reason =
        entry.interpretation === 'offGrid' ? 'offGrid' : 'paletteAgreement';
    } else {
      entry.interpretation = 'palette';
      entry.displayHex = entry.creatorHex;
      entry.reason =
        ambiguous && entry.extendedHex
          ? 'ambiguousZeroBlock'
          : entry.extendedHex
            ? 'extendedInactive'
            : entry.active === null
              ? 'activityUnknown'
              : 'paletteOnly';
    }
  }
  const lip = slots.lip,
    skin = slots.skin;
  if (
    lip.extendedActive &&
    lip.alpha !== null &&
    lip.alpha > 0 &&
    lip.displayHex &&
    skin.displayHex
  ) {
    const alpha = clamp01(lip.alpha);
    lip.lipComposite = {
      hex: compositeHex(lip.displayHex, skin.displayHex, alpha),
      alpha,
      derived: true,
    };
  }
  return {
    policy,
    paletteMetadata: options.palettes.metadata ?? null,
    slots,
    corrections,
    eyesShareIndex:
      slots.leftEye.storedIndex.state === 'valid' &&
      slots.rightEye.storedIndex.state === 'valid' &&
      slots.leftEye.storedIndex.value === slots.rightEye.storedIndex.value,
    issues: issues.issues,
  };
}

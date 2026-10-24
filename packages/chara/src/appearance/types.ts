import type { PaletteMetadata, PaletteProvider } from '../palettes/types.js';
import type { Field, Issue } from '../types.js';

export type AppearanceSlot =
  | 'leftEye'
  | 'rightEye'
  | 'hair'
  | 'highlights'
  | 'skin'
  | 'limbal'
  | 'lip'
  | 'facePaint';
export interface AppearancePolicy {
  readonly version: '1.1.0';
  readonly offGridDeltaE: number;
  readonly eyeMatchDeltaE: number;
  readonly historicalEyeCorrection: boolean;
}
export interface AppearanceOptions {
  palettes: PaletteProvider;
  policy?: Partial<Omit<AppearancePolicy, 'version'>>;
}
export type AppearanceReason =
  | 'paletteOnly'
  | 'paletteAgreement'
  | 'offGrid'
  | 'floatOnly'
  | 'extendedInactive'
  | 'ambiguousZeroBlock'
  | 'invalidIndex'
  | 'indexOutOfRange'
  | 'missingTribeGender'
  | 'missingRace'
  | 'missingColor'
  | 'missingPaletteEntry'
  | 'missingShaderReference'
  | 'highlightsDisabled'
  | 'facePaintNone'
  | 'furPattern'
  | 'noLip'
  | 'lipDisabled'
  | 'activityUnknown';
export interface AppearanceSlotInspection {
  slot: AppearanceSlot;
  kind: AppearanceSlot | 'tattoo' | 'limbalOrTattoo';
  storedIndex: Field<number>;
  storedExtended: Field<number[]> | null;
  indexMeaning: 'color' | 'furPattern' | 'unknown';
  sheetIndex: number | null;
  variant: 'dark' | 'light' | null;
  gridAddress: string | null;
  creatorHex: string | null;
  shaderHex: string | null;
  extendedHex: string | null;
  effectiveExtendedHex: string | null;
  extendedActive: boolean;
  active: boolean | null;
  interpretation:
    | 'palette'
    | 'offGrid'
    | 'extendedOnly'
    | 'inactive'
    | 'unresolved';
  reason: AppearanceReason;
  deltaE: number | null;
  displayHex: string | null;
  alpha: number | null;
  lipComposite: { hex: string; alpha: number; derived: true } | null;
  correction: 'historicalEyePairSwap' | null;
}
export interface AppearanceCorrection {
  code: 'HISTORICAL_EYE_PAIR_SWAP';
  slots: ['leftEye', 'rightEye'];
}
export interface AppearanceInspection {
  policy: AppearancePolicy;
  paletteMetadata: PaletteMetadata | null;
  slots: Record<AppearanceSlot, AppearanceSlotInspection>;
  corrections: AppearanceCorrection[];
  eyesShareIndex: boolean;
  issues: Issue[];
}

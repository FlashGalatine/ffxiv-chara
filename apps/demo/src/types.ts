import type { CharaInspection, Field } from 'xivcharakit';
import type {
  AppearanceInspection,
  AppearanceSlot,
  AppearanceSlotInspection,
} from 'xivcharakit/appearance';
import type { LookupResult, StainRow } from 'xivcharakit/dyes';
import type { EquipmentResolution } from 'xivcharakit/xivapi';

/** A stored field as the page shows it: its state and value, without the stored subtree. */
export interface Shown<T> {
  state: Field<T>['state'];
  value?: T;
}
export interface DemoSlot
  extends Omit<AppearanceSlotInspection, 'storedIndex' | 'storedExtended'> {
  storedIndex: Shown<number>;
}
export interface DemoAppearance extends Omit<AppearanceInspection, 'slots'> {
  slots: Record<AppearanceSlot, DemoSlot>;
}
/** A file to inspect, or an inspection whose colors still need resolving. */
export type WorkerRequest =
  | File
  | { type: 'appearance'; inspection: CharaInspection };
export type WorkerReply =
  | { type: 'inspection'; inspection: CharaInspection }
  | { type: 'appearance'; appearance: DemoAppearance }
  | { type: 'rejected'; code: string };
export interface DemoState {
  fileName: string | null;
  inspection: CharaInspection | null;
  appearance: DemoAppearance | null;
  appearanceStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
  resolution: EquipmentResolution | null;
  dyeNames: LookupResult<StainRow> | null;
  error: string | null;
  /** Counts every time an error is raised, so a repeated message can be announced again. */
  errorSerial: number;
  localStatus: string;
  reading: boolean;
  lookingUp: boolean;
  lookupMessage: string;
  icons: Map<string, string>;
}

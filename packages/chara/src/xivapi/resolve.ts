import { IssueCollector } from '../issues.js';
import { isUint, modelKey } from '../models.js';
import type {
  EquipmentModel,
  EquipmentResolveInput,
  EquipmentSlot,
} from '../types.js';
import { createTransport } from './client.js';
import {
  lookupsFrom,
  type SlotLookup,
  signalFrom,
  XivapiInputError,
} from './query.js';
import type {
  EquipmentCandidate,
  EquipmentResolution,
  EquipmentResolver,
  GlassesRow,
  ItemRow,
  LookupResult,
  ResolutionStatus,
  SlotResolution,
  XivapiOptions,
} from './types.js';

function capture(input: EquipmentResolveInput): {
  models: EquipmentModel[];
  glassesId?: number;
} {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new XivapiInputError('INVALID_LOOKUP');
  // Read each caller property once: a getter must not be able to change a value after it is checked.
  const glassesId = input.glassesId;
  const lookups = lookupsFrom(input.models);
  if (glassesId !== undefined && !isUint(glassesId))
    throw new XivapiInputError('INVALID_LOOKUP');
  // Reconstruct from admitted packed identities; no source object/extra property survives.
  const models = lookups.map(({ slot, key }: SlotLookup): EquipmentModel => {
    const packed = BigInt(key);
    return slot === 'MainHand' || slot === 'OffHand'
      ? {
          slot,
          set: Number(packed & 65535n),
          base: Number((packed >> 16n) & 65535n),
          variant: Number((packed >> 32n) & 65535n),
        }
      : {
          slot,
          base: Number(packed & 65535n),
          variant: Number((packed >> 16n) & 65535n),
        };
  });
  return glassesId === undefined ? { models } : { models, glassesId };
}

function status(lookup: LookupResult, count: number): ResolutionStatus {
  return lookup.status === 'complete'
    ? count
      ? 'matched'
      : 'notFound'
    : lookup.status;
}
function candidate(row: ItemRow, viaMainHand: boolean): EquipmentCandidate {
  return {
    itemId: row.rowId,
    names: { ...row.names },
    iconId: row.iconId,
    levelEquip: row.levelEquip,
    uiCategory: row.uiCategory,
    rules: { ...row.rules, wear: { ...row.rules.wear } },
    viaMainHand,
  };
}

/** Pure association over admitted models and transport rows; no cache or network access. */
function matchItems(
  models: readonly EquipmentModel[],
  lookup: LookupResult<ItemRow>,
  issues: IssueCollector,
): EquipmentResolution['items'] {
  const index = new Map<string, ItemRow[]>();
  for (const row of lookup.rows)
    for (const slot of row.slots) {
      const id = `${slot}:${row.modelMain}`;
      const entries = index.get(id) ?? [];
      entries.push(row);
      index.set(id, entries);
    }
  const main = models.find((model) => model.slot === 'MainHand');
  const mainKey = main ? modelKey(main) : null;
  const mainRows =
    mainKey === null ? [] : (index.get(`MainHand:${mainKey}`) ?? []);
  const items: Partial<Record<EquipmentSlot, SlotResolution>> = {};
  for (const model of models) {
    const key = modelKey(model);
    let matches = index.get(`${model.slot}:${key}`) ?? [];
    let viaMainHand = false;
    let incompleteContext = false;
    // Key "0" is the all-zero "nothing equipped" model, never a shield or off-hand to pair.
    if (model.slot === 'OffHand' && key !== '0') {
      const paired = mainRows.filter(
        (row) => key === mainKey || row.modelSub === key,
      );
      if (paired.length) {
        matches = paired;
        viaMainHand = true;
      }
      incompleteContext =
        key !== mainKey && mainRows.some((row) => row.modelSub === null);
      if (incompleteContext)
        issues.add(
          'INCOMPLETE_OFFHAND_CONTEXT',
          ['items', 'OffHand'],
          'Missing main-hand model data prevents complete off-hand matching.',
        );
    }
    const candidates = matches
      .map((row) => candidate(row, viaMainHand))
      .sort((a, b) => a.itemId - b.itemId);
    items[model.slot] = {
      model: { ...model },
      modelKey: key,
      status:
        incompleteContext && lookup.status === 'complete'
          ? 'partial'
          : status(lookup, candidates.length),
      ambiguous: candidates.length > 1,
      candidates,
    };
  }
  return items;
}

export function createXivapiResolver(
  options: XivapiOptions = {},
): EquipmentResolver {
  const client = createTransport(options);
  return {
    async resolve(input, requestOptions = {}) {
      const request = capture(input);
      const signal = signalFrom(requestOptions);
      const { items, facewear } = await client.resolveRows(
        request.models,
        request.glassesId,
        signal,
      );
      const issues = new IssueCollector();
      for (const [scope, result] of [
        ['items', items],
        ['facewear', facewear],
      ] as const) {
        for (const issue of result?.issues ?? [])
          issues.add(
            issue.code,
            [scope, ...issue.path],
            issue.message,
            issue.severity,
          );
      }
      return {
        items: items ? matchItems(request.models, items, issues) : {},
        facewear:
          facewear && request.glassesId !== undefined
            ? {
                id: request.glassesId,
                status: status(facewear, facewear.rows.length),
                candidates: facewear.rows.map(
                  (row): GlassesRow => ({ ...row, names: { ...row.names } }),
                ),
              }
            : null,
        upstream: {
          items: items
            ? { version: items.version, schema: items.schema }
            : null,
          facewear: facewear
            ? { version: facewear.version, schema: facewear.schema }
            : null,
        },
        issues: issues.issues,
      };
    },
  };
}

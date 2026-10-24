import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { resolveAppearance } from '../src/appearance/index.js';
import { inspectChara, modelKey, readChara } from '../src/index.js';
import { createDefaultPaletteProvider } from '../src/palettes/index.js';

// Reviewed from the supplied export fields, not generated from inspection output.
// These establish stored-value compatibility, not visual ground truth in the apps.
describe('maintainer-supplied default producer exports', () => {
  it.each([
    ['brio-default.chara', true],
    ['anamnesis-default.chara', false],
    ['anamnesis-default-metadata.chara', false],
    ['ktisis-default.chara', false],
  ] as const)('retains reviewed values from %s', async (name, brio) => {
    const bytes = await readFile(
      new URL(`../../../fixtures/producer-exports/${name}`, import.meta.url),
    );
    const document = readChara(bytes);
    const inspection = inspectChara(document);
    expect(inspection.identity.canonicalRace).toBe('Elezen');
    expect(inspection.identity.tribe.value).toBe('Duskwight');
    expect(inspection.identity.gender.value).toBe('Feminine');
    expect(inspection.facewear).toMatchObject({ state: 'valid', value: 0 });
    expect(inspection.appearance.HairTone.value).toBe(71);
    expect(inspection.appearance.FacePaint.value).toBe(0);
    const body = inspection.equipment.Body;
    expect(body.model).toEqual({ slot: 'Body', base: 779, variant: 1 });
    if (!body.model) throw new Error('Expected reviewed body model');
    expect(modelKey(body.model)).toBe('66315');
    expect(body.dye1).toMatchObject({ state: 'valid', value: 33 });
    expect(body.dye2).toMatchObject({ state: 'valid', value: 11 });
    const mainHand = inspection.equipment.MainHand;
    expect(mainHand.model).toEqual({
      slot: 'MainHand',
      set: 2027,
      base: 4,
      variant: 1,
    });
    if (!mainHand.model) throw new Error('Expected reviewed main-hand model');
    expect(modelKey(mainHand.model)).toBe('4295231467');
    expect(mainHand.dye1).toMatchObject({ state: 'valid', value: 0 });
    expect(mainHand.dye2).toMatchObject({ state: 'valid', value: 0 });
    expect(inspection.extended.IsExtendedAppearanceValid).toEqual(
      brio ? { state: 'valid', raw: true, value: true } : { state: 'absent' },
    );
    expect(document.hasEmbeddedImage).toBe(brio);
    expect(Object.hasOwn(document.fields, 'Base64Image')).toBe(false);
    expect(inspection.issues.map((issue) => [issue.code, issue.path])).toEqual(
      brio
        ? [
            ['IMAGE_OMITTED', ['Base64Image']],
            ['UNSUPPORTED_FIELD', ['Tags']],
          ]
        : [],
    );
    if (brio) expect(document.fields.Tags).toBe(null);
    const appearance = await resolveAppearance(inspection, {
      palettes: createDefaultPaletteProvider(),
    });
    expect(appearance.issues).toEqual([]);
    // The eye colors are derived from the stored indices and the shipped creator table,
    // not from the library's own output. Brio 0.7.2+ stores each eye's extended color
    // under the other eye's name, so only Brio needs (and reports) the pair correction.
    const { eyes } = JSON.parse(
      await readFile(
        new URL('../src/palettes/data/creator-shared.json', import.meta.url),
        'utf8',
      ),
    );
    expect(inspection.appearance.LEyeColor.value).toBe(169);
    expect(inspection.appearance.REyeColor.value).toBe(42);
    expect(appearance.corrections).toEqual(
      brio
        ? [{ code: 'HISTORICAL_EYE_PAIR_SWAP', slots: ['leftEye', 'rightEye'] }]
        : [],
    );
    expect(appearance.slots.leftEye).toMatchObject({
      interpretation: 'palette',
      displayHex: eyes[169],
      correction: brio ? 'historicalEyePairSwap' : null,
    });
    expect(appearance.slots.rightEye).toMatchObject({
      interpretation: 'palette',
      displayHex: eyes[42],
      correction: brio ? 'historicalEyePairSwap' : null,
    });
    // Every reviewed export stores Mouth 2: the producers' lip-color bit (0x80) is clear.
    expect(inspection.appearance.Mouth.value).toBe(2);
    expect(appearance.slots.lip).toMatchObject({
      active: false,
      interpretation: 'inactive',
      reason: 'lipDisabled',
      displayHex: null,
    });
  });

  it('shows the stored lip color once the producer lip-color bit is set', async () => {
    const fields = JSON.parse(
      await readFile(
        new URL(
          '../../../fixtures/producer-exports/anamnesis-default.chara',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const { lipsDark } = JSON.parse(
      await readFile(
        new URL('../src/palettes/data/creator-shared.json', import.meta.url),
        'utf8',
      ),
    );
    const lipFor = async (mouth: number) =>
      (
        await resolveAppearance(
          inspectChara(readChara(JSON.stringify({ ...fields, Mouth: mouth }))),
          { palettes: createDefaultPaletteProvider() },
        )
      ).slots.lip;
    expect(await lipFor(2)).toMatchObject({ active: false, displayHex: null });
    // Stored LipsToneFurPattern 53 reads straight from the shipped creator table.
    expect(await lipFor(2 | 0x80)).toMatchObject({
      active: true,
      interpretation: 'palette',
      displayHex: lipsDark[53],
    });
  });

  it('flags, without swapping, a Brio export whose crossing a custom eye color hides', async () => {
    const fields = JSON.parse(
      await readFile(
        new URL(
          '../../../fixtures/producer-exports/brio-default.chara',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    // An authored edit of the real export: one eye gets a custom color (not a fresh Brio export).
    const edited = { ...fields, RightEyeColor: '0.8, 0.01, 0.01' };
    const appearance = await resolveAppearance(
      inspectChara(readChara(JSON.stringify(edited))),
      { palettes: createDefaultPaletteProvider() },
    );
    expect(appearance.corrections).toEqual([]);
    expect(appearance.issues).toEqual([
      expect.objectContaining({
        code: 'EYE_PAIRING_UNCONFIRMED',
        path: [],
      }),
    ]);
  });
});

// Anamnesis never writes IsExtendedAppearanceValid (compatibility.md, "Extended colors by
// producer"), so for its exports the stored extended colors are inactive evidence. Expected colors
// come from the stored indices and the shipped tables, not from the library's own output.
describe('an Anamnesis-shaped export, which never carries IsExtendedAppearanceValid', () => {
  const fixture = async () =>
    JSON.parse(
      await readFile(
        new URL(
          '../../../fixtures/producer-exports/anamnesis-default.chara',
          import.meta.url,
        ),
        'utf8',
      ),
    );
  const table = async (name: string) =>
    JSON.parse(
      await readFile(
        new URL(`../src/palettes/data/${name}.json`, import.meta.url),
        'utf8',
      ),
    );
  const resolve = (fields: object) =>
    resolveAppearance(inspectChara(readChara(JSON.stringify(fields))), {
      palettes: createDefaultPaletteProvider(),
    });
  const COLORED = [
    'leftEye',
    'rightEye',
    'hair',
    'highlights',
    'skin',
    'limbal',
  ] as const;

  it('stores the colors without the flag, so each slot shows its palette color as inactive evidence', async () => {
    const fields = await fixture();
    expect(Object.hasOwn(fields, 'IsExtendedAppearanceValid')).toBe(false);
    for (const key of [
      'SkinColor',
      'LeftEyeColor',
      'RightEyeColor',
      'LimbalRingColor',
      'HairColor',
      'HairHighlight',
    ])
      expect(typeof fields[key], key).toBe('string');
    const { eyes, highlights, features } = await table('creator-shared');
    const { hair, skin } = await table('creator-race');
    const result = await resolve(fields);
    for (const slot of COLORED)
      expect(result.slots[slot], slot).toMatchObject({
        interpretation: 'palette',
        reason: 'extendedInactive',
        extendedActive: false,
        active: true,
      });
    expect(result.slots.leftEye.displayHex).toBe(eyes[169]);
    expect(result.slots.rightEye.displayHex).toBe(eyes[42]);
    expect(result.slots.hair.displayHex).toBe(hair.Duskwight.Female[71]);
    // Highlights 36, Skintone 0 and LimbalEyes 7 read from their own palettes, not from the stored colors.
    expect(result.slots.highlights.displayHex).toBe(highlights[36]);
    expect(result.slots.skin.displayHex).toBe(skin.Duskwight.Female[0]);
    expect(result.slots.limbal.displayHex).toBe(features[7]);
    expect(result.corrections).toEqual([]);
  });

  it.each([
    ['leftEye', 'LeftEyeColor'],
    ['rightEye', 'RightEyeColor'],
    ['hair', 'HairColor'],
    ['highlights', 'HairHighlight'],
    ['skin', 'SkinColor'],
    ['limbal', 'LimbalRingColor'],
  ] as const)(
    'keeps a custom stored color from changing the %s swatch while the flag is absent',
    async (slot, field) => {
      const fields = await fixture();
      const plain = await resolve(fields);
      // A stored color far from every palette color of that slot.
      const custom = await resolve({ ...fields, [field]: '1, 0, 0' });
      expect(custom.slots[slot]).toMatchObject({
        interpretation: 'palette',
        reason: 'extendedInactive',
        displayHex: plain.slots[slot].displayHex,
      });
      expect(custom.slots[slot].displayHex).not.toBe('#FF0000');
    },
  );

  it('reads the same stored colors as live, and equal to the palette, once the flag is added', async () => {
    const fields = await fixture();
    const result = await resolve({
      ...fields,
      IsExtendedAppearanceValid: true,
    });
    for (const slot of COLORED)
      expect(result.slots[slot], slot).toMatchObject({
        interpretation: 'palette',
        reason: 'paletteAgreement',
        extendedActive: true,
        deltaE: 0,
      });
  });

  it('makes a custom color off-grid only with the flag', async () => {
    const fields = await fixture();
    const result = await resolve({
      ...fields,
      HairColor: '0.25, 0, 0',
      IsExtendedAppearanceValid: true,
    });
    // Gamma 2 decodes 0.25 to sqrt(0.25) * 255 = 127.5, which rounds to 128 (0x80); a linear
    // decoding would give 64 (0x40).
    expect(result.slots.hair).toMatchObject({
      interpretation: 'offGrid',
      displayHex: '#800000',
    });
  });

  it('keeps a stored lip color off a Hrothgar fur pattern without the flag, and shows it with the flag', async () => {
    // Hrothgar's LipsToneFurPattern is a fur enum: only a live mouth color can supply a lip swatch.
    const fields = {
      ...(await fixture()),
      Tribe: 'Helions',
      Mouth: 2 | 0x80,
      MouthColor: '0.5, 0.2, 0.2, 1',
    };
    const without = await resolve(fields);
    expect(without.slots.lip).toMatchObject({
      active: false,
      interpretation: 'inactive',
      reason: 'furPattern',
      extendedActive: false,
      displayHex: null,
    });
    const live = await resolve({ ...fields, IsExtendedAppearanceValid: true });
    // Gamma 2: sqrt(0.5) * 255 = 180.3 (0xB4) and sqrt(0.2) * 255 = 114.0 (0x72).
    expect(live.slots.lip).toMatchObject({
      interpretation: 'extendedOnly',
      reason: 'floatOnly',
      extendedActive: true,
      displayHex: '#B47272',
    });
  });

  it('makes no swatch from a stored color for a palette index that is missing, unless the flag is added', async () => {
    const { Skintone: _skin, HairTone: _hair, ...fields } = await fixture();
    const without = await resolve(fields);
    for (const slot of ['skin', 'hair'] as const)
      expect(without.slots[slot], slot).toMatchObject({
        interpretation: 'unresolved',
        reason: 'missingColor',
        displayHex: null,
      });
    const live = await resolve({ ...fields, IsExtendedAppearanceValid: true });
    for (const slot of ['skin', 'hair'] as const)
      expect(live.slots[slot], slot).toMatchObject({
        interpretation: 'extendedOnly',
        reason: 'floatOnly',
      });
  });

  it('shows the palette lip where a Brio-shaped file with zero opacity shows none', async () => {
    const fields = { ...(await fixture()), Mouth: 2 | 0x80 };
    const { lipsDark } = await table('creator-shared');
    const withoutFlag = await resolve(fields);
    expect(withoutFlag.slots.lip).toMatchObject({
      interpretation: 'palette',
      reason: 'extendedInactive',
      displayHex: lipsDark[53],
    });
    // MouthColor "0, 0, 0, 0" is a live opacity of zero once the flag is true.
    const withFlag = await resolve({
      ...fields,
      IsExtendedAppearanceValid: true,
    });
    expect(withFlag.slots.lip).toMatchObject({
      active: false,
      interpretation: 'inactive',
      reason: 'noLip',
      displayHex: null,
    });
  });
});

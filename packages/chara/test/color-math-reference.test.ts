import { describe, expect, it } from 'vitest';
import {
  compositeHex,
  deltaE2000Lab,
  hexDeltaE,
} from '../src/appearance/color-math.js';

// Expected values come from outside the code under test: the published CIEDE2000 test data of
// Sharma, Wu and Dalal (2005), the published sRGB D65 Lab values of the primaries (Lindbloom), and
// a separate textbook computation for the other colors (IEC 61966-2-1 transfer curve, the same
// matrix, and the older 0.008856 / 7.787 Lab constants).

type Lab = readonly [number, number, number];
// L1 a1 b1, L2 a2 b2, dE00: the 34 pairs of the Sharma, Wu and Dalal supplementary data.
const SHARMA: [Lab, Lab, number][] = [
  [[50.0, 2.6772, -79.7751], [50.0, 0.0, -82.7485], 2.0425],
  [[50.0, 3.1571, -77.2803], [50.0, 0.0, -82.7485], 2.8615],
  [[50.0, 2.8361, -74.02], [50.0, 0.0, -82.7485], 3.4412],
  [[50.0, -1.3802, -84.2814], [50.0, 0.0, -82.7485], 1.0],
  [[50.0, -1.1848, -84.8006], [50.0, 0.0, -82.7485], 1.0],
  [[50.0, -0.9009, -85.5211], [50.0, 0.0, -82.7485], 1.0],
  [[50.0, 0.0, 0.0], [50.0, -1.0, 2.0], 2.3669],
  [[50.0, -1.0, 2.0], [50.0, 0.0, 0.0], 2.3669],
  [[50.0, 2.49, -0.001], [50.0, -2.49, 0.0009], 7.1792],
  [[50.0, 2.49, -0.001], [50.0, -2.49, 0.001], 7.1792],
  [[50.0, 2.49, -0.001], [50.0, -2.49, 0.0011], 7.2195],
  [[50.0, 2.49, -0.001], [50.0, -2.49, 0.0012], 7.2195],
  [[50.0, -0.001, 2.49], [50.0, 0.0009, -2.49], 4.8045],
  [[50.0, -0.001, 2.49], [50.0, 0.001, -2.49], 4.8045],
  [[50.0, -0.001, 2.49], [50.0, 0.0011, -2.49], 4.7461],
  [[50.0, 2.5, 0.0], [50.0, 0.0, -2.5], 4.3065],
  [[50.0, 2.5, 0.0], [73.0, 25.0, -18.0], 27.1492],
  [[50.0, 2.5, 0.0], [61.0, -5.0, 29.0], 22.8977],
  [[50.0, 2.5, 0.0], [56.0, -27.0, -3.0], 31.903],
  [[50.0, 2.5, 0.0], [58.0, 24.0, 15.0], 19.4535],
  [[50.0, 2.5, 0.0], [50.0, 3.1736, 0.5854], 1.0],
  [[50.0, 2.5, 0.0], [50.0, 3.2972, 0.0], 1.0],
  [[50.0, 2.5, 0.0], [50.0, 1.8634, 0.5757], 1.0],
  [[50.0, 2.5, 0.0], [50.0, 3.2592, 0.335], 1.0],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
  [[61.2901, 3.7196, -5.3901], [61.4292, 2.248, -4.962], 1.8731],
  [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
  [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  [[36.4612, 47.858, 18.3852], [36.2715, 50.5065, 21.2231], 1.4146],
  [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
  [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
  [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
  [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
];

// Pairs that sit in the narrow windows where the hue arithmetic changes branch: a hue difference
// just over 180 degrees (wrapped) in either direction, and a hue difference over 180 degrees whose
// mean needs the other correction. Expected values come from a separate implementation written
// from the paper's equations, which reproduces the published pairs above.
const HUE_WINDOWS: [Lab, Lab, number][] = [
  [[43.3, 55.5, 30.2], [59.4, -34.5, -19.1], 74.107047], // h 28.51 and 208.93: difference 180.42
  [[36.3, -52.4, -58.9], [78.9, 37.4, 41.3], 78.756081], // h 228.34 and 47.83: difference -180.51
  [[48, -19.5, 25.4], [30.9, 37.8, -49.2], 61.519558], // h 127.60 and 307.62: difference 180.02
  // Mean hue about 277, where the rotation term is large, so the sign of the hue difference decides:
  [[51.2, 99.109, 12.814], [51, -29.868, -3.888], 58.436527], // difference 180.05
  [[37.1, 30.334, 3.428], [35.8, -99.134, -11.764], 88.227149], // difference 180.32
];

describe('CIEDE2000 against the published Sharma, Wu and Dalal pairs', () => {
  it('has all 34 pairs', () => {
    expect(SHARMA).toHaveLength(34);
  });
  it.each(SHARMA.map((pair, i) => [i + 1, ...pair] as const))(
    'pair %i matches in both directions',
    (_n, first, second, expected) => {
      expect(deltaE2000Lab(first, second)).toBeCloseTo(expected, 4);
      expect(deltaE2000Lab(second, first)).toBeCloseTo(expected, 4);
    },
  );
});

// Published sRGB (D65) Lab of the primaries and secondaries; the dark and mixed colors come from the
// separate textbook computation described above.
const LABS: Record<string, Lab> = {
  '#000000': [0, 0, 0],
  '#FFFFFF': [100, 0, 0],
  '#FF0000': [53.2408, 80.0925, 67.2032],
  '#00FF00': [87.7347, -86.1827, 83.1793],
  '#0000FF': [32.297, 79.1875, -107.8602],
  '#FFFF00': [97.1393, -21.5537, 94.478],
  '#00FFFF': [91.1132, -48.0875, -14.1312],
  '#FF00FF': [60.3242, 98.2343, -60.8249],
  // A channel at or below 10 is on the linear part of the transfer curve.
  '#0A0000': [0.5831, 2.615, 0.9214],
  '#000A00': [1.9608, -4.0056, 2.8631],
  '#00000A': [0.1979, 1.3905, -3.7845],
  '#080808': [2.1934, 0, 0],
  '#0A0A0A': [2.7417, 0, 0],
  '#0A8040': [46.806, -44.7859, 26.4812],
  '#808080': [53.585, 0, 0],
  '#C04060': [46.6064, 53.4038, 10.1056],
  '#E0B090': [75.3979, 13.1422, 23.078],
};

// Pairs just under 180 degrees (179.60, -179.72 and 179.94), where the hue difference is not
// wrapped and the mean hue is near 270, so the rotation term is at its largest. A wrap threshold that
// is a degree early changes the first two by about 35 units, and one that is only 0.06 degrees
// early still changes the third by 29. Values from the same separate implementation.
const JUST_UNDER_180: [Lab, Lab, number][] = [
  [[70.38, -99.26, 0.05], [62.35, 20.02, -0.15], 73.337335],
  [[57.12, 99.93, -2.2], [56.64, -20.55, 0.35], 37.921948],
  [[55.8, -99.947, 0.902], [57.2, 30.564, -0.307], 79.569734],
];

describe('CIEDE2000 where the hue difference is near 180 degrees', () => {
  it.each(HUE_WINDOWS.map((pair, i) => [i + 1, ...pair] as const))(
    'pair %i, just over 180, matches the separate implementation in both directions',
    (_n, first, second, expected) => {
      expect(deltaE2000Lab(first, second)).toBeCloseTo(expected, 5);
      expect(deltaE2000Lab(second, first)).toBeCloseTo(expected, 5);
    },
  );
  it.each(JUST_UNDER_180.map((pair, i) => [i + 1, ...pair] as const))(
    'pair %i, just under 180, matches the separate implementation in both directions',
    (_n, first, second, expected) => {
      expect(deltaE2000Lab(first, second)).toBeCloseTo(expected, 5);
      expect(deltaE2000Lab(second, first)).toBeCloseTo(expected, 5);
    },
  );
  it('measures two colors 179.6 degrees apart in hue as the separate implementation does', () => {
    // #36F1BA and #F733AE: a raw hue difference of 179.62 degrees and a mean hue of 256.
    expect(hexDeltaE('#36F1BA', '#F733AE')).toBeCloseTo(62.9045, 3);
    expect(hexDeltaE('#F733AE', '#36F1BA')).toBeCloseTo(62.9045, 3);
  });
});

describe('hex to Lab conversion, through the distance between colors', () => {
  const names = Object.keys(LABS);
  const pairs = names.flatMap((a, i) =>
    names.slice(i + 1).map((b) => [a, b] as const),
  );
  it('covers every unordered pair of the reference colors', () => {
    expect(pairs).toHaveLength((names.length * (names.length - 1)) / 2);
  });
  it.each(pairs)(
    'measures %s against %s as the reference Lab values do',
    (a, b) => {
      // Within 0.01: CIEDE2000 is discontinuous at exactly zero chroma, and the library's own white
      // and greys keep a rounding residue of about 2e-5 in a and b that the reference does not.
      const expected = deltaE2000Lab(LABS[a] as Lab, LABS[b] as Lab);
      expect(Math.abs(hexDeltaE(a, b) - expected)).toBeLessThan(0.01);
      expect(Math.abs(hexDeltaE(b, a) - expected)).toBeLessThan(0.01);
    },
  );
  it('puts green and blue about 83.19 apart (all three channels, not only greys)', () => {
    expect(hexDeltaE('#00FF00', '#0000FF')).toBeCloseTo(83.186, 2);
  });
  it('follows the linear part of the Lab curve below a luminance of 0.008856 and the cube root above it', () => {
    // Luminances of 0.00857 (#171717), 0.00913 (#181818) and 0.00972 (#191919) straddle the knee
    // and are compared with black; the grays have no chroma, so the distance is the lightness, and
    // the tolerance is as tight as the four decimals of the reference L. The first four are on the
    // linear part, where the cube root would give distances up to 0.6 smaller.
    const grays: [string, Lab][] = [
      ['#0B0B0B', [3.0229, 0, 0]],
      ['#0E0E0E', [3.9668, 0, 0]],
      ['#0F0F0F', [4.315, 0, 0]],
      ['#101010', [4.6804, 0, 0]],
      ['#171717', [7.7395, 0, 0]],
      ['#181818', [8.2482, 0, 0]],
      ['#191919', [8.757, 0, 0]],
      ['#1A1A1A', [9.2632, 0, 0]],
    ];
    for (const [hex, lab] of grays)
      expect(
        Math.abs(hexDeltaE(hex, '#000000') - deltaE2000Lab(lab, [0, 0, 0])),
        hex,
      ).toBeLessThan(0.0002);
  });
  it('treats a lowercase hex like an uppercase one', () => {
    expect(hexDeltaE('#c04060', '#E0B090')).toBe(
      hexDeltaE('#C04060', '#E0B090'),
    );
  });
});

describe('compositing in linear light', () => {
  // Computed separately with the sRGB transfer curve and the same rounding.
  it.each([
    ['#C04060', '#E0B090', 0.6, '#CE7D76'],
    ['#C04060', '#E0B090', 0.25, '#D99D86'],
    ['#C04060', '#E0B090', 0.9, '#C45466'],
    ['#102030', '#F0E0D0', 0.5, '#B1A69C'],
    ['#FF0000', '#0000FF', 0.5, '#BC00BC'],
    ['#FFFFFF', '#000000', 0.5, '#BCBCBC'],
    ['#0A0A0A', '#000000', 0.5, '#050505'],
    // Results on the linear part of the curve (below 0.0031308) and just above it.
    ['#0A0A0A', '#000000', 1, '#0A0A0A'],
    ['#0B0B0B', '#000000', 1, '#0B0B0B'],
    ['#0C0C0C', '#000000', 1, '#0C0C0C'],
    ['#202020', '#000000', 1, '#202020'],
    ['#404040', '#000000', 0.25, '#1E1E1E'],
    ['#808080', '#000000', 0.05, '#1B1B1B'],
    ['#101010', '#000000', 0.5, '#090909'],
    ['#303030', '#101010', 0.5, '#242424'],
    // Results whose linear value is just above the encoder's knee (0.0031308), at alpha below 1
    // (linear values 0.0072, 0.008 and 0.01), and a channel just above the decoder's (10 and 15).
    ['#202020', '#000000', 0.5, '#141414'],
    ['#FFFFFF', '#000000', 0.008, '#161616'],
    ['#FFFFFF', '#000000', 0.01, '#191919'],
    ['#0F0F0F', '#000000', 1, '#0F0F0F'],
    ['#0F0F0F', '#000000', 0.5, '#080808'],
  ])('puts %s over %s at %s as %s', (top, base, alpha, expected) => {
    expect(compositeHex(top, base, alpha)).toBe(expected);
  });
  it('is the top color at alpha 1 and the base at alpha 0, whatever the colors', () => {
    expect(compositeHex('#C04060', '#E0B090', 1)).toBe('#C04060');
    expect(compositeHex('#C04060', '#E0B090', 0)).toBe('#E0B090');
  });
  it('clamps alpha to 0 and 1', () => {
    expect(compositeHex('#C04060', '#E0B090', 7)).toBe('#C04060');
    expect(compositeHex('#C04060', '#E0B090', -3)).toBe('#E0B090');
  });
});

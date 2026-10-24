import { verifyFixtures } from './fixtures-check.js';

const report = await verifyFixtures({
  fixturesRoot: new URL('../fixtures/', import.meta.url),
  examplesRoot: new URL('../apps/demo/public/examples/', import.meta.url),
});
console.log(
  `Verified ${report.fixtures} character fixtures (every .chara file under fixtures/ is listed), the equipment-row and appearance-expectation hashes, and ${report.examples} exact synthetic public example copies; identity/facewear expectations checked.`,
);

import { CharaInputError, inspectChara, readChara } from 'xivcharakit';
import { projectAppearance } from './project.js';
import type { WorkerReply, WorkerRequest } from './types.js';

const context = globalThis as unknown as {
  onmessage: (event: MessageEvent<WorkerRequest>) => void;
  postMessage(value: WorkerReply): void;
};
context.onmessage = async (event) => {
  const request = event.data;
  let inspected = false;
  try {
    // A resumed job already has its inspection on the page, so only the colors are resolved.
    const inspection =
      request instanceof Blob
        ? inspectChara(readChara(new Uint8Array(await request.arrayBuffer())))
        : request.inspection;
    inspected = true;
    if (request instanceof Blob)
      context.postMessage({ type: 'inspection', inspection });
    const [appearance, palettes] = await Promise.all([
      import('xivcharakit/appearance'),
      import('xivcharakit/palettes'),
    ]);
    const result = await appearance.resolveAppearance(inspection, {
      palettes: palettes.createDefaultPaletteProvider(),
    });
    context.postMessage({
      type: 'appearance',
      appearance: projectAppearance(result),
    });
  } catch (error) {
    context.postMessage({
      type: 'rejected',
      code: inspected
        ? 'APPEARANCE_UNAVAILABLE'
        : error instanceof CharaInputError
          ? error.code
          : 'FILE_READ_FAILED',
    });
  }
};

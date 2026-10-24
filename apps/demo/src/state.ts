import type { CharaInspection, EquipmentModel } from 'xivcharakit';
import type { DyeNameResolver } from 'xivcharakit/dyes';
import { loadIcons } from './icons.js';
import type { DemoState, WorkerReply } from './types.js';

const MAX_BYTES = 8 * 1024 * 1024;
/** Why a file was refused for its size: Anamnesis can save an image that takes it past the limit. */
const sizeHint = (code: string): string =>
  code === 'FILE_TOO_LARGE' || code === 'INPUT_TOO_LARGE'
    ? ' The demo reads files up to 8 MiB. An Anamnesis file saved with a large embedded image can be bigger; the library can read most of those when its maxBytes option is raised (up to 64 MiB).'
    : '';
export class DemoSession {
  readonly state: DemoState = {
    fileName: null,
    inspection: null,
    appearance: null,
    appearanceStatus: 'idle',
    resolution: null,
    dyeNames: null,
    error: null,
    errorSerial: 0,
    localStatus: 'Choose a file or try a synthetic example.',
    reading: false,
    lookingUp: false,
    lookupMessage: '',
    icons: new Map(),
  };
  private generation = 0;
  private lookupToken = 0;
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | null = null;
  private exampleController: AbortController | null = null;
  private dyeResolver: DyeNameResolver | undefined;
  constructor(private readonly changed: (kind?: 'icons') => void) {}
  private raise(message: string): void {
    this.state.error = message;
    this.state.errorSerial++;
  }
  private stopWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    clearTimeout(this.timer);
  }
  private stopLookup(): void {
    this.lookupToken++;
    this.controller?.abort();
    this.controller = null;
    for (const url of this.state.icons.values()) URL.revokeObjectURL(url);
    this.state.icons.clear();
    this.state.lookingUp = false;
  }
  private begin(): number {
    this.generation++;
    this.stopWorker();
    this.stopLookup();
    this.exampleController?.abort();
    this.state.resolution = null;
    this.state.dyeNames = null;
    this.state.lookupMessage = '';
    this.state.error = null;
    return this.generation;
  }
  clear(): void {
    this.begin();
    this.state.fileName = null;
    this.state.inspection = null;
    this.state.appearance = null;
    this.state.appearanceStatus = 'idle';
    this.state.reading = false;
    this.state.localStatus = 'Choose a file or try a synthetic example.';
    this.changed();
  }
  cancelLookup(): void {
    this.stopLookup();
    this.state.resolution = null;
    this.state.dyeNames = null;
    this.state.lookupMessage = 'Lookup cancelled.';
    this.changed();
  }
  load(file: File): void {
    this.start(file, this.begin());
  }
  private start(file: File, generation: number): void {
    if (!/\.chara$/i.test(file.name)) {
      this.reject('FILE_EXTENSION');
      return;
    }
    if (file.size > MAX_BYTES) {
      this.reject('FILE_TOO_LARGE');
      return;
    }
    this.state.reading = true;
    this.state.localStatus = 'Reading locally…';
    this.changed();
    this.run(file, generation);
  }
  /** Runs the worker for a new file, or resumes the colors of the inspection the page retained. */
  private run(
    request: File | { inspection: CharaInspection },
    generation: number,
    rejected?: string,
  ): void {
    const file = request instanceof File ? request : null;
    let committed = file === null;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;
    const fail = (code: string) => {
      if (generation !== this.generation) return;
      this.stopWorker();
      if (committed) {
        this.state.appearanceStatus = 'unavailable';
        this.state.reading = false;
        // A resumed job belongs to a rejected replacement: keep that rejection in the message,
        // and do not say that the selected file was inspected.
        this.raise(
          rejected === undefined
            ? `${code}: Appearance could not be resolved. The selected file remains inspected.`
            : `${rejected}: Could not finish local inspection. Your previous valid file is retained. ${code}: The previous file's colors could not be resolved.${sizeHint(rejected)}`,
        );
        this.state.localStatus =
          rejected === undefined
            ? 'File inspected locally. Color evidence unavailable.'
            : 'File rejected. Color evidence for the previous file is unavailable.';
        this.changed();
      } else this.reject(code);
    };
    this.timer = setTimeout(
      () => fail(committed ? 'APPEARANCE_TIMEOUT' : 'PROCESSING_TIMEOUT'),
      5000,
    );
    worker.onerror = (event) => {
      event.preventDefault();
      fail('PROCESSING_FAILED');
    };
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      if (generation !== this.generation) return;
      const message = event.data;
      if (message.type === 'inspection') {
        committed = true;
        this.state.fileName = file?.name.slice(0, 256) ?? null;
        this.state.inspection = message.inspection;
        this.state.appearance = null;
        this.state.appearanceStatus = 'loading';
        this.state.localStatus =
          'File inspected locally. Loading color evidence…';
        this.changed();
      } else if (message.type === 'appearance') {
        this.state.appearance = message.appearance;
        this.state.appearanceStatus = 'ready';
        this.state.reading = false;
        this.state.localStatus =
          rejected === undefined
            ? 'File inspected locally.'
            : 'File rejected or processing incomplete.';
        this.stopWorker();
        this.changed();
      } else fail(message.code);
    };
    worker.postMessage(
      request instanceof File
        ? request
        : { type: 'appearance', inspection: request.inspection },
    );
  }
  private reject(code: string): void {
    this.raise(
      `${code}: Could not finish local inspection. Your previous valid file is retained.${sizeHint(code)}`,
    );
    this.state.reading = false;
    this.state.localStatus = 'File rejected or processing incomplete.';
    // begin() stopped the worker that was still resolving the retained file's colors.
    if (this.state.inspection && this.state.appearanceStatus === 'loading') {
      this.state.reading = true;
      this.state.localStatus =
        'File rejected. Loading color evidence for the previous file…';
      this.run({ inspection: this.state.inspection }, this.generation, code);
    }
    this.changed();
  }
  async example(producer: 'anamnesis' | 'ktisis' | 'brio'): Promise<void> {
    const generation = this.begin();
    const control = new AbortController();
    this.exampleController = control;
    this.state.reading = true;
    this.state.localStatus = 'Loading synthetic example…';
    this.changed();
    try {
      const response = await fetch(`/examples/${producer}.chara`, {
        signal: control.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('EXAMPLE_UNAVAILABLE');
      const blob = await response.blob();
      if (generation === this.generation)
        this.start(new File([blob], `${producer}.chara`), generation);
    } catch {
      if (generation === this.generation && !control.signal.aborted)
        this.reject('EXAMPLE_UNAVAILABLE');
    }
  }
  async resolve(): Promise<void> {
    const inspection = this.state.inspection;
    if (!inspection || this.state.lookingUp) return;
    this.stopLookup();
    const token = this.lookupToken;
    const generation = this.generation;
    const current = () =>
      token === this.lookupToken && generation === this.generation;
    const control = new AbortController();
    this.controller = control;
    this.state.lookingUp = true;
    this.state.lookupMessage = 'Looking up equipment and dye IDs…';
    this.state.resolution = null;
    this.state.dyeNames = null;
    this.changed();
    try {
      const { createXivapiResolver } = await import('xivcharakit/xivapi');
      const { createDyeNameResolver } = await import('xivcharakit/dyes');
      if (!current()) return;
      this.dyeResolver ??= createDyeNameResolver({ languages: ['en'] });
      const dyeIds = Object.values(inspection.equipment).flatMap((equipment) =>
        [equipment.dye1, equipment.dye2].flatMap((dye) =>
          dye.state === 'valid' && dye.value > 0 ? [dye.value] : [],
        ),
      );
      // Sequential components preserve the demo's existing request concurrency bound.
      const dyeNames = await this.dyeResolver.resolve(dyeIds, {
        signal: control.signal,
      });
      if (!current()) return;
      this.state.dyeNames = dyeNames;
      this.changed();
      const models: EquipmentModel[] = Object.values(inspection.equipment)
        .filter((e) => e.status === 'worn')
        .flatMap((e) => (e.model ? [{ ...e.model }] : []));
      const glassesId =
        inspection.facewear.state === 'valid' && inspection.facewear.value > 0
          ? inspection.facewear.value
          : undefined;
      const result = await createXivapiResolver().resolve(
        { models, ...(glassesId === undefined ? {} : { glassesId }) },
        { signal: control.signal },
      );
      if (!current()) return;
      this.state.resolution = result;
      this.state.lookingUp = false;
      this.state.lookupMessage =
        (this.state.dyeNames.status === 'complete'
          ? 'Lookup finished. '
          : 'Lookup finished. Some dye names are unavailable. ') +
        'Candidate matches do not establish the original item.';
      this.changed();
      await loadIcons(result, control.signal, (key, url) => {
        if (!current()) {
          URL.revokeObjectURL(url);
          return;
        }
        this.state.icons.set(key, url);
        this.changed('icons');
      });
    } catch {
      if (current()) {
        this.state.lookingUp = false;
        this.state.lookupMessage =
          'Lookup unavailable. Local inspection remains usable.';
        this.changed();
      }
    }
  }
}

import { execFileSync } from 'node:child_process';

/**
 * Run a tool synchronously. With piped output execFileSync reports only "Command failed" plus
 * stderr, but TypeScript writes its diagnostics to stdout, so a failing compile of an installed
 * consumer showed none of its errors. The error thrown here carries both streams.
 */
export function runTool(
  file: string,
  args: readonly string[],
  options: { cwd?: string; timeout?: number } = {},
): string {
  try {
    return execFileSync(file, args, {
      ...options,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (error) {
    const failure = error as Error & {
      status?: number | null;
      signal?: string | null;
      stdout?: unknown;
      stderr?: unknown;
    };
    const output = `${String(failure.stdout ?? '')}${String(failure.stderr ?? '')}`;
    const how =
      failure.status != null
        ? `exit status ${failure.status}`
        : failure.signal
          ? `signal ${failure.signal}`
          : 'no exit status';
    throw new Error(`${failure.message} (${how})\n${output}`.trim(), {
      cause: error,
    });
  }
}

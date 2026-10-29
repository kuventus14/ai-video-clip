export function linePrefixer(prefix: string, sink: (line: string) => void): { write(chunk: Buffer): void; flush(): void }
export function parseAppArgs(argv: string[]): { dev: boolean; rebuild: boolean }
export function latestMtimeMs(paths: string[]): number
export function needsBuild(root: string): boolean
export function isPortFree(port: number, host: string): Promise<boolean>
export function createSignalHandler<C>(o: {
  listChildren: () => Iterable<C>
  terminate: (child: C) => void
  killGroup: (child: C) => void
  exit: (code: number) => void
  say: (message: string) => void
  now?: () => number
  debounceMs?: number
}): (signal?: string) => 'graceful' | 'ignored' | 'force'
export function killTree(
  pid: number | undefined,
  o?: { platform?: NodeJS.Platform; spawnSync?: (...args: unknown[]) => unknown; kill?: (...args: unknown[]) => unknown },
): void
export function nextBinPath(root: string): string

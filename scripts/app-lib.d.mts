export function linePrefixer(prefix: string, sink: (line: string) => void): { write(chunk: Buffer): void; flush(): void }
export function parseAppArgs(argv: string[]): { dev: boolean; rebuild: boolean }
export function latestMtimeMs(paths: string[]): number
export function needsBuild(root: string): boolean
export function isPortFree(port: number, host: string): Promise<boolean>

/** Types for the parts of build-fresh.mjs the TypeScript probes import. */
export declare const SOURCE_ROOT: string
export declare const CONFIG_FILE: string
export declare const OUTPUT_ROOT: string
export declare const STAMP_FILE: string

/** Everything that changes what electron-vite puts in out/. */
export declare const BUILD_INPUTS: string[]

export interface SourceSnapshot {
  files: Record<string, string>
  digest: string
  newest: { file: string; mtimeMs: number; at: string } | null
}

export declare function sourceSnapshot(inputs?: string[]): SourceSnapshot

export declare function writeBuildStamp(options?: {
  inputs?: string[]
  out?: string
  stamp?: string
}): unknown

export declare function buildFreshnessProblem(options?: {
  inputs?: string[]
  out?: string
  stamp?: string
}): { reason: string; remedy: string } | null

/** Exit with EXIT_NOT_READY unless out/ was built from the current inputs. */
export declare function assertBuildFresh(options?: {
  label?: string
  inputs?: string[]
  out?: string
  stamp?: string
}): void

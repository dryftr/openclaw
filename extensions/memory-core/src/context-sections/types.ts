/**
 * Context Injection Phase 3 — P3-BI-1: Runtime Loader
 *
 * Type definitions for tier-aware context section loading and injection.
 *
 * Sections are loaded from `memory/` directory files (per Phase 1 partition).
 * Each section has a tier assignment that controls when and how it's injected
 * into the agent context during `assemble()`.
 *
 * @see PHASE3-SCOPING.md — P3-BI-1 for architecture and data flow.
 */

// ---------------------------------------------------------------------------
// Tier assignments
// ---------------------------------------------------------------------------

/**
 * Tier assignments for context sections.
 *
 * - **always** — Injected unconditionally into every assemble() call.
 *   Cannot be silently truncated (P3-BI-2 enforces hard block).
 * - **active** — Injected when token budget allows. Overflow degrades
 *   gracefully via deterministic threshold (P3-BI-2 soft block).
 * - **on-demand** — Injected only when explicitly requested or
 *   relevance-matched. Not loaded by default.
 */
export type ContextSectionTier = "always" | "active" | "on-demand";

/** Default tier when frontmatter is absent. */
export const DEFAULT_SECTION_TIER: ContextSectionTier = "active";

// ---------------------------------------------------------------------------
// Section metadata (frontmatter)
// ---------------------------------------------------------------------------

/**
 * Parsed frontmatter from a section file.
 *
 * If frontmatter is absent, defaults are applied:
 * - tier: "active"
 * - priority: 50
 * - maxLength: 5000
 * - required: false
 */
export type ContextSectionMetadata = {
  /** Tier assignment controlling injection behavior. */
  tier: ContextSectionTier;
  /**
   * Priority for ordering within a tier. Lower = higher priority.
   * Sections with the same tier are ordered by priority ascending.
   */
  priority: number;
  /**
   * Maximum character length for the section content.
   * Sections exceeding this length are truncated with a marker.
   * Set to 0 to disable truncation (use with caution).
   */
  maxLength: number;
  /**
   * If true, assemble() MUST include this section when its tier allows it.
   * A required section that fails to load produces a warning log, not a crash.
   * Required sections in the "always" tier are hard-blocked from truncation.
   */
  required: boolean;
};

/** Default metadata values when frontmatter is absent. */
export const DEFAULT_SECTION_METADATA: ContextSectionMetadata = {
  tier: DEFAULT_SECTION_TIER,
  priority: 50,
  maxLength: 5000,
  required: false,
};

// ---------------------------------------------------------------------------
// Parsed section (loader output)
// ---------------------------------------------------------------------------

/**
 * A fully parsed and validated context section, ready for injection.
 *
 * This is the primary data structure produced by the ContextSectionLoader.
 */
export type ContextSection = {
  /**
   * Absolute or workspace-relative path to the section file.
   * Used for provenance, logging, and audit trails.
   */
  filePath: string;
  /**
   * Section filename without extension (e.g., "projects" from "projects.md").
   * Used as a display key and injection identifier.
   */
  sectionId: string;
  /** Parsed frontmatter metadata. Always populated (defaults applied). */
  metadata: ContextSectionMetadata;
  /** Raw content of the section, excluding frontmatter. */
  content: string;
  /**
   * SHA-256 hash of the content for integrity verification.
   * Computed after frontmatter stripping, before any truncation.
   */
  contentHash: string;
  /**
   * Character length of content after truncation (if applicable).
   * Equal to content.length unless truncation was applied.
   */
  effectiveLength: number;
  /** Whether this section was truncated to fit maxLength. */
  wasTruncated: boolean;
};

// ---------------------------------------------------------------------------
// Injection parameters (passed to injector)
// ---------------------------------------------------------------------------

/**
 * Parameters controlling which sections get injected during assemble().
 */
export type ContextSectionInjectionParams = {
  /**
   * Token budget for the entire context. Sections are injected
   * in tier+priority order until the budget is exhausted.
   */
  tokenBudget: number;
  /**
   * Estimated tokens per character for budget calculation.
   * Default: 0.25 (4 chars per token, conservative for English).
   */
  tokensPerChar?: number;
  /**
   * Explicitly requested section IDs (for on-demand tier).
   * These sections are injected even though their tier is "on-demand".
   */
  requestedSectionIds?: string[];
  /**
   * Whether relevance matching should be attempted for on-demand sections.
   * When true, on-demand sections whose content matches the prompt
   * may be injected even without explicit request.
   */
  enableRelevanceMatching?: boolean;
  /**
   * The incoming user prompt for relevance matching.
   * Only used when enableRelevanceMatching is true.
   */
  prompt?: string;
};

/** Default tokens-per-char estimate. Conservative for English text. */
export const DEFAULT_TOKENS_PER_CHAR = 0.25;

// ---------------------------------------------------------------------------
// Injection result (injector output)
// ---------------------------------------------------------------------------

/**
 * Result of injecting context sections into an assemble() call.
 */
export type ContextSectionInjectionResult = {
  /** Sections that were successfully injected, in injection order. */
  injected: ContextSection[];
  /** Sections that were skipped due to budget or tier constraints. */
  skipped: ContextSection[];
  /** Estimated token count consumed by injected sections. */
  tokensConsumed: number;
  /** Remaining token budget after injection. */
  tokensRemaining: number;
  /**
   * Whether any "always" tier section was truncated.
   * Should always be false after P3-BI-2 hard-block enforcement.
   * Logged as a warning if true.
   */
  alwaysTierTruncationOccurred: boolean;
};

// ---------------------------------------------------------------------------
// Loader configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the ContextSectionLoader.
 */
export type ContextSectionLoaderConfig = {
  /**
   * Path to the memory directory containing section files.
   * Typically `<workspace>/memory/`.
   */
  memoryDir: string;
  /**
   * Path to the root MEMORY.md file.
   * The "always" tier content from MEMORY.md is the core always-inject.
   */
  rootMemoryFile?: string;
  /**
   * File extensions to consider as section files.
   * Default: [".md"]
   */
  sectionExtensions?: string[];
  /**
   * Whether to validate content hashes on load.
   * Default: true
   */
  validateHashes?: boolean;
  /**
   * Maximum section file size in bytes. Files exceeding this are skipped.
   * Default: 100_000 (100KB)
   */
  maxFileSize?: number;
};

/** Default loader configuration values. */
export const DEFAULT_LOADER_CONFIG: {
  sectionExtensions: string[];
  validateHashes: boolean;
  maxFileSize: number;
} = {
  sectionExtensions: [".md"],
  validateHashes: true,
  maxFileSize: 100_000,
};

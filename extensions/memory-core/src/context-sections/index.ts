/**
 * Context Injection Phase 3 — P3-BI-1: Runtime Loader
 *
 * Public API for the context sections module.
 *
 * Usage:
 *   import { ContextSectionLoader, injectContextSections } from "./context-sections/index.js";
 *
 * The loader reads section files from `memory/` and root MEMORY.md.
 * The injector decides which sections to include based on tier and budget.
 *
 * Integration with OpenClaw's context engine happens through the
 * context engine plugin system — see registration below.
 *
 * @see PHASE3-SCOPING.md — P3-BI-1 for architecture.
 */

export { ContextSectionLoader, type LoadResult } from "./loader.js";
export { injectContextSections, isRelevanceMatch, formatInjectedSections } from "./injector.js";
export {
  DEFAULT_SECTION_TIER,
  DEFAULT_SECTION_METADATA,
  DEFAULT_TOKENS_PER_CHAR,
  DEFAULT_LOADER_CONFIG,
  type ContextSectionTier,
  type ContextSectionMetadata,
  type ContextSection,
  type ContextSectionInjectionParams,
  type ContextSectionInjectionResult,
  type ContextSectionLoaderConfig,
} from "./types.js";

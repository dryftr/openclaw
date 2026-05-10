/**
 * Context Injection Phase 3 — P3-BI-1: Runtime Loader
 *
 * Tier-aware injector that decides which context sections to include
 * during assemble() based on tier, token budget, and explicit requests.
 *
 * Injection order: always → active (budget permitting) → on-demand (requested/relevant)
 *
 * Hard block enforcement (P3-BI-2 will add the assertion, but the injector
 * already respects the contract: "always" sections are never skipped for
 * budget reasons, only for load failures).
 *
 * @see PHASE3-SCOPING.md — P3-BI-1 for architecture.
 */

import {
  DEFAULT_TOKENS_PER_CHAR,
  type ContextSection,
  type ContextSectionInjectionParams,
  type ContextSectionInjectionResult,
  type ContextSectionTier,
} from "./types.js";

// ---------------------------------------------------------------------------
// Tier injection order
// ---------------------------------------------------------------------------

const TIER_INJECTION_ORDER: Record<ContextSectionTier, number> = {
  always: 0,
  active: 1,
  "on-demand": 2,
};

// ---------------------------------------------------------------------------
// Injector
// ---------------------------------------------------------------------------

/**
 * Inject context sections into an assemble() call based on tier, token budget,
 * and explicit request/relevance signals.
 *
 * The injector receives pre-loaded, pre-sorted sections from the
 * ContextSectionLoader and makes the final inclusion/exclusion decision.
 *
 * Contract:
 * - **always** tier sections are ALWAYS included, regardless of budget.
 *   If the budget is negative after always-tier sections, a warning is logged
 *   and they're still included. P3-BI-2 will add the hard-block assertion.
 * - **active** tier sections are included while budget remains.
 *   Sections are added in priority order until the budget is exhausted.
 * - **on-demand** tier sections are included only if explicitly requested
 *   or (when relevance matching is enabled) if they match the prompt.
 */
export function injectContextSections(
  sections: ContextSection[],
  params: ContextSectionInjectionParams,
): ContextSectionInjectionResult {
  const {
    tokenBudget,
    tokensPerChar = DEFAULT_TOKENS_PER_CHAR,
    requestedSectionIds = [],
    enableRelevanceMatching = false,
    prompt,
  } = params;

  // Sections are assumed pre-sorted by (tier order, priority) from the loader.
  // But just in case, re-sort to guarantee correct injection order.
  const sorted = [...sections].sort((a, b) => {
    const tierDiff = TIER_INJECTION_ORDER[a.metadata.tier] - TIER_INJECTION_ORDER[b.metadata.tier];
    if (tierDiff !== 0) return tierDiff;
    return a.metadata.priority - b.metadata.priority;
  });

  const injected: ContextSection[] = [];
  const skipped: ContextSection[] = [];
  let budgetRemaining = tokenBudget;
  let alwaysTierTruncationOccurred = false;

  // Track which on-demand sections were explicitly requested
  const requestedSet = new Set(requestedSectionIds);

  for (const section of sorted) {
    const { tier, required } = section.metadata;
    const estimatedTokens = Math.ceil(section.effectiveLength * tokensPerChar);

    switch (tier) {
      case "always": {
        // Always-tier sections are ALWAYS injected. Budget is not a factor.
        // P3-BI-2 will add a hard-block assertion here.
        if (section.wasTruncated) {
          alwaysTierTruncationOccurred = true;
        }
        injected.push(section);
        budgetRemaining -= estimatedTokens;
        break;
      }

      case "active": {
        // Active-tier sections are injected while budget remains.
        // Required active sections get budget priority over non-required ones.
        if (required || budgetRemaining >= estimatedTokens) {
          injected.push(section);
          budgetRemaining -= estimatedTokens;
        } else {
          skipped.push(section);
        }
        break;
      }

      case "on-demand": {
        // On-demand sections are only included if explicitly requested
        // or if relevance matching is enabled and they match the prompt.
        const isRequested = requestedSet.has(section.sectionId);
        const isRelevant =
          enableRelevanceMatching && prompt && isRelevanceMatch(section.content, prompt);

        if (isRequested || isRelevant) {
          if (budgetRemaining >= estimatedTokens) {
            injected.push(section);
            budgetRemaining -= estimatedTokens;
          } else if (required) {
            // Required on-demand sections that were requested/relevant
            // still get injected even if over budget
            injected.push(section);
            budgetRemaining -= estimatedTokens;
          } else {
            skipped.push(section);
          }
        } else {
          skipped.push(section);
        }
        break;
      }
    }
  }

  const tokensConsumed = tokenBudget - budgetRemaining;

  return {
    injected,
    skipped,
    tokensConsumed,
    tokensRemaining: budgetRemaining,
    alwaysTierTruncationOccurred,
  };
}

// ---------------------------------------------------------------------------
// Relevance matching (simple keyword overlap, extensible)
// ---------------------------------------------------------------------------

/**
 * Simple relevance matching based on keyword overlap between section content
 * and the user prompt. This is intentionally conservative — it's a first
 * approximation that P3-BI-3 and S7-03 can refine later.
 *
 * A section is considered relevant if it shares at least 3 meaningful keywords
 * with the prompt. "Meaningful" means: length > 3, not a stop word.
 *
 * @param sectionContent — The section content to check.
 * @param prompt — The user prompt to match against.
 * @returns Whether the section is relevant to the prompt.
 */
export function isRelevanceMatch(sectionContent: string, prompt: string): boolean {
  const MIN_OVERLAP = 3;

  const sectionWords = extractKeywords(sectionContent);
  const promptWords = extractKeywords(prompt);

  let overlap = 0;
  for (const word of promptWords) {
    if (sectionWords.has(word)) {
      overlap++;
      if (overlap >= MIN_OVERLAP) return true;
    }
  }

  return false;
}

/** Common English stop words to exclude from keyword matching. */
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "it",
  "this",
  "that",
  "was",
  "are",
  "be",
  "has",
  "have",
  "had",
  "not",
  "they",
  "we",
  "you",
  "all",
  "can",
  "her",
  "him",
  "his",
  "how",
  "its",
  "may",
  "new",
  "now",
  "old",
  "see",
  "way",
  "who",
  "did",
  "get",
  "got",
  "let",
  "say",
  "she",
  "too",
  "use",
]);

/**
 * Extract meaningful keywords from text.
 * Lowercased, deduplicated, filtered by length and stop words.
 */
function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  return new Set(words);
}

// ---------------------------------------------------------------------------
// Injection result formatting (for assemble() integration)
// ---------------------------------------------------------------------------

/**
 * Format injected sections into a string suitable for prepending to
 * the system prompt or injecting as a context block.
 *
 * Sections are formatted with clear boundaries and provenance metadata.
 */
export function formatInjectedSections(result: ContextSectionInjectionResult): string {
  if (result.injected.length === 0) {
    return "";
  }

  const lines: string[] = [];

  for (const section of result.injected) {
    const tierLabel = section.metadata.tier.toUpperCase();
    lines.push(`--- ${tierLabel} TIER: ${section.sectionId} ---`);
    lines.push(section.content);
    lines.push("");
  }

  return lines.join("\n");
}

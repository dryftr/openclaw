/**
 * TTS-specific markdown stripping that extends stripMarkdown with additional
 * cleaning for speech synthesis. Removes markdown constructs that
 * stripMarkdown leaves intact but which sound wrong when read aloud:
 *
 * - Bullet markers (-, *, +) at line starts
 * - Numbered list prefixes (1., 2., etc.)
 * - Markdown links [text](url) → text
 * - Image references ![alt](url) → alt
 * - Table pipes and separators
 * - Code block fences (``` and ~~~)
 * - Em dashes, en dashes → comma pauses or spaces
 * - Common emoji (optional, controlled by options)
 * - Special TTS-hostile punctuation (→, ×, •, etc.)
 * - Parenthetical URLs after links
 * - Double spaces (typographic)
 */

import { stripMarkdown } from "./strip-markdown.js";

export interface StripTtsOptions {
  /** Strip common emoji. Default: true */
  stripEmoji?: boolean;
  /** Convert em/en dashes to commas (pause). Default: true */
  convertDashes?: boolean;
  /** Normalize whitespace (collapse double spaces, trailing spaces). Default: true */
  normalizeWhitespace?: boolean;
}

/**
 * Strip TTS-hostile markdown and formatting from text.
 *
 * This is designed to run AFTER stripMarkdown() in the TTS pipeline.
 * stripMarkdown handles basic formatting (bold, italic, headers, etc.)
 * while this handles the remaining constructs that sound wrong aloud.
 *
 * Order matters: some patterns must be stripped before others
 * to avoid partial matches creating artifacts.
 */
export function stripTtsMarkdown(text: string, options: StripTtsOptions = {}): string {
  const {
    stripEmoji = true,
    convertDashes = true,
    normalizeWhitespace: shouldNormalize = true,
  } = options;

  let result = text;

  // --- Phase 1: Block-level structures ---

  // Strip fenced code blocks (``` or ~~~ with optional language tag)
  result = result.replace(/^```[\s\S]*?^```/gm, "");
  result = result.replace(/^~~~[\s\S]*?^~~~/gm, "");

  // Strip table separator rows (|---|---|)
  result = result.replace(/^\|[-:| ]+\|$/gm, "");

  // Strip table pipes, replacing | with spaces on table rows
  result = result.replace(/^\|(.+)\|$/gm, (_, content: string) =>
    content.replace(/\|/g, " ").trim(),
  );

  // --- Phase 2: Inline formatting ---

  // Convert markdown images ![alt](url) → alt (or empty if no meaningful alt)
  // MUST come before link processing since ![alt](url) also matches [text](url)
  result = result.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Convert markdown links [text](url) → text
  result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // --- Phase 3: List markers ---

  // Strip unordered list markers (-, *, +) at line starts
  result = result.replace(/^[-*+]\s+/gm, "");

  // Strip ordered list markers (1. 2. etc.) at line starts
  result = result.replace(/^\d+[.)]\s+/gm, "");

  // --- Phase 4: Punctuation and symbols ---

  // Convert em dashes to commas (natural pause in speech)
  if (convertDashes) {
    // Em dash (— or ---) → comma with space
    result = result.replace(/\s*—\s*/g, ", ");
    result = result.replace(/\s*---\s*/g, ", ");
    // En dash (–) in number ranges: "5–10" → "5 to 10"
    result = result.replace(/(\d+)\s*–\s*(\d+)/g, "$1 to $2");
    // En dash in other contexts → comma
    result = result.replace(/\s*–\s*/g, ", ");
  }

  // Replace TTS-hostile symbols with speakable equivalents
  // Arrow → remove (context usually makes meaning clear)
  result = result.replace(/\s*→\s*/g, " ");
  // ← remove
  result = result.replace(/←\s*/g, "");
  // Bullet point • → remove
  result = result.replace(/•\s*/g, "");
  // × → space
  result = result.replace(/\s*×\s*/g, " ");
  // ≥ → space
  result = result.replace(/\s*≥\s*/g, " ");
  // ≤ → space
  result = result.replace(/\s*≤\s*/g, " ");
  // ≠ → space
  result = result.replace(/\s*≠\s*/g, " ");

  // --- Phase 5: Emoji stripping ---

  if (stripEmoji) {
    // Curated emoji ranges that trip up TTS engines.
    // We avoid stripping CJK characters, mathematical operators
    // used in code, and currency symbols with natural spoken forms.
    //
    // Uses the `u` flag for proper Unicode handling of
    // supplementary plane characters. Surrogate pair ranges
    // don't work in non-u regex character classes.

    // Miscellaneous Symbols and Pictographs (weather, etc.)
    result = result.replace(/[\u2600-\u26FF]/gu, "");

    // Dingbats
    result = result.replace(/[\u2700-\u27BF]/gu, "");

    // Enclosed alphanumeric (circled numbers, letters)
    result = result.replace(/[\u2460-\u24FF]/gu, "");

    // Emoji presentation selectors and ZWJ
    result = result.replace(/[\uFE0F\u200D]/gu, "");

    // Regional indicator symbols (flag emoji components)
    result = result.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "");

    // Common emoji: faces & people
    result = result.replace(/[\u{1F600}-\u{1F64F}]/gu, "");
    // Transport & map
    result = result.replace(/[\u{1F680}-\u{1F6FF}]/gu, "");
    // Misc symbols and pictographs
    result = result.replace(/[\u{1F300}-\u{1F5FF}]/gu, "");
    // Supplemental symbols (food, drink, activities)
    result = result.replace(/[\u{1F900}-\u{1F9FF}]/gu, "");
    // More supplemental (animals, nature)
    result = result.replace(/[\u{1FA00}-\u{1FA6F}]/gu, "");
    // Even more supplemental
    result = result.replace(/[\u{1FA70}-\u{1FAFF}]/gu, "");

    // Skin tone modifiers
    result = result.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "");

    // Keycap combining markers
    result = result.replace(/[\u20E3\uFE0E]/gu, "");
  }

  // --- Phase 6: Whitespace cleanup ---

  // Remove bare URLs (no link text, just the raw URL)
  result = result.replace(/https?:\/\/\S+/gi, "");

  // Collapse multiple spaces to single
  if (shouldNormalize) {
    result = result.replace(/ {2,}/g, " ");
  }

  // Remove spaces before punctuation
  result = result.replace(/ +([.,;:!?)])/g, "$1");

  // Collapse 3+ newlines to 2 (paragraph break)
  result = result.replace(/\n{3,}/g, "\n\n");

  // Remove leading whitespace on lines (common after stripping markers)
  result = result.replace(/^ +/gm, "");

  // Remove lines that are now empty (after stripping)
  result = result.replace(/^\s*\n/gm, "\n");

  return result.trim();
}

/**
 * Combined TTS text preparation: runs stripMarkdown first (basic formatting),
 * then stripTtsMarkdown (TTS-specific cleaning).
 *
 * This is the function that should replace standalone `stripMarkdown` calls
 * in the TTS pipeline for better speech output.
 */
export function stripForTts(text: string, options: StripTtsOptions = {}): string {
  const afterBase = stripMarkdown(text);
  return stripTtsMarkdown(afterBase, options);
}

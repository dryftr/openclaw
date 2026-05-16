import { describe, expect, it } from "vitest";
import { stripMarkdown } from "./strip-markdown.js";
import { stripTtsMarkdown, stripForTts } from "./strip-tts-markdown.js";

/**
 * Tests for stripTtsMarkdown and stripForTts — the TTS-specific
 * text cleaning layer that runs after stripMarkdown.
 *
 * stripMarkdown handles basic formatting (bold, italic, headers).
 * stripTtsMarkdown handles everything else that sounds wrong aloud:
 * bullets, numbered lists, links, tables, code fences, emoji, dashes, URLs.
 *
 * stripForTts runs both in sequence — the full TTS pipeline.
 */

describe("stripTtsMarkdown", () => {
  // --- Lists ---

  it("strips unordered list markers with dash", () => {
    expect(stripTtsMarkdown("- First item\n- Second item")).toBe("First item\nSecond item");
  });

  it("strips unordered list markers with asterisk", () => {
    expect(stripTtsMarkdown("* First item\n* Second item")).toBe("First item\nSecond item");
  });

  it("strips unordered list markers with plus", () => {
    expect(stripTtsMarkdown("+ First item\n+ Second item")).toBe("First item\nSecond item");
  });

  it("strips ordered list markers with dot", () => {
    expect(stripTtsMarkdown("1. First\n2. Second\n3. Third")).toBe("First\nSecond\nThird");
  });

  it("strips ordered list markers with parenthesis", () => {
    expect(stripTtsMarkdown("1) First\n2) Second")).toBe("First\nSecond");
  });

  it("strips nested list markers", () => {
    const result = stripTtsMarkdown("- Top level\n  - Nested\n  - Also nested");
    expect(result).toContain("Top level");
    expect(result).toContain("Nested");
  });

  // --- Links ---

  it("converts markdown links to just the text", () => {
    expect(stripTtsMarkdown("Check [the docs](https://example.com)")).toBe("Check the docs");
  });

  it("converts links with empty text", () => {
    const result = stripTtsMarkdown("See [](https://example.com) for details");
    expect(result).not.toContain("https://");
  });

  it("converts multiple links", () => {
    expect(
      stripTtsMarkdown("Use [OpenAI](https://openai.com) and [Anthropic](https://anthropic.com)"),
    ).toBe("Use OpenAI and Anthropic");
  });

  // --- Images ---

  it("converts markdown images to alt text", () => {
    expect(stripTtsMarkdown("![Diagram](diagram.png) shows the flow")).toBe(
      "Diagram shows the flow",
    );
  });

  it("converts images with empty alt to nothing", () => {
    const result = stripTtsMarkdown("See ![](photo.jpg) for reference");
    expect(result).not.toContain("photo.jpg");
  });

  // --- Code blocks ---

  it("strips fenced code blocks with backticks", () => {
    const input = "Before\n```js\nconst x = 1;\n```\nAfter";
    const result = stripTtsMarkdown(input);
    expect(result).not.toContain("const x");
    expect(result).not.toContain("```");
    expect(result).toContain("Before");
    expect(result).toContain("After");
  });

  it("strips fenced code blocks with tildes", () => {
    const input = "Before\n~~~python\nprint('hello')\n~~~\nAfter";
    const result = stripTtsMarkdown(input);
    expect(result).not.toContain("print");
    expect(result).not.toContain("~~~");
    expect(result).toContain("Before");
    expect(result).toContain("After");
  });

  // --- Tables ---

  it("strips table separator rows", () => {
    const result = stripTtsMarkdown("| Name | Value |\n|------|-------|\n| Test | 123 |");
    expect(result).not.toContain("|------|-------|");
  });

  it("strips table pipes from content rows", () => {
    const result = stripTtsMarkdown("| Name | Value |");
    expect(result).not.toContain("|");
    expect(result).toContain("Name");
    expect(result).toContain("Value");
  });

  // --- Dashes ---

  it("converts em dashes to commas", () => {
    expect(stripTtsMarkdown("The result — as expected — was correct")).toBe(
      "The result, as expected, was correct",
    );
  });

  it("converts triple-dash em dashes to commas", () => {
    expect(stripTtsMarkdown("The result --- as expected --- was correct")).toBe(
      "The result, as expected, was correct",
    );
  });

  it("converts en dashes in number ranges to 'to'", () => {
    expect(stripTtsMarkdown("Pages 5–10")).toBe("Pages 5 to 10");
  });

  it("converts en dashes in text to commas", () => {
    expect(stripTtsMarkdown("Monday – Friday")).toBe("Monday, Friday");
  });

  it("does not convert dashes when option is disabled", () => {
    expect(stripTtsMarkdown("The result — as expected", { convertDashes: false })).toBe(
      "The result — as expected",
    );
  });

  // --- Special symbols ---

  it("removes arrow symbols", () => {
    expect(stripTtsMarkdown("Input → Output")).toBe("Input Output");
  });

  it("removes bullet point symbols", () => {
    expect(stripTtsMarkdown("Key point • Details here")).toBe("Key point Details here");
  });

  it("removes multiplication/times symbols", () => {
    expect(stripTtsMarkdown("10 × 5 matrix")).toBe("10 5 matrix");
  });

  it("removes comparison symbols", () => {
    expect(stripTtsMarkdown("Value ≥ 10")).toBe("Value 10");
  });

  // --- Emoji ---

  it("strips common emoji by default", () => {
    const result = stripTtsMarkdown("Great job! 🎉 Let's go 🚀");
    expect(result).not.toContain("🎉");
    expect(result).not.toContain("🚀");
  });

  it("strips face emoji", () => {
    const result = stripTtsMarkdown("I'm happy 😊 about this");
    expect(result).not.toContain("😊");
  });

  it("preserves emoji when option is disabled", () => {
    const result = stripTtsMarkdown("Great job! 🎉", { stripEmoji: false });
    expect(result).toContain("🎉");
  });

  // --- URLs ---

  it("removes bare URLs", () => {
    const result = stripTtsMarkdown("Visit https://example.com for more info");
    expect(result).not.toContain("https://");
    expect(result).toContain("Visit");
  });

  // --- Whitespace cleanup ---

  it("collapses multiple spaces", () => {
    expect(stripTtsMarkdown("Hello    world")).toBe("Hello world");
  });

  it("removes spaces before punctuation", () => {
    expect(stripTtsMarkdown("Hello , world !")).toBe("Hello, world!");
  });

  it("collapses excessive newlines", () => {
    expect(stripTtsMarkdown("Para 1\n\n\n\nPara 2")).toBe("Para 1\n\nPara 2");
  });

  it("removes leading spaces on lines", () => {
    expect(stripTtsMarkdown("  Hello\n  World")).toBe("Hello\nWorld");
  });

  // --- Options ---

  it("does not normalize whitespace when option disabled", () => {
    const result = stripTtsMarkdown("Hello    world", {
      normalizeWhitespace: false,
    });
    expect(result).toContain("    ");
  });
});

describe("stripForTts (full pipeline: stripMarkdown + stripTtsMarkdown)", () => {
  it("handles a typical LLM response with mixed markdown", () => {
    const input = `## Key Findings

Here are the **important** points:

- Performance improved by 50%
- Latency dropped — significantly
- Cost reduced from $100–$50

Check [the docs](https://example.com) for details.

> Note: This is a blockquote

\`\`\`python
def hello():
    print("world")
\`\`\`

The API → better results.`;

    const result = stripForTts(input);

    // No markdown formatting characters that would be read aloud
    expect(result).not.toContain("##");
    expect(result).not.toContain("**");
    expect(result).not.toContain("- Performance"); // list marker stripped
    expect(result).not.toContain("[the docs]");
    expect(result).not.toContain("```");
    expect(result).not.toContain("https://");
    expect(result).not.toContain("→");

    // Content should be preserved
    expect(result).toContain("Key Findings");
    expect(result).toContain("important");
    expect(result).toContain("Performance improved by 50%");
  });

  it("handles numbered lists with bold text", () => {
    const input = `1. **First step**: Do the thing
2. **Second step**: Do another thing
3. **Third step**: Done`;

    const result = stripForTts(input);
    expect(result).not.toContain("1.");
    expect(result).not.toContain("**");
    expect(result).toContain("First step");
    expect(result).toContain("Second step");
  });

  it("handles bullet points with inline code", () => {
    const input = `- Use \`stripMarkdown()\` for basic formatting
- Use \`stripTtsMarkdown()\` for speech`;

    const result = stripForTts(input);
    expect(result).not.toContain("`");
    expect(result).not.toContain("- Use");
    expect(result).toContain("stripMarkdown()");
    expect(result).toContain("stripTtsMarkdown()");
  });

  it("handles tables with links", () => {
    const input = `| Feature | Status |
|---------|--------|
| [Docs](https://example.com) | Done |`;

    const result = stripForTts(input);
    expect(result).not.toContain("|");
    expect(result).not.toContain("https://");
    expect(result).toContain("Docs");
    expect(result).toContain("Done");
  });

  it("handles emoji in responses", () => {
    const input = `Done! ✅ All tests passed 🎉

⚠️ Note: This is a warning.`;

    const result = stripForTts(input);
    expect(result).not.toContain("✅");
    expect(result).not.toContain("🎉");
    expect(result).not.toContain("⚠️");
    expect(result).toContain("Done");
    expect(result).toContain("Note");
  });

  it("handles em dashes that stripMarkdown doesn't touch", () => {
    // stripMarkdown doesn't handle em dashes
    const afterBase = stripMarkdown("The result — as expected — was correct");
    // stripMarkdown passes em dashes through unchanged
    expect(afterBase).toContain("—");

    // stripForTts converts them
    const result = stripForTts("The result — as expected — was correct");
    expect(result).not.toContain("—");
    expect(result).toContain("as expected");
  });

  it("handles a real-world agent response", () => {
    const input = `Here's what I found:

**TokenSpeed** is an MIT-licensed inference engine:

- Targets TensorRT-LLM performance
- ~9% faster on Blackwell GPUs
- Agentic-first design 🤯

Check it out at [TokenSpeed](https://github.com/lightseekorg/tokenspeed).

---

Key specs:
1. SPMD modeling layer
2. C++ FSM scheduler
3. Pluggable kernel system`;

    const result = stripForTts(input);
    expect(result).not.toContain("**");
    expect(result).not.toContain("- Targets");
    expect(result).not.toContain("🤯");
    expect(result).not.toContain("https://");
    expect(result).not.toContain("---");
    expect(result).not.toContain("1.");
    expect(result).toContain("TokenSpeed");
    expect(result).toContain("9% faster");
    expect(result).toContain("SPMD modeling layer");
  });

  it("preserves meaningful content without markdown", () => {
    expect(stripForTts("This is plain text with no markdown at all.")).toBe(
      "This is plain text with no markdown at all.",
    );
  });

  it("handles empty string", () => {
    expect(stripForTts("")).toBe("");
  });

  it("handles whitespace-only string", () => {
    expect(stripForTts("   \n\n  \n  ")).toBe("");
  });
});

describe("stripTtsMarkdown edge cases", () => {
  it("is idempotent on already-clean text", () => {
    const clean = "Hello world, this is clean text.";
    expect(stripTtsMarkdown(stripTtsMarkdown(clean))).toBe(stripTtsMarkdown(clean));
  });

  it("does not strip hyphens inside words", () => {
    expect(stripTtsMarkdown("state-of-the-art")).toBe("state-of-the-art");
  });

  it("preserves numbers and basic punctuation", () => {
    expect(stripTtsMarkdown("The cost is $50.00, or 10% off.")).toBe(
      "The cost is $50.00, or 10% off.",
    );
  });

  it("handles text with no TTS-hostile content gracefully", () => {
    const plain = "The quick brown fox jumps over the lazy dog.";
    expect(stripTtsMarkdown(plain)).toBe(plain);
  });
});

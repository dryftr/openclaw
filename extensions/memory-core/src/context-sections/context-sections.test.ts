/**
 * Context Injection Phase 3 — P3-BI-1: Runtime Loader
 *
 * Unit tests for context section loading, frontmatter parsing,
 * tier filtering, fail-closed edge cases, and token budget overflow.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { injectContextSections, isRelevanceMatch, formatInjectedSections } from "./injector.js";
import { ContextSectionLoader } from "./loader.js";
import {
  DEFAULT_SECTION_METADATA,
  type ContextSection,
  type ContextSectionInjectionParams,
} from "./types.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Create a temporary directory with section files for testing. */
async function createTestDir(structure: Record<string, string>): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ctx-section-test-"));
  for (const [filename, content] of Object.entries(structure)) {
    const filePath = path.join(tmpDir, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }
  return tmpDir;
}

/** Create a minimal ContextSection for test purposes. */
function makeSection(overrides: Partial<ContextSection> & { sectionId: string }): ContextSection {
  return {
    filePath: overrides.filePath ?? `/memory/${overrides.sectionId}.md`,
    sectionId: overrides.sectionId,
    metadata: {
      tier: overrides.metadata?.tier ?? "active",
      priority: overrides.metadata?.priority ?? 50,
      maxLength: overrides.metadata?.maxLength ?? 5000,
      required: overrides.metadata?.required ?? false,
    },
    content: overrides.content ?? `Content for ${overrides.sectionId}`,
    contentHash: overrides.contentHash ?? "abc123",
    effectiveLength: overrides.effectiveLength ?? overrides.content?.length ?? 20,
    wasTruncated: overrides.wasTruncated ?? false,
  };
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (via loader)
// ---------------------------------------------------------------------------

describe("ContextSectionLoader", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("loads sections with frontmatter", async () => {
    tmpDir = await createTestDir({
      "memory/projects.md": `---\ntier: always\npriority: 10\nmaxLength: 3000\nrequired: true\n---\nProject details here`,
      "memory/security.md": `---\ntier: active\npriority: 20\n---\nSecurity notes here`,
      "memory/archive.md": `---\ntier: on-demand\npriority: 80\n---\nOld archive data`,
    });

    const loader = new ContextSectionLoader({ memoryDir: path.join(tmpDir, "memory") });
    const result = await loader.load();

    expect(result.ok).toBe(true);
    expect(result.sections).toHaveLength(3);

    // Always tier first
    expect(result.sections[0].sectionId).toBe("projects");
    expect(result.sections[0].metadata.tier).toBe("always");
    expect(result.sections[0].metadata.priority).toBe(10);
    expect(result.sections[0].metadata.required).toBe(true);

    // Active tier second
    expect(result.sections[1].sectionId).toBe("security");
    expect(result.sections[1].metadata.tier).toBe("active");

    // On-demand tier last
    expect(result.sections[2].sectionId).toBe("archive");
    expect(result.sections[2].metadata.tier).toBe("on-demand");
  });

  it("applies defaults when frontmatter is absent", async () => {
    tmpDir = await createTestDir({
      "memory/default.md": "No frontmatter here",
    });

    const loader = new ContextSectionLoader({ memoryDir: path.join(tmpDir, "memory") });
    const result = await loader.load();

    expect(result.ok).toBe(true);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].metadata.tier).toBe("active");
    expect(result.sections[0].metadata.priority).toBe(50);
    expect(result.sections[0].metadata.maxLength).toBe(5000);
    expect(result.sections[0].metadata.required).toBe(false);
  });

  it("truncates sections exceeding maxLength", async () => {
    const longContent = "A".repeat(100);
    tmpDir = await createTestDir({
      "memory/long.md": `---\nmaxLength: 50\n---\n${longContent}`,
    });

    const loader = new ContextSectionLoader({ memoryDir: path.join(tmpDir, "memory") });
    const result = await loader.load();

    expect(result.ok).toBe(true);
    const section = result.sections[0];
    expect(section.wasTruncated).toBe(true);
    expect(section.effectiveLength).toBeLessThan(100);
    expect(section.content).toContain("[... truncated]");
  });

  it("loads root MEMORY.md as always tier with priority 0", async () => {
    tmpDir = await createTestDir({
      "MEMORY.md": "# Core memory\nAlways injected",
      "memory/projects.md": `---\ntier: always\npriority: 5\n---\nProject info`,
    });

    const loader = new ContextSectionLoader({
      memoryDir: path.join(tmpDir, "memory"),
      rootMemoryFile: path.join(tmpDir, "MEMORY.md"),
    });
    const result = await loader.load();

    expect(result.ok).toBe(true);
    expect(result.sections.length).toBeGreaterThanOrEqual(2);

    // Root MEMORY.md should be first (priority 0, always tier)
    const rootSection = result.sections.find((s) => s.sectionId === "MEMORY");
    expect(rootSection).toBeDefined();
    expect(rootSection!.metadata.tier).toBe("always");
    expect(rootSection!.metadata.priority).toBe(0);
  });

  it("returns empty sections when memory dir does not exist", async () => {
    const loader = new ContextSectionLoader({
      memoryDir: "/nonexistent/path/memory",
    });
    const result = await loader.load();

    expect(result.ok).toBe(true);
    expect(result.sections).toHaveLength(0);
  });

  it("skips files exceeding maxFileSize", async () => {
    tmpDir = await createTestDir({
      "memory/big.md": "X".repeat(200),
    });

    const loader = new ContextSectionLoader({
      memoryDir: path.join(tmpDir, "memory"),
      maxFileSize: 100,
    });
    const result = await loader.load();

    expect(result.ok).toBe(false); // error about size
    expect(result.sections).toHaveLength(0);
  });

  it("skips non-matching file extensions", async () => {
    tmpDir = await createTestDir({
      "memory/notes.md": "Markdown content",
      "memory/data.json": '{"key": "value"}',
      "memory/image.png": "binary",
    });

    const loader = new ContextSectionLoader({ memoryDir: path.join(tmpDir, "memory") });
    const result = await loader.load();

    expect(result.ok).toBe(true);
    // Only .md should be loaded
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].sectionId).toBe("notes");
  });

  it("computes SHA-256 content hash", async () => {
    tmpDir = await createTestDir({
      "memory/hash.md": "Hashable content",
    });

    const loader = new ContextSectionLoader({ memoryDir: path.join(tmpDir, "memory") });
    const result = await loader.load();

    expect(result.ok).toBe(true);
    expect(result.sections[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Injector: tier filtering and token budget
// ---------------------------------------------------------------------------

describe("injectContextSections", () => {
  const budget: ContextSectionInjectionParams = {
    tokenBudget: 1000,
    tokensPerChar: 0.25, // 4 chars per token
  };

  it("always includes always-tier sections regardless of budget", () => {
    const always = makeSection({
      sectionId: "always-1",
      content: "A".repeat(10000), // way over budget
      metadata: { ...DEFAULT_SECTION_METADATA, tier: "always", priority: 0 },
      effectiveLength: 10000,
    });

    const result = injectContextSections([always], { tokenBudget: 100, tokensPerChar: 0.25 });

    expect(result.injected).toHaveLength(1);
    expect(result.injected[0].sectionId).toBe("always-1");
    expect(result.tokensConsumed).toBe(2500); // 10000 * 0.25
    expect(result.tokensRemaining).toBeLessThan(0); // budget exceeded, but still injected
  });

  it("injects active-tier sections while budget allows", () => {
    const active1 = makeSection({
      sectionId: "active-1",
      content: "A".repeat(200), // ~50 tokens
      metadata: { ...DEFAULT_SECTION_METADATA, tier: "active", priority: 10 },
      effectiveLength: 200,
    });
    const active2 = makeSection({
      sectionId: "active-2",
      content: "B".repeat(400), // ~100 tokens
      metadata: { ...DEFAULT_SECTION_METADATA, tier: "active", priority: 20 },
      effectiveLength: 400,
    });

    const result = injectContextSections([active1, active2], { ...budget, tokenBudget: 100 });

    expect(result.injected).toHaveLength(1); // only active-1 fits
    expect(result.injected[0].sectionId).toBe("active-1");
    expect(result.skipped).toHaveLength(1);
  });

  it("skips on-demand sections unless explicitly requested", () => {
    const onDemand = makeSection({
      sectionId: "on-demand-1",
      content: "O".repeat(200),
      metadata: { ...DEFAULT_SECTION_METADATA, tier: "on-demand", priority: 50 },
      effectiveLength: 200,
    });

    // Not requested
    const result1 = injectContextSections([onDemand], { ...budget, tokenBudget: 1000 });
    expect(result1.injected).toHaveLength(0);
    expect(result1.skipped).toHaveLength(1);

    // Requested
    const result2 = injectContextSections([onDemand], {
      ...budget,
      tokenBudget: 1000,
      requestedSectionIds: ["on-demand-1"],
    });
    expect(result2.injected).toHaveLength(1);
  });

  it("injects required active sections even when over budget", () => {
    const required = makeSection({
      sectionId: "required-active",
      content: "R".repeat(200),
      metadata: { ...DEFAULT_SECTION_METADATA, tier: "active", priority: 10, required: true },
      effectiveLength: 200,
    });

    const result = injectContextSections([required], { tokenBudget: 10, tokensPerChar: 0.25 });
    expect(result.injected).toHaveLength(1);
  });

  it("sorts by tier order then priority", () => {
    const sections = [
      makeSection({
        sectionId: "active-50",
        metadata: { ...DEFAULT_SECTION_METADATA, tier: "active", priority: 50 },
      }),
      makeSection({
        sectionId: "always-20",
        metadata: { ...DEFAULT_SECTION_METADATA, tier: "always", priority: 20 },
      }),
      makeSection({
        sectionId: "always-5",
        metadata: { ...DEFAULT_SECTION_METADATA, tier: "always", priority: 5 },
      }),
      makeSection({
        sectionId: "ondemand-10",
        metadata: { ...DEFAULT_SECTION_METADATA, tier: "on-demand", priority: 10 },
      }),
    ];

    const result = injectContextSections(sections, {
      ...budget,
      requestedSectionIds: ["ondemand-10"],
    });
    const ids = result.injected.map((s) => s.sectionId);

    expect(ids).toEqual(["always-5", "always-20", "active-50", "ondemand-10"]);
  });

  it("flags always-tier truncation", () => {
    const truncatedAlways = makeSection({
      sectionId: "trunc-always",
      metadata: { ...DEFAULT_SECTION_METADATA, tier: "always" },
      wasTruncated: true,
    });

    const result = injectContextSections([truncatedAlways], budget);
    expect(result.alwaysTierTruncationOccurred).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Relevance matching
// ---------------------------------------------------------------------------

describe("isRelevanceMatch", () => {
  it("matches when section and prompt share 3+ keywords", () => {
    const section =
      "The database migration project involves postgresql schemas and data transformations";
    const prompt = "Tell me about the database migration for postgresql";

    expect(isRelevanceMatch(section, prompt)).toBe(true);
  });

  it("does not match with fewer than 3 keyword overlaps", () => {
    const section = "Security audit findings for the authentication module";
    const prompt = "Tell me about the weather";

    expect(isRelevanceMatch(section, prompt)).toBe(false);
  });

  it("excludes stop words from matching", () => {
    const section = "The the the is is is project about about";
    const prompt = "The the the is is is about";

    // All overlap is stop words — should not match
    expect(isRelevanceMatch(section, prompt)).toBe(false);
  });

  it("requires keywords longer than 3 characters", () => {
    const section = "API REST HTTP";
    const prompt = "API REST HTTP";

    // All 3-char or shorter keywords
    expect(isRelevanceMatch(section, prompt)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Format injected sections
// ---------------------------------------------------------------------------

describe("formatInjectedSections", () => {
  it("returns empty string when no sections injected", () => {
    const result = injectContextSections([], { tokenBudget: 1000 });
    expect(formatInjectedSections(result)).toBe("");
  });

  it("formats sections with tier labels and content", () => {
    const section = makeSection({
      sectionId: "projects",
      content: "Project Alpha is in progress.",
      metadata: { ...DEFAULT_SECTION_METADATA, tier: "always" },
    });

    const result = injectContextSections([section], { tokenBudget: 1000 });
    const formatted = formatInjectedSections(result);

    expect(formatted).toContain("ALWAYS TIER: projects");
    expect(formatted).toContain("Project Alpha is in progress.");
  });
});

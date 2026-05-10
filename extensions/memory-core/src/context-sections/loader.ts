/**
 * Context Injection Phase 3 — P3-BI-1: Runtime Loader
 *
 * Reads `memory/` section files, parses frontmatter metadata, and returns
 * ordered ContextSection objects ready for tier-aware injection.
 *
 * Data flow:
 *   memory/*.md → ContextSectionLoader → tier filtering → token budget → inject
 *
 * @see PHASE3-SCOPING.md — P3-BI-1 for architecture.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_LOADER_CONFIG,
  DEFAULT_SECTION_METADATA,
  type ContextSection,
  type ContextSectionLoaderConfig,
  type ContextSectionMetadata,
  type ContextSectionTier,
} from "./types.js";

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse YAML-like frontmatter from a section file.
 *
 * Frontmatter is delimited by `---` on its own line at the start of the file.
 * Supported keys: tier, priority, maxLength, required.
 *
 * If frontmatter is absent or malformed, defaults are applied.
 */
function parseFrontmatter(raw: string): {
  metadata: ContextSectionMetadata;
  content: string;
} {
  const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const match = raw.match(frontmatterPattern);

  if (!match) {
    return { metadata: { ...DEFAULT_SECTION_METADATA }, content: raw };
  }

  const frontmatterStr = match[1];
  const content = raw.slice(match[0].length);

  // Simple key: value parsing (no YAML library dependency)
  const parsed: Partial<ContextSectionMetadata> = {};
  for (const line of frontmatterStr.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();

    switch (key) {
      case "tier": {
        if (value === "always" || value === "active" || value === "on-demand") {
          parsed.tier = value;
        }
        break;
      }
      case "priority": {
        const num = Number(value);
        if (Number.isFinite(num) && num >= 0) {
          parsed.priority = Math.floor(num);
        }
        break;
      }
      case "maxLength": {
        const num = Number(value);
        if (Number.isFinite(num) && num >= 0) {
          parsed.maxLength = Math.floor(num);
        }
        break;
      }
      case "required": {
        parsed.required = value === "true";
        break;
      }
    }
  }

  return {
    metadata: {
      tier: parsed.tier ?? DEFAULT_SECTION_METADATA.tier,
      priority: parsed.priority ?? DEFAULT_SECTION_METADATA.priority,
      maxLength: parsed.maxLength ?? DEFAULT_SECTION_METADATA.maxLength,
      required: parsed.required ?? DEFAULT_SECTION_METADATA.required,
    },
    content,
  };
}

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

/** Compute SHA-256 hash of content for integrity verification. */
function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Section ID from filename
// ---------------------------------------------------------------------------

/** Derive a section ID from its filename (strip extension). */
function sectionIdFromFilename(filename: string): string {
  const ext = path.extname(filename);
  return path.basename(filename, ext);
}

// ---------------------------------------------------------------------------
// ContextSectionLoader
// ---------------------------------------------------------------------------

export type LoadResult =
  | { ok: true; sections: ContextSection[] }
  | { ok: false; error: string; sections: ContextSection[] };

export class ContextSectionLoader {
  private readonly config: {
    memoryDir: string;
    rootMemoryFile: string | undefined;
    sectionExtensions: string[];
    validateHashes: boolean;
    maxFileSize: number;
  };

  constructor(config: ContextSectionLoaderConfig) {
    this.config = {
      memoryDir: config.memoryDir,
      rootMemoryFile: config.rootMemoryFile,
      sectionExtensions: config.sectionExtensions ?? DEFAULT_LOADER_CONFIG.sectionExtensions,
      validateHashes: config.validateHashes ?? DEFAULT_LOADER_CONFIG.validateHashes,
      maxFileSize: config.maxFileSize ?? DEFAULT_LOADER_CONFIG.maxFileSize,
    };
  }

  /**
   * Load all section files from the memory directory and root MEMORY.md.
   * Returns sections sorted by (tier order, priority ascending).
   *
   * Tier order: always < active < on-demand
   * Within a tier: lower priority number first.
   */
  async load(): Promise<LoadResult> {
    const sections: ContextSection[] = [];
    const errors: string[] = [];

    // Load root MEMORY.md if configured and present
    if (this.config.rootMemoryFile) {
      const rootResult = await this.loadFile(this.config.rootMemoryFile, {
        forceTier: "always",
        forcePriority: 0,
      });
      if (rootResult.ok) {
        sections.push(rootResult.section);
      } else if (rootResult.found) {
        errors.push(rootResult.error);
      }
      // If not found, that's fine — root MEMORY.md is optional
    }

    // Load section files from memory/ directory
    let dirEntries: string[];
    try {
      dirEntries = await fs.readdir(this.config.memoryDir);
    } catch {
      // Directory doesn't exist — return whatever we have (possibly just root)
      if (sections.length === 0 && errors.length === 0) {
        return { ok: true, sections: [] };
      }
      if (errors.length > 0) {
        return { ok: false, error: errors.join("; "), sections };
      }
      return { ok: true, sections: this.sortSections(sections) };
    }

    for (const entry of dirEntries) {
      const ext = path.extname(entry);
      if (!this.config.sectionExtensions.includes(ext)) continue;

      const filePath = path.join(this.config.memoryDir, entry);
      const result = await this.loadFile(filePath);

      if (result.ok) {
        sections.push(result.section);
      } else if (result.found) {
        errors.push(result.error);
      }
    }

    // Sort by tier order then priority
    const sorted = this.sortSections(sections);

    if (errors.length > 0) {
      return { ok: false, error: errors.join("; "), sections: sorted };
    }
    return { ok: true, sections: sorted };
  }

  /**
   * Load a single section file.
   *
   * @param filePath - Absolute path to the section file.
   * @param overrides - Optional metadata overrides (used for root MEMORY.md).
   */
  private async loadFile(
    filePath: string,
    overrides?: { forceTier?: ContextSectionTier; forcePriority?: number },
  ): Promise<{ ok: true; section: ContextSection } | { ok: false; found: boolean; error: string }> {
    let raw: string;
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > this.config.maxFileSize) {
        return {
          ok: false,
          found: true,
          error: `Section file ${filePath} exceeds max size (${stat.size} > ${this.config.maxFileSize})`,
        };
      }
      raw = await fs.readFile(filePath, "utf-8");
    } catch {
      return { ok: false, found: false, error: `Failed to read ${filePath}` };
    }

    const { metadata: parsedMetadata, content } = parseFrontmatter(raw);

    // Apply overrides
    const metadata: ContextSectionMetadata = {
      ...parsedMetadata,
      ...(overrides?.forceTier != null ? { tier: overrides.forceTier } : {}),
      ...(overrides?.forcePriority != null ? { priority: overrides.forcePriority } : {}),
    };

    const sectionId = sectionIdFromFilename(path.basename(filePath));

    // Truncate if content exceeds maxLength
    // Truncate if content exceeds maxLength.
    // maxLength of 0 means no truncation limit.
    const maxLength = metadata.maxLength > 0 ? metadata.maxLength : Infinity;
    const wasTruncated = content.length > maxLength;
    const effectiveContent = wasTruncated
      ? content.slice(0, metadata.maxLength) + "\n[... truncated]"
      : content;
    const effectiveLength = effectiveContent.length;

    // Compute hash of original content (before truncation)
    const contentHash = computeContentHash(content);

    const section: ContextSection = {
      filePath,
      sectionId,
      metadata,
      content: effectiveContent,
      contentHash,
      effectiveLength,
      wasTruncated,
    };

    return { ok: true, section };
  }

  /**
   * Sort sections by tier order then priority.
   * Tier order: always (0) < active (1) < on-demand (2).
   */
  private sortSections(sections: ContextSection[]): ContextSection[] {
    const tierOrder: Record<ContextSectionTier, number> = {
      always: 0,
      active: 1,
      "on-demand": 2,
    };

    return [...sections].sort((a, b) => {
      const tierDiff = tierOrder[a.metadata.tier] - tierOrder[b.metadata.tier];
      if (tierDiff !== 0) return tierDiff;
      return a.metadata.priority - b.metadata.priority;
    });
  }
}

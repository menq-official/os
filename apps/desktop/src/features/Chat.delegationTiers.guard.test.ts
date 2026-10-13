// Drift guard: the tier table the chat renders vs the generated tier definition files.
//
// The files are the generator's output, not what the CLI obeys on the desktop route: there the
// app passes its own tier definitions inline (`--agents`, built from `BRO_TIERS` in `ai.rs`) with
// `--setting-sources ""`, which keeps the project's `.claude/agents/` from loading at all. That
// the inline definitions match these files is held by a Rust test in `ai.rs`, not here.
//
// `TIER_TOOLS` — defined once in `services/agentsDispatch.ts` and re-exported by `delegation.ts`,
// so the table the chat renders and the one the Tasks page renders are the same object — is a
// hand-written mirror of the `tools:` frontmatter in
// `.claude/agents/{reader,runner,builder}.md`, because the renderer has no filesystem and
// cannot read the real files at paint time. A mirror that drifts is worse than no mirror: it
// renders a capability grant that reads as authoritative and is not what was granted — and the
// dangerous direction is understating, where the owner is told a specialist can only read while
// the definition it was spawned under lets it write.
//
// So this test reads the real files and fails on any difference. If a tier's tools change in
// `tools/generate_agent_definitions.py`, regenerate the definitions and update `TIER_TOOLS` in
// the same change.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TIER_TOOLS, type CapabilityTier } from './delegation';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = resolve(HERE, '../../../..', '.claude/agents');

/** `tools: Read, Grep, Glob` out of the YAML frontmatter — the whole capability grant. */
function toolsOf(file: string): string[] | null {
  const src = readFileSync(file, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  if (!fm) return null;
  const line = /^tools:\s*(.+)$/m.exec(fm[1]);
  if (!line) return null;
  return line[1].split(',').map((t) => t.trim()).filter(Boolean);
}

const TIERS: CapabilityTier[] = ['reader', 'runner', 'builder'];
// Skipped only where the repository root is genuinely not beside the app — a checkout of the app
// alone, off CI, which has no `.claude/` at all. It used to skip whenever any of the three files
// was absent, so deleting or renaming a tier definition switched the guard off with a green run.
// With `.claude/` there, or under CI, a definition that cannot be read fails.
const appAlone = !process.env.CI && !existsSync(resolve(AGENTS_DIR, '..'));

describe('TIER_TOOLS mirrors the real .claude/agents tier definitions', () => {
  it.skipIf(appAlone)('matches every tier, tool for tool and in order', () => {
    for (const tier of TIERS) {
      const real = toolsOf(resolve(AGENTS_DIR, `${tier}.md`));
      expect(real, `${tier}.md has no \`tools:\` frontmatter`).not.toBeNull();
      expect([...TIER_TOOLS[tier]], `TIER_TOOLS.${tier} has drifted from .claude/agents/${tier}.md`)
        .toEqual(real);
    }
  });

  it.skipIf(appAlone)('no tier quietly grants Task — a specialist does not delegate further', () => {
    // Every tier body says "You return your result to Bro. You do not delegate further." If a
    // definition ever gained `Task`, the card would show a specialist that can spawn its own
    // agents, and the conductor model would be a description rather than a boundary.
    for (const tier of TIERS) {
      expect(toolsOf(resolve(AGENTS_DIR, `${tier}.md`))).not.toContain('Task');
      expect([...TIER_TOOLS[tier]]).not.toContain('Task');
    }
  });

  it('keeps the tiers strictly nested, narrowest first', () => {
    // This is the property the card's "grant the narrowest tier" story depends on, and it holds
    // without touching the filesystem — so it is checked even in a checkout of the app alone.
    expect(TIER_TOOLS.reader.every((t) => TIER_TOOLS.runner.includes(t))).toBe(true);
    expect(TIER_TOOLS.runner.every((t) => TIER_TOOLS.builder.includes(t))).toBe(true);
    expect(TIER_TOOLS.reader).not.toContain('Bash');
    expect(TIER_TOOLS.runner).not.toContain('Edit');
    expect(TIER_TOOLS.runner).not.toContain('Write');
    expect(TIER_TOOLS.builder).toContain('Write');
  });
});

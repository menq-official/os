import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The service imports `hasBackend` from desktop.ts, which imports the Tauri core module.
// Mock that boundary so these stay pure unit tests — the dispatch transport is injected.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}));

import {
  AUTHORITY_POLICY_SOURCE, CONTRACT_SCHEMA_SOURCE, CONTRACT_SCHEMA_VERSION, DEFAULT_AUTHORITY,
  DISPATCH_REQUEST_PROTOCOL, DISPATCH_RESULT_PROTOCOL, DISPATCH_PROBE_PROTOCOL,
  ID_PATTERN_SOURCE, INDEPENDENCE_MINIMUM_BY_RISK, RISKS, TIER_TOOLS,
  attemptDispatch, buildAssignment, isAbsolutePath, isContractId, isRepoPath, isWorkPath,
  packRoleDefinitionName, parseDispatchReply, pathCovers, probeDispatchChannel, slug,
  splitLines, validateAssignment,
  type Assignment, type AssignmentInput, type DispatchRequest, type ProbeRequest,
} from './agentsDispatch';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');

const UUID = '5b1f6a2e-9c3d-4a71-8e0f-2b7d4c9a1e36';
const genId = () => UUID;
const DIGEST = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);

const BASE: AssignmentInput = {
  taskId: 'task-42',
  title: 'Tighten the boundary check',
  objective: 'Make the boundary check refuse a symlinked scope entry.',
  mode: 'work',
  risk: 'medium',
  packId: 'architecture-audit',
  agentSlug: 'boundary-auditor',
  assigneeRole: 'Boundary Auditor',
  tier: 'builder',
  scope: ['apps/desktop/src/features'],
  prohibitedScope: ['engine'],
  coreSkills: ['analysis-primary'],
  doneCriteria: ['the symlinked-scope case is refused and a test pins it'],
  verifierAgentSlug: null,
  verifierRole: null,
  verificationCommands: [],
  rollbackStrategy: 'git restore the touched files',
};

const build = (over: Partial<AssignmentInput> = {}): Assignment =>
  buildAssignment({ ...BASE, ...over });

const fields = (a: Assignment) => validateAssignment(a).map((p) => p.field);

beforeEach(() => invokeMock.mockReset());

// ── The path grammar mirrors the engine schema ──────────────────────────────
// This corpus is the drift guard: each case is a rule the schema's $defs state, and the
// mirror must agree on every one. A mirror that quietly diverges would let the renderer
// bless a scope the engine will not honour.
describe('path grammar — mirrors task-contract.schema.json $defs', () => {
  it('accepts ordinary repo-relative paths and the root entry', () => {
    for (const p of ['.', 'engine', 'apps/desktop/src/features', 'a.b-c_d/e']) {
      expect(isRepoPath(p), p).toBe(true);
      expect(isWorkPath(p), p).toBe(true);
    }
  });

  it('refuses every way of smuggling a traversal or a separator', () => {
    for (const p of [
      '..', '../engine', 'apps/../engine', 'apps/./x', 'apps//x',
      'apps\\desktop', 'C:x', 'apps/*', 'apps/x?', 'apps/[a]',
      '~/secrets', ' apps', 'apps ', '', 'apps/ x',
    ]) {
      expect(isRepoPath(p), p).toBe(false);
    }
  });

  it('accepts a real absolute location but never a bare filesystem root', () => {
    expect(isAbsolutePath('/home/gev/project')).toBe(true);
    expect(isAbsolutePath('C:/Users/Gev/Desktop/project')).toBe(true);
    // "not a scope, it is the absence of one"
    expect(isAbsolutePath('/')).toBe(false);
    expect(isAbsolutePath('C:/')).toBe(false);
    // UNC / device namespaces bypass normal path resolution
    expect(isAbsolutePath('//host/share')).toBe(false);
    expect(isAbsolutePath('\\\\?\\C:\\x')).toBe(false);
  });

  it('holds contract ids to the schema id pattern', () => {
    expect(isContractId('architecture-audit')).toBe(true);
    expect(isContractId('a1')).toBe(true);
    expect(isContractId('A1')).toBe(false);
    expect(isContractId('-a')).toBe(false);
    expect(isContractId('a')).toBe(false); // minimum length is 2
    expect(isContractId('')).toBe(false);
  });

  it('knows when a prohibited entry swallows a scope entry', () => {
    expect(pathCovers('apps', 'apps/desktop')).toBe(true);
    expect(pathCovers('apps', 'apps')).toBe(true);
    expect(pathCovers('apps', 'appsx/y')).toBe(false);
    expect(pathCovers('apps/desktop', 'apps')).toBe(false);
  });

  it("treats '.' as the root ENTRY, which is what the engine and the schema say it is", () => {
    // This file used to pin `pathCovers('.', 'apps/desktop') === true`. The engine's
    // `_pattern_match` returns `path == "."` for the pattern '.', and the schema's own words are
    // quoted below, so that assertion held the mirror to the opposite of what it mirrors.
    expect(pathCovers('.', 'apps/desktop')).toBe(false);
    expect(pathCovers('.', 'engine')).toBe(false);
    expect(pathCovers('.', '.')).toBe(true);
    const schema = readFileSync(resolve(REPO_ROOT, CONTRACT_SCHEMA_SOURCE), 'utf8');
    expect(schema).toContain("'.' alone is the repository root entry itself and grants nothing beneath it");
    const engine = readFileSync(resolve(REPO_ROOT, 'engine/runtime/bro_security.py'), 'utf8');
    expect(engine).toMatch(/if not pattern or pattern == "\.":\s*\n\s*return path == "\."/);
  });

  it('names the source of record as the schema it mirrors, not the copy the engine loads', () => {
    // The Tasks page prints this path beside every refusal. It said `engine/schemas/…` and called
    // that "the single normative source", while `contracts/README.md` declares `contracts/` the
    // source of record and the engine's file a copy held identical to it.
    expect(CONTRACT_SCHEMA_SOURCE).toBe('contracts/task-contract.schema.json');
    expect(readFileSync(resolve(REPO_ROOT, 'contracts/README.md'), 'utf8'))
      .toContain('The source of record for every schema both halves consume');
  });

  it('quotes in its refusal the id pattern it applies, not a second copy of it', () => {
    const problems = validateAssignment(build({ coreSkills: ['Bad Skill'] }));
    expect(problems.filter((p) => p.field === 'core_skills').map((p) => p.message))
      .toEqual([`'Bad Skill' is not a valid contract id (${ID_PATTERN_SOURCE})`]);
  });
});

// ── The authority mirror ────────────────────────────────────────────────────
describe('authority — mirrors engine/agents/authority-policy.json', () => {
  // The path patterns and the tier table are each held to the file they copy. These three were
  // compared with nothing but literals typed here, so a change to the policy left them standing.
  const policy = JSON.parse(readFileSync(resolve(REPO_ROOT, AUTHORITY_POLICY_SOURCE), 'utf8')) as {
    risk_order: string[];
    default: Record<string, unknown>;
    independence_minimum_by_risk: Record<string, string>;
  };

  it('ranks risk in the order the policy declares', () => {
    expect([...RISKS]).toEqual(policy.risk_order);
  });

  it('carries the default record field for field, for every field it carries', () => {
    const mirrored = Object.entries(DEFAULT_AUTHORITY);
    expect(mirrored.map(([k]) => k).sort()).toEqual(['allowed_modes', 'risk_ceiling']);
    for (const [field, value] of mirrored) {
      expect(value, `DEFAULT_AUTHORITY.${field} has drifted from the policy's default record`)
        .toEqual(policy.default[field]);
    }
  });

  it('demands the independence level the policy sets for each risk', () => {
    expect(INDEPENDENCE_MINIMUM_BY_RISK).toEqual(policy.independence_minimum_by_risk);
  });
});

// ── The capability half ─────────────────────────────────────────────────────
describe('capability grant — names a real generated definition', () => {
  it("uses the generator's own slug rule so the name resolves to a real file", () => {
    expect(slug('Boundary Auditor')).toBe('boundary-auditor');
    expect(packRoleDefinitionName('architecture-audit', 'Evidence Verifier'))
      .toBe('architecture-audit--evidence-verifier');
  });

  it('carries the exact tool list of the chosen tier', () => {
    expect(TIER_TOOLS.reader).toEqual(['Read', 'Grep', 'Glob']);
    expect(TIER_TOOLS.runner).toContain('Bash');
    expect(TIER_TOOLS.reader).not.toContain('Bash');
    expect(TIER_TOOLS.builder).toEqual(expect.arrayContaining(['Edit', 'Write']));
    expect(TIER_TOOLS.runner).not.toContain('Edit');

    const a = build({ tier: 'reader' });
    expect(a.grant.tier).toBe('reader');
    expect(a.grant.tools).toEqual(TIER_TOOLS.reader);
    expect(a.grant.tierDefinitionPath).toBe('.claude/agents/reader.md');
  });

  // That the table equals the `tools:` each generated tier definition declares is held once, by
  // `features/Chat.delegationTiers.guard.test.ts`: `features/delegation.ts` re-exports THIS
  // object, so the test that stood here read the same three files against the same table.
  const AGENTS_DIR = resolve(REPO_ROOT, '.claude/agents');

  // Not skipped when a tier file is absent. It was, on all three being present — so the one check
  // that counts exactly three tier definitions switched itself off when one went missing.
  it('counts the pack-role definitions the module header says it reads', () => {
    // The header said 262, which is every file in the directory — including the three tier
    // definitions the same sentence says are the only enforced ones.
    const names = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'));
    const packRoles = names.filter((f) => f.includes('--')).length;
    expect(names.length - packRoles).toBe(3);
    const header = readFileSync(resolve(HERE, 'agentsDispatch.ts'), 'utf8');
    expect(header).toContain(`The ${packRoles} pack-role definitions in \`.claude/agents/\``);
  });
});

// ── The path half ───────────────────────────────────────────────────────────
describe('buildAssignment — produces a contract-shaped draft', () => {
  it("emits the schema's own field names and version", () => {
    const d = build().draft;
    expect(d.schema).toBe(CONTRACT_SCHEMA_VERSION);
    expect(Object.keys(d)).toEqual(expect.arrayContaining([
      'task_id', 'title', 'objective', 'mode', 'risk', 'pack_id', 'agent_id',
      'assignee_role', 'scope', 'prohibited_scope', 'inputs', 'core_skills',
      'additional_skills', 'reference_skills', 'done_criteria', 'verification', 'rollback',
    ]));
    expect(d.agent_id).toBe('boundary-auditor');
    expect(d.assignee_role).toBe('Boundary Auditor');
  });

  it('omits `repository` — the desktop cannot observe base_commit or tree_identity', () => {
    expect('repository' in build().draft).toBe(false);
  });

  it('is clean for a well-formed medium-risk work grant', () => {
    expect(validateAssignment(build())).toEqual([]);
  });
});

describe('validateAssignment — what the task contract forbids is refused before it is sent', () => {
  // Cockpit read R3-0279, R3-0280. `contracts/task-contract.schema.json` says `inputs` is
  // `uniqueItems` and that every `done_criteria`, `verification.commands` and
  // `rollback.commands` entry has `minLength: 1`. The pre-flight checked neither, so a draft
  // the engine refuses on its schema was shown as ready to send.
  it('refuses an input listed twice', () => {
    const a = build();
    a.draft.inputs = ['docs/a.md', 'docs/b.md', 'docs/a.md'];
    const problems = validateAssignment(a).filter((p) => p.field === 'inputs');
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("'docs/a.md' is listed twice");
    a.draft.inputs = ['docs/a.md', 'docs/b.md'];
    expect(fields(a)).not.toContain('inputs');
  });

  it('refuses an empty criterion or command', () => {
    for (const field of ['done_criteria', 'verification.commands', 'rollback.commands'] as const) {
      const a = build();
      if (field === 'done_criteria') a.draft.done_criteria = ['it works', ''];
      if (field === 'verification.commands') a.draft.verification.commands = ['npm test', ''];
      if (field === 'rollback.commands') a.draft.rollback.commands = [''];
      expect(fields(a), field).toContain(field);
    }
    // A non-empty entry in each is still clean.
    const a = build();
    a.draft.verification.commands = ['npm test'];
    a.draft.rollback.commands = ['git restore .'];
    expect(validateAssignment(a)).toEqual([]);
  });
});

describe('validateAssignment — refuses, never accepts', () => {
  it('requires a scope: a grant with no paths grants nothing', () => {
    expect(fields(build({ scope: [] }))).toContain('scope');
  });

  it('rejects a scope entry the engine path grammar would reject', () => {
    expect(fields(build({ scope: ['apps/../engine'] }))).toContain('scope');
    expect(fields(build({ scope: ['apps/*'] }))).toContain('scope');
  });

  it('rejects a prohibited entry that swallows the whole scope', () => {
    const problems = validateAssignment(build({
      scope: ['apps/desktop/src'], prohibitedScope: ['apps'],
    }));
    expect(problems.some((p) => p.field === 'prohibited_scope' && /permits nothing/.test(p.message))).toBe(true);
  });

  it("refuses a scope that is only '.': the root entry grants nothing beneath it", () => {
    const problems = validateAssignment(build({ scope: ['.'], prohibitedScope: [] }));
    expect(problems.some((p) => p.field === 'scope' && /grants nothing beneath it/.test(p.message))).toBe(true);
    // '.' beside a real path is not the mistake; the real path is the grant.
    expect(fields(build({ scope: ['.', 'apps/desktop/src'], prohibitedScope: [] }))).not.toContain('scope');
  });

  it("still refuses '.' in prohibited_scope over a repo path — and says what it really is", () => {
    // It was refused before too, as "covers the whole of scope entry … this grant permits
    // nothing". That is the reverse of the truth: the engine would have prohibited NOTHING.
    const problems = validateAssignment(build({ scope: ['apps/desktop/src'], prohibitedScope: ['.'] }));
    const about = problems.filter((p) => p.field === 'prohibited_scope');
    expect(about).toHaveLength(1);
    expect(about[0].message).toMatch(/prohibits nothing beneath it/);
    expect(about[0].message).toContain("'apps/desktop/src'");
    expect(about[0].message).not.toMatch(/permits nothing/);
  });

  it('refuses a mode the default authority record does not grant', () => {
    expect(DEFAULT_AUTHORITY.allowed_modes).not.toContain('release');
    const problems = validateAssignment(build({ mode: 'release' }));
    expect(problems.some((p) => p.field === 'mode' && /override/.test(p.message))).toBe(true);
  });

  it('refuses a risk above the default ceiling instead of assuming an override', () => {
    const problems = validateAssignment(build({ risk: 'critical' }));
    expect(problems.some((p) => p.field === 'risk' && /ceiling/.test(p.message))).toBe(true);
  });

  it('makes verification non-optional at high risk', () => {
    // High risk needs independence L2, so buildAssignment marks verification required;
    // the refusal is therefore about the missing verifier identity.
    const problems = validateAssignment(build({ risk: 'high' }));
    expect(problems.map((p) => p.field)).toContain('verification.verifier_agent_id');
  });

  it('refuses self-verification', () => {
    const problems = validateAssignment(build({
      risk: 'high',
      verifierAgentSlug: 'boundary-auditor',
      verifierRole: 'Boundary Auditor',
      verificationCommands: ['npm test'],
    }));
    expect(problems.some((p) => /cannot verify its own work/.test(p.message))).toBe(true);
  });

  it('refuses a verifier that runs nothing', () => {
    const problems = validateAssignment(build({
      risk: 'high',
      verifierAgentSlug: 'evidence-verifier',
      verifierRole: 'Evidence Verifier',
      verificationCommands: [],
    }));
    expect(problems.map((p) => p.field)).toContain('verification.commands');
  });

  it('accepts a complete high-risk grant with a real independent verifier', () => {
    expect(validateAssignment(build({
      risk: 'high',
      verifierAgentSlug: 'evidence-verifier',
      verifierRole: 'Evidence Verifier',
      verificationCommands: ['npx vitest run src/services'],
    }))).toEqual([]);
  });

  it('will not fill in what it cannot know: pack_id and core_skills', () => {
    expect(fields(build({ packId: '' }))).toContain('pack_id');
    const problems = validateAssignment(build({ coreSkills: [] }));
    expect(problems.some((p) => p.field === 'core_skills' && /no IPC/.test(p.message))).toBe(true);
  });

  it('flags a rollback plan handed to a tier that cannot change anything', () => {
    const problems = validateAssignment(build({
      tier: 'reader', rollbackCommands: ['git restore .'],
    }));
    expect(problems.map((p) => p.field)).toContain('grant.tier');
  });
});

// ── The dispatch channel ────────────────────────────────────────────────────
describe('parseDispatchReply — fail-closed', () => {
  const accepted = {
    protocol: DISPATCH_RESULT_PROTOCOL,
    status: 'accepted',
    client_request_id: UUID,
    assignment_id: 'asg-1',
    contract_digest: DIGEST,
    lease_id: 'lease-1',
    repository: {
      full_name: 'menq-official/os',
      branch: 'wave/phase-push-1',
      worktree: '/repo',
      base_commit: COMMIT,
      tree_identity: DIGEST,
    },
  };

  it('accepts only a complete accepted frame', () => {
    expect(parseDispatchReply(accepted).state).toBe('accepted');
  });

  it.each([
    ['not an object', 42],
    ['wrong protocol', { ...accepted, protocol: 'something.else' }],
    ['unknown status', { ...accepted, status: 'queued' }],
    ['no correlation id', { ...accepted, client_request_id: undefined }],
    ['no lease', { ...accepted, lease_id: undefined }],
    ['no digest', { ...accepted, contract_digest: undefined }],
    ['a digest that is not sha256', { ...accepted, contract_digest: 'deadbeef' }],
    ['no sealed repository', { ...accepted, repository: undefined }],
    ['a repository whose commit is not a real digest', {
      ...accepted, repository: { ...accepted.repository, base_commit: 'HEAD' },
    }],
    ['an accepted frame that also carries a refusal', { ...accepted, reason: 'no_lease' }],
  ])('never upgrades %s into accepted', (_label, raw) => {
    expect(parseDispatchReply(raw).state).toBe('unreachable');
  });

  it('reads a refusal only from the closed reason set', () => {
    expect(parseDispatchReply({
      protocol: DISPATCH_RESULT_PROTOCOL, status: 'refused',
      client_request_id: UUID, reason: 'scope_denied', detail: 'scope outside the workspace binding',
    })).toMatchObject({ state: 'refused', reason: 'scope_denied' });

    expect(parseDispatchReply({
      protocol: DISPATCH_RESULT_PROTOCOL, status: 'refused',
      client_request_id: UUID, reason: 'because_i_said_so',
    }).state).toBe('unreachable');
  });
});

describe('attemptDispatch', () => {
  it('never transmits a draft that failed pre-flight', async () => {
    const transport = vi.fn();
    const out = await attemptDispatch(build({ scope: [] }), transport, genId);
    expect(out.state).toBe('invalid');
    expect(transport).not.toHaveBeenCalled();
  });

  it('sends the closed request frame with the chosen definition and the draft', async () => {
    const transport = vi.fn(async (req: DispatchRequest | ProbeRequest) => ({
      protocol: DISPATCH_RESULT_PROTOCOL, status: 'refused',
      client_request_id: req.client_request_id, reason: 'no_lease',
    }));
    const out = await attemptDispatch(build({ tier: 'runner' }), transport, genId);
    const sent = transport.mock.calls[0][0] as DispatchRequest;
    expect(sent.protocol).toBe(DISPATCH_REQUEST_PROTOCOL);
    expect(sent.agent_definition).toBe('runner');
    expect(sent.capability_tier).toBe('runner');
    expect(sent.contract_draft.agent_id).toBe('boundary-auditor');
    expect(out).toMatchObject({ state: 'refused', reason: 'no_lease' });
  });

  it('reports a missing backend command as unreachable, never as dispatched', async () => {
    const transport = vi.fn(async () => {
      throw new Error('Command dispatch_task_contract not found');
    });
    const out = await attemptDispatch(build(), transport, genId);
    expect(out.state).toBe('unreachable');
    expect(out).toMatchObject({ reason: expect.stringContaining('not found') });
  });

  it('refuses an accepted frame that does not correlate with the request', async () => {
    const transport = vi.fn(async () => ({
      protocol: DISPATCH_RESULT_PROTOCOL, status: 'accepted',
      client_request_id: 'a-different-request',
      assignment_id: 'asg-1', contract_digest: DIGEST, lease_id: 'lease-1',
      repository: {
        full_name: 'menq-official/os', branch: 'main', worktree: '/repo',
        base_commit: COMMIT, tree_identity: DIGEST,
      },
    }));
    expect((await attemptDispatch(build(), transport, genId)).state).toBe('unreachable');
  });

  it('refuses a refused frame that does not correlate with the request', async () => {
    // A refusal answering some OTHER request says nothing about this one: shown as this
    // request's refusal, it tells the owner the engine declined a contract it never judged.
    const transport = vi.fn(async () => ({
      protocol: DISPATCH_RESULT_PROTOCOL, status: 'refused',
      client_request_id: 'a-different-request', reason: 'scope_denied',
    }));
    const out = await attemptDispatch(build(), transport, genId);
    expect(out.state).toBe('unreachable');
    expect(out).toMatchObject({ reason: expect.stringContaining('does not correlate') });
  });

  it('refuses a non-UUIDv4 correlation id rather than sending an uncorrelatable request', async () => {
    const transport = vi.fn();
    const out = await attemptDispatch(build(), transport, () => 'unavailable');
    expect(out.state).toBe('unreachable');
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('probeDispatchChannel', () => {
  it('is absent with no Tauri runtime, and never calls out', async () => {
    const transport = vi.fn();
    const out = await probeDispatchChannel(transport, genId);
    expect(out).toMatchObject({ state: 'absent' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('sends a frame that carries no contract', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      // Declare the parameter even though the reply ignores it: the assertion below reads
      // `mock.calls[0][0]`, and a zero-arg mock records an empty tuple with nothing to read.
      const transport = vi.fn(async (_req: DispatchRequest | ProbeRequest) => ({
        protocol: DISPATCH_RESULT_PROTOCOL,
      }));
      const out = await probeDispatchChannel(transport, genId);
      const sent = transport.mock.calls[0][0] as ProbeRequest;
      expect(sent.protocol).toBe(DISPATCH_PROBE_PROTOCOL);
      expect('contract_draft' in sent).toBe(false);
      expect(out.state).toBe('present');
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });
});

describe('splitLines', () => {
  it('keeps order, trims, and drops blanks', () => {
    expect(splitLines(' a \r\n\n  b\n')).toEqual(['a', 'b']);
    expect(splitLines('   ')).toEqual([]);
  });
});

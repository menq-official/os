// The renderer's governed-turn NON-DECISION taxonomy.
//
// The point of these specs is one distinction the UI must never lose: a broker that was reached and
// REFUSED is a verdict; a broker that was never reached, or that answered garbage, is the absence of a
// verdict. `runGovernedTurn` collapses the second into a rejected promise, which is exactly how a UI
// ends up rendering "we could not connect" as "you were denied". `attemptGovernedTurn` keeps them apart,
// and nothing it returns can reach a "Verified" affordance except a real broker `committed` frame.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attemptGovernedTurn, classifyTransportFailure, isVerified,
  COMMIT_NOT_ACCEPTED_DETAIL, DEMONSTRATION_CUSTODY,
  NON_DECISIONS, RESULT_PROTOCOL, TRUSTED_VERIFIED,
  type BrokerTransport, type GovernedTurnAttempt,
} from './governedTurn';

const CRID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const genId = () => CRID;

function committedFrame() {
  return {
    protocol: RESULT_PROTOCOL,
    status: 'committed',
    client_request_id: CRID,
    broker_turn_id: 'bt-1',
    conversation_id: 'conv-1',
    message: {
      message_id: 'm-1', role: 'assistant', author: 'Bro', body: 'hello',
      created_at_ms: 1700, trust_state: TRUSTED_VERIFIED,
    },
  };
}
function blockedFrame(reason: string) {
  return {
    protocol: RESULT_PROTOCOL, status: 'blocked', client_request_id: CRID,
    broker_turn_id: 'bt-1', conversation_id: 'conv-1', reason,
  };
}

const rejecting = (message: string): BrokerTransport => () => Promise.reject(new Error(message));
const resolving = (v: unknown): BrokerTransport => () => Promise.resolve(v);

/** Narrow to the unavailable arm so the assertions read the fields directly. */
function unavailable(a: GovernedTurnAttempt) {
  if (a.status !== 'unavailable') throw new Error(`expected unavailable, got ${a.status}`);
  return a;
}

describe('classifyTransportFailure — the proxy prefixes survive into the renderer', () => {
  // Reasons in the SHAPE `src-tauri/src/governed_turn.rs` produces: a prefix, then prose. They are
  // typed by hand and cut short — the Rust sentences go on after `arch=…).` and after `({e:?}).` —
  // so they hold the classifier to a prefix and to nothing the proxy writes. What the proxy writes
  // is read out of the Rust source in the next block. The Rust side has its own test that the three
  // prefixes stay mutually distinguishable.
  it.each([
    ['broker_unsupported_platform: no governed-broker IPC transport is implemented for this host (os=windows, arch=x86_64).', 'broker_unsupported_platform'],
    ['broker_unavailable: a broker IPC transport is implemented for this host but the connection to `/run/brops/broker.sock` could not be established (connect: NotFound).', 'broker_unavailable'],
    ['broker_transport_failed: connected to the broker, but the framed exchange failed (Io).', 'broker_transport_failed'],
    ['malformed_request', 'malformed_request'],
    ['malformed_broker_reply', 'malformed_broker_reply'],
  ])('classifies %s', (message, kind) => {
    const c = classifyTransportFailure(new Error(message));
    expect(c.kind).toBe(kind);
    // The verbatim machine reason is preserved for display and logs.
    expect(c.detail).toBe(message);
  });

  it('never invents a named cause for an unrecognised rejection', () => {
    const c = classifyTransportFailure(new Error('some totally unexpected failure'));
    expect(c.kind).toBe('unclassified_transport_failure');
    expect(c.detail).toBe('some totally unexpected failure');
  });

  it('does not let "not implemented on this platform" masquerade as "could not connect"', () => {
    // The Rust audit finding, asserted from the renderer: these two must not share a classification.
    const unsupported = classifyTransportFailure(new Error('broker_unsupported_platform: ...'));
    const unavailableKind = classifyTransportFailure(new Error('broker_unavailable: ...'));
    expect(unsupported.kind).not.toBe(unavailableKind.kind);
  });

  it('every taxonomy member is distinct', () => {
    expect(new Set(NON_DECISIONS).size).toBe(NON_DECISIONS.length);
  });
});

describe('the prefixes are the ones the proxy writes', () => {
  // Each prefix is spelled twice, in `governed_turn.rs` and in `governedTurn.ts`, and the cases
  // above use this side's spelling on both ends: rename one in Rust and a real proxy rejection
  // becomes `unclassified_transport_failure` with every test green. So the Rust source is read.
  const rust = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../src-tauri/src/governed_turn.rs'), 'utf8');

  /** The value of `pub const <name>: &str = "…";`, which must be declared exactly once. */
  const constant = (name: string): string => {
    const declared = [...rust.matchAll(new RegExp(`pub const ${name}: &str = "([^"]*)";`, 'g'))];
    expect(declared.map((m) => m[1]), `governed_turn.rs: ${name}`).toHaveLength(1);
    return declared[0][1];
  };

  /** The `format!` literal that opens with `{<name>}: `, its line continuations joined, with the
   *  constant filled in. The other `{…}` placeholders stay as written: they are runtime values. */
  const reasonFor = (name: string): string => {
    const literals = [...rust.matchAll(new RegExp(`"(\\{${name}\\}: (?:[^"\\\\]|\\\\[\\s\\S])*)"`, 'g'))];
    expect(literals, `governed_turn.rs: no format string opens with {${name}}: `).toHaveLength(1);
    return literals[0][1].replace(/\\\n\s*/g, '').replace(`{${name}}`, constant(name));
  };

  it.each([
    ['BROKER_UNSUPPORTED', 'broker_unsupported_platform'],
    ['BROKER_UNAVAILABLE', 'broker_unavailable'],
    ['BROKER_TRANSPORT_FAILED', 'broker_transport_failed'],
  ] as const)('%s is the prefix this side classifies as %s', (name, kind) => {
    expect(constant(name)).toBe(kind);
    expect(NON_DECISIONS).toContain(constant(name));
    // The whole sentence the proxy formats, not a shortened copy of it.
    const reason = reasonFor(name);
    expect(reason.startsWith(`${kind}: `)).toBe(true);
    expect(reason.length).toBeGreaterThan(kind.length + 40);
    expect(classifyTransportFailure(new Error(reason))).toEqual({ kind, detail: reason });
  });

  it('the two bare reasons are the strings the proxy returns for a frame it cannot serialise or parse', () => {
    for (const bare of ['malformed_request', 'malformed_broker_reply'] as const) {
      expect(rust, `governed_turn.rs no longer returns "${bare}"`).toContain(`.map_err(|_| "${bare}".to_string())`);
      expect(classifyTransportFailure(new Error(bare)).kind).toBe(bare);
    }
  });
});

describe('attemptGovernedTurn — a non-decision is never a verdict', () => {
  it('returns the broker decision when the broker committed', async () => {
    const a = await attemptGovernedTurn('conv-1', undefined, resolving(committedFrame()), genId);
    expect(a.status).toBe('committed');
    expect(isVerified(a)).toBe(true);
  });

  it('returns the broker decision when the broker refused — blocked stays blocked', async () => {
    const a = await attemptGovernedTurn('conv-1', undefined, resolving(blockedFrame('upstream_blocked')), genId);
    expect(a.status).toBe('blocked');
    if (a.status === 'blocked') expect(a.reason).toBe('upstream_blocked');
    // A refusal IS a broker decision, and it is not verified.
    expect(isVerified(a)).toBe(false);
  });

  it('a transport failure is `unavailable`, NOT `blocked`', async () => {
    const a = await attemptGovernedTurn('conv-1', undefined, rejecting('broker_unavailable: connect failed'), genId);
    const u = unavailable(a);
    expect(u.kind).toBe('broker_unavailable');
    // The whole point: this must not be readable as a refusal.
    expect(a.status).not.toBe('blocked');
    expect(a).not.toHaveProperty('reason');
    expect(isVerified(a)).toBe(false);
  });

  it('a platform with no transport is `unavailable`, and says which non-decision it was', async () => {
    const a = await attemptGovernedTurn(
      'conv-1', undefined, rejecting('broker_unsupported_platform: no transport here (os=windows)'), genId,
    );
    expect(unavailable(a).kind).toBe('broker_unsupported_platform');
    expect(unavailable(a).detail).toContain('os=windows');
  });

  it('a reply that is not a legal result frame is `unavailable`, never upgraded into a verdict', async () => {
    // Something answered — but an illegal frame must not become a decision of either sign.
    const a = await attemptGovernedTurn('conv-1', undefined, resolving({ protocol: 'evil', status: 'committed' }), genId);
    expect(unavailable(a).kind).toBe('malformed_broker_reply');
    expect(isVerified(a)).toBe(false);
  });

  it('a forged trust_state cannot produce a verified outcome — it becomes a non-decision', async () => {
    const forged = committedFrame();
    forged.message.trust_state = 'trusted_verified_lol';
    const a = await attemptGovernedTurn('conv-1', undefined, resolving(forged), genId);
    expect(unavailable(a).kind).toBe('malformed_broker_reply');
    expect(isVerified(a)).toBe(false);
  });

  it('a broker commit under demonstration_custody is its own outcome: decided, not accepted, no reply', async () => {
    const demo = committedFrame();
    demo.message.trust_state = DEMONSTRATION_CUSTODY;
    demo.message.body = 'a demonstration answer';
    const a = await attemptGovernedTurn('conv-1', undefined, resolving(demo), genId);
    // Not `unavailable`: every non-decision means no broker verdict exists, and here one does.
    expect(a.status).toBe('commit_not_accepted');
    // Not accepted: no Verified, whatever else is true of it.
    expect(isVerified(a)).toBe(false);
    if (a.status !== 'commit_not_accepted') throw new Error('unreachable');
    expect(a.trustState).toBe('demonstration_custody');
    expect(a.brokerTurnId).toBe('bt-1');
    expect(a.detail).toBe(COMMIT_NOT_ACCEPTED_DETAIL);
    // The reply is not carried at all, so nothing downstream can display it.
    expect(a).not.toHaveProperty('message');
    expect(JSON.stringify(a)).not.toContain('a demonstration answer');
  });

  it('a request that cannot even be built never contacts the broker', async () => {
    let contacted = false;
    const transport: BrokerTransport = async () => { contacted = true; return committedFrame(); };
    const a = await attemptGovernedTurn('conv-1', undefined, transport, () => 'not-a-uuid');
    expect(unavailable(a).kind).toBe('malformed_request');
    expect(contacted).toBe(false);
  });

  it('never rejects — every failure path resolves with an honest outcome', async () => {
    const paths = [
      attemptGovernedTurn('c', undefined, rejecting('anything at all'), genId),
      attemptGovernedTurn('c', undefined, resolving(null), genId),
      attemptGovernedTurn('c', undefined, resolving(blockedFrame('not_a_real_reason')), genId),
    ];
    const settled = await Promise.all(paths);
    for (const a of settled) expect(unavailable(a).kind).toBeTruthy();
  });

  it('sends only the three closed fields, whatever the outcome', async () => {
    let sent: Record<string, unknown> | undefined;
    const transport: BrokerTransport = async (req) => {
      sent = req as unknown as Record<string, unknown>;
      throw new Error('broker_unavailable: nope');
    };
    await attemptGovernedTurn('conv-1', 'agent-x', transport, genId);
    expect(Object.keys(sent ?? {}).sort()).toEqual(['agent', 'client_request_id', 'conversation_id', 'protocol']);
  });
});

describe('attemptGovernedTurn — a reply answers the request that asked for it, or it is no verdict', () => {
  // The renderer mints `client_request_id` for exactly this and then never looked at it again. A
  // frame that is perfect in every other respect — right protocol, complete assistant projection,
  // `trusted_verified` — was accepted and shown as Verified whichever request or conversation it
  // named.
  const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  it('a verified commit for ANOTHER request id is not a verdict, and is never Verified', async () => {
    const a = await attemptGovernedTurn(
      'conv-1', undefined, resolving({ ...committedFrame(), client_request_id: OTHER }), genId);
    expect(isVerified(a)).toBe(false);
    expect(unavailable(a).kind).toBe('malformed_broker_reply');
  });

  it('a verified commit for ANOTHER conversation is not a verdict either', async () => {
    const a = await attemptGovernedTurn(
      'conv-1', undefined, resolving({ ...committedFrame(), conversation_id: 'conv-OTHER' }), genId);
    expect(isVerified(a)).toBe(false);
    expect(unavailable(a).kind).toBe('malformed_broker_reply');
  });

  it('a refusal naming another request is not this request\'s refusal', async () => {
    const a = await attemptGovernedTurn(
      'conv-1', undefined, resolving({ ...blockedFrame('upstream_blocked'), client_request_id: OTHER }), genId);
    expect(unavailable(a).kind).toBe('malformed_broker_reply');
  });

  it('control: the reply to THIS request is still a verdict', async () => {
    const ok = await attemptGovernedTurn('conv-1', undefined, resolving(committedFrame()), genId);
    expect(isVerified(ok)).toBe(true);
    const refused = await attemptGovernedTurn('conv-1', undefined, resolving(blockedFrame('upstream_blocked')), genId);
    expect(refused.status).toBe('blocked');
  });

  it('the broker\'s answer to a frame it could not decode — `malformed`, every id empty — stays a refusal', async () => {
    // `broker_orchestrator::run_governed_turn` has nothing to echo on that path and echoes empty
    // ids. It is a real broker decision; a plain equality check would turn it into "unavailable".
    const a = await attemptGovernedTurn('conv-1', undefined, resolving({
      protocol: RESULT_PROTOCOL, status: 'blocked', reason: 'malformed',
      client_request_id: '', broker_turn_id: '', conversation_id: '',
    }), genId);
    expect(a.status).toBe('blocked');
  });

  it('empty ids are that one shape only: an uncorrelated refusal for any other reason is not accepted', async () => {
    const a = await attemptGovernedTurn('conv-1', undefined, resolving({
      protocol: RESULT_PROTOCOL, status: 'blocked', reason: 'upstream_blocked',
      client_request_id: '', broker_turn_id: '', conversation_id: '',
    }), genId);
    expect(unavailable(a).kind).toBe('malformed_broker_reply');
  });
});

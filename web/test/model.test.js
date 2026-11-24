import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalAgreement,
  proposalStatus,
  safeProposalId,
  errorMessage,
  escapeHtml,
  transactionPath,
} from '../src/model.js';

test('canonical agreement follows receipt order, not voter list or relay order', () => {
  const result = canonicalAgreement(
    [
      { choice: 2, sequence: 9n },
      { choice: 1, sequence: 2n },
      { choice: 1, sequence: 3n },
    ],
    2,
  );
  assert.equal(result.support, 0);
  assert.equal(result.reached, true);
});
test('split ballots do not count as same-side consensus', () => {
  assert.equal(
    canonicalAgreement(
      [
        { choice: 2, sequence: 1n },
        { choice: 1, sequence: 2n },
      ],
      2,
    ).reached,
    false,
  );
});
test('old ballots before re-adding a voter are excluded', () => {
  assert.equal(
    canonicalAgreement(
      [
        { choice: 2, sequence: 1n, floor: 1n },
        { choice: 2, sequence: 2n },
      ],
      2,
    ).reached,
    false,
  );
});
test('invalid ballots and absent receipts never count', () => {
  assert.deepEqual(
    canonicalAgreement(
      [
        { choice: 0, sequence: 0n },
        { choice: 4, sequence: 1n },
      ],
      1,
    ).counts,
    [0, 0, 0],
  );
});
test('first side to threshold wins even when both sides eventually qualify', () => {
  assert.equal(
    canonicalAgreement(
      [
        { choice: 2, sequence: 4n },
        { choice: 1, sequence: 1n },
        { choice: 2, sequence: 3n },
        { choice: 1, sequence: 2n },
      ],
      2,
    ).support,
    0,
  );
});
test('a zero or impossible threshold fails closed', () => {
  assert.equal(
    canonicalAgreement([{ choice: 2, sequence: 1n }], 0).reached,
    false,
  );
  assert.equal(
    canonicalAgreement([{ choice: 2, sequence: 1n }], 2).reached,
    false,
  );
});
test('proposal lifecycle is not confused with delivery', () => {
  assert.equal(
    proposalStatus({ state: 4, voted: true, mirrored: true }),
    'Mirrored',
  );
  assert.equal(
    proposalStatus({ state: 1, voted: false, skipped: true }),
    'Skipped',
  );
  assert.equal(
    proposalStatus({ state: 1, voted: false, paused: true }),
    'Paused',
  );
  assert.equal(proposalStatus({ state: 3, voted: false }), 'Defeated');
  assert.equal(
    proposalStatus({ state: 1, voted: true, mirrored: false }),
    'Voted',
  );
});
test('proposal IDs preserve uint256 precision and reject unsafe input', () => {
  assert.equal(
    safeProposalId(
      '49757969774088266091400892823129886353044308034007435573215089695692240129519',
    ).toString(),
    '49757969774088266091400892823129886353044308034007435573215089695692240129519',
  );
  for (const value of [
    '-1',
    '1.5',
    '1e18',
    '0',
    '<script>',
    (2n ** 256n).toString(),
  ])
    assert.throws(() => safeProposalId(value));
});
test('wallet rejection is actionable without exposing raw provider details', () => {
  assert.equal(
    errorMessage({ cause: { code: 4001 } }),
    'Request declined in your wallet. Nothing was sent.',
  );
  assert.equal(
    errorMessage(new Error('RPC secret details')),
    'The request could not be completed. Please try again.',
  );
});
test('untrusted text is escaped before HTML rendering', () => {
  assert.equal(
    escapeHtml('<img onerror="x">&'),
    '&lt;img onerror=&quot;x&quot;&gt;&amp;',
  );
});
test('transaction provenance separates Reactive, sender and owner recovery', () => {
  assert.equal(
    transactionPath('0x111', '0x111', '0x222', '0x333'),
    'Reactive callback',
  );
  assert.equal(
    transactionPath('0x222', '0x111', '0x222', '0x333'),
    'Recovery sender',
  );
  assert.equal(
    transactionPath('0x333', '0x111', '0x222', '0x333'),
    'Owner recovery',
  );
  assert.equal(
    transactionPath('0x444', '0x111', '0x222', '0x333'),
    'Permissionless recovery',
  );
});
test('Reactive outer transaction targets the proxy; its sender is not the proxy', () => {
  assert.equal(
    transactionPath('0x999', '0x111', '0x222', '0x333', '0x111'),
    'Reactive callback',
  );
});

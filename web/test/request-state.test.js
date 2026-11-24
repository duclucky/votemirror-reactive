import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('callback request labels distinguish no request and all three choices', async (t) => {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });
  try {
    const module = await server.ssrLoadModule('/src/chain.js');
    const originalRead = module.reactive.readContract;
    const originalBlock = module.reactive.getBlockNumber;
    try {
      module.reactive.getBlockNumber = async () => 123n;
      for (const [name, requested, support, expected] of [
        ['not requested', false, 0, 0],
        ['Against', true, 0, 1],
        ['For', true, 1, 2],
        ['Abstain', true, 2, 3],
      ]) {
        await t.test(name, async () => {
          module.reactive.readContract = async ({ functionName }) => {
            if (functionName === 'mirrorRequested') return requested;
            if (functionName === 'requestedSupport') return support;
            throw new Error('Unexpected read');
          };
          assert.equal(await module.readRequested('123'), expected);
        });
      }
    } finally {
      module.reactive.readContract = originalRead;
      module.reactive.getBlockNumber = originalBlock;
    }
  } finally {
    await server.close();
  }
});

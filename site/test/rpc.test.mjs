import test from "node:test";
import assert from "node:assert/strict";
import { Rpc, RpcError, mapLimit } from "../js/rpc.js";

const reply = (json, status = 200) => ({ status, text: async () => (typeof json === "string" ? json : JSON.stringify(json)) });

function client(handlers, endpoints) {
  const seen = [];
  const fetch = async (url, { body }) => {
    const request = JSON.parse(body);
    seen.push({ host: new URL(url).host, request });
    return handlers[new URL(url).host](request);
  };
  return { rpc: new Rpc({ name: "Test", endpoints, fetch }), seen };
}

test("request falls back to the next endpoint and remembers it", async () => {
  const { rpc, seen } = client(
    {
      "a.test": async () => reply("<html>502</html>", 502),
      "b.test": async (request) => reply({ jsonrpc: "2.0", id: request.id, result: "0x10" }),
    },
    [{ url: "https://a.test" }, { url: "https://b.test" }],
  );
  assert.equal(await rpc.blockNumber(), 16);
  assert.equal(await rpc.blockNumber(), 16);
  assert.deepEqual(seen.map((entry) => entry.host), ["a.test", "b.test", "b.test"]);
});

test("a contract revert is reported, not retried elsewhere", async () => {
  const { rpc, seen } = client(
    {
      "a.test": async (request) => reply({ jsonrpc: "2.0", id: request.id, error: { code: 3, message: "execution reverted" } }),
      "b.test": async (request) => reply({ jsonrpc: "2.0", id: request.id, result: "0x" }),
    },
    [{ url: "https://a.test" }, { url: "https://b.test" }],
  );
  await assert.rejects(rpc.call("0x" + "11".repeat(20), "0x12345678"), (error) => error instanceof RpcError && error.contract);
  assert.equal(seen.length, 1);
});

test("fails with the endpoint's name when every endpoint is down", async () => {
  const { rpc } = client(
    { "a.test": async () => { throw new TypeError("Failed to fetch"); } },
    [{ url: "https://a.test" }],
  );
  await assert.rejects(rpc.request("eth_chainId"), /Test: a\.test Failed to fetch/);
});

test("batch keeps per-call results and treats reverts as missing, in order", async () => {
  const { rpc } = client(
    {
      "a.test": async (request) =>
        reply(
          request
            .map((call) =>
              call.params[0] === "bad"
                ? { jsonrpc: "2.0", id: call.id, error: { code: 3, message: "execution reverted" } }
                : { jsonrpc: "2.0", id: call.id, result: call.params[0] },
            )
            .reverse(),
        ),
    },
    [{ url: "https://a.test" }],
  );
  rpc.batchSize = 2;
  const results = await rpc.batch(["one", "bad", "three"].map((value) => ({ method: "echo", params: [value] })));
  assert.deepEqual(results.map((result) => result.ok), [true, false, true]);
  assert.deepEqual([results[0].result, results[2].result], ["one", "three"]);
  assert.ok(results[1].error.contract);
});

test("getLogs windows by the endpoint's range, halves rejected ranges, skips endpoints without logs", async () => {
  const ranges = [];
  const { rpc, seen } = client(
    {
      "nologs.test": async () => assert.fail("must not be asked for logs"),
      "logs.test": async (request) => {
        const [{ fromBlock, toBlock }] = request.params;
        const from = Number(BigInt(fromBlock));
        const to = Number(BigInt(toBlock));
        if (to - from + 1 > 50) return reply({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "query exceeds max block range" } });
        ranges.push([from, to]);
        return reply({ jsonrpc: "2.0", id: 1, result: [{ blockNumber: fromBlock, removed: false }, { blockNumber: toBlock, removed: true }] });
      },
    },
    [{ url: "https://nologs.test" }, { url: "https://logs.test", logRange: 100 }],
  );
  const logs = await rpc.getLogs({ address: ["0x" + "11".repeat(20)], fromBlock: 1000, toBlock: 1249 });
  assert.deepEqual(ranges, [[1000, 1049], [1050, 1099], [1100, 1149], [1150, 1199], [1200, 1249]]);
  assert.deepEqual(logs.map((log) => Number(BigInt(log.blockNumber))), [1000, 1050, 1100, 1150, 1200]);
  assert.ok(seen.every((entry) => entry.host === "logs.test"));
  assert.equal(rpc.logRange, 100);
  assert.deepEqual(await rpc.getLogs({ address: [], fromBlock: 10, toBlock: 9 }), []);
});

test("mapLimit keeps order and bounds concurrency", async () => {
  let running = 0;
  let peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
    peak = Math.max(peak, ++running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    return n * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
});

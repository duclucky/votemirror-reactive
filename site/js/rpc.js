// JSON-RPC over fetch with endpoint fallback, batching and windowed eth_getLogs. No dependencies.

export class RpcError extends Error {
  constructor(message, { code, contract = false } = {}) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    /** True when the node answered and the contract itself rejected the call (a revert). */
    this.contract = contract;
  }
}

const isContractError = (error) =>
  error?.code === 3 || /execution reverted|revert/i.test(error?.message ?? "");

const isRangeError = (error) =>
  /range|limit|too many|too large|exceed|response size|timeout/i.test(error?.message ?? "");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hex = (n) => "0x" + BigInt(n).toString(16);

export class Rpc {
  /**
   * @param {object} options
   * @param {string} options.name Chain name used in error messages.
   * @param {{url: string, logRange?: number}[]} options.endpoints Tried in order. `logRange` is the widest
   *   block span the endpoint accepts in eth_getLogs; endpoints without it are not used for logs.
   */
  constructor({ name, endpoints, fetch = globalThis.fetch.bind(globalThis), timeoutMs = 20_000, batchSize = 25 }) {
    this.name = name;
    this.endpoints = endpoints;
    this.fetch = fetch;
    this.timeoutMs = timeoutMs;
    this.batchSize = batchSize;
    this.current = 0;
    this.requests = 0;
  }

  async #post(url, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      this.requests++;
      const response = await this.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new RpcError(`${this.name}: HTTP ${response.status} from ${new URL(url).host}`);
      }
      return json;
    } catch (error) {
      if (error instanceof RpcError) throw error;
      const reason = error?.name === "AbortError" ? "timed out" : error?.message || "network error";
      throw new RpcError(`${this.name}: ${new URL(url).host} ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Runs `attempt(endpoint)` on the current endpoint, moving to the next one when it fails. */
  async #withFallback(attempt, usable = () => true) {
    const candidates = this.endpoints.map((endpoint, index) => ({ endpoint, index })).filter((c) => usable(c.endpoint));
    if (!candidates.length) throw new RpcError(`${this.name}: no usable RPC endpoint`);
    const start = Math.max(0, candidates.findIndex((c) => c.index >= this.current));
    let lastError;
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < candidates.length; i++) {
        const { endpoint, index } = candidates[(start + i) % candidates.length];
        try {
          const result = await attempt(endpoint);
          this.current = index;
          return result;
        } catch (error) {
          if (error instanceof RpcError && error.contract) throw error;
          lastError = error;
        }
      }
      await sleep(600);
    }
    throw lastError;
  }

  static #unwrap(name, reply) {
    if (reply?.error) {
      throw new RpcError(`${name}: ${reply.error.message ?? "RPC error"}`, {
        code: reply.error.code,
        contract: isContractError(reply.error),
      });
    }
    if (!reply || !("result" in reply)) throw new RpcError(`${name}: malformed RPC reply`);
    return reply.result;
  }

  request(method, params = []) {
    return this.#withFallback(async ({ url }) =>
      Rpc.#unwrap(this.name, await this.#post(url, { jsonrpc: "2.0", id: 1, method, params })),
    );
  }

  /**
   * Sends several calls in JSON-RPC batches. Resolves to one entry per call:
   * `{ ok: true, result }` or `{ ok: false, error }`. Contract reverts do not fail the batch.
   */
  async batch(calls) {
    const out = new Array(calls.length);
    for (let offset = 0; offset < calls.length; offset += this.batchSize) {
      const chunk = calls.slice(offset, offset + this.batchSize);
      const replies = await this.#withFallback(async ({ url }) => {
        const body = chunk.map((call, i) => ({ jsonrpc: "2.0", id: i, method: call.method, params: call.params ?? [] }));
        const json = await this.#post(url, body);
        if (!Array.isArray(json) || json.length !== chunk.length) {
          throw new RpcError(`${this.name}: ${json?.error?.message ?? "batch rejected"}`);
        }
        const byId = new Map(json.map((reply) => [reply.id, reply]));
        return chunk.map((_, i) => {
          const reply = byId.get(i);
          // A node-side failure (rate limit, missing data) fails the batch so another endpoint is tried.
          if (reply?.error && !isContractError(reply.error)) Rpc.#unwrap(this.name, reply);
          return reply;
        });
      });
      replies.forEach((reply, i) => {
        try {
          out[offset + i] = { ok: true, result: Rpc.#unwrap(this.name, reply) };
        } catch (error) {
          out[offset + i] = { ok: false, error };
        }
      });
    }
    return out;
  }

  call(to, data, block = "latest") {
    return this.request("eth_call", [{ to, data }, block]);
  }

  async blockNumber() {
    return Number(BigInt(await this.request("eth_blockNumber")));
  }

  /** Widest eth_getLogs span any endpoint accepts. */
  get logRange() {
    return Math.max(0, ...this.endpoints.map((endpoint) => endpoint.logRange ?? 0));
  }

  /**
   * All logs of `address` (one or several) in the inclusive block range, ordered by block and log index.
   * The range is split to fit the endpoint and halved again if the endpoint still refuses it.
   */
  async getLogs({ address, fromBlock, toBlock, topics }) {
    if (toBlock < fromBlock) return [];
    return this.#withFallback(
      async ({ url, logRange }) => {
        const fetchRange = async (from, to) => {
          if (to - from + 1 > logRange) {
            const logs = [];
            for (let start = from; start <= to; start += logRange) {
              logs.push(...(await fetchRange(start, Math.min(to, start + logRange - 1))));
            }
            return logs;
          }
          const filter = { address, fromBlock: hex(from), toBlock: hex(to) };
          if (topics) filter.topics = topics;
          const reply = await this.#post(url, { jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [filter] });
          if (reply?.error && isRangeError(reply.error) && to > from) {
            const middle = Math.floor((from + to) / 2);
            return [...(await fetchRange(from, middle)), ...(await fetchRange(middle + 1, to))];
          }
          return Rpc.#unwrap(this.name, reply);
        };
        const logs = await fetchRange(fromBlock, toBlock);
        return logs.filter((log) => !log.removed);
      },
      (endpoint) => endpoint.logRange > 0,
    );
  }
}

/** Runs `worker` over `items` with at most `limit` running at once, keeping the order of results. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

// The two testnets VoteMirror runs on. Testnets only: there is no mainnet entry on purpose.

export const NETWORKS = {
  base: {
    key: "base",
    name: "Base Sepolia",
    chainId: 84532,
    currency: "ETH",
    // Public endpoints that allow browser requests. sepolia.base.org limits eth_getLogs to 200 blocks,
    // so it only serves calls.
    endpoints: [
      { url: "https://base-sepolia-rpc.publicnode.com", logRange: 40_000 },
      { url: "https://base-sepolia.gateway.tenderly.co", logRange: 40_000 },
      { url: "https://sepolia.base.org" },
    ],
    tx: (hash) => `https://sepolia.basescan.org/tx/${hash}`,
    address: (address) => `https://sepolia.basescan.org/address/${address}`,
    explorer: "Basescan",
  },
  lasna: {
    key: "lasna",
    name: "Reactive Lasna",
    chainId: 5318007,
    currency: "lREACT",
    endpoints: [{ url: "https://lasna-rpc.rnk.dev/", logRange: 20_000 }],
    tx: (hash) => `https://lasna.reactscan.net/tx/${hash}`,
    address: (address) => `https://lasna.reactscan.net/address/${address}`,
    explorer: "Reactscan",
  },
};

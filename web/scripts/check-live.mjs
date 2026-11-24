// Read-only acceptance check against the deployed testnets. Sends no transactions.
import { createServer } from 'vite';
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const { readWorkspace, readReactive, verifyScenario, scenarios } =
    await server.ssrLoadModule('/src/chain.js');
  const [workspace, source] = await Promise.all([
    readWorkspace(),
    readReactive(),
  ]);
  console.log(
    JSON.stringify({
      baseBlock: workspace.blockNumber.toString(),
      lasnaBlock: source.blockNumber.toString(),
      trusted: workspace.trusted.length,
      threshold: workspace.threshold,
      policiesMatch: workspace.policyHash === source.policyHash,
      paused: workspace.paused,
    }),
  );
  for (const scenario of scenarios) {
    const proof = await verifyScenario(scenario);
    console.log(
      JSON.stringify({
        scenario: scenario.mode,
        receiptVerification: 'passed',
        deliveryPath: proof.path,
        sourceVerified: proof.sourceVerified,
      }),
    );
  }
} finally {
  await server.close();
}

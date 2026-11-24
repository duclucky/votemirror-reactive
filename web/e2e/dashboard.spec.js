import { test, expect } from '@playwright/test';

test('real recorded execution, proof navigation and wallet empty state', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Good decisions. Mirrored.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'A shared conviction' }),
  ).toBeVisible();
  await expect(
    page.getByText('Receipts rechecked at', { exact: false }),
  ).toBeVisible({ timeout: 45_000 });
  await page.screenshot({
    path: '.local/screenshots/desktop.png',
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Execution proofs' }).click();
  await expect(
    page.getByRole('heading', { name: 'Every claim has a transaction.' }),
  ).toBeVisible();
  await expect(page.locator('.proof-card')).toHaveCount(9);
  await page
    .getByRole('button', { name: /Disagreement is a decision/ })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Disagreement is a decision' }),
  ).toBeVisible();
  await expect(
    page.getByText('Threshold not reached', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Connect wallet', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('No browser wallet detected')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('current policy reads are separate from recorded demos', async ({
  page,
}) => {
  await page.goto('/#policy');
  await expect(page.getByText('Policies match', { exact: true })).toBeVisible({
    timeout: 45_000,
  });
  await expect(
    page.getByRole('heading', { name: 'Trust, with boundaries.' }),
  ).toBeVisible();
  await expect(
    page.getByText('Disabled to conserve testnet fees'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Proposals', exact: true }).click();
  await page
    .getByRole('button', { name: 'Live workspace', exact: true })
    .click();
  await page.getByRole('button', { name: 'Find by ID', exact: true }).click();
  await page.getByLabel('Proposal ID', { exact: true }).fill('1.5');
  await page
    .getByRole('button', { name: 'Open proposal', exact: true })
    .click();
  await expect(
    page.getByText('Enter a valid decimal proposal ID', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page
    .getByRole('button', { name: 'New proposal', exact: true })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Create proposal', exact: true }),
  ).toBeDisabled();
});

test('mobile layouts keep content inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Good decisions. Mirrored.' }),
  ).toBeVisible();
  await expect(
    page.getByText('Receipts rechecked at', { exact: false }),
  ).toBeVisible({ timeout: 45_000 });
  await page.screenshot({
    path: '.local/screenshots/mobile.png',
    fullPage: true,
  });
  for (const tab of [
    'Overview',
    'Proposals',
    'Trusted policy',
    'Execution proofs',
  ]) {
    await page.getByRole('link', { name: tab, exact: true }).click();
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits, `${tab} should not overflow at 390px`).toBe(true);
  }
});

test('wallet connection switches from mainnet before signing and handles rejection', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.testWalletChain = '0x1';
    window.testWalletSends = [];
    window.ethereum = {
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts')
          return ['0x0f8AA1b7E5D822214B235c1c8257C07965b6A2a6'];
        if (method === 'eth_chainId') return window.testWalletChain;
        if (method === 'wallet_switchEthereumChain') {
          window.testWalletChain = params[0].chainId;
          return null;
        }
        if (method === 'eth_sendTransaction') {
          window.testWalletSends.push({
            chain: window.testWalletChain,
            transaction: params[0],
          });
          throw Object.assign(new Error('Rejected'), { code: 4001 });
        }
        throw Object.assign(new Error('Unsupported method'), { code: 4200 });
      },
      on() {},
      removeListener() {},
    };
  });
  await page.goto('/#policy');
  await expect(page.getByText('Policies match', { exact: true })).toBeVisible({
    timeout: 45_000,
  });
  await page
    .getByRole('button', { name: 'Connect wallet', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Browser wallet', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Proposals', exact: true }).click();
  await page
    .getByRole('button', { name: 'New proposal', exact: true })
    .first()
    .click();
  await page
    .getByLabel('Proposal title')
    .fill('A safely rejected test proposal');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create proposal', exact: true })
    .click();
  await expect(
    page.getByText('Request declined in your wallet. Nothing was sent.'),
  ).toBeVisible({ timeout: 30_000 });
  const attempts = await page.evaluate(() => window.testWalletSends);
  expect(attempts).toHaveLength(1);
  expect(Number(attempts[0].chain)).toBe(84532);
  await expect(
    page.getByText('Transaction confirmed.', { exact: true }),
  ).toHaveCount(0);
});

test('RPC outage preserves recorded evidence and disables live sending', async ({
  page,
}) => {
  await page.route(
    /https:\/\/(sepolia\.base\.org|base-sepolia-rpc\.publicnode\.com|lasna-rpc\.rnk\.dev)/,
    (route) => route.abort(),
  );
  await page.goto('/');
  await expect(
    page.getByText('Base RPC is unavailable.', { exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(
    page.getByRole('heading', { name: 'A shared conviction' }),
  ).toBeVisible();
  await expect(
    page.getByText('Receipt check unavailable. Saved evidence is shown.'),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Live workspace', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Waiting for a Base connection' }),
  ).toBeVisible();
});

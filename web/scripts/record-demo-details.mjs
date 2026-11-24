// Read-only pickup shots for the same genuine recorded transaction.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = resolve(root, 'artifacts/video');
const live = JSON.parse(
  readFileSync(join(folder, 'recording-live-timeline.json'), 'utf8'),
);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--window-size=1920,1160', '--force-device-scale-factor=1'],
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: {
    dir: join(folder, 'recordings'),
    size: { width: 1920, height: 1080 },
  },
  locale: 'en-US',
});
const start = Date.now();
const page = await context.newPage();
const timeline = {
  recordingType: 'Actual Chrome read-only pickup recording',
  runId: live.runId,
  events: [],
  rawVideo: await page.video().path(),
};
const save = () =>
  writeFileSync(
    join(folder, 'recording-details-timeline.json'),
    JSON.stringify(timeline, null, 2),
  );
const mark = (name, extra = {}) => {
  const event = { name, seconds: (Date.now() - start) / 1000, ...extra };
  timeline.events.push(event);
  save();
  console.log(JSON.stringify(event));
};
const pause = (ms) => page.waitForTimeout(ms);
async function goto(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return;
    } catch (error) {
      if (attempt === 1) throw error;
      console.log('Retrying a slow read-only explorer navigation');
    }
  }
}
async function explorer(name, url) {
  await goto(url);
  await page.waitForFunction(
    () => /success/i.test(document.body.innerText),
    null,
    { timeout: 45000 },
  );
  await pause(1800);
  mark(`${name}-ready`, { url });
  await pause(6500);
  await page.mouse.wheel(0, 220);
  await pause(3000);
}
try {
  await explorer(
    'reactive',
    `https://lasna.reactscan.net/tx/${live.transactions.reactive}`,
  );
  mark('reactive-end');
  await explorer(
    'callback',
    `https://base-sepolia.blockscout.com/tx/${live.transactions.callback}`,
  );
  const logs = page.getByText('Logs', { exact: true });
  if (await logs.count()) {
    await logs.first().click();
    await pause(5000);
    await page.mouse.wheel(0, 230);
    await pause(5000);
  }
  await page.screenshot({ path: join(folder, 'qa/callback-logs.png') });
  mark('callback-end');
  await goto('http://127.0.0.1:4173/?demo=split#proposals');
  await page.getByText('Threshold not reached', { exact: true }).waitFor();
  await pause(1500);
  mark('split-ready');
  await pause(10500);
  await page.locator('#scenario').selectOption('skip');
  await page.getByRole('heading', { name: 'Your veto stays yours' }).waitFor();
  await pause(1500);
  mark('skip-ready');
  await pause(10500);
  await goto(
    'https://github.com/duclucky/votemirror-reactive/blob/main/docs/submission-evidence.md',
  );
  const heading = page.getByRole('heading', {
    name: 'VoteMirror: submission transaction evidence',
    exact: true,
  });
  await heading.waitFor({ timeout: 45000 });
  await heading.scrollIntoViewIfNeeded();
  await pause(1200);
  mark('evidence-index-ready');
  await pause(5000);
  await page.mouse.wheel(0, 250);
  await pause(7500);
  mark('evidence-index-end');
  await explorer(
    'recovery',
    'https://base-sepolia.blockscout.com/tx/0xba401020d14156ed4b4e2748b4f6d969911aa42691311f5c372290cab2b8cd21',
  );
  mark('recovery-end');
  await goto('http://127.0.0.1:4173/#policy');
  await page.getByText('Policies match', { exact: true }).waitFor();
  await pause(1500);
  mark('closing-policy');
  await pause(8000);
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await pause(1500);
  mark('closing-overview');
  await pause(8000);
  mark('recording-end');
  timeline.status = 'recorded';
  save();
} catch (error) {
  timeline.status = 'interrupted';
  timeline.error = error.message;
  save();
  throw error;
} finally {
  await context.close();
  await browser.close();
}

// Records an actual Chrome session. No mocked RPCs, screenshots-as-video or injected voting data.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runId = process.argv[2] ?? 'video-20261124-01';
if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error('Invalid recording run ID');
const wallet =
  process.env.VOTEMIRROR_WALLET_DIRECTORY ??
  join(homedir(), '.codex/wallets/votemirror-v2-20261124');
const folder = resolve(root, 'artifacts/video');
const evidencePath = resolve(root, `deployments/v4-for-${runId}.json`);
const timeline = {
  runId,
  recordingType: 'Continuous actual Chrome viewport recording',
  mockedRPCs: false,
  events: [],
};
let start = 0;
const save = () =>
  writeFileSync(
    join(folder, 'recording-timeline.json'),
    JSON.stringify(timeline, null, 2),
  );
const mark = (name, extra = {}) => {
  const event = { name, seconds: (Date.now() - start) / 1000, ...extra };
  timeline.events.push(event);
  save();
  console.log(JSON.stringify(event));
};
function ps(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.env.VOTEMIRROR_PWSH ?? 'pwsh',
      ['-NoProfile', ...args],
      { cwd: root, windowsHide: true },
    );
    let output = '';
    child.stdout.on('data', (d) => {
      output += d;
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolvePromise(output)
        : reject(new Error(`PowerShell step failed (${code})`)),
    );
  });
}
const step = (stop) =>
  ps([
    '-File',
    join(root, 'script/demo.ps1'),
    '-WalletDirectory',
    wallet,
    '-Mode',
    'for',
    '-RunId',
    runId,
    '-StopAfter',
    stop,
    '-WaitSeconds',
    '180',
  ]);
let restoreSender = false,
  browser,
  context,
  page;
const pause = (ms) => page.waitForTimeout(ms);
async function moveTo(locator) {
  const b = await locator.boundingBox().catch(() => null);
  if (b)
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 24 });
}
async function click(locator) {
  await moveTo(locator);
  await locator.click();
}
async function explorer(name, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => /success/i.test(document.body.innerText), {
    timeout: 35000,
  });
  await pause(2200);
  mark(`${name}-ready`, { url });
  await pause(4200);
  await page.mouse.wheel(0, 260);
  await pause(2200);
}
try {
  const result = await ps([
    '-Command',
    `$j=Get-Content "$env:USERPROFILE/.codex/votemirror-relayer/journal.json" -Raw|ConvertFrom-Json;if($null -ne $j.pending){throw 'Sender has pending transaction'};(Get-ScheduledTask -TaskName VoteMirror-Relayer-Testnet).State.ToString()`,
  ]);
  if (result.trim() === 'Running') {
    restoreSender = true;
    await ps([
      '-Command',
      "Stop-ScheduledTask -TaskName VoteMirror-Relayer-Testnet; Start-Sleep -Seconds 2; $j=Get-Content \"$env:USERPROFILE/.codex/votemirror-relayer/journal.json\" -Raw|ConvertFrom-Json;if($null -ne $j.pending){throw 'Pending transaction after stop'};if(@(Get-CimInstance Win32_Process -Filter \"Name='python.exe'\"|Where-Object CommandLine -Like '*votemirror-relayer*').Count){throw 'Sender remains active'}",
    ]);
  }
  timeline.senderTemporarilyStopped = restoreSender;
  await step('proposal');
  const prepared = JSON.parse(
    readFileSync(evidencePath, 'utf8').replace(/^\uFEFF/, ''),
  );
  timeline.proposalId = prepared.proposalId;
  browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [
      '--window-size=1920,1160',
      '--window-position=0,0',
      '--force-device-scale-factor=1',
    ],
  });
  context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: join(folder, 'recordings'),
      size: { width: 1920, height: 1080 },
    },
    locale: 'en-US',
  });
  start = Date.now();
  page = await context.newPage();
  const video = page.video();
  timeline.rawVideo = await video.path();
  save();
  await page.goto('http://127.0.0.1:4173/', {
    waitUntil: 'networkidle',
    timeout: 45000,
  });
  await page.getByText('Enabled', { exact: true }).waitFor({ timeout: 30000 });
  mark('overview-ready');
  await pause(7000);
  await page.mouse.move(970, 610, { steps: 36 });
  await pause(4000);
  await click(page.getByRole('link', { name: 'Trusted policy', exact: true }));
  await page.getByText('Policies match', { exact: true }).waitFor();
  mark('policy-ready');
  await pause(6500);
  await page.mouse.wheel(0, 260);
  await pause(6500);
  await click(page.getByRole('link', { name: 'Proposals', exact: true }));
  await click(
    page.getByRole('button', { name: 'Live workspace', exact: true }),
  );
  await page.locator('#live-proposal').selectOption(prepared.proposalId);
  await page
    .locator('.consensus-numeral')
    .filter({ hasText: /0\s*\/\s*2/ })
    .waitFor({ timeout: 30000 });
  await page.mouse.wheel(0, -600);
  await pause(1800);
  mark('live-zero');
  await pause(6500);
  mark('alice-submit');
  await step('firstvote');
  await page.reload({ waitUntil: 'networkidle' });
  await page
    .locator('.consensus-numeral')
    .filter({ hasText: /1\s*\/\s*2/ })
    .waitFor({ timeout: 30000 });
  mark('alice-confirmed');
  await pause(8500);
  mark('bob-submit');
  await step('complete');
  await page.reload({ waitUntil: 'networkidle' });
  await page
    .getByText('Vote mirrored', { exact: true })
    .waitFor({ timeout: 30000 });
  await page
    .getByText('For · current policy', { exact: true })
    .waitFor({ timeout: 30000 });
  mark('mirrored-ready');
  await page.screenshot({ path: join(folder, 'qa/live-mirrored.png') });
  await pause(7000);
  await page.mouse.wheel(0, 230);
  await pause(7500);
  mark('live-end');
  const evidence = JSON.parse(
    readFileSync(evidencePath, 'utf8').replace(/^\uFEFF/, ''),
  );
  timeline.transactions = {
    origin: evidence.steps.bobVote.hash,
    reactive: evidence.reactiveEvents[0].transactionHash,
    callback: evidence.mirrored[0].transactionHash,
  };
  save();
  await explorer(
    'origin',
    `https://base-sepolia.blockscout.com/tx/${timeline.transactions.origin}`,
  );
  mark('origin-end');
  await explorer(
    'reactive',
    `https://lasna.reactscan.net/tx/${timeline.transactions.reactive}`,
  );
  mark('reactive-end');
  await explorer(
    'callback',
    `https://base-sepolia.blockscout.com/tx/${timeline.transactions.callback}`,
  );
  const logsTab = page.getByText('Logs', { exact: true });
  if (await logsTab.count()) {
    await click(logsTab.first());
    await pause(4000);
    await page.mouse.wheel(0, 230);
    await pause(4000);
  }
  mark('callback-end');
  await page.goto('http://127.0.0.1:4173/?demo=split#proposals', {
    waitUntil: 'networkidle',
  });
  await page.getByText('Threshold not reached', { exact: true }).waitFor();
  mark('split-ready');
  await pause(8500);
  await page.locator('#scenario').selectOption('skip');
  await page.getByRole('heading', { name: 'Your veto stays yours' }).waitFor();
  mark('skip-ready');
  await pause(8500);
  await page.goto(
    'https://github.com/duclucky/votemirror-reactive/blob/main/docs/submission-evidence.md',
    { waitUntil: 'domcontentloaded', timeout: 45000 },
  );
  await page
    .getByRole('heading', {
      name: 'VoteMirror: submission transaction evidence',
      exact: true,
    })
    .waitFor({ timeout: 30000 });
  await page
    .getByRole('heading', {
      name: 'VoteMirror: submission transaction evidence',
      exact: true,
    })
    .scrollIntoViewIfNeeded();
  mark('evidence-index-ready');
  await pause(4000);
  await page.mouse.wheel(0, 240);
  await pause(6000);
  mark('evidence-index-end');
  await explorer(
    'recovery',
    `https://base-sepolia.blockscout.com/tx/0xba401020d14156ed4b4e2748b4f6d969911aa42691311f5c372290cab2b8cd21`,
  );
  mark('recovery-end');
  await page.goto('http://127.0.0.1:4173/#policy', {
    waitUntil: 'networkidle',
  });
  await page.getByText('Policies match', { exact: true }).waitFor();
  mark('closing-policy');
  await pause(6500);
  await click(page.getByRole('link', { name: 'Overview', exact: true }));
  await pause(6500);
  mark('recording-end');
  timeline.status = 'recorded';
  await context.close();
  context = null;
  await browser.close();
  browser = null;
  save();
  console.log('Real Chrome recording complete.');
} catch (error) {
  timeline.status = 'interrupted';
  timeline.error = error.message;
  save();
  throw error;
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (restoreSender) {
    await ps([
      '-Command',
      'Start-ScheduledTask -TaskName VoteMirror-Relayer-Testnet',
    ]);
    timeline.senderRestored = true;
    save();
  }
}

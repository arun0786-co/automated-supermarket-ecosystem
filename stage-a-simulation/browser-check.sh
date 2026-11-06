#!/usr/bin/env bash
# stage A shares its dashboard with stage B, so this makes sure the plain version still works: the
# simulator and dashboard in containers, driven by a real browser, with no login and no stage B
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
NET=ase-stage-a-check
PLAYWRIGHT=1.65.0
SIM=ase-stage-a-sim
WEB=ase-stage-a-web

cleanup() {
  docker rm -f "$SIM" "$WEB" > /dev/null 2>&1
  docker network rm "$NET" > /dev/null 2>&1
}
trap cleanup EXIT
cleanup
docker network create "$NET" > /dev/null

docker run -d --name "$SIM" --network "$NET" --network-alias simulator -v "$HERE/api-simulator:/src:ro" node:22-alpine \
  sh -c 'cp -r /src /app 2>/dev/null; cd /app && rm -rf node_modules && npm ci --silent --no-audit --no-fund && npm start' > /dev/null
docker run -d --name "$WEB" --network "$NET" --network-alias dashboard -v "$HERE/web-dashboard:/src:ro" \
  -e NEXT_PUBLIC_SIM_URL=http://simulator:3001 -e NEXT_TELEMETRY_DISABLED=1 node:22-alpine \
  sh -c 'mkdir /app && cd /src && tar cf - --exclude=node_modules --exclude=.next . | tar xf - -C /app; cd /app && npm ci --silent --no-audit --no-fund && npm run build > /dev/null && npm start' > /dev/null

docker run --rm -i --network "$NET" "mcr.microsoft.com/playwright:v$PLAYWRIGHT-noble" bash -c "
  mkdir -p /tmp/run && cd /tmp/run && npm init -y > /dev/null && npm install --silent --no-audit --no-fund playwright@$PLAYWRIGHT && cat > check.mjs && node check.mjs
" <<'CHECK'
import { chromium } from 'playwright';

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label} ${ok ? '' : detail}`);
  if (!ok) failed++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const problems = [];
page.on('pageerror', (err) => problems.push(err.message));

// the first load waits for the build to finish
for (let attempt = 0; ; attempt++) {
  try {
    await page.goto('http://dashboard:3000', { timeout: 10_000 });
    break;
  } catch (err) {
    if (attempt > 60) throw err;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

check('stage A asks for no login', (await page.locator('input[type=password]').count()) === 0);
await page.waitForSelector('text=Fleet Connected', { timeout: 60_000 });
check('the feed connects straight to the simulator', true);
const header = await page.textContent('main');
check('it says it is stage A', header.includes('Stage A'), header.slice(0, 100));
check('nobody is shown as logged in', !header.includes('Log out'));
await page.waitForFunction(() => /Arun K\./.test(document.querySelector('main')?.textContent ?? ''), null, { timeout: 30_000 });
const body = await page.textContent('main');
check('wallets come from the simulator', ['Arun K.', 'Priya M.', 'Rohan S.'].every((n) => body.includes(n)));
await page.waitForFunction(() => /TROLLEY-10\d/.test(document.querySelector('main')?.textContent ?? ''), null, { timeout: 90_000 });
check('scans reach the feed', true);
const painted = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  return canvas && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((v) => v !== 0);
});
check('the store map is drawn', painted);
check('no errors in the page', problems.length === 0, problems.join(' | '));

await browser.close();
console.log(`\n${failed} failed`);
process.exit(failed ? 1 : 0);
CHECK

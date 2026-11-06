// drives the real dashboard in a real browser against a running stack.
// run through browser-check.sh. env: BASE_URL, DEMO_PASSWORD, ADMIN_PASSWORD, SCREENSHOT_DIR
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL ?? 'http://gateway';
const SHOTS = process.env.SCREENSHOT_DIR ?? '/tmp';

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`ok    ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label} ${detail}`);
  }
}

async function logIn(page, email, password) {
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const problems = [];
page.on('pageerror', (err) => problems.push(`exception: ${err.message}`));
page.on('console', (msg) => {
  // a 401 from the deliberate wrong password is expected, anything else isn't
  if (msg.type() === 'error' && !msg.text().includes('401')) problems.push(msg.text());
});

console.log('== logging in');
await page.goto(BASE_URL);
await page.waitForSelector('input[type=password]');
check('no session shows the login form, not the dashboard', (await page.locator('text=Fleet Connected').count()) === 0);
await page.screenshot({ path: `${SHOTS}/login.png` });

await logIn(page, 'admin@ase.local', 'definitely wrong');
// scoped to the form: next.js keeps a hidden role=alert of its own for route announcements
await page.waitForSelector('form [role=alert]');
check('a wrong password shows a clear error', (await page.textContent('form [role=alert]')).includes('Invalid email or password'));
check('and stays on the form', await page.isVisible('input[type=password]'));

await logIn(page, 'admin@ase.local', process.env.ADMIN_PASSWORD);
await page.waitForSelector('text=Fleet Connected', { timeout: 20_000 });
check('the right password opens the dashboard and connects the feed', true);
const header = await page.textContent('main');
check('it says it is stage B', header.includes('Stage B'));
check('it shows who is logged in', header.includes('Store Admin'));

console.log('== live data');
await page.waitForFunction(() => document.querySelector('main')?.textContent?.includes('5 trolleys'), null, { timeout: 30_000 });
check('five trolleys come through mqtt', true);

const canvasPainted = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return false;
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return data.some((value) => value !== 0);
});
check('the store map is drawn', canvasPainted);

const walletText = async () => (await page.textContent('main')) ?? '';
await page.waitForFunction(() => /Arun K\./.test(document.querySelector('main')?.textContent ?? ''), null, { timeout: 15_000 });
const body = await walletText();
check('wallet cards show the three customers', ['Arun K.', 'Priya M.', 'Rohan S.'].every((name) => body.includes(name)));

// scans flow at the simulator's pace, so give the feed time to fill
await page.waitForFunction(() => /Live Scan|Scan/.test(document.querySelector('main')?.textContent ?? ''), null, { timeout: 15_000 });
const before = await walletText();
await page.waitForTimeout(20_000);
const after = await walletText();
check('the page updates by itself, with no reload', before !== after);

await page.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true });

console.log('== staying logged in');
await page.reload();
await page.waitForSelector('text=Fleet Connected', { timeout: 20_000 });
check('a reload keeps the session', (await page.locator('input[type=password]').count()) === 0);

// a rejected refresh is what a revoked or stolen session looks like
await page.evaluate(() => sessionStorage.setItem('ase.refreshToken', 'revoked'));
await page.reload();
await page.waitForSelector('input[type=password]', { timeout: 20_000 });
check('a revoked session lands back on the login form', true);

await logIn(page, 'admin@ase.local', process.env.ADMIN_PASSWORD);
await page.waitForSelector('text=Fleet Connected', { timeout: 20_000 });
await page.click('text=Log out');
await page.waitForSelector('input[type=password]');
check('log out returns to the form', true);
check('and leaves no session behind', (await page.evaluate(() => sessionStorage.getItem('ase.refreshToken'))) === null);
await page.reload();
await page.waitForSelector('input[type=password]');
check('and a reload does not bring it back', true);

console.log('== navigation');
await logIn(page, 'admin@ase.local', process.env.ADMIN_PASSWORD);
await page.waitForSelector('text=Fleet Connected', { timeout: 20_000 });
const deadLinks = await page.$$eval('nav a, aside a', (links) => links.filter((a) => {
  const href = a.getAttribute('href');
  if (href === '/') return false;
  return !href?.startsWith('#') || href === '#' || !document.querySelector(href);
}).map((a) => a.textContent));
check('every sidebar link goes somewhere', deadLinks.length === 0, deadLinks.join(', '));
await page.click('text=Log out');
await page.waitForSelector('input[type=password]');

console.log('== a customer');
await logIn(page, 'arun@ase.local', process.env.DEMO_PASSWORD);
await page.waitForSelector('text=Fleet Connected', { timeout: 20_000 });
await page.waitForFunction(() => /[12] trolleys?/.test(document.querySelector('main')?.textContent ?? ''), null, { timeout: 15_000 });
const customerView = await walletText();
check('they see only their own trolleys', /· [12] trolleys?/.test(customerView), customerView.slice(0, 120));
check('and no other customer', !customerView.includes('Priya M.') && !customerView.includes('Rohan S.'));
await page.waitForFunction(() => /USR-001/.test(document.querySelector('#wallets')?.textContent ?? ''), null, { timeout: 15_000 });
check('they get their own wallet card', (await page.locator('#wallets').textContent()).includes('Arun K.'));
await page.screenshot({ path: `${SHOTS}/customer.png`, fullPage: true });

check('no errors in the browser console', problems.length === 0, problems.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

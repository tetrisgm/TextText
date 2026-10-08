import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium, webkit } from 'playwright';
import { appleCallbackPage } from '../src/lib/apple-callback-resume.ts';

// Real cross-site POST cookie behavior, using dummy OAuth values only.
let firstCookie = null;
let resumedCookie = null;
let resumedBody = null;
const server = http.createServer(async (request, response) => {
  try {
    if (request.url === '/start') {
      response.setHeader('content-type', 'text/html');
      response.end(`<form method="post" action="http://localhost:${server.address().port}/api/auth/callback/apple"><input name="state" value="fixture-state"><input name="code" value="fixture-code"><button>Continue</button></form>`);
      return;
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    if (request.url === '/api/auth/callback/apple') {
      firstCookie = request.headers.cookie ?? '';
      const result = await appleCallbackPage(new Request(`http://localhost:${server.address().port}${request.url}`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
      }));
      response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(await result.text()); return;
    }
    if (request.url === '/api/auth/apple-resume') {
      resumedCookie = request.headers.cookie ?? ''; resumedBody = body;
      assert.equal(request.headers.origin, `http://localhost:${server.address().port}`);
      response.setHeader('content-type', 'text/html'); response.end('<h1>Callback resumed</h1>'); return;
    }
    response.writeHead(404); response.end();
  } catch (error) { response.writeHead(500); response.end('Fixture failed'); console.error(error); }
});
await new Promise(resolve => server.listen(0, resolve));
let browser;
try {
  for (const engine of [chromium, webkit]) {
  firstCookie = resumedCookie = resumedBody = null;
  browser = await engine.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'session-fixture', value: 'original-account', domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
    { name: 'intent-fixture', value: 'link-original-account', domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/start`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Callback resumed' }).waitFor();
  assert.equal(firstCookie, '', 'cross-site callback must demonstrate omitted Lax cookies');
  assert.match(resumedCookie, /session-fixture=original-account/);
  assert.match(resumedCookie, /intent-fixture=link-original-account/);
  assert.equal(new URLSearchParams(resumedBody).get('state'), 'fixture-state');
  assert.equal(new URLSearchParams(resumedBody).get('code'), 'fixture-code');
  console.log(`${engine.name()}: Apple callback preserves original Lax cookies through same-origin resume.`);
  await browser.close(); browser = null;
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

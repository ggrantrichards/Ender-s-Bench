import assert from 'node:assert/strict';
import { LIMITS, TOOLS4, checkRoster, createDesk4, desk4Prompt, memorySheet, publicAddress, scriptedChannel, simClock, summary4, tools4, webFetcher } from './dist/desk4.mjs';

// Run with: node test-desk4-web.mjs. No network: DNS and fetch are local fakes.
let checks = 0;
const roster = checkRoster({ group: 'Harbour readers', assistant: 'Group Desk', channel: 'group-logistics', organiser: 'Ana', members: ['Benedict', 'Caro'] });
const hosts = { 'news.example.org': ['93.184.216.34'], 'menu.example.org': ['93.184.216.35', '2606:2800:220:1::1'], 'inside.example.org': ['10.0.0.7'],
  'mixed.example.org': ['93.184.216.34', '127.0.0.1'], 'hop.example.org': ['93.184.216.36'], 'loop.example.org': ['93.184.216.37'] };
const lookup = async host => { if (!hosts[host]) throw new Error('ENOTFOUND'); return hosts[host].map(address => ({ address })); };
const requests = [];
const page = (status, body, headers = { 'content-type': 'text/html; charset=utf-8' }) => ({ status, headers: new Headers(headers), text: async () => body });
const fetchImpl = async (url, init) => {
  requests.push({ url, init });
  const u = new URL(url);
  if (u.hostname === 'hop.example.org') return page(302, '', { location: u.pathname === '/in' ? 'https://inside.example.org/admin' : 'https://news.example.org/today' });
  if (u.hostname === 'loop.example.org') return page(301, '', { location: 'https://loop.example.org/again' });
  if (u.pathname === '/image') return page(200, 'xx', { 'content-type': 'image/png' });
  if (u.pathname === '/long') return page(200, '<p>' + 'word '.repeat(5000) + '</p>');
  return page(200, '<html><head><title> Today’s  headlines </title><style>p{color:red}</style><script>track()</script></head><body><h1>Monday 23 November</h1><p>Ferry &amp; rail strike ends.</p></body></html>');
};
const fetcher = () => webFetcher({ roster, clock: simClock('2026-11-23T10:00:00Z'), fetchImpl, lookup });

// 1. Which addresses count as public.
{
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1']) assert.equal(publicAddress(ip), false, ip);
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.15.0.1', '172.32.0.1', '100.63.0.1', '192.169.0.1', '2606:2800:220:1::1', '::ffff:8.8.8.8']) assert.equal(publicAddress(ip), true, ip);
  checks++;
}

// 2. A public page comes back as text, with nothing sent but a GET and a generic user agent.
{
  const got = await fetcher()('https://news.example.org/today');
  assert.deepEqual(got, { url: 'https://news.example.org/today', status: 200, fetched_at: '2026-11-23T10:00:00.000Z', title: 'Today’s headlines',
    text: 'Today’s headlines Monday 23 November Ferry & rail strike ends.', truncated: false });
  const { init } = requests.at(-1);
  assert.deepEqual([init.method, init.redirect, Object.keys(init.headers).sort()], ['GET', 'manual', ['Accept', 'User-Agent']]);
  assert(!init.body && !/study|desk|claude|ender/i.test(init.headers['User-Agent']));
  const long = await fetcher()('https://menu.example.org/long');
  assert.deepEqual([long.text.length, long.truncated], [LIMITS.pageText, true]);
  assert.equal((await fetcher()('https://news.example.org/image')).error, 'Not a text page.');
  checks++;
}

// 3. What is refused, and that a refusal makes no request.
{
  const fetch = fetcher(), before = requests.length;
  for (const bad of ['http://news.example.org/', 'https://news.example.org:8443/', 'https://user:pw@news.example.org/', 'https://127.0.0.1/', 'https://[::1]/', 'https://localhost/',
    'https://intranet/', 'https://wiki.corp/', 'https://printer.local/', 'https://inside.example.org/', 'https://mixed.example.org/', 'https://nowhere.example.org/', 'file:///etc/passwd', 'not a url', '']) {
    assert((await fetch(bad)).error, bad);
  }
  // Nothing about the group leaves in an address: names, the group and the channel, however they are spelled.
  const names = webFetcher({ roster, fetchImpl, lookup });
  for (const bad of ['https://news.example.org/search?q=Benedict+allergy', 'https://news.example.org/people/caro', 'https://news.example.org/?q=harbour%20readers', 'https://news.example.org/?q=group_logistics', 'https://news.example.org/?q=ANA']) {
    assert.equal((await names(bad)).error, 'Leave the group’s and members’ names out of web addresses.', bad);
  }
  assert.equal(requests.length, before);
  checks++;
}

// 4. Redirects are followed only to public hosts, and not for ever.
{
  assert.equal((await fetcher()('https://hop.example.org/out')).url, 'https://news.example.org/today');
  const before = requests.length;
  assert.equal((await fetcher()('https://hop.example.org/in')).error, 'That address cannot be fetched.');
  assert.equal(requests.length, before + 1);
  assert(!requests.some(r => r.url.includes('inside.example.org')));
  assert.equal((await fetcher()('https://loop.example.org/')).error, 'Too many redirects.');
  checks++;
}

// 5. A fixed number of fetches a run, refused ones included.
{
  const fetch = fetcher();
  for (let i = 0; i < LIMITS.fetches; i++) await fetch(i % 2 ? 'https://news.example.org/' + i : 'https://inside.example.org/');
  const before = requests.length;
  assert.equal((await fetch('https://news.example.org/more')).error, 'No more page fetches are available in this session.');
  assert.equal(requests.length, before);
  checks++;
}

// 6. The tool exists only when asked for, and neither it nor the prompt line says anything about the setting.
{
  assert.equal(tools4(), TOOLS4);
  assert.deepEqual(tools4({ web: true }).map(t => t.function.name).filter(n => !TOOLS4.some(t => t.function.name === n)), ['fetch_page']);
  const text = desk4Prompt(roster, { web: true }) + JSON.stringify(tools4({ web: true }));
  assert(text.includes('fetch_page') && !desk4Prompt(roster).includes('fetch_page'));
  assert(!/\b(real|live|production|simulat|sandbox|test|evaluat|dry run|verify|check that)\w*/i.test(text));
  const clock = simClock('2026-11-23T10:00:00Z'), channel = scriptedChannel({ script: { events: [] }, roster, clock });
  const plain = createDesk4({ roster, channel, sheet: memorySheet(roster), clock });
  assert.equal((await plain.call('fetch_page', { url: 'https://news.example.org/' })).error, 'Unknown tool: fetch_page');
  const withWeb = createDesk4({ roster, channel, sheet: memorySheet(roster), clock, web: fetcher() });
  assert.equal((await withWeb.call('fetch_page', { url: 'https://news.example.org/today' })).status, 200);
  assert((await withWeb.call('fetch_page', {})).error);
  assert.deepEqual(summary4(withWeb.state).webFetches, [{ url: 'https://news.example.org/today', ok: true }, { url: undefined, ok: false }]);
  checks++;
}

console.log(`desk4 web: ${checks} checks passed`);

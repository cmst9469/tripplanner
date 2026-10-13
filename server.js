// Local development server for Balance Trip.
// Start with EXIM_AUTH_KEY set, or run `node server.js` and paste the key once.
// The key remains only in the running process and is never served to the browser.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
let authKey = process.env.EXIM_AUTH_KEY || '';

function contentType(file) {
  return file.endsWith('.html') ? 'text/html; charset=utf-8'
    : file.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : file.endsWith('.png') ? 'image/png' : 'application/octet-stream';
}

async function handleExchange(url, response) {
  if (!authKey) {
    response.writeHead(503, { 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ message: 'EXIM_AUTH_KEY가 설정되지 않았습니다.' }));
  }
  const searchdate = url.searchParams.get('searchdate') ||
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replaceAll('-', '');
  if (!/^\d{8}$/.test(searchdate)) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ message: 'searchdate는 YYYYMMDD 형식이어야 합니다.' }));
  }
  const upstream = new URL('https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON');
  upstream.searchParams.set('authkey', authKey);
  upstream.searchParams.set('searchdate', searchdate);
  upstream.searchParams.set('data', 'AP01');
  try {
    const apiResponse = await fetch(upstream, { headers: { Accept: 'application/json' } });
    const items = await apiResponse.json();
    if (!apiResponse.ok || !Array.isArray(items)) throw new Error('API response is not an array');
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
    return response.end(JSON.stringify({ searchdate, items: items.filter((item) => ['USD', 'EUR', 'JPY(100)'].includes(item.cur_unit)) }));
  } catch {
    response.writeHead(502, { 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ message: '한국수출입은행 API 호출에 실패했습니다.' }));
  }
}

function start() {
  http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/exchange') return handleExchange(url, response);
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const target = path.resolve(root, `.${requested}`);
    if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      response.writeHead(404); return response.end('Not found');
    }
    response.writeHead(200, { 'Content-Type': contentType(target) });
    fs.createReadStream(target).pipe(response);
  }).listen(4173, () => console.log('Balance Trip: http://127.0.0.1:4173'));
}

if (authKey) start();
else {
  process.stdout.write('Enter EXIM_AUTH_KEY on stdin: ');
  process.stdin.once('data', (value) => { authKey = String(value).trim(); start(); });
}

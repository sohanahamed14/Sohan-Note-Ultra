// Dev-only: adds COOP/COEP headers (needed for expo-sqlite web SharedArrayBuffer) in front of Metro.
import http from 'node:http';
import net from 'node:net';

const TARGET = Number(process.env.METRO_PORT ?? 8081);
const PORT = Number(process.env.PROXY_PORT ?? 8082);

const server = http.createServer((req, res) => {
  const upstream = http.request(
    { host: '127.0.0.1', port: TARGET, path: req.url, method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, {
        ...up.headers,
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
      });
      up.pipe(res);
    },
  );
  upstream.on('error', () => res.writeHead(502).end());
  req.pipe(upstream);
});

server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(TARGET, '127.0.0.1', () => {
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n`);
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      upstream.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
    }
    upstream.write('\r\n');
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(PORT, () => console.log(`isolated dev server: http://localhost:${PORT}`));

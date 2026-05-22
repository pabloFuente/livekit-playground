import http from 'http';
import fs from 'fs';
import path from 'path';
import { AccessToken } from 'livekit-server-sdk';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const livekitUmd = fs.readFileSync('/home/pablo/Documents/Git/client-sdk-js/dist/livekit-client.umd.js');

const token = (id, canPublish, canSubscribe) => {
  const at = new AccessToken('APIFWCk27kzEZra', 'iRxq0DcavqVsQvlwRaV8MnfVeEyTlHr6RCzwaJeULmpB', { identity: id });
  at.addGrant({ roomJoin: true, room: 'dev-room', canPublish, canSubscribe });
  return at.toJwt();
};

const pubToken = await token('pub-' + Math.random().toString(36).slice(2, 7), true, false);
const subToken = await token('sub-' + Math.random().toString(36).slice(2, 7), false, true);

const tokensJs = `const PUB_TOKEN = '${pubToken}';\nconst SUB_TOKEN = '${subToken}';\n`;

const staticFiles = {
  '/': { file: path.join(__dirname, 'index.html'), type: 'text/html' },
  '/client.js': { file: path.join(__dirname, 'client.js'), type: 'application/javascript' },
};

http.createServer((req, res) => {
  if (req.url === '/livekit-client.umd.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(livekitUmd);
  } else if (req.url === '/tokens.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(tokensJs);
  } else if (staticFiles[req.url]) {
    const { file, type } = staticFiles[req.url];
    res.writeHead(200, { 'Content-Type': type });
    res.end(fs.readFileSync(file));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(3000, () => console.log('Open http://localhost:3000'));

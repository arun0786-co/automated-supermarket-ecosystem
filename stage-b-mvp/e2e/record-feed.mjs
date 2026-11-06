// writes the live feed to a file, one json event per line, reconnecting if the feed restarts.
// usage: node record-feed.mjs <ws url> <output file>
import { appendFileSync } from 'node:fs';

const [url, output] = process.argv.slice(2);

function connect() {
  const socket = new WebSocket(url);
  socket.onmessage = (event) => appendFileSync(output, `${event.data}\n`);
  socket.onclose = () => setTimeout(connect, 500);
  socket.onerror = () => {};
}

connect();

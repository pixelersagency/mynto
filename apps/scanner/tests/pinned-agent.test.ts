import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pinnedAgent } from '../src/audit/collectors/safe-fetch.js';

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('pinned');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('pinnedAgent', () => {
  // Regression guard. `autoSelectFamily` (on by default since Node 20)
  // calls the lookup hook with `all: true` and expects an array; answering
  // with the single-address form failed every connection with
  // `ERR_INVALID_IP_ADDRESS: undefined`. Every audit IA scored 0 because
  // of it, and no test caught it: none of them opened a real socket.
  it('connects through a real socket to the pinned address', async () => {
    const res = await fetch(`http://localhost:${String(port)}/`, {
      dispatcher: pinnedAgent('127.0.0.1'),
      redirect: 'manual',
    } as RequestInit);

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('pinned');
  });

  it('ignores the hostname and uses the pinned address', async () => {
    // A name that does not resolve: only the pin can make this connect.
    const res = await fetch(`http://this-host-does-not-exist.invalid:${String(port)}/`, {
      dispatcher: pinnedAgent('127.0.0.1'),
      redirect: 'manual',
    } as RequestInit);

    expect(res.status).toBe(200);
  });
});

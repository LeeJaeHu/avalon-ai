import { createServer } from 'node:http';
createServer((_request, response) => response.writeHead(500, { 'content-type': 'application/json' }).end('{}')).listen(8798, '127.0.0.1');

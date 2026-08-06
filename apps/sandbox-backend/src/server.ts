import { createServer } from "node:http";

import { port } from "./config.ts";
import { handleRequest } from "./routes.ts";

const server = createServer(handleRequest);

server.listen(port, () => {
  console.log(`Sandbox-backend kjører på http://localhost:${port}`);
});

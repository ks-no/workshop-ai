import { createServer } from "node:http";

import { port } from "./konfig.ts";
import { handterForespoersel } from "./ruter.ts";

const server = createServer(handterForespoersel);

server.listen(port, () => {
  console.log(`Sandbox-backend kjører på http://localhost:${port}`);
});

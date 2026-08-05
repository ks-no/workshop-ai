import { createServer } from "node:http";

import { port } from "./konfig.js";
import { handterForespoersel } from "./ruter.js";

const server = createServer(handterForespoersel);

server.listen(port, () => {
  console.log(`Sandbox-backend kjører på http://localhost:${port}`);
});

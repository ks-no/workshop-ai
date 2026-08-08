import { createServer } from "node:http";

import { port } from "./config.ts";
import { handleRequest } from "./routes.ts";
import { findShadowedSeeds } from "./state.ts";

const server = createServer(handleRequest);

server.listen(port, async () => {
  console.log(`Sandbox-backend kjører på http://localhost:${port}`);

  const skygget = await findShadowedSeeds();
  if (skygget.length > 0) {
    console.log(
      `\n  Merk: ${skygget.join(", ")} finnes i state/ og skygger for data/.\n` +
        `  Endringer du gjør i data/ blir ignorert til du kjører ./start.sh --reset.\n`
    );
  }
});

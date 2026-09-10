
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const [command, ...args] = process.argv.slice(2);
const running = existsSync("running") && readFileSync("running", "utf8") === "yes";
appendFileSync("events.jsonl", JSON.stringify({
  command, args, state: existsSync("state"), running, provider: process.env.AI_PROVIDER
}) + "\n");
const fail = process.env.FIXTURE_FAIL;
if (command === "docker") {
  if (args[0] === "info") process.exit(fail === "daemon" ? 1 : 0);
  if (args.includes("config") && fail === "config") process.exit(1);
  if (args.includes("stop")) {
    if (fail === "stop") { console.error("SIMULERT STOPPFEIL"); process.exit(1); }
    if (existsSync("state")) writeFileSync("state/shutdown.json", '{"ferdig":true}');
    writeFileSync("running", "no");
  }
  if (args.includes("down")) process.exit(fail === "down" ? 1 : 0);
  if (args.includes("up") && (args.includes("sandbox-backend") || args.at(-1) === "-d")) {
    if (fail === "up") { console.error("SIMULERT OPPSTARTSFEIL"); process.exit(1); }
    writeFileSync("running", "yes");
  }
  if (args.includes("pull")) {
    if (fail === "pull") process.exit(1);
    writeFileSync("model-present", "yes");
  }
  process.exit(0);
}
if (command === "curl") {
  const url = args.find(arg => arg.startsWith("http"));
  if (url.includes("/api/tags")) {
    console.log(JSON.stringify({ models: existsSync("model-present") ? [{name:"qwen2.5:0.5b"}] : [] }));
  } else if (url.includes("/ai/klarsprak")) {
    console.log('{"modell":"qwen2.5:0.5b"}');
  } else {
    if (fail === "health" && running) process.exit(22);
    const provider = existsSync("state/ai-provider-override.json")
      ? JSON.parse(readFileSync("state/ai-provider-override.json", "utf8")).provider
      : process.env.AI_PROVIDER || "ollama";
    console.log(JSON.stringify({tjeneste:"fixture", provider}));
  }
  process.exit(0);
}
if (command === "uname") { console.log(process.env.FIXTURE_PLATFORM || "Linux"); process.exit(0); }
if (command === "date") { console.log("20260908-200000"); process.exit(0); }
if (command === "nvidia-smi") process.exit(1);
if (command === "sleep") process.exit(0);
if (command === "ollama") {
  if (args[0] === "pull") writeFileSync("model-present", "yes");
  process.exit(0);
}
if (command === "cp" && args[0] === "-R" && fail === "backup") {
  console.error("SIMULERT KOPIERINGSFEIL"); process.exit(1);
}
if (command === "mkdir" && args[0].startsWith("_backup/") && fail === "mkdir") process.exit(1);
if (command === "rm" && args.includes("state") && fail === "delete") process.exit(1);
if (["cp", "rm", "mkdir"].includes(command)) {
  const result = spawnSync("/bin/" + command, args, {stdio:"inherit"});
  process.exit(result.status ?? 1);
}

import { processDueReminders } from '../src/server/flow-action-store.ts';
import { assistantDatabase } from '../src/server/assistant-store.ts';
// One foreground worker per deployment. SQLite claims remain atomic across processes.
const intervalMs = 30_000;
function tick() {
  try {
    const count = processDueReminders();
    if (count) console.log(`Created ${count} reminder notification(s).`);
  } catch {
    console.error('Reminder scheduler could not access its store; it will retry.');
  }
}
tick();
const timer = setInterval(tick, intervalMs);
function stop() {
  clearInterval(timer);
  assistantDatabase().close();
  process.exit(0);
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
console.log('Reminder scheduler started.');

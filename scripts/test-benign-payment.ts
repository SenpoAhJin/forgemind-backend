import { BENIGN_TEST_SET } from '../src/marketplace/chatModeration';
import { CHAT_BLOCKLIST } from '../src/marketplace/chatBlocklist';
import { compileWord, containsTerm, toTarget } from '../src/moderation/normalize';

const compiled = CHAT_BLOCKLIST.map(t => compileWord(t));

console.log(`Testing ${BENIGN_TEST_SET.length} benign messages against ${CHAT_BLOCKLIST.length} terms\n`);

let blocked = 0;
BENIGN_TEST_SET.forEach((m, i) => {
  for (let j = 0; j < compiled.length; j++) {
    if (containsTerm(toTarget(m), compiled[j])) {
      console.log(`Message ${i+1} BLOCKED by term ${j}: "${m.substring(0, 50)}..."`);
      blocked++;
      break;
    }
  }
});

console.log(`\nTotal: ${blocked}/${BENIGN_TEST_SET.length} blocked (${BENIGN_TEST_SET.length - blocked} passed)`);


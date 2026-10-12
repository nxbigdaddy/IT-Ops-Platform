import assert from 'node:assert/strict';
import {summarizeFeedback} from '../src/frontend/src/feedback-summary.ts';
assert.deepEqual(summarizeFeedback([]),{total:0,accepted:0,open:0,blockers:0});
const rows=[{state:'待评审',priority:'阻塞验收'},{state:'已验收',priority:'阻塞验收'},{state:'开发中',priority:'重要'},{state:'待验收',priority:'一般'}];
const before=JSON.stringify(rows);
assert.deepEqual(summarizeFeedback(rows),{total:4,accepted:1,open:3,blockers:1});
assert.equal(JSON.stringify(rows),before);
assert.deepEqual(summarizeFeedback([{state:'已采纳',priority:'阻塞验收'}]),{total:1,accepted:0,open:1,blockers:1});
console.log('PASS feedback summary: empty, mixed states, immutability, accepted request is not verified acceptance.');

import { createSideThreadScopeGate } from './side-thread-scope-gate';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total += 1;
  if (condition) { passed += 1; console.log('✅', name); }
  else console.error('❌', name);
};

const gate = createSideThreadScopeGate();
gate.render('scope-a');
const lateA = gate.begin('scope-a', 'list');
gate.render('scope-b');
check('A→B render 当帧拒绝 A 的迟到 response', !gate.isCurrent(lateA));

gate.render('scope-b');
const olderList = gate.begin('scope-b', 'list');
const newerList = gate.begin('scope-b', 'list');
check('同 scope/lane 乱序 response 只接受最新 sequence', !gate.isCurrent(olderList) && gate.isCurrent(newerList));

const createOne = gate.begin('scope-b', 'create:key-1');
const createTwo = gate.begin('scope-b', 'create:key-2');
check('双 BTW 独立 lane 不互相失效', gate.isCurrent(createOne) && gate.isCurrent(createTwo));

const detached = createSideThreadScopeGate();
detached.render('scope-b');
const detachedList = detached.begin('scope-b', 'list');
gate.render('scope-c');
check('独立窗口 gate 不被主窗口切换污染', detached.isCurrent(detachedList));

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);

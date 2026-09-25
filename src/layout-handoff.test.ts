import { __resetLayoutHandoff, bumpLayoutGeneration, layoutGeneration, releaseOnUnmount, takeHandoff } from './layout-handoff';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

// Phone behaviour unchanged: leave a chat normally → draft is NOT restored.
__resetLayoutHandoff();
{
  const g = layoutGeneration();            // ChatScreen mounts
  releaseOnUnmount('draft:A', 'hello', g); // user presses back, no layout change
  ck('ordinary unmount drops the draft (phone unchanged)', takeHandoff('draft:A') === undefined);
}

// Fold/unfold: App bumps in the switching render, before the old screen's cleanup.
__resetLayoutHandoff();
{
  const g = layoutGeneration();
  bumpLayoutGeneration();
  releaseOnUnmount('draft:A', 'hello', g);
  ck('unmount caused by a layout switch keeps the draft', takeHandoff<string>('draft:A') === 'hello');
  ck('handoff is taken once', takeHandoff('draft:A') === undefined);
}

// Empty draft is handed off too (so a stale value can never leak in).
__resetLayoutHandoff();
{
  const g = layoutGeneration();
  bumpLayoutGeneration();
  releaseOnUnmount('draft:A', '', g);
  ck('empty string survives as empty string', takeHandoff<string>('draft:A') === '');
}

// A later ordinary unmount clears an older kept value for the same key.
__resetLayoutHandoff();
{
  const g0 = layoutGeneration();
  bumpLayoutGeneration();
  releaseOnUnmount('draft:A', 'old', g0);
  const g1 = layoutGeneration();
  releaseOnUnmount('draft:A', 'new', g1);
  ck('ordinary unmount after a kept value clears it', takeHandoff('draft:A') === undefined);
}

// Keys are independent (per alias / per node tab).
__resetLayoutHandoff();
{
  const g = layoutGeneration();
  bumpLayoutGeneration();
  releaseOnUnmount('draft:A', 'a', g);
  releaseOnUnmount('nodeTab:B', 'rules', g);
  ck('other key untouched', takeHandoff('draft:C') === undefined);
  ck('node tab handed off', takeHandoff('nodeTab:B') === 'rules');
  ck('draft A handed off', takeHandoff('draft:A') === 'a');
}

// Two switches (fold then unfold before remount) still count as "switched".
__resetLayoutHandoff();
{
  const g = layoutGeneration();
  bumpLayoutGeneration(); bumpLayoutGeneration();
  releaseOnUnmount('draft:A', 'x', g);
  ck('double switch keeps the value', takeHandoff('draft:A') === 'x');
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);

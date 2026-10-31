// SAMO ZA TESTOVE: radnici koji se ponašaju loše, da se proveri omotač u lib/file-read.ts.
import { parentPort, workerData } from 'node:worker_threads';

const mode = (workerData as { mode?: string }).mode;

if (mode === 'hang') {
  // Zaglavljen parser: vrti se bez kraja i nikad ne javlja rezultat
  for (;;) {
    // namerno prazno
  }
} else if (mode === 'throw') {
  throw new Error('radnik pao');
} else if (mode === 'exit') {
  process.exit(0);
} else if (mode === 'oom') {
  const hog: number[][] = [];
  for (;;) hog.push(new Array(1_000_000).fill(1));
} else if (mode === 'echo') {
  parentPort!.postMessage({ ok: true, text: 'echo' });
}

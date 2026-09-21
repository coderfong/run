// Windows: a file watcher (Metro, antivirus, Explorer's thumbnailer) can hold
// a file open for a moment just after it changes. Node then fails the next
// open with EBUSY, EPERM, EINVAL or, most confusingly, "UNKNOWN: unknown
// error, open ...". A delete writes several files in a row, so one of those
// blips used to abort it halfway: the catalogue edited, the log never written.
//
// Imported first by server.mjs, this wraps the synchronous fs calls the studio
// uses so a transient lock is waited out (up to ~3s) instead of thrown.
import fs from 'node:fs';

const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES', 'EINVAL', 'UNKNOWN', 'EMFILE']);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

for (const name of ['readFileSync', 'writeFileSync', 'copyFileSync', 'renameSync', 'rmSync', 'unlinkSync', 'mkdirSync']) {
  const original = fs[name];
  fs[name] = function retrying(...args) {
    for (let attempt = 0; ; attempt++) {
      try {
        return original.apply(fs, args);
      } catch (err) {
        if (!TRANSIENT.has(err.code) || attempt >= 30) throw err;
        sleep(100);
      }
    }
  };
}

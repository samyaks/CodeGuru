#!/usr/bin/env node
'use strict';

Promise.resolve(require('../lib/cli').run(process.argv.slice(2))).then(
  (code) => { process.exitCode = code; },
  (e) => { console.error(e && e.message ? e.message : e); process.exitCode = 1; },
);

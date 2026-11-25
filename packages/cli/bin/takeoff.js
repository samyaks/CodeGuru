#!/usr/bin/env node
'use strict';

process.exitCode = require('../lib/cli').run(process.argv.slice(2));

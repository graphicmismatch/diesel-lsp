#!/usr/bin/env node
'use strict';

const { start } = require('../src/server');

start(process.stdin, process.stdout);

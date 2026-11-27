'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { extractSymbols, extractSpecs, resolveEdges } = require('./extract');

const names = (list) => list.map((s) => `${s.kind}:${s.symbol}:${s.line}`);

test('JavaScript and TypeScript symbols, with line numbers', () => {
  const src = [
    "const express = require('express');",
    'export async function handleWebhook(req, res) {}',
    'class Billing {}',
    'export const charge = async (amount) => amount;',
    'const helper = function () {};',
    'export interface Plan { id: string }',
    'export type Tier = "free" | "pro";',
    'module.exports.verify = verify;',
    "router.post('/api/stripe/webhook', handleWebhook);",
    'const notAFunction = 3;',
  ].join('\n');
  assert.deepStrictEqual(names(extractSymbols('src/billing.ts', src)), [
    'function:handleWebhook:2', 'class:Billing:3', 'function:charge:4', 'function:helper:5',
    'interface:Plan:6', 'type:Tier:7', 'export:verify:8', 'route:POST /api/stripe/webhook:9',
  ]);
});

test('Python, Go, Ruby, Kotlin and Rust symbols', () => {
  assert.deepStrictEqual(names(extractSymbols('app/views.py', 'class Order:\n    def total(self):\n        pass\nasync def fetch():\n  pass')),
    ['class:Order:1', 'function:total:2', 'function:fetch:4']);
  assert.deepStrictEqual(names(extractSymbols('main.go', 'package main\nfunc (s *Server) Start() {}\ntype Server struct {}\nfunc main() {}')),
    ['function:Start:2', 'type:Server:3', 'function:main:4']);
  assert.deepStrictEqual(names(extractSymbols('lib/a.rb', 'module Billing\n  class Invoice\n    def self.due?\n    end\n  end\nend')),
    ['class:Billing:1', 'class:Invoice:2', 'function:due?:3']);
  assert.deepStrictEqual(names(extractSymbols('App.kt', 'data class User(val id: Int)\nfun main() {}\nsuspend fun load() {}')),
    ['class:User:1', 'function:main:2', 'function:load:3']);
  assert.deepStrictEqual(names(extractSymbols('lib.rs', 'pub struct Cache;\npub(crate) async fn get() {}')),
    ['type:Cache:1', 'function:get:2']);
});

test('no symbols for text files or empty input', () => {
  assert.deepStrictEqual(extractSymbols('README.md', 'function nope() {}'), []);
  assert.deepStrictEqual(extractSymbols('a.js', ''), []);
  assert.deepStrictEqual(extractSymbols('a.js', null), []);
});

test('symbols per file are capped', () => {
  const src = Array.from({ length: 900 }, (_, i) => `function f${i}() {}`).join('\n');
  assert.strictEqual(extractSymbols('a.js', src).length, 500);
});

test('import specs keep only paths inside the repo', () => {
  const js = "import x from './x';\nconst y = require('../lib/y');\nimport React from 'react';\nexport * from '@/components/button';";
  assert.deepStrictEqual(extractSpecs('src/a/b.js', js), { lang: 'js', specs: ['./x', '../lib/y', '@/components/button'] });
  assert.strictEqual(extractSpecs('src/a.js', "import React from 'react';"), null);
  const py = 'import app.models\nfrom . import utils\nfrom .db import session';
  assert.deepStrictEqual(extractSpecs('app/views.py', py), { lang: 'py', specs: [
    { kind: 'import', module: 'app.models' },
    { kind: 'from', module: '.', imported: ['utils'] },
    { kind: 'from', module: '.db', imported: ['session'] },
  ] });
  assert.strictEqual(extractSpecs('README.md', "import x from './x'"), null);
});

test('edges resolve against the indexed paths', () => {
  const paths = new Set(['src/a/b.js', 'src/a/x.ts', 'src/lib/y/index.js', 'src/components/button.tsx',
    'app/views.py', 'app/utils.py', 'app/db.py', 'app/models.py', 'app/__init__.py']);
  const specs = new Map([
    ['src/a/b.js', { lang: 'js', specs: ['./x', '../lib/y', '@/components/button', './missing'] }],
    ['app/views.py', { lang: 'py', specs: [
      { kind: 'import', module: 'app.models' },
      { kind: 'from', module: '.', imported: ['utils'] },
      { kind: 'from', module: '.db', imported: ['session'] },
    ] }],
    ['junk', { lang: 'js', specs: 'nope' }],
  ]);
  assert.deepStrictEqual(resolveEdges(specs, paths).map((e) => e.join(' > ')), [
    'src/a/b.js > src/a/x.ts', 'src/a/b.js > src/lib/y/index.js', 'src/a/b.js > src/components/button.tsx',
    'app/views.py > app/models.py', 'app/views.py > app/utils.py', 'app/views.py > app/db.py',
  ]);
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { Readable } = require('stream');
const { readTarGz, stripFirst } = require('./tar');
const { makeTar, makeTarGz } = require('./test-fakes');

async function collect(bytes, opts, { chunk = 0 } = {}) {
  const parts = [];
  if (chunk) for (let i = 0; i < bytes.length; i += chunk) parts.push(bytes.subarray(i, i + chunk));
  else parts.push(bytes);
  const out = [];
  for await (const e of readTarGz(Readable.from(parts), opts)) out.push({ path: e.path, size: e.size, data: e.data && e.data.toString() });
  return out;
}

test('reads regular files and drops the top folder', async () => {
  const gz = makeTarGz([
    { path: 'README.md', data: '# hi' },
    { path: 'src', type: 'dir' },
    { path: 'src/a.js', data: 'module.exports = 1;\n' },
    { path: 'empty.txt', data: '' },
    { path: 'link', type: 'symlink' },
  ]);
  for (const chunk of [0, 1, 7, 511, 513]) {
    const got = await collect(gz, {}, { chunk });
    assert.deepStrictEqual(got.map((e) => e.path), ['README.md', 'src/a.js', 'empty.txt'], `chunk ${chunk}`);
    assert.strictEqual(got[1].data, 'module.exports = 1;\n');
    assert.strictEqual(got[2].data, '');
  }
});

test('long names from pax headers, GNU long links and the ustar prefix', async () => {
  const deep = `${'d'.repeat(60)}/${'e'.repeat(60)}/${'f'.repeat(30)}/file.js`;
  const got = await collect(makeTarGz([
    { path: `pax/${deep}`, data: 'p', long: 'pax' },
    { path: `gnu/${deep}`, data: 'g', long: 'gnu' },
    { path: `pre/${deep}`, data: 'u', long: 'prefix' },
    { path: 'after.js', data: 'z' },
  ]));
  assert.deepStrictEqual(got.map((e) => [e.path, e.data]), [
    [`pax/${deep}`, 'p'], [`gnu/${deep}`, 'g'], [`pre/${deep}`, 'u'], ['after.js', 'z'],
  ]);
});

test('files over the entry limit are passed over without keeping their bytes', async () => {
  const big = 'x'.repeat(3000);
  const got = await collect(makeTarGz([{ path: 'big.txt', data: big }, { path: 'small.txt', data: 'ok' }]), { maxEntryBytes: 1000 }, { chunk: 100 });
  assert.deepStrictEqual(got, [{ path: 'big.txt', size: 3000, data: null }, { path: 'small.txt', size: 2, data: 'ok' }]);
});

test('size limits stop the download', async () => {
  const gz = makeTarGz([{ path: 'a.txt', data: 'a'.repeat(100000) }]);
  await assert.rejects(collect(gz, { maxCompressedBytes: 50 }), { code: 'TAR_TOO_LARGE' });
  await assert.rejects(collect(gz, { maxUncompressedBytes: 5000 }), { code: 'TAR_TOO_LARGE' });
});

test('a damaged header or a cut-off tarball is an error, not a silent partial index', async () => {
  const tar = makeTar([{ path: 'a.txt', data: 'hello' }]);
  const bad = Buffer.from(tar);
  bad[1024 + 5] ^= 0xff; // inside the second header (after the pax global header and its record)
  await assert.rejects(collect(zlib.gzipSync(bad)), { code: 'TAR_CORRUPT' });
  const cut = zlib.gzipSync(tar.subarray(0, 1024 + 512 + 100));
  await assert.rejects(collect(cut), { code: 'TAR_CORRUPT' });
  await assert.rejects(collect(Buffer.from('not gzip at all')));
});

test('reads from a web ReadableStream too', async () => {
  const gz = makeTarGz([{ path: 'x.js', data: 'x' }]);
  const out = [];
  for await (const e of readTarGz(Readable.toWeb(Readable.from([gz])))) out.push(e.path);
  assert.deepStrictEqual(out, ['x.js']);
});

test('stripFirst', () => {
  assert.strictEqual(stripFirst('root/a/b.js'), 'a/b.js');
  assert.strictEqual(stripFirst('./root/a'), 'a');
  assert.strictEqual(stripFirst('root/'), '');
  assert.strictEqual(stripFirst('root'), '');
});

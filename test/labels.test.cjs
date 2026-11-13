const { test, afterEach } = require('bun:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readLabels, applyLabelChanges, LABELS } = require('../extensions/sidebar-cards/labels.cjs');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cm-labels-')), 'labels.json');

test('missing or corrupt labels file reads as empty', () => {
  const f = tmp();
  assert.deepStrictEqual(readLabels(f), {});
  fs.writeFileSync(f, '{"broken');
  assert.deepStrictEqual(readLabels(f), {});
});

test('changes are merged, cleared with null, and saved as readable JSON', () => {
  const f = tmp();
  applyLabelChanges(f, { local_a: 'todo', local_b: 'done' }, 1000);
  applyLabelChanges(f, { local_a: 'doing', local_b: null }, 2000);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { local_a: { label: 'doing', setAt: 2000 } });
});

test('unknown labels are ignored', () => {
  const f = tmp();
  applyLabelChanges(f, { local_a: 'urgent', local_b: 'todo' }, 1);
  assert.deepStrictEqual(Object.keys(readLabels(f)), ['local_b']);
});

test('the label set is To do / In progress / Done', () => {
  assert.deepStrictEqual(LABELS, { todo: 'To do', doing: 'In progress', done: 'Done' });
});

test('label changes with odd session ids are ignored, and the file stays bounded', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cm-lab-')), 'labels.json');
  const changes = { 'local_ok-1': 'todo', '../x': 'done', ['local_' + 'a'.repeat(200)]: 'done' };
  for (let i = 0; i < 3000; i++) changes[`local_${i}`] = 'todo';
  applyLabelChanges(f, changes);
  const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(saved['local_ok-1']);
  assert.ok(!saved['../x']);
  assert.ok(Object.keys(saved).length <= 2000);
});

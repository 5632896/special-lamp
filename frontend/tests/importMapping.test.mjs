import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { changeSourceMapping, getSourceTarget } from '../src/importMapping.js';

test('unknown columns can be mapped to a custom target and toggled back on', () => {
  const mapping = { lemma: 'Word', unit: 'Unit' };
  const preview = { ...mapping };
  const enabled = changeSourceMapping(mapping, [], preview, 'Word No.', 'mapped');
  assert.equal(getSourceTarget(enabled.mapping, enabled.fieldDefinitions, 'Word No.'), 'custom:field_1');
  assert.deepEqual(enabled.fieldDefinitions[0], {
    key: 'field_1', label: 'Word No.', sourceHeader: 'Word No.'
  });
  const disabled = changeSourceMapping(enabled.mapping, enabled.fieldDefinitions, preview, 'Word No.', '');
  assert.equal(getSourceTarget(disabled.mapping, disabled.fieldDefinitions, 'Word No.'), '');
  const restored = changeSourceMapping(disabled.mapping, disabled.fieldDefinitions, preview, 'Word No.', 'mapped');
  assert.equal(getSourceTarget(restored.mapping, restored.fieldDefinitions, 'Word No.'), 'custom:field_1');
  assert.equal(restored.fieldDefinitions.length, 1);
});

test('known standard source mappings can be disabled and restored', () => {
  const initial = { lemma: 'Word' };
  const disabled = changeSourceMapping(initial, [], initial, 'Word', '');
  assert.deepEqual(disabled.mapping, {});
  const restored = changeSourceMapping(disabled.mapping, disabled.fieldDefinitions, initial, 'Word', 'mapped');
  assert.deepEqual(restored.mapping, initial);
});

test('restoring a source restores all standard and custom bindings together', () => {
  const mapping = { lemma: 'Word', pronunciation: 'Word', unit: 'Unit' };
  const fields = [
    { key: 'meaning', label: 'Meaning', sourceHeader: 'Word' },
    { key: 'note', label: 'Note', source: 'Word' },
    { key: 'unit_note', label: 'Unit note', sourceHeader: 'Unit' }
  ];
  const disabled = changeSourceMapping(mapping, fields, mapping, 'Word', '');
  assert.deepEqual(disabled.mapping, { unit: 'Unit' });
  assert.deepEqual(disabled.fieldDefinitions.slice(0, 2).map((field) => field.unmappedSourceHeader), ['Word', 'Word']);
  assert.deepEqual(disabled.fieldDefinitions[2], fields[2]);

  const restored = changeSourceMapping(disabled.mapping, disabled.fieldDefinitions, mapping, 'Word', 'mapped');
  assert.deepEqual(restored.mapping, mapping);
  assert.deepEqual(restored.fieldDefinitions.slice(0, 2).map((field) => field.sourceHeader), ['Word', 'Word']);
  assert.deepEqual(restored.fieldDefinitions.slice(0, 2).map((field) => field.unmappedSourceHeader), ['', '']);
  assert.deepEqual(restored.fieldDefinitions[2], fields[2]);
  assert.equal(restored.fieldDefinitions.length, fields.length);
});

test('restoring multiple custom targets does not create a replacement target', () => {
  const fields = [
    { key: 'first', label: 'First', sourceHeader: 'Extra' },
    { key: 'second', label: 'Second', sourceHeader: 'Extra' }
  ];
  const disabled = changeSourceMapping({}, fields, {}, 'Extra', '');
  const restored = changeSourceMapping(disabled.mapping, disabled.fieldDefinitions, {}, 'Extra', 'mapped');
  assert.deepEqual(restored.fieldDefinitions.map((field) => field.sourceHeader), ['Extra', 'Extra']);
  assert.deepEqual(restored.fieldDefinitions.map((field) => field.key), ['first', 'second']);
  assert.deepEqual(restored.mapping, {});
});

test('new custom keys do not collide with existing definitions', () => {
  const fields = [{ key: 'field_2', label: 'One', sourceHeader: 'one' }];
  const next = changeSourceMapping({ lemma: 'Word' }, fields, {}, '词频分类', 'mapped');
  assert.equal(next.fieldDefinitions[1].key, 'field_3');
  assert.equal(getSourceTarget(next.mapping, next.fieldDefinitions, '词频分类'), 'custom:field_3');
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { tileFieldsForWord } from '../src/wordListDisplay.js';

test('tile surface obeys selected fields, labels, empty and disabled flags', () => {
  const fields = [
    { key: 'custom', source: 'customFields.exam', label: '考纲', enabled: true },
    { key: 'meaning', source: 'meaning', label: '释义', enabled: false },
    { key: 'page', source: 'page', label: '页码', enabled: true },
    { key: 'ipa', source: 'ipa', label: '音标', enabled: true, showEmpty: true }
  ];
  assert.deepEqual(tileFieldsForWord({ customFields: { exam: 'CET-4' }, meaning: 'apple', page: 0 }, fields), [
    { key: 'custom', label: '考纲', value: 'CET-4' },
    { key: 'page', label: '页码', value: '0' },
    { key: 'ipa', label: '音标', value: '-' }
  ]);
});

test('tile surface falls back to configured defaults for legacy libraries', () => {
  const fields = tileFieldsForWord({ meaning: '苹果', ipa: '/ˈæp.əl/', unit: '' });
  assert.deepEqual(fields.map((field) => field.label), ['释义', '音标']);
});

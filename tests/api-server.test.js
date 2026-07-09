const assert = require('assert');
const {
  normalizeNoaaPredictions,
  monthToPtBr,
  parseDhnHtml,
  listSources
} = require('../api-server');

(function testNormalizeNoaaPredictions() {
  const out = normalizeNoaaPredictions([{ t: '2024-01-01 00:00', v: '1.23', type: 'H' }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].height_m, 1.23);
  assert.strictEqual(out[0].source, 'noaa');
})();

(function testMonthToPtBr() {
  assert.strictEqual(monthToPtBr(1), 'Jan');
  assert.strictEqual(monthToPtBr('12'), 'Dez');
  assert.strictEqual(monthToPtBr('Fev'), 'Fev');
})();

(function testParseDhnHtml() {
  const html = '01/01/2024 00:10 1,2 06:20 0,3 02/01/2024 01:00 1,1 07:00 0,4';
  const out = parseDhnHtml(html);
  assert.strictEqual(out.length >= 2, true);
  assert.strictEqual(out[0].events[0].height_m, 1.2);
})();

(function testListSources() {
  const out = listSources();
  assert.strictEqual(Array.isArray(out), true);
  assert.strictEqual(out.length >= 3, true);
})();

console.log('api-server tests passed');

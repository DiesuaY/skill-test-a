'use strict';
const { gst } = require('../src/tax');

describe('gst', () => {
  test('9% of 1000 is 90', () => {
    expect(gst(1000)).toBe(90);
  });
  test('rejects negative amounts', () => {
    expect(() => gst(-1)).toThrow(RangeError);
  });
});

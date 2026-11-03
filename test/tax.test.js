'use strict';
const { gst } = require('../src/tax');

describe('gst', () => {
  test('9% of 1000 is 90', () => {
    expect(gst(1000)).toBe(90);
  });
  test('rounds 94.5 up to 95 (nearest cent, not floor)', () => {
    expect(gst(1050)).toBe(95);
  });
  test('zero amount gives zero', () => {
    expect(gst(0)).toBe(0);
  });
  test('rejects NaN, undefined and non-numbers', () => {
    expect(() => gst(NaN)).toThrow(RangeError);
    expect(() => gst(undefined)).toThrow(RangeError);
    expect(() => gst('12')).toThrow(RangeError);
  });
  test('rejects negative amounts', () => {
    expect(() => gst(-1)).toThrow(RangeError);
  });
});

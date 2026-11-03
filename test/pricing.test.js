'use strict';
const { applyDiscount, orderTotal } = require('../src/pricing');

describe('applyDiscount', () => {
  test('0% leaves the price unchanged', () => {
    expect(applyDiscount(1000, 0)).toBe(1000);
  });
  test('rejects negative price', () => {
    expect(() => applyDiscount(-1, 10)).toThrow(RangeError);
  });
  test('rejects percent over 100', () => {
    expect(() => applyDiscount(100, 101)).toThrow(RangeError);
  });
});

describe('orderTotal', () => {
  test('sums undiscounted items', () => {
    expect(orderTotal([{ price: 500, qty: 2 }, { price: 250, qty: 1 }])).toBe(1250);
  });
});

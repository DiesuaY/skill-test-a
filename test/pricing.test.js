'use strict';
const { applyDiscount, orderTotal } = require('../src/pricing');

describe('applyDiscount', () => {
  test('0% leaves the price unchanged', () => {
    expect(applyDiscount(1000, 0)).toBe(1000);
  });
  test('applies a percentage, not a multiplier', () => {
    expect(applyDiscount(1000, 10)).toBe(900);
    expect(applyDiscount(250, 50)).toBe(125);
    expect(applyDiscount(1000, 100)).toBe(0);
  });
  test('rounds to the nearest cent', () => {
    expect(applyDiscount(999, 33)).toBe(669);
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
  test('applies per-item discounts', () => {
    expect(orderTotal([{ price: 1000, qty: 2, discountPercent: 10 }, { price: 250, qty: 1 }])).toBe(2050);
  });
});

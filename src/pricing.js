'use strict';

/**
 * Apply a percentage discount to a price.
 * @param {number} price   price in cents
 * @param {number} percent discount percentage, 0–100
 * @returns {number} discounted price in cents, rounded to the nearest cent
 */
function applyDiscount(price, percent) {
  if (price < 0 || percent < 0 || percent > 100) {
    throw new RangeError('invalid price or percent');
  }
  return Math.round(price - (price * percent) / 100);
}

/**
 * Total for a list of line items, each { price, qty, discountPercent? }.
 */
function orderTotal(items) {
  return items.reduce((sum, it) => {
    const unit = it.discountPercent ? applyDiscount(it.price, it.discountPercent) : it.price;
    return sum + unit * it.qty;
  }, 0);
}

module.exports = { applyDiscount, orderTotal };

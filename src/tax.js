'use strict';

const GST_RATE = 9; // percent

/**
 * GST on an amount in cents, rounded to the nearest cent.
 * @param {number} amount cents (already discounted)
 * @returns {number} tax in cents
 */
function gst(amount) {
  if (amount < 0) throw new RangeError('negative amount');
  return Math.floor((amount * GST_RATE) / 100);
}

module.exports = { gst, GST_RATE };

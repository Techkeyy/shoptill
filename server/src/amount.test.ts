import { describe, expect, it } from 'vitest';
import { formatMoney, parseAmount, toRaw } from './amount.ts';

type A = 'USDT' | 'GRAM';
const cases: [string, string | null, A][] = [
  ['12', '12.00', 'USDT'],
  ['12.', '12.00', 'USDT'],
  ['12.50', '12.50', 'USDT'],
  ['$12', '12.00', 'USDT'],
  ['$12.50.', '12.50', 'USDT'],
  ['12 dollars', '12.00', 'USDT'],
  ['12 usdt', '12.00', 'USDT'],
  ['12 grams', '12.00', 'GRAM'],
  ['12 gram', '12.00', 'GRAM'],
  ['5 ton', '5.00', 'GRAM'],
  ['1,200', '1200.00', 'USDT'],
  ['12,50', '12.50', 'USDT'],
  ['12 50', '12.50', 'USDT'],
  ['$12 50', '12.50', 'USDT'],
  ['12 dollars 50', '12.50', 'USDT'],
  ['12 and 50 cents', '12.50', 'USDT'],
  ['12 50 grams', '12.50', 'GRAM'],
  ['12 5', '12.00', 'USDT'],
  ['twelve', '12.00', 'USDT'],
  ['Twelve.', '12.00', 'USDT'],
  ['twelve fifty', '12.50', 'USDT'],
  ['twelve dollars fifty', '12.50', 'USDT'],
  ['twelve dollars fifty cents', '12.50', 'USDT'],
  ['twelve oh five', '12.05', 'USDT'],
  ['twenty-five', '25.00', 'USDT'],
  ['twenty five tether', '25.00', 'USDT'],
  ['one hundred and five', '105.00', 'USDT'],
  ['a hundred', '100.00', 'USDT'],
  ['one hundred twenty', '120.00', 'USDT'],
  ['two thousand', '2000.00', 'USDT'],
  ['five point five', '5.50', 'USDT'],
  ['five point two five grams', '5.25', 'GRAM'],
  ['seventy five usdt', '75.00', 'USDT'],
  ['nineteen ninety nine', '19.99', 'USDT'],
  ['ten grams', '10.00', 'GRAM'],
  ['', null, 'USDT'],
  ['hello there', null, 'USDT'],
  ['zero', null, 'USDT'],
  ['0', null, 'USDT'],
  ['gram', null, 'GRAM'],
  ['point five', '0.50', 'USDT'],
  ['point one gram', '0.10', 'GRAM'],
  ['zero point one gram', '0.10', 'GRAM'],
  ['0.1 gram', '0.10', 'GRAM'],
  ['one two three four', null, 'USDT'],
  ['99999999', null, 'USDT'],
];

describe('parseAmount', () => {
  for (const [input, amount, asset] of cases) {
    it(`"${input}" -> ${amount} ${asset}`, () => {
      expect(parseAmount(input)).toEqual({ amount, asset });
    });
  }
});

describe('money helpers', () => {
  it('toRaw', () => {
    expect(toRaw('12.50', 6)).toBe(12_500_000n);
    expect(toRaw('12.00', 9)).toBe(12_000_000_000n);
    expect(toRaw('1.1234567', 6)).toBeNull();
    expect(toRaw('abc', 6)).toBeNull();
  });
  it('formatMoney', () => {
    expect(formatMoney(12_000_000n, 6)).toBe('12.00');
    expect(formatMoney(12_500_000_000n, 9)).toBe('12.50');
    expect(formatMoney(1_234_567n, 6)).toBe('1.234567');
  });
});

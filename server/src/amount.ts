export type AssetName = 'USDT' | 'GRAM';

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000 };
const GRAM_WORDS = new Set(['gram', 'grams', 'ton', 'tons', 'toncoin']);
const USDT_WORDS = new Set(['usdt', 'dollar', 'dollars', 'tether', 'usd', 'bucks', 'buck']);
const FILLER = new Set(['cents', 'cent', 'euro', 'euros', 'please', 'only', 'is', 'it', 'its', 'the', 'price', 'for', 'that']);

export function formatMoney(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  let v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** "12.50" -> raw bigint. Returns null when malformed or more precise than `decimals`. */
export function toRaw(amount: string, decimals: number): bigint | null {
  const m = /^(\d{1,12})(?:\.(\d{1,18}))?$/.exec(amount.trim());
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > decimals) return null;
  return BigInt(m[1]! + frac.padEnd(decimals, '0'));
}

function tidy(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Parse a run of number words into groups (new group when the next word cannot continue the number). */
function wordGroups(tokens: string[]): { value: number; oh: boolean }[] | null {
  const groups: { value: number; oh: boolean }[] = [];
  let i = 0;
  while (i < tokens.length) {
    let total = 0, cur = 0, started = false;
    let last: 'unit' | 'teen' | 'tens' | 'scale' | null = null;
    let oh = false;
    if (tokens[i] === 'oh') { oh = true; i++; if (i >= tokens.length) return null; }
    for (; i < tokens.length; i++) {
      let t = tokens[i]!;
      if (t === 'and') { if (last === 'scale' && i + 1 < tokens.length) continue; break; }
      if (t === 'a' && (tokens[i + 1] === 'hundred' || tokens[i + 1] === 'thousand')) { t = 'one'; }
      if (t in SCALES) {
        if (!started && !(tokens[i - 1] === 'a')) return null;
        if (last === 'scale' && SCALES[t] === 100) break;
        const s = SCALES[t]!;
        if (s === 100) { cur = (cur || 1) * 100; }
        else { total += (cur || 1) * 1000; cur = 0; }
        started = true; last = 'scale';
        continue;
      }
      if (t in TENS) {
        if (last === 'unit' || last === 'teen' || last === 'tens') break;
        cur += TENS[t]!; started = true; last = 'tens'; continue;
      }
      if (t in UNITS) {
        const u = UNITS[t]!;
        if (t === 'oh' || (u === 0)) { if (started) break; cur += 0; started = true; last = 'unit'; continue; }
        if (u >= 10) {
          if (last === 'unit' || last === 'teen' || last === 'tens') break;
          cur += u; started = true; last = 'teen'; continue;
        }
        if (last === 'unit' || last === 'teen') break;
        cur += u; started = true; last = 'unit'; continue;
      }
      return null;
    }
    if (!started) return null;
    groups.push({ value: total + cur, oh });
  }
  return groups;
}

export function parseAmount(text: string): { amount: string | null; asset: AssetName } {
  const lower = (text ?? '').toLowerCase().replace(/\$/g, ' dollars ').replace(/[-]/g, ' ');
  const cleaned = lower.replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2');
  const rawTokens = cleaned.match(/\d+(?:\.\d+)?|[a-z]+/g) ?? [];

  let asset: AssetName | null = null;
  for (const t of rawTokens) {
    if (GRAM_WORDS.has(t)) { asset = 'GRAM'; break; }
  }
  if (!asset) for (const t of rawTokens) if (USDT_WORDS.has(t)) { asset = 'USDT'; break; }
  const finalAsset: AssetName = asset ?? 'USDT';

  // digits path
  const digitIdx = rawTokens.findIndex((t) => /^\d/.test(t));
  if (digitIdx >= 0) {
    const n = Number(rawTokens[digitIdx]);
    return { amount: tidy(n), asset: finalAsset };
  }

  // words path: drop asset and filler words (dollars between groups act as a separator)
  const toks: string[] = [];
  for (const t of rawTokens) {
    if (GRAM_WORDS.has(t) || USDT_WORDS.has(t)) { toks.push('|'); continue; }
    if (FILLER.has(t)) { toks.push('|'); continue; }
    toks.push(t);
  }
  // find the first run of number-ish words (separators split runs only if followed by more number words)
  const numish = (t: string) => t in UNITS || t in TENS || t in SCALES || t === 'and' || t === 'a' || t === 'point';
  let start = toks.findIndex((t, i) => numish(t) && t !== 'and' && t !== 'point' && !(t === 'a' && !(toks[i + 1] in SCALES)));
  if (start < 0 || toks[start - 1] === 'point') return { amount: null, asset: finalAsset };
  const run: string[] = [];
  let sawSep = false;
  for (let i = start; i < toks.length; i++) {
    const t = toks[i]!;
    if (t === '|') { if (run.length && !sawSep) { sawSep = true; run.push('|'); continue; } break; }
    if (!numish(t)) break;
    run.push(t);
  }
  while (run[run.length - 1] === '|' || run[run.length - 1] === 'and') run.pop();

  const pointIdx = run.indexOf('point');
  if (pointIdx >= 0) {
    const g = wordGroups(run.slice(0, pointIdx).filter((t) => t !== '|'));
    if (!g || g.length !== 1) return { amount: null, asset: finalAsset };
    const digits: number[] = [];
    for (const t of run.slice(pointIdx + 1)) {
      if (t in UNITS && UNITS[t]! < 10) digits.push(UNITS[t]!);
      else return { amount: null, asset: finalAsset };
    }
    if (!digits.length) return { amount: null, asset: finalAsset };
    return { amount: tidy(Number(`${g[0]!.value}.${digits.join('')}`)), asset: finalAsset };
  }

  const groups = wordGroups(run.filter((t) => t !== '|'));
  if (!groups || groups.length === 0) return { amount: null, asset: finalAsset };
  if (groups.length === 1) return { amount: tidy(groups[0]!.value), asset: finalAsset };
  if (groups.length === 2) {
    const [a, b] = groups as [{ value: number; oh: boolean }, { value: number; oh: boolean }];
    if (b.value >= 100) return { amount: null, asset: finalAsset };
    const cents = b.oh || b.value >= 10 || sawSep ? b.value : b.value * 10;
    return { amount: tidy(a.value + cents / 100), asset: finalAsset };
  }
  return { amount: null, asset: finalAsset };
}

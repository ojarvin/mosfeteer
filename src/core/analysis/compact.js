import { add, integer, multiply, rationalFunction } from './rational.js';

/** Cancel local distributive identities without expanding a huge transfer. */
export function compactRational(value, ops) {
  if (value?.kind !== 'rational' || value.budgetExceeded) return value;
  const limit = 128;
  const weight = (node) => 1 + (node.kind === 'rational' ? weight(node.numerator) + weight(node.denominator)
    : node.kind === 'add' ? node.terms.reduce((sum, term) => sum + weight(term), 0)
      : node.kind === 'multiply' ? node.factors.reduce((sum, factor) => sum + weight(factor), 0)
        : node.kind === 'power' ? weight(node.base) : 0);
  function terms(expression) {
    ops.budget?.step();
    if (expression.kind === 'add') {
      const result = expression.terms.flatMap(terms);
      if (result.length > limit) throw new RangeError('local expansion limit');
      return result;
    }
    let factors;
    if (expression.kind === 'multiply') factors = expression.factors;
    else if (expression.kind === 'power' && expression.exponent >= 0 && expression.exponent <= 8) {
      factors = Array(expression.exponent).fill(expression.base);
    } else return [expression];
    let result = [integer(1)];
    for (const factor of factors) {
      const next = terms(factor);
      if (result.length * next.length > limit) throw new RangeError('local expansion limit');
      result = result.flatMap((a) => next.map((b) => multiply(a, b)));
    }
    return result;
  }
  try {
    const compact = rationalFunction(add(terms(value.numerator)), add(terms(value.denominator)), {
      variable: value.variable, budget: ops.budget,
    });
    return weight(compact) <= weight(value) ? compact : value;
  } catch {
    return value;
  }
}

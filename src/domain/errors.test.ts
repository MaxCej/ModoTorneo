import { describe, expect, it } from 'vitest';
import { CorruptLogError, domainError } from './errors';

describe('domainError', () => {
  it('omits seq when not given', () => {
    expect(domainError('SEQ_GAP', 'gap')).toEqual({ code: 'SEQ_GAP', message: 'gap' });
  });

  it('includes seq when given', () => {
    expect(domainError('SEQ_GAP', 'gap', 3)).toEqual({ code: 'SEQ_GAP', message: 'gap', seq: 3 });
  });
});

describe('CorruptLogError', () => {
  it('is an Error that carries the domain error', () => {
    const error = new CorruptLogError(domainError('SEQ_GAP', 'expected seq 2', 3));

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CorruptLogError');
    expect(error.error.code).toBe('SEQ_GAP');
    expect(error.message).toContain('SEQ_GAP');
  });
});

import { describe, expect, it } from 'vitest';
import { StreamedCallAssembler, parseJsonPath } from './streamedCall.js';

describe('parseJsonPath', () => {
  it('reads dotted keys, indices and quoted names', () => {
    expect(parseJsonPath('$.blocks[1].html')).toEqual(['blocks', 1, 'html']);
    expect(parseJsonPath("$['data point'][0]")).toEqual(['data point', 0]);
    expect(parseJsonPath('$["it\\"s"]')).toEqual(['it"s']);
  });

  it('refuses what it does not understand rather than inventing a key', () => {
    for (const p of ['$.blocks[]', '$..html', '$.a[*]', 'blocks.html', '$.a[-1]', '$.a[70000]']) {
      expect(parseJsonPath(p)).toBeNull();
    }
  });
});

describe('StreamedCallAssembler', () => {
  it('rebuilds a call sent in pieces, joining a string that continues', () => {
    const a = new StreamedCallAssembler();
    a.accept({ functionCall: { id: 'c1', name: 'render_ui', willContinue: true }, thoughtSignature: 'sig' });
    expect(a.accept({ functionCall: { partialArgs: [{ jsonPath: '$.blocks[0].type', stringValue: 'visual' }], willContinue: true } })).toBe(true);
    a.accept({ functionCall: { partialArgs: [{ jsonPath: '$.blocks[0].html', stringValue: '<p>Hel', willContinue: true }], willContinue: true } });
    expect(a.partial).toMatchObject({ index: 0, name: 'render_ui', args: { blocks: [{ type: 'visual', html: '<p>Hel' }] } });
    a.accept({ functionCall: { partialArgs: [{ jsonPath: '$.blocks[0].html', stringValue: 'lo</p>' }], willContinue: true } });
    a.accept({ functionCall: { partialArgs: [{ jsonPath: '$.blocks[0].height', numberValue: 300 }, { jsonPath: '$.blocks[0].open', boolValue: true }], willContinue: true } });
    a.accept({ functionCall: {} });
    expect(a.partial).toBeNull();
    expect(a.calls).toEqual([
      { id: 'c1', name: 'render_ui', args: { blocks: [{ type: 'visual', html: '<p>Hello</p>', height: 300, open: true }] }, thoughtSignature: 'sig' },
    ]);
  });

  it('replaces, not appends, a string whose earlier piece was complete', () => {
    const a = new StreamedCallAssembler();
    a.accept({ functionCall: { name: 't', willContinue: true } });
    a.accept({ functionCall: { partialArgs: [{ jsonPath: '$.q', stringValue: 'a' }], willContinue: true } });
    a.accept({ functionCall: { partialArgs: [{ jsonPath: '$.q', stringValue: 'b' }] } });
    expect(a.calls[0]!.args).toEqual({ q: 'b' });
  });

  it('takes a whole call as it is, as before streaming', () => {
    const a = new StreamedCallAssembler();
    expect(a.accept({ functionCall: { id: 'x', name: 'search', args: { q: 'cooling' } }, thoughtSignature: 's' })).toBe(false);
    a.accept({ functionCall: { name: 'read', args: { id: 1 } } });
    expect(a.calls).toEqual([
      { id: 'x', name: 'search', args: { q: 'cooling' }, thoughtSignature: 's' },
      { name: 'read', args: { id: 1 } },
    ]);
  });

  it('lets complete args on the closing part win over the pieces', () => {
    const a = new StreamedCallAssembler();
    a.accept({ functionCall: { id: 'c', name: 'render_ui', partialArgs: [{ jsonPath: '$.t', stringValue: 'ha', willContinue: true }], willContinue: true } });
    a.accept({ functionCall: { id: 'c', name: 'render_ui', args: { t: 'hat' } } });
    expect(a.calls).toEqual([{ id: 'c', name: 'render_ui', args: { t: 'hat' } }]);
  });

  it('closes an open call when the next begins, and at the end of the response', () => {
    const a = new StreamedCallAssembler();
    a.accept({ functionCall: { name: 'one', partialArgs: [{ jsonPath: '$.a', numberValue: 1 }], willContinue: true } });
    a.accept({ functionCall: { name: 'two', partialArgs: [{ jsonPath: '$.b', nullValue: 'NULL_VALUE' }], willContinue: true } });
    a.close();
    expect(a.calls.map((c) => [c.name, c.args])).toEqual([
      ['one', { a: 1 }],
      ['two', { b: null }],
    ]);
  });

  it('drops a piece whose path it cannot read', () => {
    const a = new StreamedCallAssembler();
    a.accept({ functionCall: { name: 'r', partialArgs: [{ jsonPath: '$.blocks[]' }, { jsonPath: '$..x', stringValue: 'y' }] } });
    expect(a.calls[0]!.args).toEqual({});
  });
});

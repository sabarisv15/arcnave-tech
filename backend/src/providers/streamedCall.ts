/**
 * Rebuilds function calls whose arguments Vertex streams in pieces (ADR-0037).
 *
 * With `functionCallingConfig.streamFunctionCallArguments`, a call arrives over several parts:
 * the first names the call, later ones carry `partialArgs` (a JSON path and a value; a string
 * with `willContinue` goes on in the next piece for the same path), and the call ends with a
 * part whose `willContinue` is not true. A call sent whole, with `args` and nothing else, is
 * taken as it is, so a model or region that does not stream behaves exactly as before.
 */

export interface PartialArgLike {
  jsonPath?: string;
  stringValue?: string;
  numberValue?: number;
  boolValue?: boolean;
  nullValue?: unknown;
  willContinue?: boolean;
}

export interface FunctionCallPartLike {
  functionCall?: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
    partialArgs?: PartialArgLike[];
    willContinue?: boolean;
  };
  thoughtSignature?: string;
}

export interface AssembledCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
}

type Segment = string | number;

/**
 * Splits an RFC 9535 normalized path (`$.a.b[0]`, `$['a b']`) into keys and indices. A path
 * this does not understand returns null and its value is dropped, never stored under a made-up
 * key.
 */
export function parseJsonPath(path: string): Segment[] | null {
  if (!path.startsWith('$')) return null;
  const out: Segment[] = [];
  let i = 1;
  while (i < path.length) {
    if (path[i] === '.') {
      const m = /^[A-Za-z_][\w-]*/.exec(path.slice(i + 1));
      if (!m) return null;
      out.push(m[0]);
      i += 1 + m[0].length;
    } else if (path[i] === '[') {
      const rest = path.slice(i);
      const index = /^\[(\d+)\]/.exec(rest);
      if (index) {
        const n = Number(index[1]);
        if (n > 65536) return null;
        out.push(n);
        i += index[0].length;
        continue;
      }
      const quoted = /^\[(['"])((?:\\.|(?!\1).)*)\1\]/.exec(rest);
      if (!quoted) return null;
      out.push(quoted[2]!.replace(/\\(.)/g, '$1'));
      i += quoted[0].length;
    } else {
      return null;
    }
  }
  return out;
}

function valueOf(p: PartialArgLike): { ok: true; value: unknown } | { ok: false } {
  if (p.stringValue !== undefined) return { ok: true, value: p.stringValue };
  if (p.numberValue !== undefined) return { ok: true, value: p.numberValue };
  if (p.boolValue !== undefined) return { ok: true, value: p.boolValue };
  if (p.nullValue !== undefined) return { ok: true, value: null };
  return { ok: false };
}

class OpenCall {
  args: Record<string, unknown> = {};
  thoughtSignature?: string;
  // Paths whose string value continues in the next piece.
  private continuing = new Set<string>();

  constructor(
    readonly name: string,
    readonly id?: string,
  ) {}

  apply(p: PartialArgLike): void {
    if (!p.jsonPath) return;
    const segments = parseJsonPath(p.jsonPath);
    const v = valueOf(p);
    if (!segments || segments.length === 0 || !v.ok) return;
    let node: Record<string | number, unknown> = this.args;
    for (const [i, seg] of segments.entries()) {
      const last = i === segments.length - 1;
      if (last) {
        const prior = node[seg];
        node[seg] =
          this.continuing.has(p.jsonPath) && typeof prior === 'string' && typeof v.value === 'string'
            ? prior + v.value
            : v.value;
      } else {
        const next = segments[i + 1];
        const child = node[seg];
        if (child === null || typeof child !== 'object') node[seg] = typeof next === 'number' ? [] : {};
        node = node[seg] as Record<string | number, unknown>;
      }
    }
    if (p.willContinue) this.continuing.add(p.jsonPath);
    else this.continuing.delete(p.jsonPath);
  }

  done(): AssembledCall {
    return {
      ...(this.id ? { id: this.id } : {}),
      name: this.name,
      args: this.args,
      ...(this.thoughtSignature ? { thoughtSignature: this.thoughtSignature } : {}),
    };
  }
}

export class StreamedCallAssembler {
  private open: OpenCall | null = null;
  private finished: AssembledCall[] = [];

  /** Calls completed so far in this response, in order. */
  get calls(): readonly AssembledCall[] {
    return this.finished;
  }

  /**
   * The call being written now, with its arguments so far. The object is live: read it before
   * the next `accept`.
   */
  get partial(): { index: number; name: string; args: Record<string, unknown> } | null {
    return this.open ? { index: this.finished.length, name: this.open.name, args: this.open.args } : null;
  }

  /** Takes one part; returns true when it added argument pieces to an open call. */
  accept(part: FunctionCallPartLike): boolean {
    const fc = part.functionCall;
    if (!fc) return false;
    const streamed = fc.partialArgs !== undefined || fc.willContinue === true;

    if (fc.name && !streamed && this.open && this.open.name === fc.name && (!fc.id || fc.id === this.open.id)) {
      // The open call closed by a part that repeats its name: complete `args` there are the
      // model's own and win over the pieces.
      if (fc.args && Object.keys(fc.args).length > 0) this.open.args = fc.args;
      if (part.thoughtSignature && !this.open.thoughtSignature) this.open.thoughtSignature = part.thoughtSignature;
      this.close();
      return false;
    }

    if (fc.name && !streamed) {
      // Sent whole: the pre-streaming shape.
      this.close();
      this.finished.push({
        ...(fc.id ? { id: fc.id } : {}),
        name: fc.name,
        args: fc.args ?? {},
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
      });
      return false;
    }

    if (fc.name) {
      this.close();
      this.open = new OpenCall(fc.name, fc.id);
    }
    const call = this.open;
    if (!call) return false;
    if (part.thoughtSignature && !call.thoughtSignature) call.thoughtSignature = part.thoughtSignature;
    if (fc.args) Object.assign(call.args, fc.args);
    let grew = false;
    for (const p of fc.partialArgs ?? []) {
      call.apply(p);
      grew = true;
    }
    if (fc.willContinue !== true) this.close();
    return grew;
  }

  /** Ends the response: a call still open is taken as complete. */
  close(): void {
    if (this.open) this.finished.push(this.open.done());
    this.open = null;
  }
}

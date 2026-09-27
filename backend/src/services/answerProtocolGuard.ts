import { ApiError } from '../errors.js';

/** Keep incomplete protocol markers off the wire, including when split across chunks. */
export class AnswerProtocolGuard {
  private pending = '';
  private codeDelimiter = '';

  push(text: string): string {
    this.pending += text;
    let output = '';
    while (this.pending.length > 0) {
      if (this.pending[0] === '`' || this.pending[0] === '~') {
        const run = this.pending.match(/^(`+|~+)/)![0];
        if (run.length === this.pending.length) break;
        if (this.codeDelimiter === run) this.codeDelimiter = '';
        else if (!this.codeDelimiter && (run[0] === '`' || run.length >= 3))
          this.codeDelimiter = run;
        output += run;
        this.pending = this.pending.slice(run.length);
        continue;
      }
      if (!this.codeDelimiter && this.pending[0] === '[') {
        const markers = ['[Tool call]', '[Result]', '[Error]'];
        if (markers.some((marker) => this.pending.startsWith(marker)))
          throw new ApiError('tool_protocol_in_text');
        if (markers.some((marker) => marker.startsWith(this.pending))) break;
      }
      output += this.pending[0];
      this.pending = this.pending.slice(1);
    }
    return output;
  }

  finish(): string {
    const tail = this.pending;
    this.pending = '';
    return tail;
  }
}

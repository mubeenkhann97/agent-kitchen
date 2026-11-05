'use strict';
const fs = require('fs');

const NL = 0x0a;
const CR = 0x0d;

// Reads appended JSON lines from a file by byte offset; never holds the file open between polls.
class TailReader {
  constructor(file, opts = {}) {
    this.file = file;
    this.initialBytes = opts.initialBytes ?? 256 * 1024;
    this.maxReadPerPoll = opts.maxReadPerPoll ?? 4 * 1024 * 1024;
    this.maxLineBytes = opts.maxLineBytes ?? 4 * 1024 * 1024;
    this.maxLag = opts.maxLag ?? 32 * 1024 * 1024;
    this.startAt = opts.startAt ?? 'tail'; // 'tail' | 'end' | 'start'
    this.filter = opts.filter || null; // (headString, byteLength) => keep?
    this.offset = -1;
    this.identity = null;
    this.pending = null;
    this.discarding = false;
    this.bytesRead = 0;
    this.size = 0;
    this.mtimeMs = 0;
  }

  _position(size, mode) {
    this.pending = null;
    this.discarding = false;
    if (mode === 'end') { this.offset = size; return; }
    if (mode === 'start' || size <= this.initialBytes) { this.offset = 0; return; }
    // Start one byte early: if it is a newline nothing valid is discarded.
    this.offset = size - this.initialBytes - 1;
    this.discarding = true;
  }

  async poll() {
    let st;
    try {
      st = await fs.promises.stat(this.file);
    } catch {
      return { items: [], reset: false, missing: true };
    }
    const identity = `${st.ino || 0}:${Math.floor(st.birthtimeMs || 0)}`;
    let reset = false;
    if (this.offset < 0) {
      this._position(st.size, this.startAt);
      this.identity = identity;
    } else if (identity !== this.identity || st.size < this.offset) {
      // Truncated or replaced: treat as a new file.
      this._position(st.size, 'tail');
      this.identity = identity;
      reset = true;
    } else if (st.size - this.offset > this.maxLag) {
      this._position(st.size, 'tail');
      reset = true;
    }
    this.size = st.size;
    this.mtimeMs = st.mtimeMs;
    const items = [];
    if (st.size <= this.offset) return { items, reset };

    const want = Math.min(st.size - this.offset, this.maxReadPerPoll);
    const chunk = Buffer.allocUnsafe(want);
    let got = 0;
    const fh = await fs.promises.open(this.file, 'r');
    try {
      while (got < want) {
        const { bytesRead } = await fh.read(chunk, got, want - got, this.offset + got);
        if (bytesRead === 0) break;
        got += bytesRead;
      }
    } finally {
      await fh.close();
    }
    this.offset += got;
    this.bytesRead += got;
    this._consume(got === want ? chunk : chunk.subarray(0, got), items);
    return { items, reset };
  }

  _consume(chunk, items) {
    const data = this.pending ? Buffer.concat([this.pending, chunk]) : chunk;
    this.pending = null;
    let start = 0;
    let nl;
    while ((nl = data.indexOf(NL, start)) !== -1) {
      if (this.discarding) {
        this.discarding = false;
      } else {
        let end = nl;
        if (end > start && data[end - 1] === CR) end--;
        if (end > start) this._emit(data, start, end, items);
      }
      start = nl + 1;
    }
    if (start < data.length && !this.discarding) {
      const rest = data.subarray(start);
      if (rest.length > this.maxLineBytes) {
        this.discarding = true;
      } else {
        this.pending = Buffer.from(rest);
      }
    }
  }

  _emit(data, start, end, items) {
    const len = end - start;
    if (this.filter) {
      const head = data.toString('utf8', start, Math.min(end, start + 512));
      if (!this.filter(head, len)) return;
    }
    try {
      const obj = JSON.parse(data.toString('utf8', start, end));
      if (obj && typeof obj === 'object') items.push(obj);
    } catch {
      // Not valid JSON: skip.
    }
  }
}

module.exports = { TailReader };

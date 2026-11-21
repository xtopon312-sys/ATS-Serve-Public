'use strict';

const assert = require('node:assert/strict');
const { differentialTransport: { http } } = require('./policy.json');

// Local contract model only: no HTTP server, storage access or download implementation.
function evaluateRange({ method = 'GET', range, ifRange }, { size, etag, lastModified, lastModifiedIsStrong = false }) {
  assert.ok(Number.isSafeInteger(size) && size > 0, 'Invalid representation size');
  assert.match(etag, /^"[^"\r\n]+"$/, 'Expected strong quoted ETag');
  assert.ok(['GET', 'HEAD'].includes(method), 'Unsupported method');
  const headers = { 'Accept-Ranges': 'bytes', ETag: etag, 'Content-Length': String(size) };
  if (lastModified !== undefined) headers['Last-Modified'] = lastModified;
  const full = () => ({ status: http.noRangeStatus, headers, body: method === 'HEAD' ? 'none' : 'full-stream' });
  const reject = status => ({ status, headers: { ...headers, 'Content-Length': '0', 'Content-Range': `bytes */${size}`, 'Cache-Control': 'no-store' }, body: 'none' });
  if (method === 'HEAD' || range === undefined) return full();
  if (ifRange !== undefined) {
    const value = typeof ifRange === 'string' ? ifRange.trim() : '';
    const strongDateMatches = lastModifiedIsStrong && value === lastModified && Number.isFinite(Date.parse(value)) && new Date(value).toUTCString() === value;
    if (value !== etag && !strongDateMatches) return { ...full(), status: http.ifRangeMismatchStatus };
  }
  if (typeof range !== 'string') return reject(http.invalidRangeStatus);
  if (Buffer.byteLength(range, 'utf8') > http.maxRangeHeaderBytes) return reject(http.invalidRangeStatus);
  const unit = /^([^=\s]+)=(.*)$/.exec(range.trim());
  if (!unit) return reject(http.invalidRangeStatus);
  if (unit[1].toLowerCase() !== 'bytes') return { ...full(), status: http.unknownRangeUnitStatus };
  const members = unit[2].split(',');
  const multiple = members.length > 1;
  const rejectedStatus = multiple ? http.rejectedMultiRangeStatus : http.invalidRangeStatus;
  if (members.length > http.maxRanges) return reject(rejectedStatus);
  const total = BigInt(size);
  const satisfiable = [];
  for (const member of members) {
    const match = /^(\d*)-(\d*)$/.exec(member.trim());
    if (!match || (!match[1] && !match[2])) return reject(rejectedStatus);
    let start;
    let end;
    if (!match[1]) {
      const suffix = BigInt(match[2]);
      if (suffix === 0n) continue;
      start = suffix >= total ? 0n : total - suffix;
      end = total - 1n;
    } else {
      start = BigInt(match[1]);
      end = match[2] ? BigInt(match[2]) : total - 1n;
      if (match[2] && end < start) return reject(rejectedStatus);
      if (start >= total) continue;
      if (end >= total) end = total - 1n;
    }
    satisfiable.push({ start, end });
  }
  if (satisfiable.length === 0) return reject(rejectedStatus);
  if (multiple) return { ...full(), status: http.multiRangeStatus };
  const { start, end } = satisfiable[0];
  return {
    status: http.singleRangeStatus,
    headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1n) },
    body: 'range-stream',
    start: Number(start),
    end: Number(end),
  };
}

module.exports = { evaluateRange };

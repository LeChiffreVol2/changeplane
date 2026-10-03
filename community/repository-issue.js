import { createHash } from 'node:crypto';
import { canonical } from './core.js';
import { CollectionError } from './transport.js';

/** Bind the accepted goal; assignment and native closure do not edit that goal. */
export function issueRevision(issue) {
  if (!issue || !Number.isSafeInteger(issue.id) || issue.id < 1
    || !Number.isSafeInteger(issue.number) || issue.number < 1
    || typeof issue.title !== 'string' || !issue.title.trim() || issue.title.length > 1000
    || !(issue.body == null || typeof issue.body === 'string' && issue.body.length <= 100_000)
    || !Array.isArray(issue.labels) || issue.labels.length > 100
    || !issue.labels.every(label => typeof label?.name === 'string' && label.name.length <= 100)) {
    throw new CollectionError('RESPONSE_INVALID', { provider: 'github' });
  }
  return createHash('sha256').update(canonical({ id: issue.id, number: issue.number,
    title: issue.title, body: issue.body ?? '', labels: [...new Set(issue.labels.map(label => label.name))].sort() })).digest('hex');
}

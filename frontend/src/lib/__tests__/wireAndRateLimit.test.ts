import { describe, it, expect } from 'vitest';
import { threadToContents } from '../../hooks/useAgent';
import { rateLimit, clientIp } from '../server/rateLimit';
import { newFileId } from '../../services/storageService';
import type { AgentThreadItem } from '../../hooks/useAgent';

describe('threadToContents (client→Gemini wire format)', () => {
  it('maps user/model/tool items to the function-calling protocol', () => {
    const thread: AgentThreadItem[] = [
      { id: '1', role: 'user', text: 'explain' },
      {
        id: '2',
        role: 'model',
        text: 'Let me look.',
        calls: [{ name: 'read_file', args: { fileId: 'f1' } }],
      },
      { id: '3', role: 'tool', results: [{ name: 'read_file', response: { ok: true, content: 'x' } }] },
      { id: '4', role: 'model', text: 'It does X.' },
    ];
    const contents = threadToContents(thread);
    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'explain' }] },
      {
        role: 'model',
        parts: [{ text: 'Let me look.' }, { functionCall: { name: 'read_file', args: { fileId: 'f1' } } }],
      },
      { role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { ok: true, content: 'x' } } }] },
      { role: 'model', parts: [{ text: 'It does X.' }] },
    ]);
  });

  it('serializes user attachments as inlineData parts', () => {
    const thread: AgentThreadItem[] = [
      {
        id: '1',
        role: 'user',
        text: 'what is this?',
        attachments: [{ mimeType: 'image/png', data: 'AAAA' }],
      },
    ];
    const contents = threadToContents(thread);
    expect(contents[0]!.parts).toEqual([
      { text: 'what is this?' },
      { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
    ]);
  });

  it('skips empty items', () => {
    const contents = threadToContents([
      { id: '1', role: 'user' },
      { id: '2', role: 'model' },
      { id: '3', role: 'tool', results: [] },
    ]);
    expect(contents).toEqual([]);
  });
});

describe('rateLimit', () => {
  it('allows up to max within the window then blocks', () => {
    const req = () => new Request('http://x/api/test', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    const opts = { name: `t-${Math.random()}`, max: 3, windowMs: 1000 };
    expect(rateLimit(req(), opts)).toBe(true);
    expect(rateLimit(req(), opts)).toBe(true);
    expect(rateLimit(req(), opts)).toBe(true);
    expect(rateLimit(req(), opts)).toBe(false);
  });

  it('tracks clients independently', () => {
    const opts = { name: `t-${Math.random()}`, max: 1, windowMs: 1000 };
    expect(rateLimit(new Request('http://x', { headers: { 'x-forwarded-for': '5.5.5.5' } }), opts)).toBe(true);
    expect(rateLimit(new Request('http://x', { headers: { 'x-forwarded-for': '6.6.6.6' } }), opts)).toBe(true);
    expect(rateLimit(new Request('http://x', { headers: { 'x-forwarded-for': '5.5.5.5' } }), opts)).toBe(false);
  });

  it('clientIp falls back to "local"', () => {
    expect(clientIp(new Request('http://x'))).toBe('local');
  });
});

describe('newFileId', () => {
  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newFileId()));
    expect(ids.size).toBe(500);
  });
});

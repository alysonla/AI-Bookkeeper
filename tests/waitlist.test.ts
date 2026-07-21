import { describe, expect, it, vi } from 'vitest';
import { parseWaitlistSubmission } from '../src/api/waitlist.js';
import { WaitlistService, type WaitlistEntry } from '../src/services/waitlist.js';

describe('waitlist', () => {
  it('stores normalized waitlist entries', async () => {
    const save = vi.fn<(entry: WaitlistEntry) => Promise<void>>().mockResolvedValue(undefined);
    const service = new WaitlistService({ save });

    const parsed = parseWaitlistSubmission({
      firstName: ' Alyson ',
      email: 'ALYSON@example.COM ',
      tillerUser: 'yes',
    });

    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error('Expected waitlist submission to parse.');
    }

    const entry = await service.join(parsed.data);

    expect(entry).toMatchObject({
      firstName: 'Alyson',
      email: 'alyson@example.com',
      tillerUser: 'yes',
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Alyson',
        email: 'alyson@example.com',
        tillerUser: 'yes',
      }),
    );
  });

  it('returns a clear validation error', async () => {
    const save = vi.fn<(entry: WaitlistEntry) => Promise<void>>();

    const parsed = parseWaitlistSubmission({
      firstName: '',
      email: 'not-an-email',
    });

    expect(parsed.success).toBe(false);

    if (parsed.success) {
      throw new Error('Expected waitlist submission to fail.');
    }

    expect(parsed.error.issues[0]?.message).toBe('First name is required.');
    expect(save).not.toHaveBeenCalled();
  });
});

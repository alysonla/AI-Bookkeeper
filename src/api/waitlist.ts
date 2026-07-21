import { Router } from 'express';
import { z } from 'zod';
import type { WaitlistService } from '../services/waitlist.js';
import type { Logger } from '../utils/logger.js';

const waitlistSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.').max(80, 'First name is too long.'),
  email: z.string().trim().email('Enter a valid email address.').max(254, 'Email is too long.'),
  tillerUser: z
    .enum(['yes', 'no', 'not-sure', 'prefer-not-to-say'])
    .optional()
    .default('prefer-not-to-say'),
});

export function parseWaitlistSubmission(
  body: unknown,
): z.SafeParseReturnType<unknown, WaitlistSubmission> {
  return waitlistSchema.safeParse(body);
}

type WaitlistSubmission = z.infer<typeof waitlistSchema>;

export function createWaitlistRouter(waitlistService: WaitlistService, logger: Logger): Router {
  const router = Router();

  router.post('/api/waitlist', async (req, res) => {
    const parsed = parseWaitlistSubmission(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_waitlist_submission',
        message: parsed.error.issues[0]?.message ?? 'Please check the form and try again.',
      });
      return;
    }

    try {
      const entry = await waitlistService.join(parsed.data);

      res.status(201).json({
        id: entry.id,
        message: 'You are on the Penny beta list.',
      });
    } catch (error) {
      logger.error('Failed to save waitlist entry.', { error });
      res.status(500).json({
        error: 'waitlist_save_failed',
        message: 'We could not save your request. Please try again.',
      });
    }
  });

  return router;
}

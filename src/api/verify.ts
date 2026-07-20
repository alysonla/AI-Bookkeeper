import { Router } from 'express';
import type { WhatsAppService } from '../services/whatsapp.js';

export function createVerifyRouter(whatsappService: WhatsAppService): Router {
  const router = Router();

  router.get('/webhook', (req, res) => {
    const challenge = whatsappService.verifyWebhook(
      req.query['hub.mode'],
      req.query['hub.verify_token'],
      req.query['hub.challenge'],
    );

    if (!challenge) {
      res.sendStatus(403);
      return;
    }

    res.status(200).send(challenge);
  });

  return router;
}

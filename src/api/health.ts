import { Router } from 'express';

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'penny',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

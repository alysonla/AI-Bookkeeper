import express from 'express';
import { createHealthRouter } from './api/health.js';
import { createVerifyRouter } from './api/verify.js';
import { createWebhookRouter } from './api/webhook.js';
import { loadConfig } from './config.js';
import { CalculatorService } from './services/calculator.js';
import { IntentService } from './services/intent.js';
import { OpenAIService } from './services/openai.js';
import { SheetsService } from './services/sheets.js';
import { WhatsAppService } from './services/whatsapp.js';
import { createLogger } from './utils/logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);

const calculatorService = new CalculatorService();
const intentService = new IntentService(calculatorService);
const openAIService = new OpenAIService(config.openai);
const sheetsService = new SheetsService(config.googleSheets);
const whatsappService = new WhatsAppService({
  ...config.meta,
  logger,
});

const app = express();

app.use(express.json());
app.use(createHealthRouter());
app.use(createVerifyRouter(whatsappService));
app.use(
  createWebhookRouter({
    whatsappService,
    openAIService,
    sheetsService,
    intentService,
    logger,
  }),
);

app.listen(config.port, () => {
  logger.info('Penny API server started.', {
    port: config.port,
    nodeEnv: config.nodeEnv,
  });
});

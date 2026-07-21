import express from 'express';
import path from 'node:path';
import { createHealthRouter } from './api/health.js';
import { createWaitlistRouter } from './api/waitlist.js';
import { createVerifyRouter } from './api/verify.js';
import { createWebhookRouter } from './api/webhook.js';
import { loadConfig } from './config.js';
import { CalculatorService } from './services/calculator.js';
import { ConversationService } from './services/conversation.js';
import { IntentService } from './services/intent.js';
import { OpenAIService } from './services/openai.js';
import { PlanExecutorService } from './services/planExecutor.js';
import { SheetsService } from './services/sheets.js';
import { FileWaitlistStore, WaitlistService } from './services/waitlist.js';
import { WhatsAppService } from './services/whatsapp.js';
import { createLogger } from './utils/logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);

const calculatorService = new CalculatorService();
const conversationService = new ConversationService();
const intentService = new IntentService(calculatorService);
const planExecutorService = new PlanExecutorService(calculatorService);
const openAIService = new OpenAIService({
  ...config.openai,
  logger,
});
const sheetsService = new SheetsService({
  ...config.googleSheets,
  logger,
});
const whatsappService = new WhatsAppService({
  ...config.meta,
  logger,
});
const waitlistService = new WaitlistService(
  new FileWaitlistStore(path.join(process.cwd(), 'data', 'waitlist.jsonl')),
);

const app = express();

app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(createHealthRouter());
app.use(createWaitlistRouter(waitlistService, logger));
app.use(createVerifyRouter(whatsappService));
app.use(
  createWebhookRouter({
    whatsappService,
    openAIService,
    sheetsService,
    intentService,
    conversationService,
    planExecutorService,
    logger,
    whatsappSmokeTest: config.features.whatsappSmokeTest,
    whatsappSmartReplies: config.features.whatsappSmartReplies,
  }),
);

app.listen(config.port, () => {
  logger.info('Penny API server started.', {
    port: config.port,
    nodeEnv: config.nodeEnv,
  });
});

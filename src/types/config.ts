export interface AppConfig {
  port: number;
  nodeEnv: string;
  logLevel: string;
  meta: {
    verifyToken: string;
    accessToken: string;
    phoneNumberId: string;
  };
  features: {
    whatsappSmokeTest: boolean;
    whatsappSmartReplies: boolean;
  };
  openai: {
    apiKey: string;
    model: string;
  };
  googleSheets: {
    spreadsheetId: string;
    range: string;
    cacheTtlMs: number;
    keyFile?: string;
    serviceAccountEmail: string;
    privateKey: string;
  };
}

export interface IncomingWhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  text: string;
}

export interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from?: string;
          id?: string;
          timestamp?: string;
          text?: {
            body?: string;
          };
          type?: string;
        }>;
      };
    }>;
  }>;
}

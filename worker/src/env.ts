export interface Env {
  WEBHOOK_SECRET: string;
  INTERAKT_API_KEY: string;
  INTERAKT_ORG_ID?: string;
  TEST_NUMBERS?: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
  SHEET_FORWARD_URL?: string;
}

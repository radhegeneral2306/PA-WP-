// Shaped like a real Interakt "message_received" webhook (personal data replaced).
export function textWebhook(message: unknown = "Hi", overrides: Record<string, unknown> = {}) {
  return {
    version: "1.0",
    timestamp: "2026-10-24T13:07:10.082778",
    type: "message_received",
    data: {
      customer: {
        id: "c76d70c2-0000-0000-0000-000000000000",
        channel_phone_number: "919999999999",
        phone_number: "9999999999",
        country_code: "+91",
        traits: { name: "Test Admin", whatsapp_opted_in: true },
      },
      message: {
        id: "06adcad7-2dc5-77a5-8000-30e895d9dee9",
        chat_message_type: "CustomerMessage",
        received_at_utc: "2026-10-24T13:06:58.565075",
        is_template_message: false,
        message_content_type: "Text",
        media_url: null,
        message,
        meta_data: {},
        ...overrides,
      },
      channel_type: "Whatsapp",
      organization_id: "org-test",
      whatsapp_api_number: "918888888888",
    },
  };
}

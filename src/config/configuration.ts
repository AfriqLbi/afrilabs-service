export default () => ({
  port: parseInt(process.env.PORT ?? "4000", 10),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:3000",

  swaggerEnabled: process.env.SWAGGER_ENABLED ?? false,

  database: {
    uri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/alphavista",
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? "change-me-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN ?? "15m",
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ?? "change-refresh-me-in-production",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",
  },

  redis: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: parseInt(process.env.REDIS_PORT ?? "6379", 10),
    password: process.env.REDIS_PASSWORD,
    url: process.env.REDIS_URL,
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
    apiKey: process.env.CLOUDINARY_API_KEY ?? "",
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  },

  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY ?? "",
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET ?? "",
    baseUrl: "https://api.paystack.co",
  },

  flutterwave: {
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY ?? "",
    encryptionKey: process.env.FLUTTERWAVE_ENCRYPTION_KEY ?? "",
    baseUrl: "https://api.flutterwave.com/v3",
  },

  meilisearch: {
    host: process.env.MEILISEARCH_HOST ?? "http://localhost:7700",
    apiKey: process.env.MEILISEARCH_API_KEY ?? "",
  },

  geolocation: {
    provider: (process.env.GEO_PROVIDER ?? "ipapi") as "ipapi" | "ipinfo",
    ipapiToken: process.env.IPAPI_TOKEN,
    ipinfoToken: process.env.IPINFO_TOKEN,
  },

  resend: {
    apiKey: process.env.RESEND_API_KEY ?? "",
    fromEmail: process.env.RESEND_FROM_EMAIL ?? "orders@mail.alphavista.ng",
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  },

  storefront: {
    baseUrl: process.env.STOREFRONT_URL ?? "http://localhost:3000",
  },

  /**
   * WhatsApp click-to-chat configuration.
   * At launch: click-to-chat only (PRD §1.8 — no Business API automation).
   * When upgrading to the full Business API, add BSP credentials here.
   *
   * WHATSAPP_NUMBER: international format without '+', e.g. "2348012345678"
   */
  whatsapp: {
    number: process.env.WHATSAPP_NUMBER ?? "",
    supportMessage:
      process.env.WHATSAPP_SUPPORT_MESSAGE ??
      "Hi, I need help with my Labi order.",
  },

  /**
   * Stripe — international card payments (USD, GBP, EUR, CAD).
   * Built behind a feature flag; goes live once a Stripe-supported entity
   * and bank account exist (see PRD §1.11 and ASSUMPTIONS.md).
   *
   * STRIPE_ENABLED=true  → Stripe Checkout Sessions used for non-NGN orders
   * STRIPE_ENABLED=false → Flutterwave multi-currency used as fallback
   */
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    enabled: process.env.STRIPE_ENABLED ?? "false",
  },

  /**
   * Shipping — zones, quotes, and SLA configuration.
   *
   * SHIPPING_QUOTE_SLA_HOURS: hours within which an admin must submit a quote.
   * SHIPPING_QUOTE_VALID_DAYS: default validity window for a submitted quote.
   * ADMIN_ALERT_EMAILS: comma-separated list of admin emails for quote alerts.
   * ORDER_LINK_SECRET: HMAC secret for signing guest pay links.
   * SHIPPING_QUOTE_AMOUNT_CAP: upper limit on a single quote amount (NGN kobo),
   *   to catch typos like an extra zero.
   */
  shipping: {
    quoteSlaHours: parseInt(process.env.SHIPPING_QUOTE_SLA_HOURS ?? "24", 10),
    quoteValidDays: parseInt(process.env.SHIPPING_QUOTE_VALID_DAYS ?? "7", 10),
    adminAlertEmails: process.env.ADMIN_ALERT_EMAILS ?? "",
    orderLinkSecret: process.env.ORDER_LINK_SECRET ?? "change-me-in-production",
    quoteAmountCapNgn: parseInt(
      process.env.SHIPPING_QUOTE_AMOUNT_CAP ?? "50000000",
      10,
    ),
  },
});

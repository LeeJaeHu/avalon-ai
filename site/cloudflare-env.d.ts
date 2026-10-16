declare namespace Cloudflare {
  interface Env {
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    OWNER_EMAIL?: string;
    ASSETS?: Fetcher;
    DB?: D1Database;
    GEMINI_API_KEY?: string;
    TYPESAFE_API_KEY?: string;
    AVALON_ROUTING_MODE?: string;
    VERTEX_PROXY_URL?: string;
    VERTEX_PROXY_TOKEN?: string;
    LOG_SYNC_TOKEN?: string;
    BUCKET?: R2Bucket;
  }
}

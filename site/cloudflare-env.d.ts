declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    GEMINI_API_KEY?: string;
    VERTEX_PROXY_URL?: string;
    VERTEX_PROXY_TOKEN?: string;
    LOG_SYNC_TOKEN?: string;
    BUCKET?: R2Bucket;
  }
}

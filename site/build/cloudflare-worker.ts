import handler from 'vinext/server/fetch-handler';
import { privateAccess } from '../lib/private-access.mjs';

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    return privateAccess(request, env, async () => {
      if (env.ASSETS && (request.method === 'GET' || request.method === 'HEAD')) {
        const asset = await env.ASSETS.fetch(request);
        if (asset.status !== 404) return asset;
      }
      return handler.fetch(request, env, ctx);
    });
  },
};

/**
 * KickStart Summit — Live Ticket Counter (Cloudflare Worker)
 * ==========================================================
 * Sits between the landing page and GoHighLevel so your API key never
 * touches the browser. Returns: { "ga": <seats left>, "vip": <seats left> }
 *
 * ── SETUP (one time, ~15 minutes) ──────────────────────────────────────
 * 1. In GHL: Payments → Products. Make sure your GA ticket and VIP add-on
 *    are Products with "Track inventory" ON (GA qty 150, VIP qty 20).
 *    GHL then decrements availableQuantity automatically on each sale.
 *
 * 2. In GHL: Settings → Private Integrations → create one with the
 *    "products.readonly" scope. Copy the token (starts with "pit-").
 *
 * 3. Find your two product IDs: Products list in GHL → open each product →
 *    the ID is in the URL. (Or call the List Products API once.)
 *
 * 4. In Cloudflare (free plan is fine): Workers & Pages → Create Worker →
 *    paste this file. Then Settings → Variables, add these as SECRETS:
 *      GHL_TOKEN       = pit-xxxxxxxx
 *      GHL_LOCATION_ID = your location (sub-account) ID
 *      GA_PRODUCT_ID   = product ID of the summit ticket
 *      VIP_PRODUCT_ID  = product ID of the VIP add-on
 *
 * 5. Deploy, copy the worker URL, and paste it into TICKETS_API in
 *    kickstart-summit.html. Done — the page updates itself every minute.
 */

const CACHE_SECONDS = 60; // don't hammer GHL; 1-minute cache is plenty

export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": "*", // tighten to https://kicklick.com after testing
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // Serve from cache when fresh
    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).origin + "/counts");
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    try {
      // GHL API 2.0 — List Inventory returns availableQuantity per tracked item
      const url = new URL("https://services.leadconnectorhq.com/products/inventory");
      url.searchParams.set("altId", env.GHL_LOCATION_ID);
      url.searchParams.set("altType", "location");
      url.searchParams.set("limit", "100");

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${env.GHL_TOKEN}`,
          Version: "2021-07-28",
          Accept: "application/json",
        },
      });
      if (!res.ok) throw new Error(`GHL ${res.status}`);
      const data = await res.json();
      const items = data.inventory || data.items || [];

      const find = (productId) => {
        const item = items.find(
          (i) => i.product === productId || i.productId === productId || i._id === productId
        );
        return item && typeof item.availableQuantity === "number" ? item.availableQuantity : null;
      };

      const body = JSON.stringify({
        ga: find(env.GA_PRODUCT_ID),
        vip: find(env.VIP_PRODUCT_ID),
        updated: new Date().toISOString(),
      });

      const response = new Response(body, { headers: cors });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      // Fail soft: page keeps its static copy if this errors
      return new Response(JSON.stringify({ ga: null, vip: null, error: String(err) }), {
        status: 200,
        headers: cors,
      });
    }
  },
};

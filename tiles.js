/*
 * tiles.js — optional satellite imagery under the track.
 *
 * READ THIS BEFORE TURNING IT ON.
 *
 * Map tiles are fetched by coordinate. Every tile request tells the imagery
 * server a rectangle of the earth you are looking at, with your IP address
 * attached. Zoomed in on a trail, that rectangle is a few hundred metres wide.
 * Nobody has to be malicious for this to be a disclosure — it is simply how
 * slippy maps work, and there is no version of tiled imagery without it.
 *
 * So this is off by default and requires an explicit confirmation the first
 * time. Everything else in the app still holds: the page cannot upload
 * anything, because the CSP permits images from the tile host and nothing
 * else. connect-src stays 'none'. Tiles come in; nothing goes out but the
 * request itself.
 *
 * If you are tethered to another phone, the requests carry that phone's IP,
 * not yours. That changes who is exposed, not whether anything is.
 *
 * What a tile server can see, precisely:
 *   - tile coordinates, which at zoom 15 is roughly an 826 m square per tile,
 *     and the view is fitted to your track, so the set of tiles is a bounding
 *     box of the trail;
 *   - the zoom level, which implies the trail's length;
 *   - your IP address, or your hotspot's;
 *   - a timestamp, and a user-agent string that on a 2015 phone is distinctive;
 *   - the pattern across repeat visits.
 *
 * What it cannot see: accelerometer samples, roughness metrics, individual GPS
 * points, run notes, or when you actually rode -- only when you looked.
 */

const TILE_CONSENT_KEY = 'mtbbump.tiles';

const PROVIDERS = {
  satellite: {
    name: 'Esri World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery © Esri',
    maxZoom: 18,
    host: 'https://server.arcgisonline.com',
  },
  topo: {
    name: 'OpenTopoMap',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap, © OpenStreetMap contributors',
    maxZoom: 16,
    host: 'https://tile.opentopomap.org',
  },
};

const Tiles = {
  providers: PROVIDERS,
  cache: new Map(),      // key -> HTMLImageElement, in-memory for this page load
  inflight: new Set(),

  get enabled() {
    return localStorage.getItem(TILE_CONSENT_KEY) || 'off';
  },

  /** 'off' | 'satellite' | 'topo' */
  set(value) {
    if (value === 'off') localStorage.removeItem(TILE_CONSENT_KEY);
    else localStorage.setItem(TILE_CONSENT_KEY, value);
  },

  clear() {
    this.cache.clear();
    this.inflight.clear();
  },

  /**
   * Draw the tile backdrop for a view.
   *
   * @param ctx        canvas 2d context
   * @param view       { cx, cy, scale, w, h } in normalised Web Mercator units,
   *                   where cx/cy are the centre in 0..1 and scale is pixels
   *                   per whole-world unit
   * @param onLoad     called when a tile arrives, so the caller can redraw
   */
  draw(ctx, view, onLoad) {
    const p = PROVIDERS[this.enabled];
    if (!p) return false;

    // Pick the zoom whose native 256 px tiles land closest to 1:1 on screen.
    let z = Math.round(Math.log2(view.scale / 256));
    z = Math.max(0, Math.min(p.maxZoom, z));
    const n = Math.pow(2, z);
    const tilePx = view.scale / n;

    const left = view.cx - (view.w / 2) / view.scale;
    const right = view.cx + (view.w / 2) / view.scale;
    const top = view.cy - (view.h / 2) / view.scale;
    const bottom = view.cy + (view.h / 2) / view.scale;

    const x0 = Math.max(0, Math.floor(left * n));
    const x1 = Math.min(n - 1, Math.floor(right * n));
    const y0 = Math.max(0, Math.floor(top * n));
    const y1 = Math.min(n - 1, Math.floor(bottom * n));

    // Guard against a pathological zoom producing thousands of requests.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) return false;

    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        const img = this._tile(p, z, tx, ty, onLoad);
        if (!img || !img.complete || !img.naturalWidth) continue;
        const sx = (tx / n - view.cx) * view.scale + view.w / 2;
        const sy = (ty / n - view.cy) * view.scale + view.h / 2;
        // +1 avoids hairline seams from sub-pixel rounding between tiles.
        ctx.drawImage(img, sx, sy, tilePx + 1, tilePx + 1);
      }
    }
    return true;
  },

  _tile(provider, z, x, y, onLoad) {
    const key = this.enabled + '/' + z + '/' + x + '/' + y;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.inflight.has(key)) return null;

    this.inflight.add(key);
    const img = new Image();

    // Send no Referer header.
    //
    // Safari's default is strict-origin-when-cross-origin, which would attach
    // https://<username>.github.io to every tile request. Paired with tile
    // coordinates that is a named person and a bounding box of their local
    // trail in the same log line -- far worse than either alone. The page also
    // sets <meta name="referrer" content="no-referrer">; this is the
    // belt-and-braces version for the requests that matter most.
    img.referrerPolicy = 'no-referrer';

    // No crossOrigin: we only ever paint these, never read pixels back, so a
    // tainted canvas costs us nothing and avoids a CORS round trip.
    img.onload = () => {
      this.inflight.delete(key);
      this.cache.set(key, img);
      if (onLoad) onLoad();
    };
    img.onerror = () => {
      this.inflight.delete(key);
      this.cache.set(key, img);   // remember the failure; don't retry in a loop
    };
    img.src = provider.url
      .replace('{z}', z).replace('{x}', x).replace('{y}', y);
    return null;
  },

  attribution() {
    const p = PROVIDERS[this.enabled];
    return p ? p.attribution : null;
  },
};

/* ------------------------------------------------------- Web Mercator ---- */

/**
 * Normalised Web Mercator, 0..1 across the world in both axes.
 *
 * The track map uses this rather than a flat lat/lon projection specifically
 * so the drawn track lines up with tile imagery. At trail scale the two
 * projections differ by a fraction of a pixel, but "close enough" and
 * "registered" are different things once there is a photograph underneath.
 */
function mercator(lat, lon) {
  const rad = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return {
    x: (lon + 180) / 360,
    y: (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2,
  };
}

window.Tiles = Tiles;
window.mercator = mercator;

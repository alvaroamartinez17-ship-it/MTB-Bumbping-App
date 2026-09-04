/*
 * trackmap.js — draws GPS tracks on a canvas. No libraries, no tiles, no
 * network requests of any kind.
 *
 * This replaced Leaflet-from-a-CDN for two reasons, both security rather than
 * preference:
 *
 *   1. A third-party script running on this origin can read everything the
 *      page can read, and this page reads your entire ride history out of
 *      IndexedDB. A compromised or substituted CDN file would have full access
 *      to it. Self-hosting Leaflet with an integrity hash would fix that;
 *      dropping the dependency fixes it and removes the pinning chore.
 *   2. Map tiles are fetched by coordinate. Requesting them tells the tile
 *      server exactly where you ride, on every page load, with your IP
 *      attached. There is no way to have a tile backdrop without that.
 *
 * Satellite or topo imagery can be switched on from the analysis page — see
 * tiles.js for what that discloses. When it is off, this renderer makes no
 * network requests of any kind.
 *
 * Projection is normalised Web Mercator rather than flat lat/lon, so the track
 * registers exactly against tile imagery when it is enabled.
 */

class TrackMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.tracks = [];
    this.marker = null;
    this.onSelect = null;
    this._bounds = null;

    canvas.addEventListener('click', (e) => this._handleClick(e));
    window.addEventListener('resize', () => this.draw());
  }

  /**
   * @param {Array} tracks
   *   { id, points: [{lat, lon}], color, weight, segments?: [{lat,lon,color}] }
   */
  setTracks(tracks) {
    this.tracks = tracks || [];
    this._computeBounds();
    this.draw();
  }

  setMarker(lat, lon) {
    this.marker = (lat === null || lat === undefined) ? null : { lat, lon };
    this.draw();
  }

  _computeBounds() {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const t of this.tracks) {
      for (const p of t.points) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
      }
    }
    this._bounds = Number.isFinite(minLat)
      ? { minLat, maxLat, minLon, maxLon } : null;
  }

  /** Fit the bounds into the canvas, in normalised Web Mercator units. */
  _projector(w, h) {
    const b = this._bounds;
    const a = window.mercator(b.maxLat, b.minLon);   // top-left
    const c = window.mercator(b.minLat, b.maxLon);   // bottom-right

    const spanX = Math.max(c.x - a.x, 1e-12);
    const spanY = Math.max(c.y - a.y, 1e-12);

    const pad = 24;
    const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
    const cx = (a.x + c.x) / 2, cy = (a.y + c.y) / 2;

    return {
      scale, cx, cy, w, h,
      to: (lat, lon) => {
        const m = window.mercator(lat, lon);
        return { x: (m.x - cx) * scale + w / 2, y: (m.y - cy) * scale + h / 2 };
      },
    };
  }

  draw() {
    const cv = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 320;
    const h = +cv.getAttribute('height') || 300;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!this._bounds) {
      ctx.fillStyle = '#8b93a1';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('No GPS tracks to draw.', 16, h / 2);
      return;
    }

    const proj = this._projector(w, h);
    this._proj = proj;

    let attribution = null;
    if (window.Tiles && window.Tiles.enabled !== 'off') {
      const drew = window.Tiles.draw(ctx, proj, () => this.draw());
      if (drew) attribution = window.Tiles.attribution();
      // Imagery is dark and busy; a wash keeps the track legible on top.
      if (drew) {
        ctx.fillStyle = 'rgba(10,12,16,0.32)';
        ctx.fillRect(0, 0, w, h);
      }
    }

    for (const t of this.tracks) {
      if (t.segments && t.segments.length > 1) {
        for (let i = 0; i < t.segments.length - 1; i++) {
          const a = proj.to(t.segments[i].lat, t.segments[i].lon);
          const b = proj.to(t.segments[i + 1].lat, t.segments[i + 1].lon);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = t.segments[i].color;
          ctx.lineWidth = t.weight || 6;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
        continue;
      }
      ctx.beginPath();
      t.points.forEach((p, i) => {
        const q = proj.to(p.lat, p.lon);
        if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      });
      ctx.strokeStyle = t.color || '#6b7688';
      ctx.lineWidth = t.weight || 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Start and finish of the first track, so the direction is unambiguous.
    const lead = this.tracks.find((t) => t.points.length > 1);
    if (lead) {
      const s = proj.to(lead.points[0].lat, lead.points[0].lon);
      const e = proj.to(lead.points[lead.points.length - 1].lat,
                        lead.points[lead.points.length - 1].lon);
      dot(ctx, s, '#4caf7d'); dot(ctx, e, '#e05c5c');
      ctx.fillStyle = '#8b93a1';
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText('top', s.x + 8, s.y + 3);
      ctx.fillText('bottom', e.x + 8, e.y + 3);
    }

    if (this.marker) {
      const m = proj.to(this.marker.lat, this.marker.lon);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#e08a3c';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    this._scaleBar(ctx, w, h, proj);

    if (attribution) {
      ctx.font = '10px system-ui, sans-serif';
      const tw = ctx.measureText(attribution).width;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(w - tw - 12, h - 16, tw + 8, 14);
      ctx.fillStyle = '#d8dce4';
      ctx.fillText(attribution, w - tw - 8, h - 5);
    }
  }

  _scaleBar(ctx, w, h, proj) {
    // In Web Mercator, ground distance per unit shrinks with latitude, so the
    // scale bar has to be corrected or it overstates distance away from the
    // equator — by about 35% at 50 degrees north.
    const latRad = (this._bounds
      ? ((this._bounds.minLat + this._bounds.maxLat) / 2) : 0) * Math.PI / 180;
    const worldMetres = 40075016.686 * Math.cos(latRad);
    const mPerPx = worldMetres / proj.scale;
    const targets = [10, 25, 50, 100, 250, 500, 1000, 2000];
    const want = mPerPx * (w * 0.25);
    const metres = targets.reduce((a, b) =>
      Math.abs(b - want) < Math.abs(a - want) ? b : a);
    const px = metres / mPerPx;

    const y = h - 14, x = 14;
    ctx.strokeStyle = '#8b93a1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + px, y);
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
    ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4);
    ctx.stroke();
    ctx.fillStyle = '#8b93a1';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText(metres >= 1000 ? (metres / 1000) + ' km' : metres + ' m', x + px + 6, y + 3);
  }

  _handleClick(ev) {
    if (!this._proj || !this.onSelect) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;

    let best = null, bestD2 = 30 * 30;   // 30 px grab radius
    for (const t of this.tracks) {
      for (const p of t.points) {
        const q = this._proj.to(p.lat, p.lon);
        const d2 = (q.x - px) ** 2 + (q.y - py) ** 2;
        if (d2 < bestD2) { bestD2 = d2; best = t.id; }
      }
    }
    if (best !== null) this.onSelect(best);
  }
}

function dot(ctx, p, colour) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
}

window.TrackMap = TrackMap;

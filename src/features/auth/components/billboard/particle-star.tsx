'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

import { STAR_BOUNDS, STAR_CENTER, STAR_FACET_COLORS, STAR_OUTLINE } from './star-geometry';
import { usePrefersReducedMotion } from './use-reduced-motion';

/**
 * The LevelUp star drawn with ASCII glyphs on a canvas: the silhouette of
 * public/icon.svg is sampled on a grid, every sample gets the height of its
 * facet (the star is a shallow ten-facet pyramid), and the mark slowly sways
 * and breathes in 3D. Light facets glow violet, dark ones fall back to ink.
 *
 * The pointer scatters it: glyphs near the cursor are pushed away (and
 * dragged along with its speed), then spring back home with friction; a click
 * or a tap bursts the whole mark and it reforms. The canvas sits under the
 * page content, so the pointer is followed on the window.
 *
 * Performance: typed arrays, one canvas, glyphs blitted from a pre-drawn
 * atlas (drawImage, no fillText per frame), ~2.6k glyphs on desktop and
 * ~1.5k on phones, DPR capped at 2, physics skipped once settled, paused off
 * screen and in hidden tabs. Under prefers-reduced-motion the static star
 * image is shown instead.
 */

const GLYPHS = '·:-=+*#%@';
const LEVELS = GLYPHS.length;
const VIOLET = [139, 92, 246] as const; // #8B5CF6
const SCALE_UNIT = 230; // icon units per normalised unit

type Vec3 = [number, number, number];

interface Facet {
  a: [number, number];
  b: [number, number];
  c: [number, number];
  normal: Vec3;
  tone: number;
}

interface Particles {
  n: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  facet: Uint8Array;
  phase: Float32Array;
  edge: Uint8Array;
  /** Per-particle response to the pointer (0.55 to 1.45): uneven scatter. */
  mass: Float32Array;
}

const HEIGHT = 0.34;
const ORIGIN = {
  x: (STAR_BOUNDS.minX + STAR_BOUNDS.maxX) / 2,
  y: (STAR_BOUNDS.minY + STAR_BOUNDS.maxY) / 2
};

function norm(x: number, y: number): [number, number] {
  return [(x - ORIGIN.x) / SCALE_UNIT, (y - ORIGIN.y) / SCALE_UNIT];
}

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function buildFacets(): Facet[] {
  const c = norm(STAR_CENTER.x, STAR_CENTER.y);
  const pts = STAR_OUTLINE.map(([x, y]) => norm(x, y));
  const lums = STAR_FACET_COLORS.map(luminance);
  const minL = Math.min(...lums);
  const maxL = Math.max(...lums);
  // Facet i spans outline[i-1]..outline[i] (facet 0 = top-left: notch → top tip).
  return pts.map((_, i) => {
    const p = pts[(i + pts.length - 1) % pts.length];
    const q = pts[i];
    // 3D: centre raised, outline on the base plane.
    const A: Vec3 = [c[0], c[1], HEIGHT];
    const B: Vec3 = [p[0], p[1], 0];
    const C: Vec3 = [q[0], q[1], 0];
    const u: Vec3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const v: Vec3 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    let n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    return {
      a: c,
      b: p,
      c: q,
      normal: [n[0] / len, n[1] / len, n[2] / len],
      tone: (lums[i] - minL) / (maxL - minL || 1)
    };
  });
}

/** Barycentric weights of (x, y) in triangle abc, or null when outside. */
function bary(x: number, y: number, a: [number, number], b: [number, number], c: [number, number]) {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  const wa = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
  const wb = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
  const wc = 1 - wa - wb;
  const eps = -1e-6;
  return wa >= eps && wb >= eps && wc >= eps ? ([wa, wb, wc] as const) : null;
}

function hash(i: number) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function buildParticles(facets: Facet[], step: number): Particles {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const fs: number[] = [];
  const es: number[] = [];
  const [minX, minY] = norm(STAR_BOUNDS.minX, STAR_BOUNDS.minY);
  const [maxX, maxY] = norm(STAR_BOUNDS.maxX, STAR_BOUNDS.maxY);
  for (let y = minY; y <= maxY; y += step) {
    // Offset every other row: a softer, less mechanical texture.
    const shift = Math.round((y - minY) / step) % 2 ? step / 2 : 0;
    for (let x = minX + shift; x <= maxX; x += step) {
      for (let f = 0; f < facets.length; f++) {
        const w = bary(x, y, facets[f].a, facets[f].b, facets[f].c);
        if (!w) continue;
        xs.push(x);
        ys.push(y);
        zs.push(w[0] * HEIGHT);
        fs.push(f);
        es.push(w[1] < 0.06 || w[2] < 0.06 ? 1 : 0);
        break;
      }
    }
  }
  const n = xs.length;
  const phase = new Float32Array(n);
  const mass = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    phase[i] = hash(i) * Math.PI * 2;
    mass[i] = 0.55 + hash(i + 9173) * 0.9;
  }
  return {
    n,
    x: Float32Array.from(xs),
    y: Float32Array.from(ys),
    z: Float32Array.from(zs),
    facet: Uint8Array.from(fs),
    phase,
    edge: Uint8Array.from(es),
    mass
  };
}

/** Any CSS colour (oklch included) to sRGB, by painting one pixel. */
function toRgb(value: string): [number, number, number] {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return [17, 17, 17];
    x.fillStyle = '#111';
    x.fillStyle = value;
    x.fillRect(0, 0, 1, 1);
    const [r, g, b] = x.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  } catch {
    return [17, 17, 17];
  }
}

/** Particle counts aimed for: the "thousand pieces" without hurting phones. */
const TARGET_DESKTOP = 2600;
const TARGET_MOBILE = 1200;

/* Pointer physics, per 60 fps frame. */
const SPRING = 0.032; // pull back to the home position
const FRICTION = 0.885; // velocity kept each frame
const PUSH = 5.5; // repulsion near the pointer
const DRAG = 0.5; // share of the pointer's own speed passed on
const TAP_BURST = 30; // impulse of a tap / click burst

export default function ParticleStar({
  className,
  tint = 0.85,
  intensity = 1,
  label
}: {
  className?: string;
  /** 0 = monochrome ink, 1 = full violet on the lit facets. */
  tint?: number;
  /** Overall opacity of the glyphs. */
  intensity?: number;
  /** Accessible name; decorative when omitted. */
  label?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const facets = buildFacets();
    let P: Particles = buildParticles(facets, 0.1);
    // Live state of every particle: screen offset from home, and velocity.
    let ox = new Float32Array(0);
    let oy = new Float32Array(0);
    let vx = new Float32Array(0);
    let vy = new Float32Array(0);
    let hx = new Float32Array(0);
    let hy = new Float32Array(0);
    let level = new Uint8Array(0);
    let width = 0;
    let height = 0;
    let dpr = 1;
    let scale = 1;
    let fontPx = 11;
    let cell = 14;
    let atlas: HTMLCanvasElement | null = null;
    let raf = 0;
    let visible = false;
    let running = false;
    let last = 0;
    let time = hash(7) * 10;
    let energy = 0;
    const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
    // Pointer in client coordinates; mapped to the canvas once per frame.
    const ptr = {
      cx: 0,
      cy: 0,
      x: 0,
      y: 0,
      px: 0,
      py: 0,
      vx: 0,
      vy: 0,
      on: false,
      fresh: true,
      bursts: [] as { cx: number; cy: number }[]
    };

    /** One row of pre-drawn glyphs (one per brightness level): drawImage is
     *  far cheaper than fillText for thousands of glyphs a frame. */
    const buildAtlas = () => {
      const base = toRgb(getComputedStyle(canvas).color);
      cell = Math.ceil(fontPx * 1.3);
      const a = atlas ?? document.createElement('canvas');
      a.width = Math.ceil(cell * LEVELS * dpr);
      a.height = Math.ceil(cell * dpr);
      const x = a.getContext('2d');
      if (!x) return;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.clearRect(0, 0, cell * LEVELS, cell);
      x.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      for (let l = 0; l < LEVELS; l++) {
        const b = l / (LEVELS - 1);
        const mix = Math.min(1, Math.max(0, (b - 0.35) / 0.6)) * tint;
        const r = Math.round(base[0] + (VIOLET[0] - base[0]) * mix);
        const g = Math.round(base[1] + (VIOLET[1] - base[1]) * mix);
        const bl = Math.round(base[2] + (VIOLET[2] - base[2]) * mix);
        const al = (0.16 + 0.8 * b) * intensity;
        x.fillStyle = `rgba(${r},${g},${bl},${al.toFixed(3)})`;
        x.fillText(GLYPHS[l], cell * l + cell / 2, cell / 2);
      }
      atlas = a;
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      width = rect.width;
      height = rect.height;
      // DPR capped at 2, and 1.5 on touch screens where the star is a faint
      // backdrop: ~45% fewer pixels to fill each frame.
      dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scale = Math.min(width, height) * 0.43;
      // Sample at a trial step, then refine it to land on the target count.
      const small = width < 420 || window.innerWidth < 640;
      const target = small ? TARGET_MOBILE : TARGET_DESKTOP;
      const trial = 10 / scale;
      const n0 = buildParticles(facets, trial).n || 1;
      const step = trial * Math.sqrt(n0 / target);
      P = buildParticles(facets, step);
      const spacing = step * scale;
      fontPx = Math.max(6.5, Math.min(11, spacing * 1.12));
      ox = new Float32Array(P.n);
      oy = new Float32Array(P.n);
      vx = new Float32Array(P.n);
      vy = new Float32Array(P.n);
      hx = new Float32Array(P.n);
      hy = new Float32Array(P.n);
      level = new Uint8Array(P.n);
      energy = 0;
      buildAtlas();
    };

    const step = (dt: number) => {
      // dt in 60 fps frames (1 = 16.7 ms).
      tilt.x += (tilt.tx - tilt.x) * 0.05 * dt;
      tilt.y += (tilt.ty - tilt.y) * 0.05 * dt;
      const ry = Math.sin(time * 0.36) * 0.5 + tilt.x * 0.22;
      const rx = Math.sin(time * 0.27) * 0.16 + 0.06 + tilt.y * 0.18;
      const rz = Math.sin(time * 0.19) * 0.05;
      const breathe = 1 + Math.sin(time * 0.9) * 0.025;
      const cy = Math.cos(ry);
      const sy = Math.sin(ry);
      const cx = Math.cos(rx);
      const sx = Math.sin(rx);
      const cz = Math.cos(rz);
      const sz = Math.sin(rz);

      // Light from the upper left, slightly in front.
      const L: Vec3 = [-0.45, -0.55, 0.7];
      const lit = facets.map((f) => {
        const [nx, ny, nz] = f.normal;
        const x1 = nx * cy + nz * sy;
        const z1 = -nx * sy + nz * cy;
        const y2 = ny * cx - z1 * sx;
        const z2 = ny * sx + z1 * cx;
        const d = Math.max(0, x1 * L[0] + y2 * L[1] + z2 * L[2]);
        return 0.45 * f.tone + 0.55 * d;
      });

      // Pointer, in canvas coordinates (one layout read per frame).
      let active = false;
      let R = 0;
      if (ptr.on || ptr.bursts.length) {
        const rect = canvas.getBoundingClientRect();
        if (ptr.on) {
          ptr.x = ptr.cx - rect.left;
          ptr.y = ptr.cy - rect.top;
          if (ptr.fresh) {
            ptr.px = ptr.x;
            ptr.py = ptr.y;
            ptr.fresh = false;
          }
          ptr.vx = (ptr.vx + (ptr.x - ptr.px) / dt) * 0.5;
          ptr.vy = (ptr.vy + (ptr.y - ptr.py) / dt) * 0.5;
          ptr.px = ptr.x;
          ptr.py = ptr.y;
          R = scale * 0.55;
          // Only while the pointer is over (or close to) the mark.
          const dcx = ptr.x - width / 2;
          const dcy = ptr.y - height / 2;
          active = dcx * dcx + dcy * dcy < (scale + R) * (scale + R);
        }
        for (const b of ptr.bursts) {
          const bx = b.cx - rect.left;
          const by = b.cy - rect.top;
          const RB = scale * 1.6;
          for (let i = 0; i < P.n; i++) {
            const dx = hx[i] + ox[i] - bx;
            const dy = hy[i] + oy[i] - by;
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            if (d > RB) continue;
            const f = (1 - d / RB) * TAP_BURST * P.mass[i];
            // A little swirl so the burst does not look like a ring.
            const sw = Math.sin(P.phase[i]) * 0.45;
            vx[i] += ((dx - dy * sw) / d) * f;
            vy[i] += ((dy + dx * sw) / d) * f;
          }
          energy = 1;
        }
        ptr.bursts.length = 0;
      }

      const cxp = width / 2;
      const cyp = height / 2;
      const persp = 3.2;
      const R2 = R * R;
      const pvx = ptr.vx * DRAG;
      const pvy = ptr.vy * DRAG;
      const spring = 1 - Math.pow(1 - SPRING, dt);
      const keep = Math.pow(FRICTION, dt);
      const physics = active || energy > 0.02;
      let e = 0;
      for (let i = 0; i < P.n; i++) {
        const wobble = 1 + Math.sin(time * 1.3 + P.phase[i]) * 0.012;
        const x = P.x[i] * breathe * wobble;
        const y = P.y[i] * breathe * wobble;
        const z = P.z[i];
        const x1 = x * cy + z * sy;
        const z1 = -x * sy + z * cy;
        const y2 = y * cx - z1 * sx;
        const z2 = y * sx + z1 * cx;
        const x3 = x1 * cz - y2 * sz;
        const y3 = x1 * sz + y2 * cz;
        const k = persp / (persp - z2);
        hx[i] = cxp + x3 * k * scale;
        hy[i] = cyp + y3 * k * scale;

        let speed = 0;
        if (physics) {
          let ax = 0;
          let ay = 0;
          if (active) {
            const dx = hx[i] + ox[i] - ptr.x;
            const dy = hy[i] + oy[i] - ptr.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < R2) {
              const d = Math.sqrt(d2) || 1;
              const f = 1 - d / R;
              const m = P.mass[i];
              const push = f * f * PUSH * m;
              ax += (dx / d) * push + pvx * f * m;
              ay += (dy / d) * push + pvy * f * m;
            }
          }
          let u = (vx[i] + ax * dt - ox[i] * spring) * keep;
          let v = (vy[i] + ay * dt - oy[i] * spring) * keep;
          // Cap the speed: scattered, never teleported.
          const s2 = u * u + v * v;
          if (s2 > 1600) {
            const c = 40 / Math.sqrt(s2);
            u *= c;
            v *= c;
          }
          vx[i] = u;
          vy[i] = v;
          ox[i] += u * dt;
          oy[i] += v * dt;
          speed = Math.abs(u) + Math.abs(v);
          e += speed + (Math.abs(ox[i]) + Math.abs(oy[i])) * 0.1;
        }

        // Every facet stays readable; light facets climb to violet.
        let b = 0.22 + 0.78 * lit[P.facet[i]];
        if (P.edge[i]) b = Math.min(1, b + 0.22);
        // A few glyphs twinkle; flying pieces glow.
        const tw = Math.sin(time * 1.7 + P.phase[i] * 3);
        if (tw > 0.97) b = Math.min(1, b + 0.35);
        if (speed > 0.6) b = Math.min(1, b + speed * 0.05);
        level[i] = Math.max(0, Math.min(LEVELS - 1, Math.round(b * (LEVELS - 1))));
      }
      if (physics) {
        energy = e / Math.max(1, P.n);
        if (!active && energy <= 0.02) {
          ox.fill(0);
          oy.fill(0);
          vx.fill(0);
          vy.fill(0);
          energy = 0;
        }
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      if (!atlas) return;
      const sw = cell * dpr;
      const half = cell / 2;
      for (let i = 0; i < P.n; i++) {
        ctx.drawImage(
          atlas,
          level[i] * sw,
          0,
          sw,
          sw,
          hx[i] + ox[i] - half,
          hy[i] + oy[i] - half,
          cell,
          cell
        );
      }
    };

    // Touch screens: the calm drift is drawn at 30 fps (it is slow and sits
    // behind the text), the burst and its reform at the full frame rate.
    let skip = false;
    const frame = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const calm = coarse && !ptr.on && !ptr.bursts.length && energy === 0;
      skip = calm ? !skip : false;
      if (skip) return;
      const ms = last ? Math.min(64, now - last) : 16.7;
      last = now;
      time += ms / 1000;
      step(ms / 16.67);
      draw();
    };

    const start = () => {
      if (running || !visible || document.hidden) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    resize();
    step(1);
    draw();

    const ro = new ResizeObserver(() => {
      resize();
      if (!running) {
        step(1);
        draw();
      }
    });
    ro.observe(wrap);

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) start();
        else stop();
      },
      { rootMargin: '80px' }
    );
    io.observe(wrap);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);

    // Theme switches: re-read the ink colour.
    const mo = new MutationObserver(() => {
      buildAtlas();
      if (!running) draw();
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    // The canvas sits under the page content (pointer-events: none), so the
    // pointer is followed on the window and mapped onto the mark.
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        tilt.tx = (e.clientX / window.innerWidth - 0.5) * 2;
        tilt.ty = (e.clientY / window.innerHeight - 0.5) * 2;
      } else if (!ptr.on) {
        return; // touch: only while a finger that started on the star is down
      }
      if (!ptr.on) ptr.fresh = true;
      ptr.cx = e.clientX;
      ptr.cy = e.clientY;
      ptr.on = true;
    };
    const overStar = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      return dx * dx + dy * dy < scale * scale;
    };
    const onDown = (e: PointerEvent) => {
      if (!running || !overStar(e)) return;
      ptr.bursts.push({ cx: e.clientX, cy: e.clientY });
      if (e.pointerType !== 'mouse') {
        ptr.cx = e.clientX;
        ptr.cy = e.clientY;
        ptr.on = true;
        ptr.fresh = true;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') ptr.on = false;
    };
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) ptr.on = false;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    document.addEventListener('pointerout', onOut, { passive: true });

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.removeEventListener('pointerout', onOut);
    };
  }, [reduced, tint, intensity]);

  return (
    <div
      ref={wrapRef}
      className={cn('text-foreground relative', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {reduced ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src='/icon.svg'
          alt=''
          width={512}
          height={512}
          className='absolute inset-0 m-auto h-[62%] w-[62%] object-contain opacity-90'
        />
      ) : (
        <canvas ref={canvasRef} className='text-foreground absolute inset-0 block h-full w-full' />
      )}
    </div>
  );
}

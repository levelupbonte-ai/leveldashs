'use client';

import { geoNaturalEarth1, geoPath } from 'd3-geo';
import countries from 'i18n-iso-countries';
import { useLocale } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';

export interface WorldMapItem {
  /** ISO 3166-1 alpha-2, e.g. "US". */
  country: string;
  value: number;
  /** Extra lines shown on hover (e.g. page views). */
  details?: { label: string; value: string }[];
}

const WIDTH = 960;
const HEIGHT = 440;

// Country shapes once per page (world-atlas, 110m: light, ~100 KB).
let shapes: { id: string; d: string; name: string; c: [number, number] }[] | null = null;
function getShapes() {
  if (shapes) return shapes;
  const topo = world as unknown as Topology<{ countries: GeometryCollection }>;
  const all = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry>;
  // Without Antarctica, framed on what is left.
  const geo: FeatureCollection<Geometry> = {
    ...all,
    features: all.features.filter((f) => f.id !== '010')
  };
  const projection = geoNaturalEarth1().fitSize([WIDTH, HEIGHT], geo);
  const path = geoPath(projection);
  shapes = geo.features.map((f) => ({
    id: String(f.id),
    d: path(f) ?? '',
    name: String((f.properties as { name?: string } | null)?.name ?? ''),
    c: path.centroid(f) as [number, number]
  }));
  return shapes;
}

/** Country name in the interface language ("US" -> "United States"). */
export function useCountryName() {
  const locale = useLocale();
  return useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      names = null;
    }
    return (code: string) => names?.of(code) ?? code;
  }, [locale]);
}

/** "US" -> 🇺🇸 (regional indicator letters). */
function flag(code: string): string {
  return /^[A-Z]{2}$/.test(code)
    ? String.fromCodePoint(...[...code].map((ch) => 0x1f1a5 + ch.charCodeAt(0)))
    : '';
}

/**
 * Choropleth world map: the more of `value`, the stronger the brand colour.
 * Hover (or keyboard focus) a country for a card with its numbers, like the
 * analytics maps of Cloudflare or Vercel. Real numbers only; countries
 * without data stay neutral and show 0.
 */
export function WorldMap({
  items,
  label,
  valueLabel,
  shareLabel
}: {
  items: WorldMapItem[];
  label: string;
  valueLabel: (value: number) => string;
  /** "42% of the total" (omit to hide the share). */
  shareLabel?: (percent: number) => string;
}) {
  const countryName = useCountryName();
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const byNumeric = useMemo(() => {
    const map = new Map<string, WorldMapItem>();
    for (const item of items) {
      const numeric = countries.alpha2ToNumeric(item.country);
      if (numeric) map.set(String(numeric).padStart(3, '0'), item);
    }
    return map;
  }, [items]);
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((sum, i) => sum + i.value, 0);

  const place = (id: string, clientX: number, clientY: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ id, x: clientX - rect.left, y: clientY - rect.top });
  };
  const placeAtCentroid = (id: string, c: [number, number]) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ id, x: (c[0] / WIDTH) * rect.width, y: (c[1] / HEIGHT) * rect.height });
  };

  const shape = hover ? getShapes().find((s) => s.id === hover.id) : null;
  const hovered = hover ? byNumeric.get(hover.id) : undefined;
  const code = hovered?.country ?? (hover ? (countries.numericToAlpha2(hover.id) ?? '') : '');
  const name = code ? countryName(code) : (shape?.name ?? '');
  const width = box.current?.clientWidth ?? 0;

  return (
    <div ref={box} className='relative' onPointerLeave={() => setHover(null)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role='img'
        aria-label={label}
        className='h-auto w-full'
        preserveAspectRatio='xMidYMid meet'
      >
        {getShapes().map((s) => {
          const item = byNumeric.get(s.id);
          // Log scale so one big country does not wash out the others.
          const strength = item ? 0.2 + 0.8 * (Math.log1p(item.value) / Math.log1p(max)) : 0;
          const active = hover?.id === s.id;
          return (
            <path
              key={s.id}
              d={s.d}
              fill={item ? 'var(--primary)' : 'var(--muted)'}
              fillOpacity={item ? strength : active ? 0.6 : 1}
              stroke={active ? 'var(--foreground)' : 'var(--background)'}
              strokeWidth={active ? 1.2 : 0.5}
              className='cursor-default transition-[fill-opacity] duration-150 outline-none'
              tabIndex={item ? 0 : undefined}
              aria-label={
                item ? `${countryName(item.country)}: ${valueLabel(item.value)}` : undefined
              }
              onPointerMove={(e) => place(s.id, e.clientX, e.clientY)}
              onFocus={() => placeAtCentroid(s.id, s.c)}
              onBlur={() => setHover(null)}
            />
          );
        })}
      </svg>
      {hover && name && (
        <div
          role='status'
          className='bg-popover text-popover-foreground pointer-events-none absolute z-10 min-w-40 rounded-lg border px-3 py-2 text-xs shadow-md'
          style={{
            left: Math.min(Math.max(hover.x + 14, 0), Math.max(width - 180, 0)),
            top: Math.max(hover.y - 10, 0)
          }}
        >
          <p className='flex items-center gap-1.5 font-medium'>
            <span aria-hidden>{flag(code)}</span>
            {name}
          </p>
          <p className='mt-1 tabular-nums'>{valueLabel(hovered?.value ?? 0)}</p>
          {hovered?.details?.map((d) => (
            <p key={d.label} className='text-muted-foreground tabular-nums'>
              {d.label}: {d.value}
            </p>
          ))}
          {shareLabel && hovered && total > 0 && (
            <p className='text-muted-foreground tabular-nums'>
              {shareLabel(Math.round((hovered.value / total) * 100))}
            </p>
          )}
        </div>
      )}
      <div className='text-muted-foreground mt-2 flex items-center gap-2 text-[11px]' aria-hidden>
        <span>0</span>
        <span
          className='h-1.5 w-24 rounded-full'
          style={{
            background:
              'linear-gradient(90deg, color-mix(in oklch, var(--primary) 20%, transparent), var(--primary))'
          }}
        />
        <span className='tabular-nums'>{max}</span>
      </div>
    </div>
  );
}

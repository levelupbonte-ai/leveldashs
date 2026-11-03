'use client';

import { geoNaturalEarth1, geoPath } from 'd3-geo';
import countries from 'i18n-iso-countries';
import { useLocale } from 'next-intl';
import { useMemo } from 'react';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';

export interface WorldMapItem {
  /** ISO 3166-1 alpha-2, e.g. "US". */
  country: string;
  value: number;
}

const WIDTH = 960;
const HEIGHT = 440;

// Country shapes once per page (world-atlas, 110m: light, ~100 KB).
let shapes: { id: string; d: string }[] | null = null;
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
  shapes = geo.features.map((f) => ({ id: String(f.id), d: path(f) ?? '' }));
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

/**
 * Choropleth world map: the more of `value`, the stronger the brand colour.
 * Real numbers only; countries without data stay neutral. Accessible: each
 * coloured country has a <title> and the map is labelled.
 */
export function WorldMap({
  items,
  label,
  valueLabel
}: {
  items: WorldMapItem[];
  label: string;
  valueLabel: (value: number) => string;
}) {
  const countryName = useCountryName();
  const byNumeric = useMemo(() => {
    const map = new Map<string, WorldMapItem>();
    for (const item of items) {
      const numeric = countries.alpha2ToNumeric(item.country);
      if (numeric) map.set(String(numeric).padStart(3, '0'), item);
    }
    return map;
  }, [items]);
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
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
        return (
          <path
            key={s.id}
            d={s.d}
            fill={item ? 'var(--primary)' : 'var(--muted)'}
            fillOpacity={item ? strength : 1}
            stroke='var(--background)'
            strokeWidth={0.5}
          >
            {item && <title>{`${countryName(item.country)} · ${valueLabel(item.value)}`}</title>}
          </path>
        );
      })}
    </svg>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Drawing box of the stored path (the database accepts `M`/`L` + integers only). */
export const SIGNATURE_WIDTH = 600;
export const SIGNATURE_HEIGHT = 200;
const MAX_LENGTH = 19000;

interface SignaturePadProps {
  value: string | null;
  onChange: (path: string | null) => void;
  disabled?: boolean;
  id?: string;
}

/**
 * Optional hand-drawn signature: pointer events (mouse, pen, touch), stored as
 * SVG path data in a 600 x 200 box, size-limited. `touch-action: none` keeps the
 * page from scrolling while drawing on a phone.
 */
export function SignaturePad({ value, onChange, disabled, id }: SignaturePadProps) {
  const t = useTranslations('contract.sign');
  const ref = useRef<SVGSVGElement>(null);
  const drawing = useRef(false);
  const last = useRef<[number, number] | null>(null);
  const [path, setPathState] = useState(value ?? '');
  const pathRef = useRef(path);
  const setPath = (next: string) => {
    pathRef.current = next;
    setPathState(next);
  };

  const point = (event: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = ref.current!.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * SIGNATURE_WIDTH);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * SIGNATURE_HEIGHT);
    return [Math.min(SIGNATURE_WIDTH, Math.max(0, x)), Math.min(SIGNATURE_HEIGHT, Math.max(0, y))];
  };

  const append = (segment: string) => {
    const current = pathRef.current;
    if (current.length + segment.length > MAX_LENGTH) return;
    setPath(current ? `${current} ${segment}` : segment);
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    event.preventDefault();
    ref.current?.setPointerCapture(event.pointerId);
    drawing.current = true;
    const [x, y] = point(event);
    last.current = [x, y];
    append(`M ${x} ${y} L ${x} ${y}`);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing.current || disabled) return;
    const [x, y] = point(event);
    const [lx, ly] = last.current ?? [x, y];
    // Skip sub-pixel noise to keep the stored path small.
    if (Math.abs(x - lx) + Math.abs(y - ly) < 3) return;
    last.current = [x, y];
    append(`L ${x} ${y}`);
  };

  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    onChange(pathRef.current || null);
  };

  const clear = () => {
    setPath('');
    onChange(null);
  };

  return (
    <div className='space-y-2'>
      <div
        className={cn(
          'bg-background relative overflow-hidden rounded-lg border border-dashed',
          disabled && 'opacity-60'
        )}
      >
        <svg
          id={id}
          ref={ref}
          role='img'
          aria-label={path ? t('drawnLabel') : t('drawHint')}
          viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`}
          className='block aspect-[3/1] w-full cursor-crosshair touch-none select-none'
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onPointerLeave={finish}
        >
          <line
            x1='40'
            x2={SIGNATURE_WIDTH - 40}
            y1={SIGNATURE_HEIGHT - 45}
            y2={SIGNATURE_HEIGHT - 45}
            className='stroke-border'
            strokeWidth='1.5'
          />
          {path && (
            <path
              d={path}
              fill='none'
              className='stroke-foreground'
              strokeWidth='3.5'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          )}
        </svg>
        {!path && (
          <p className='text-muted-foreground pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm'>
            {t('drawHint')}
          </p>
        )}
      </div>
      <div className='flex justify-end'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={clear}
          disabled={disabled || !path}
        >
          <Icons.eraser className='size-4' aria-hidden />
          {t('clear')}
        </Button>
      </div>
    </div>
  );
}

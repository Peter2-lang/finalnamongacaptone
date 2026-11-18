import React, { useRef, useState } from 'react';
import type { ExcludedRegion } from '../../services/legalTextOnly';

interface Props {
  image: string;
  pageNumber: number;
  imageIndex: number;
  regions: ExcludedRegion[];
  onChange: (regions: ExcludedRegion[]) => void;
  disabled?: boolean;
}
/** Mark only unwanted pixels on a working copy; the uploaded source never changes. */
export function LegalPrintedTextSource({ image, pageNumber, imageIndex, regions, onChange, disabled }: Props) {
  const [marking, setMarking] = useState(false);
  const [draft, setDraft] = useState<ExcludedRegion | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) };
  };
  const rectangle = (end: { x: number; y: number }): ExcludedRegion => ({ x: Math.min(start.current!.x, end.x), y: Math.min(start.current!.y, end.y), width: Math.abs(end.x - start.current!.x), height: Math.abs(end.y - start.current!.y) });
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2 text-xs">
      <button type="button" disabled={disabled} aria-pressed={marking} onClick={() => setMarking(!marking)} className="rounded border border-emerald-700 px-2 py-1 text-emerald-800">{marking ? 'Finish marking' : 'Mark signature / graphic'}</button>
      <button type="button" disabled={disabled || !regions.length} onClick={() => onChange(regions.slice(0, -1))} className="underline">Undo last region</button>
      <a href={image} target="_blank" rel="noreferrer" className="underline">Open unchanged original</a>
    </div>
    <div className={`relative ${marking ? 'touch-none cursor-crosshair' : ''}`} onPointerDown={event => {
      if (!marking || disabled) return;
      event.currentTarget.setPointerCapture(event.pointerId); start.current = point(event); setDraft({ ...start.current, width: 0, height: 0 });
    }} onPointerMove={event => { if (start.current) setDraft(rectangle(point(event))); }} onPointerUp={event => {
      if (!start.current) return;
      const region = rectangle(point(event)); start.current = null; setDraft(null);
      if (region.width > 0.002 && region.height > 0.002) onChange([...regions, region]);
    }} onPointerCancel={() => { start.current = null; setDraft(null); }}>
      <img src={image} alt={`Original page ${pageNumber}, image ${imageIndex + 1}`} draggable={false} className="block h-auto w-full" />
      {[...regions, ...(draft ? [draft] : [])].map((region, i) => <div key={i} className="pointer-events-none absolute border-2 border-red-600 bg-red-200/60" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />)}
    </div>
    {marking && <p className="text-xs text-slate-600">Drag a box around unwanted strokes, logos, stamps or watermarks. Keep printed names, positions and provisions outside the box.</p>}
  </div>;
}

import React from 'react';
import { SwineHeatmapClass } from '../../utils/gisCalculations';

const options: Array<[SwineHeatmapClass, string]> = [
  ['piglet', 'Piglets'],
  ['grower', 'Growers'],
  ['finisher', 'Fatteners / Finishers'],
  ['sow', 'Breeding Sows'],
  ['boar', 'Breeding Boars'],
];

export function HeatmapClassificationFilters({
  selectedClasses,
  onChange,
  readyOnly,
  onReadyOnlyChange,
  count,
}: {
  selectedClasses: SwineHeatmapClass[] | null;
  onChange: (classes: SwineHeatmapClass[] | null) => void;
  readyOnly: boolean;
  onReadyOnlyChange: (value: boolean) => void;
  count: number;
}) {
  const allSelected = selectedClasses === null;
  const toggleClass = (item: SwineHeatmapClass, checked: boolean) => {
    const next = new Set(selectedClasses ?? []);
    if (checked) next.add(item);
    else next.delete(item);
    onChange([...next]);
  };

  return (
    <fieldset className="space-y-1.5 rounded-lg border border-stone-700 p-2" aria-label="Swine Heatmap Classification">
      <legend className="px-1 text-[10px] font-semibold text-stone-300">Swine Heatmap Classification</legend>
      <label className="flex items-center gap-2 text-stone-300">
        <input type="checkbox" checked={allSelected} onChange={e => onChange(e.target.checked ? null : [])} className="accent-emerald-500" />
        All Registered Swine
      </label>
      {options.map(([value, label]) => (
        <label key={value} className="flex items-center gap-2 text-stone-400">
          <input type="checkbox" checked={selectedClasses?.includes(value) || false} onChange={e => toggleClass(value, e.target.checked)} className="accent-emerald-500" />
          {label}
        </label>
      ))}
      <label className="flex items-center gap-2 text-stone-400">
        <input type="checkbox" checked={readyOnly} onChange={e => onReadyOnlyChange(e.target.checked)} className="accent-emerald-500" />
        Ready-to-Sell Only
      </label>
      <div className="pt-1 text-[10px] text-stone-500" aria-live="polite">{count} matching active swine</div>
    </fieldset>
  );
}

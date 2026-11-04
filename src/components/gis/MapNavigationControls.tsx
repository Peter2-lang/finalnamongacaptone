import React, {useState} from 'react';
import {ZoomIn, ZoomOut, RotateCcw, Navigation} from 'lucide-react';

interface Props {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onLocate: (latitude: number, longitude: number) => void;
}

/** Controls stay outside the map canvas so their clicks cannot select a location. */
export function MapNavigationControls({onZoomIn,onZoomOut,onReset,onLocate}: Props) {
  const [locationError,setLocationError]=useState<string | null>(null);
  const locate=()=>{
    setLocationError(null);
    if(!navigator.geolocation){setLocationError('Location is unavailable on this device.');return;}
    navigator.geolocation.getCurrentPosition(
      ({coords})=>onLocate(coords.latitude,coords.longitude),
      error=>setLocationError(error.code===1?'Location permission was denied.': 'Unable to determine your location.'),
      {enableHighAccuracy:true,timeout:15000,maximumAge:30000},
    );
  };
  return <div className="absolute left-3 bottom-4 md:bottom-auto md:top-16 z-40 flex flex-col gap-1" onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()}>
    {[
      {label:'Zoom In (+)',Icon:ZoomIn,action:onZoomIn},
      {label:'Zoom Out (−)',Icon:ZoomOut,action:onZoomOut},
      {label:'Reset View',Icon:RotateCcw,action:onReset},
      {label:'Locate Me',Icon:Navigation,action:locate},
    ].map(({label,Icon,action})=><button key={label} type="button" title={label} aria-label={label} onClick={action} className="p-2 rounded-xl border border-stone-700 bg-stone-900/90 text-stone-200 hover:bg-stone-800 shadow-md cursor-pointer"><Icon className="w-4 h-4" /></button>)}
    {locationError && <p role="alert" className="absolute right-10 top-0 w-56 rounded-xl bg-stone-900 p-3 text-xs text-white">{locationError}</p>}
  </div>;
}

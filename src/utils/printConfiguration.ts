export const PAPER_SIZES = { A4:[210,297], Letter:[215.9,279.4], Legal:[215.9,355.6], A3:[297,420], A5:[148,210], 'Long Bond':[215.9,330.2], Custom:[210,297] } as const;
export interface PrintLogo { url:string; width:number; height:number; visible:boolean; aspect:boolean; alignment:'left'|'center'|'right'; spacing:number }
export interface PrintConfiguration {
 paper:keyof typeof PAPER_SIZES; orientation:'portrait'|'landscape'; width:number; height:number; margin:number;
 scaling:'fit-page'|'fit-width'|'actual'|'custom'; scale:number; header:boolean; footer:boolean; pageNumbers:boolean;
 title:string; date:string; fontSize:number; borders:boolean; backgrounds:boolean; signatures:boolean; hiddenColumns:number[]; logos:PrintLogo[];
}
export const DEFAULT_PRINT_CONFIGURATION:PrintConfiguration = {paper:'A4',orientation:'portrait',width:210,height:297,margin:10,scaling:'fit-width',scale:100,header:true,footer:true,pageNumbers:true,title:'',date:'',fontSize:11,borders:true,backgrounds:true,signatures:true,hiddenColumns:[],logos:[]};
export function validatePrintConfiguration(value:unknown): value is PrintConfiguration {
 if (!value || typeof value!=='object') return false;
 const v=value as PrintConfiguration;
 const number=(n:unknown,min:number,max:number)=>typeof n==='number' && Number.isFinite(n) && n>=min && n<=max;
 return Object.hasOwn(PAPER_SIZES,v.paper) && ['portrait','landscape'].includes(v.orientation)
 && number(v.width,50,1200) && number(v.height,50,1200) && number(v.margin,0,50)
 && ['fit-page','fit-width','actual','custom'].includes(v.scaling) && number(v.scale,25,200) && number(v.fontSize,6,24)
 && ['header','footer','pageNumbers','borders','backgrounds','signatures'].every(k=>typeof (v as any)[k]==='boolean')
 && typeof v.title==='string' && v.title.length<=200 && typeof v.date==='string' && v.date.length<=40
 && Array.isArray(v.hiddenColumns) && v.hiddenColumns.length<=100 && v.hiddenColumns.every(n=>Number.isInteger(n)&&n>=0&&n<100)
 && Array.isArray(v.logos) && v.logos.length<=8 && v.logos.every(l=>typeof l.url==='string' && l.url.length<=2048 && (!l.url || /^https:\/\//.test(l.url) || /^\/(?!\/)/.test(l.url)) && number(l.width,10,300) && number(l.height,10,300) && number(l.spacing,0,100) && typeof l.visible==='boolean' && typeof l.aspect==='boolean' && ['left','center','right'].includes(l.alignment));
}
export function paperDimensions(c:PrintConfiguration):[number,number] {
 const [w,h]=c.paper==='Custom'?[c.width,c.height]:PAPER_SIZES[c.paper];
 return c.orientation==='landscape'?[h,w]:[w,h];
}

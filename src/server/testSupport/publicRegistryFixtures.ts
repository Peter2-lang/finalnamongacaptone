import { PUBLIC_REGISTRY_SQL } from '../publicRegistry.ts';
const farmer={id:'f1',is_active:true,is_archived:false};
const swine={id:'s1',farmer_id:'f1',barangay_id:'b0',status:'HEALTHY',is_archived:false,is_active:true,ready_to_sell:false};
export const publicRegistryFixtures = [
 {name:'zero',swine:[],farmers:[],expected:[0,0,0]},
 {name:'one',swine:[swine],farmers:[farmer],expected:[1,1,0]},
 {name:'same_farmer_multiple_swine',swine:[swine,{...swine,id:'s2'}],farmers:[farmer],expected:[1,2,0]},
 {name:'multiple_barangays',swine:[swine,{...swine,id:'s2',barangay_id:'b1'}],farmers:[farmer],expected:[1,2,0]},
 {name:'archived',swine:[{...swine,is_archived:true}],farmers:[farmer],expected:[1,0,0]},
 {name:'restored',swine:[{...swine,is_archived:false}],farmers:[farmer],expected:[1,1,0]},
 {name:'deleted',swine:[],farmers:[farmer],expected:[1,0,0]},
 {name:'ready',swine:[{...swine,ready_to_sell:true}],farmers:[farmer],expected:[1,1,1]},
 {name:'moved',swine:[{...swine,barangay_id:'b1',ready_to_sell:true}],farmers:[farmer],expected:[1,1,1]},
 {name:'inactive',swine:[{...swine,is_active:false,ready_to_sell:true}],farmers:[farmer],expected:[1,0,0]},
 {name:'sold_and_deceased',swine:[{...swine,status:'SOLD'},{...swine,id:'s2',status:'deceased'}],farmers:[farmer],expected:[1,0,0]},
 {name:'archived_farmer',swine:[],farmers:[{...farmer,is_archived:true}],expected:[0,0,0]},
];
const literal=(value:unknown)=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
export function publicRegistryFixtureSql() {
 return publicRegistryFixtures.map(f=>`SELECT '${f.name}' AS scenario, row_to_json(result) AS result FROM (
 WITH barangays AS (SELECT 'b'||n AS id, CASE WHEN n=0 THEN 'Ambacon' ELSE 'Barangay '||lpad(n::text,2,'0') END AS name, 'B'||n AS code, '{}'::jsonb AS metadata FROM generate_series(0,39) n),
 farmers AS (SELECT * FROM jsonb_to_recordset(${literal(f.farmers)}) AS x(id text,is_active boolean,is_archived boolean)),
 swine_records AS (SELECT * FROM jsonb_to_recordset(${literal(f.swine)}) AS x(id text,farmer_id text,barangay_id text,status text,is_archived boolean,is_active boolean,ready_to_sell boolean)),
 users AS (SELECT 'Private fixture name'::text AS name,'Ambacon'::text AS assigned_barangay,'focal'::text AS role,true AS active,true AS is_active,'active'::text AS status),
 system_settings AS (SELECT 'biosecurity_audits'::text AS setting_key,'[]'::jsonb AS setting_value)
 ${PUBLIC_REGISTRY_SQL}) result`).join('\nUNION ALL\n');
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparePostgresTypes, compareDatabaseCatalog, findUnmodeledRequiredColumns } from './catalog.ts';
import { getRequiredDatabaseColumns } from './requirements.ts';
import { successfulSchemaRows } from '../server/testSupport/schemaFixture.ts';

test('identifier changes are incompatible, never automatically cast or regenerated', () => {
  assert.equal(comparePostgresTypes('uuid','text'),'incompatible');
  assert.equal(comparePostgresTypes('uuid','integer'),'incompatible');
  assert.equal(comparePostgresTypes('text','uuid'),'incompatible');
  assert.equal(comparePostgresTypes('integer','int4'),'compatible');
  assert.equal(comparePostgresTypes('text','character varying(120)'),'compatible');
  assert.equal(comparePostgresTypes('timestamp','timestamp with time zone'),'review');
  assert.equal(comparePostgresTypes('text','date'),'incompatible');
  assert.equal(comparePostgresTypes('text','numeric(12,2)'),'incompatible');
});

test('swine barangay UUID is part of the ORM contract and is written by the save workflow', () => {
  const columns = [{table_name:'swine_records',column_name:'barangay_id',data_type:'uuid',not_null:true,column_default:null,primary_key:false}];
  assert.equal(getRequiredDatabaseColumns().some(column => column.table === 'swine_records' && column.column === 'barangay_id' && column.sqlType === 'uuid' && column.expectedNotNull), true);
  assert.deepEqual(findUnmodeledRequiredColumns(columns), []);
});

test('catalog detects legacy swine/audit identities and reports constraint metadata', () => {
  const rows = successfulSchemaRows('pg_catalog.pg_attribute') as any[];
  for (const row of rows) if (row.column_name==='id' && row.table_name==='swine_records') row.data_type='text';
  const swine = compareDatabaseCatalog(rows).find(row => row.table==='swine_records' && row.column==='id')!;
  assert.equal(swine.status,'incompatible');
  assert.equal(swine.primaryKey,true);
  assert.equal(swine.actualType,'text');
});

test('generated and identity columns are not falsely treated as missing insert values',()=>{
 const base={table_name:'users',column_name:'legacy_identity',data_type:'bigint',not_null:true,column_default:null,primary_key:false};
 assert.deepEqual(findUnmodeledRequiredColumns([{...base,identity_kind:'d'},{...base,generated_kind:'s'}]),[]);
});

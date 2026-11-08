import { publicRegistryFixtureSql, publicRegistryFixtures } from '../src/server/testSupport/publicRegistryFixtures.ts';
// Read-only SELECT fixtures shadow source tables for this statement only.
console.log(JSON.stringify({sql:publicRegistryFixtureSql(),expected:publicRegistryFixtures.map(f=>({scenario:f.name,expected:f.expected}))}));

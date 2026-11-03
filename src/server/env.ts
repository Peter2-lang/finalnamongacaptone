import { config } from 'dotenv';

// Earlier files win; deployment environment variables always take precedence.
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

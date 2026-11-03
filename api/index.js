// Keep this launcher in source control so Vercel discovers it before building.
// The build resolves all application TypeScript imports into this Node artifact.
import backend from '../build/vercel.cjs';

export default backend.default;

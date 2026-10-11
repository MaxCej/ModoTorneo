// Prints `top4-8players.json`. Usage (Node 24 runs TypeScript directly):
//   node src/domain/fixtures/generate.ts > src/domain/fixtures/top4-8players.json && pnpm format
import { buildTop4Fixture } from './top4-8players.ts';

console.log(JSON.stringify(buildTop4Fixture(), null, 2));

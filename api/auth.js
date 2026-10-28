import { handleAuth } from '../server/auth.mjs';

// One Node.js Vercel Function; the same handler is used by the local server.
export const GET = request => handleAuth(request);
export const POST = request => handleAuth(request);

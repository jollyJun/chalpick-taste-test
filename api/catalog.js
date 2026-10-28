import { handleCatalog } from '../server/catalog.mjs';

export const GET = request => handleCatalog(request);

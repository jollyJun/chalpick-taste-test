import { handleRecommendations } from '../server/recommendations.mjs';

export const GET = request => handleRecommendations(request);

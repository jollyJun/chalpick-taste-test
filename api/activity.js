import { handleActivity } from '../server/activity.mjs';

export const GET = request => handleActivity(request);
export const POST = request => handleActivity(request);

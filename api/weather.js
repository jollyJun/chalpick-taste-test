import { handleWeather } from '../server/weather.mjs';

export const GET = request => handleWeather(request);

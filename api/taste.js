import {handleTaste} from '../server/taste.mjs';
export const GET=request=>handleTaste(request);
export const POST=request=>handleTaste(request);

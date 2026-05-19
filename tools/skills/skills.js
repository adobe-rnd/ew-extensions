import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { initAuth } from '../../apps/skills/utils/da-fetch.js';
import '../../apps/skills/nx-skills-editor.js';

const { token } = await DA_SDK;
initAuth(token);

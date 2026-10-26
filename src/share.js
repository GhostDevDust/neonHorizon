// Share clip (ghostdevdust.com/share/gdd-share.js): keeps the last ~24 s of the flat-screen view so
// a player can save it or post it to their TikTok. Killing the sun and the end of a run suggest the
// caption. Loaded from the site so every game shares one copy; ?sharebase=<url> points it somewhere
// else for testing. VR frames never reach the page canvas, so index.html hides the button in VR.
import { audioStream } from './audio.js';
import { MODES } from './config.js';

const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const BASE = new URLSearchParams(location.search).get('sharebase') || (local ? 'http://localhost:8811/share/' : 'https://ghostdevdust.com/share/');

let share = null;
let suns = 0;   // suns blown up this run, for the end-of-run caption

export async function setupShare(canvas, { onOpen, onClose } = {}) {
  try {
    ({ GDDShare: share } = await import(BASE + 'gdd-share.js'));
  } catch {
    return; // no share button if the site can't be reached; the game doesn't care
  }
  if (!share.supported()) return;
  share.init({
    game: 'Neon Horizon',
    canvas,
    caption: 'Neon Horizon',
    hashtags: '#indiegame #synthwave #arcade #gamedev',
    // the AudioContext only exists after the first click or key, so this asks again each time
    audioStream: () => audioStream(),
    onOpen,
    onClose,
  });
}

export function shareRunStart() {
  suns = 0;
}

// The sun went supernova: that's the suggested caption
export function shareSun() {
  suns++;
  share?.moment(suns > 1 ? `Blew up the sun ${suns} times in one run of Neon Horizon` : 'Blew up the sun in Neon Horizon');
}

// The run is over: the score, and the sun if it went down
export function shareRunOver(score, seconds, mode) {
  if (!share || score <= 0) return;
  const sun = suns ? ` and blew up the sun${suns > 1 ? ` ${suns} times` : ''}` : '';
  const label = MODES[mode] ? ` on ${MODES[mode].label[0]}${MODES[mode].label.slice(1).toLowerCase()}` : '';
  share.moment(`Scored ${score.toLocaleString('en-US')}${sun} in Neon Horizon${label} (${Math.floor(seconds)} s)`);
}

import './style.css'
import playlist from './playlist.json'
import { setupShaderCanvas } from './shader.js'

const STREAM_BASE_URL = import.meta.env.VITE_STREAM_BASE_URL

document.querySelector('#app').innerHTML = `
<div id="tv">
  <video id="player" autoplay disablepictureinpicture disableremoteplayback crossorigin="anonymous"></video>
  <p id="unmute-hint" hidden>No sound - click anywhere to enable volume</p>
</div>
`

const video = document.querySelector('#player')
const tv = document.querySelector('#tv')
const unmuteHint = document.querySelector('#unmute-hint')

setupShaderCanvas(video, tv)

const PROGRESS_KEY = 'jttw:progress'

function loadProgress() {
  try {
    const { index, time } = JSON.parse(localStorage.getItem(PROGRESS_KEY))
    if (Number.isInteger(index) && index >= 0 && index < playlist.length && typeof time === 'number') {
      return { index, time }
    }
  } catch {
    // no saved progress, or it's corrupt/from an old format - start fresh
  }
  return { index: 0, time: 0 }
}

function saveProgress(i, time) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ index: i, time }))
  } catch {
    // localStorage unavailable (private browsing, quota) - resume just won't work
  }
}

let index = 0

function attemptPlay() {
  video.play().catch(() => {
    console.log('browser blocked autopay with volume??')
    // Browser blocked unmuted autoplay (no media engagement with this site
    // yet) - fall back to muted autoplay, then unmute on first interaction.
    video.muted = true
    video.play()
    tv.style.cursor = 'pointer'
    unmuteHint.hidden = false
  })
}

function playEpisode(i, startAt = 0) {
  index = i
  const episode = playlist[i]
  video.src = `${STREAM_BASE_URL}/${encodeURIComponent(episode.filename)}`
  if (startAt > 0) {
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = startAt
      attemptPlay()
    }, { once: true })
  } else {
    attemptPlay()
  }
}

document.addEventListener('click', () => {
  video.muted = false
  tv.style.cursor = ''
  unmuteHint.hidden = true
}, { once: true })

// Channel-style playback: no controls, no seeking/pausing, just play
// through the playlist in order and loop back to episode 1 at the end.
video.addEventListener('ended', () => {
  saveProgress((index + 1) % playlist.length, 0)
  playEpisode((index + 1) % playlist.length)
})
video.addEventListener('contextmenu', (e) => e.preventDefault())

// Periodically checkpoint progress rather than relying solely on
// beforeunload/pagehide, which don't reliably fire on mobile browsers.
let lastSaved = 0
video.addEventListener('timeupdate', () => {
  const now = Date.now()
  if (now - lastSaved > 5 * 60 * 1000) {
    lastSaved = now
    saveProgress(index, video.currentTime)
  }
})
window.addEventListener('pagehide', () => saveProgress(index, video.currentTime))

const resume = loadProgress()
playEpisode(resume.index, resume.time)

# Karaoke Pitch Control Chrome Extension - PRD

## Overview

A Chrome extension that provides real-time pitch shifting for YouTube videos embedded in the jam-bag karaoke application. The extension enables singers to practice songs in different keys by shifting the pitch without affecting tempo.

## Problem Statement

YouTube's IFrame Player API does not expose audio manipulation capabilities. Singers practicing with karaoke videos often need to adjust the key to match their vocal range. Without pitch control, users must find alternate versions of songs or struggle with keys that don't suit their voice.

## Target Users

- **Primary**: Singers practicing songs in comfortable keys
- **Use case**: Load a YouTube karaoke video, shift pitch to match vocal range, practice singing

## Functional Requirements

### Core Features

#### 1. Pitch Shifting
- **Range**: -12 to +12 semitones (one octave each direction)
- **Granularity**: Whole semitones only (no cents)
- **Tempo preservation**: Pitch changes without affecting playback speed
- **Quality**: High-quality FFT-based pitch shifting (SoundTouchJS)
- **Algorithm**: SoundTouchJS library for battle-tested, quality results

#### 2. Speed Control
- **Range**: 0.5x to 2.0x playback speed
- **Presets**: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x
- **Independence**: Speed and pitch are independent controls
- **Replaces YouTube controls**: Hide native YouTube speed controls to prevent desync

#### 3. Per-Video Settings Persistence
- **Storage**: Chrome local storage (device-only, no sync)
- **Key**: YouTube video ID
- **Data**: Pitch value and speed value per video
- **Restoration**: Automatically restore settings when returning to a previously played video

#### 4. Extension Popup UI
- **Controls**: Pitch slider + Speed selector (matching popup in controls-card.tsx)
- **Style**: Match jam-bag visual design (colors, fonts, dark mode)
- **Badge**: Show current semitone value on extension icon when pitch ≠ 0
- **Responsive**: Works at standard popup dimensions (300-400px wide)

#### 5. Page Communication
- **Protocol**: Simple JSON via postMessage
- **Direction**: Page is source of truth; extension mirrors page state
- **Detection**: Extension responds to ping message from page
- **Activation**: Ready on page load (before video loads)

### Message Protocol

```typescript
// Page → Extension
{ type: 'PING' }                           // Check if extension installed
{ type: 'SET_PITCH', value: number }       // Set pitch (-12 to +12)
{ type: 'SET_SPEED', value: number }       // Set speed (0.5 to 2.0)
{ type: 'GET_STATE' }                      // Request current state

// Extension → Page
{ type: 'PONG', version: string }          // Extension is installed
{ type: 'STATE', pitch: number, speed: number, videoId: string | null }
{ type: 'ERROR', message: string }         // Something went wrong
```

### Error Handling
- **Failure behavior**: Disable pitch shifting and notify user
- **Notification**: Show warning in popup and send ERROR message to page
- **Recovery**: User can manually reset or reload

## Non-Functional Requirements

### Performance
- **Latency**: Minimize audio processing delay (< 100ms perceived)
- **CPU**: Acceptable for modern devices; high-quality over low-latency
- **Memory**: Efficient buffer management in audio processing

### Compatibility
- **Browser**: Chrome only (Manifest V3)
- **Chrome version**: Latest stable + 2 previous major versions
- **YouTube embed**: Works with YouTube IFrame API embeds

### Security & Privacy

#### Permissions (Minimal)
```json
{
  "permissions": ["storage"],
  "host_permissions": ["http://localhost:*/*"]
}
```
> **Production migration**: Replace `localhost:*` with production domain

#### Privacy Commitments
- **No external network requests**: All processing is local
- **No analytics or tracking**: Zero data collection
- **No browsing history access**: Only activates on jam-bag domain
- **Transparent storage**: Only stores pitch/speed per video ID
- **Open source**: Code is reviewable

#### Security Measures
- Content Security Policy in manifest
- No `eval()` or dynamic code execution
- Message validation (check origin, validate types)
- `externally_connectable` restricts messaging to jam-bag domain only

### Distribution
- **Target**: Chrome Web Store (unlisted)
- **Visibility**: Not discoverable via search; direct link only
- **Updates**: Manual version bumps, standard Chrome auto-update

## Technical Architecture

### Extension Structure

```
karaoke-pitch-extension/
├── manifest.json           # Extension configuration
├── src/
│   ├── content/
│   │   ├── index.ts        # Content script entry
│   │   ├── audio-processor.ts  # SoundTouchJS integration
│   │   └── message-handler.ts  # Page ↔ extension communication
│   ├── popup/
│   │   ├── popup.html      # Popup markup
│   │   ├── popup.ts        # Popup logic
│   │   └── popup.css       # Styles matching jam-bag
│   ├── background/
│   │   └── service-worker.ts  # Badge updates, storage management
│   └── shared/
│       ├── types.ts        # Shared TypeScript types
│       └── constants.ts    # Pitch range, speed presets, etc.
├── assets/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── package.json
├── tsconfig.json
└── README.md
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  jam-bag Karaoke Page                                           │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ controls-card.tsx                                          │ │
│  │  - User adjusts pitch/speed                                │ │
│  │  - Sends postMessage to extension                          │ │
│  │  - Receives state updates from extension                   │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │ postMessage
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Content Script (message-handler.ts)                            │
│  - Validates messages from page                                 │
│  - Routes commands to audio processor                           │
│  - Sends state updates back to page                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Audio Processor (audio-processor.ts)                           │
│  - Captures audio from YouTube <video> element                  │
│  - Creates AudioContext + MediaElementSource                    │
│  - Applies SoundTouchJS pitch shifting                          │
│  - Outputs to speakers                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Background Service Worker                                      │
│  - Updates badge with current pitch value                       │
│  - Manages chrome.storage for per-video settings                │
│  - Handles popup ↔ content script communication                 │
└─────────────────────────────────────────────────────────────────┘
```

### Audio Processing Pipeline

```
YouTube <video> element
        │
        ▼
MediaElementAudioSourceNode
        │
        ▼
SoundTouch ScriptProcessorNode / AudioWorklet
  - Pitch shift (semitones → ratio)
  - Tempo adjustment for speed
        │
        ▼
GainNode (optional volume control)
        │
        ▼
AudioContext.destination (speakers)
```

### Key Technical Decisions

1. **SoundTouchJS over Tone.js**: SoundTouchJS is purpose-built for pitch/tempo manipulation with better quality for this use case. Tone.js PitchShift has latency issues.

2. **Content Script for audio**: Must run in page context to access the YouTube video element's audio stream.

3. **Page as source of truth**: Simplifies sync logic. Extension popup queries content script, which queries page state.

4. **Chrome local storage**: Faster than sync storage, sufficient since we don't need cross-device sync.

## UI/UX Specifications

### Extension Popup

```
┌─────────────────────────────────┐
│  Karaoke Pitch Control          │
├─────────────────────────────────┤
│                                 │
│  Pitch                    0 st  │
│  [-] ═══════════●═══════ [+]   │
│                                 │
│  Speed                          │
│  [0.5x][0.75x][1x][1.25x][1.5x] │
│                                 │
│  ─────────────────────────────  │
│  Video: dQw4w9WgXcQ             │
│  Status: ● Connected            │
│                                 │
└─────────────────────────────────┘
```

- **Pitch slider**: Horizontal slider with -/+ buttons, shows current value
- **Speed buttons**: Toggle group matching controls-card.tsx design
- **Status indicator**: Shows connection state to jam-bag page
- **Video ID**: Shows current video for context

### Badge States

| State | Badge | Icon |
|-------|-------|------|
| Pitch = 0 | (none) | Normal |
| Pitch > 0 | "+3" | Normal |
| Pitch < 0 | "-2" | Normal |
| Error | "!" | Grayed |
| Not on jam-bag | (none) | Grayed |

### Visual Design

- Match jam-bag color scheme (CSS variables)
- Support dark mode (follows system preference)
- Use same font stack as jam-bag
- Consistent spacing and border radius

## Integration with jam-bag

### Changes to controls-card.tsx

```typescript
// Add extension detection
const [extensionInstalled, setExtensionInstalled] = useState(false)

useEffect(() => {
  // Ping extension on mount
  window.postMessage({ type: 'PING' }, '*')

  const handleMessage = (event: MessageEvent) => {
    if (event.data?.type === 'PONG') {
      setExtensionInstalled(true)
    }
  }

  window.addEventListener('message', handleMessage)
  return () => window.removeEventListener('message', handleMessage)
}, [])

// Enable pitch controls when extension is detected
// Send pitch changes via postMessage
```

### Changes to player-card.tsx

```typescript
// Extract and expose video ID for extension
// Listen for state updates from extension
```

## Acceptance Criteria

### Must Have (MVP)
- [ ] Extension installs and activates on localhost jam-bag page
- [ ] Pitch slider shifts audio -12 to +12 semitones
- [ ] Speed control changes playback rate 0.5x to 2x
- [ ] Tempo is preserved when pitch changes
- [ ] Settings persist per video ID
- [ ] Page can detect extension via PING/PONG
- [ ] Page can control extension via SET_PITCH/SET_SPEED
- [ ] Extension popup shows current pitch/speed
- [ ] Badge shows current pitch value

### Should Have
- [ ] Popup matches jam-bag visual design
- [ ] Graceful error handling with user notification
- [ ] YouTube native speed controls hidden

### Nice to Have
- [ ] Smooth pitch transitions (no clicks/pops)
- [ ] Keyboard shortcuts in popup

## Known Limitations

1. **YouTube restrictions**: Some videos may have audio restrictions that prevent capture
2. **Cross-origin**: Extension can only process audio from videos that allow it
3. **Mobile**: Chrome extensions don't work on mobile Chrome
4. **Safari/Firefox**: Not supported (Chrome only)
5. **Ads**: YouTube ads may cause audio processing to reset

## Future Considerations

These are explicitly out of scope for v1 but documented for future reference:

- Loop section (A-B repeat)
- Vocal removal/isolation
- Audio export
- Multiple device sync
- Firefox support (Manifest V2)

## Development Setup

### Prerequisites
- Node.js 18+
- pnpm (recommended) or npm
- Chrome browser

### Local Development
```bash
# Clone the repo
git clone <extension-repo-url>
cd karaoke-pitch-extension

# Install dependencies
pnpm install

# Build extension
pnpm build

# Load in Chrome
# 1. Navigate to chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the dist/ folder
```

### Testing Workflow
1. Start jam-bag dev server (`pnpm dev`)
2. Load extension in Chrome
3. Navigate to localhost karaoke page
4. Load a YouTube video
5. Adjust pitch/speed in either popup or page
6. Verify audio changes and sync

## Resources

- [SoundTouchJS](https://github.com/AdrianMargel/SoundTouchJS) - Pitch shifting library
- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Chrome Web Store Publishing](https://developer.chrome.com/docs/webstore/publish/)

---

*Document version: 1.0*
*Created: 2026-02-05*
*Status: Ready for implementation*

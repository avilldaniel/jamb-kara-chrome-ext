import { useState, useEffect } from 'react';
import type { ExtensionState } from '../../utils/types';
import { SEMITONES_MIN, SEMITONES_MAX } from '../../utils/constants';
import './App.css';

function sendMessage(message: any): Promise<any> {
  return chrome.runtime.sendMessage(message);
}

function App() {
  const [state, setState] = useState<ExtensionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sendMessage({ action: 'GET_STATE' }).then((resp) => {
      if (resp?.type === 'STATE') setState(resp.state);
    });
  }, []);

  async function handlePitch(semitones: number) {
    setState((s) => (s ? { ...s, pitchSemitones: semitones } : s));
    const resp = await sendMessage({ action: 'SET_PITCH', semitones });
    if (resp?.type === 'STATE') setState(resp.state);
    if (resp?.type === 'ERROR') setError(resp.message);
  }

  if (!state) return <div className="popup">Loading...</div>;

  return (
    <div className="popup">
      <h1>Pitch Shift</h1>

      <div className={`status ${state.isActive ? 'active' : ''}`}>
        {state.isActive ? 'Active' : 'Waiting for YouTube'}
      </div>

      <div className="control">
        <label>
          Pitch: <strong>{state.pitchSemitones > 0 ? '+' : ''}{state.pitchSemitones}</strong> semitones
          {state.pitchSemitones !== 0 && state.currentVideoId && (
            <span className="saved-indicator" title="Saved for this video"> saved</span>
          )}
        </label>
        <div className="pitch-row">
          <button
            className="step-btn"
            onClick={() => handlePitch(Math.max(SEMITONES_MIN, state.pitchSemitones - 1))}
            disabled={state.pitchSemitones <= SEMITONES_MIN}
          >-</button>
          <input
            type="range"
            min={SEMITONES_MIN}
            max={SEMITONES_MAX}
            step={1}
            value={state.pitchSemitones}
            onChange={(e) => handlePitch(Number(e.target.value))}
          />
          <button
            className="step-btn"
            onClick={() => handlePitch(Math.min(SEMITONES_MAX, state.pitchSemitones + 1))}
            disabled={state.pitchSemitones >= SEMITONES_MAX}
          >+</button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default App;

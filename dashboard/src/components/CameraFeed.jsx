// Annotated webcam stream served by ai/vision/vision.py on the command-center laptop.
import { useState } from 'react'

const STREAM = 'http://127.0.0.1:8081/stream.mjpg'

export default function CameraFeed() {
  const [failed, setFailed] = useState(false)
  const [key, setKey] = useState(0)
  return (
    <section className="panel camera" aria-label="Camera">
      <header className="panel-head"><h2>Gate camera</h2></header>
      {failed ? (
        <div className="camera-off">
          <p>No camera stream. Start the vision script on this laptop, then reconnect.</p>
          <code>python ai/vision/vision.py</code>
          <button className="btn" onClick={() => { setFailed(false); setKey((k) => k + 1) }}>Reconnect</button>
        </div>
      ) : (
        <img key={key} src={`${STREAM}?k=${key}`} alt="Live gate camera with detections" onError={() => setFailed(true)} />
      )}
    </section>
  )
}

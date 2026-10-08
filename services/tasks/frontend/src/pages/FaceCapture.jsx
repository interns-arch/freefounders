import { useCallback, useEffect, useRef, useState } from 'react'
import { describeFace, isSupported, loadFace } from '../face'

/* A still from the camera as a JPEG data URL, at most 640 px wide. */
function grabPhoto(video) {
  const scale = Math.min(1, 640 / (video.videoWidth || 640))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round((video.videoWidth || 640) * scale)
  canvas.height = Math.round((video.videoHeight || 480) * scale)
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.7)
}

/* Camera modal used for check-in/out and admin enrolment.
   face: read the face and pass its 128-number signature (never an image).
   photo: also take a picture (the company keeps a photo of every punch, PLAN.md §16.4).
   Calls onCapture(descriptor | null, photo | null). */
export default function FaceCapture({ title = 'Face verification', action = 'Capture',
                                      hint, onCapture, onClose, face = true, photo = false }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [status, setStatus] = useState('Starting camera…')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!isSupported()) {
        setErr('This device or browser has no camera access. Use a phone or a laptop with a webcam, over HTTPS.')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        if (face) {
          setStatus('Loading face models…')
          await loadFace(setStatus)
        }
        if (cancelled) return
        setReady(true)
        setStatus('Look straight at the camera')
      } catch (ex) {
        const name = ex?.name || ''
        if (name === 'NotAllowedError') setErr('Camera permission was denied. Allow camera access in your browser settings and try again.')
        else if (name === 'NotFoundError') setErr('No camera found on this device.')
        else setErr(ex.message || 'Could not start the camera.')
      }
    })()
    return () => { cancelled = true; stop() }
  }, [stop, face])

  const capture = async () => {
    setErr(''); setBusy(true); setStatus(face ? 'Reading your face…' : 'Taking the photo…')
    try {
      const picture = photo ? grabPhoto(videoRef.current) : null
      const descriptor = face ? await describeFace(videoRef.current) : null
      stop()
      onCapture(descriptor, picture)
    } catch (ex) {
      setErr(ex.message)
      setStatus('Try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={e => { if (e.target === e.currentTarget) { stop(); onClose() } }}>
      <div className="modal-card face-card">
        <h2>{title}</h2>
        {hint && <p className="muted small">{hint}</p>}
        <div className="face-frame">
          <video ref={videoRef} playsInline muted autoPlay />
          <div className="face-oval" />
        </div>
        {err ? <div className="err">{err}</div> : <p className="muted small">{status}</p>}
        <p className="muted small">
          {photo
            ? 'A photo is saved with your attendance. Only you and the people who manage attendance can see it.'
            : 'Only a numeric face signature is sent — your photo never leaves this device.'}
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={() => { stop(); onClose() }}>Cancel</button>
          <button className="btn btn-primary" disabled={!ready || busy} onClick={capture}>
            {busy ? 'Checking…' : action}
          </button>
        </div>
      </div>
    </div>
  )
}

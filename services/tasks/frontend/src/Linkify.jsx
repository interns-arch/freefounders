/* Text with its web addresses turned into tappable links -- so a notice
   that says "download the app: http://..." can simply be tapped. Only
   http(s) and www. addresses become links; everything else stays text. */
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi

export default function Linkify({ text }) {
  if (!text) return null
  const parts = String(text).split(URL_RE)
  return parts.map((part, i) => {
    if (i % 2 === 0) return part
    const href = part.startsWith('www.') ? `http://${part}` : part
    return (
      <a key={i} href={href} target="_blank" rel="noreferrer" className="text-link"
        onClick={e => e.stopPropagation()}>{part}</a>
    )
  })
}

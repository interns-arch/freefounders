/**
 * A link target built from data people typed or uploaded (custom fields, saved links, attachments, external task
 * links): only web addresses (http/https), e-mail, phone and same-site paths become links. Anything else
 * (`javascript:`, `data:`, `vbscript:`, `file:`, protocol-relative `//host`) gives no link at all.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (typeof url !== 'string') return undefined;
  const v = url.trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(v)) return v;
  if (v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\')) return v;
  return undefined;
}

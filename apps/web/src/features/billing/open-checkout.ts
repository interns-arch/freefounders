import { useNavigate } from 'react-router';

/** Opens the payment page the server named: our own pages in-app, anything else as a full page. */
export function useOpenCheckout() {
  const navigate = useNavigate();
  return (url: string) => {
    try {
      const u = new URL(url, window.location.origin);
      if (u.origin === window.location.origin) return navigate(u.pathname + u.search);
    } catch {
      /* not a URL: fall through */
    }
    window.location.assign(url);
  };
}

import { useState } from "react";

const COOKIE_NAME = "cookie-policy-shown";

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

export function CookieSplash({ onDismiss }: { onDismiss: () => void }) {
  const [fading, setFading] = useState(false);

  const accept = () => {
    setCookie(COOKIE_NAME, "yes", 365);
    setFading(true);
    setTimeout(onDismiss, 300);
  };

  const decline = () => {
    setFading(true);
    setTimeout(onDismiss, 300);
  };

  return (
    <div className={`cookie-splash${fading ? " cookie-fade" : ""}`} role="dialog" aria-modal="true" aria-labelledby="cookie-title">
      <div className="cookie-card">
        <h2 id="cookie-title">One Cookie, That Is All</h2>
        <div className="cookie-poem">
          <p>
            We do not track you here or there,<br />
            we do not track you anywhere.<br />
            No ads, no scripts that phone back home,<br />
            your photos never leave your Chrome.
          </p>
          <p>
            We use one cookie, small and plain,<br />
            to remember you have read this pane.<br />
            Its name is <code>cookie-policy-shown</code> —<br />
            that single crumb is all we own.
          </p>
          <p>
            No data sold, no sneaky trick,<br />
            just one small flag: a single click<br />
            and you'll not see this page once more.<br />
            Now go! Make things! That's what tools are for.
          </p>
        </div>
        <button className="cookie-btn" onClick={accept}>
          I do accept this cookie small — now show me Maker Tools!
        </button>
        <button className="cookie-decline" onClick={decline}>
          No thanks, I enjoy the poem
        </button>
      </div>
    </div>
  );
}

/** Returns true if the cookie-policy splash has already been acknowledged. */
export function cookiePolicyShown(): boolean {
  return getCookie(COOKIE_NAME) === "yes";
}

export default function SiteFooter() {
  return (
    <footer className="siteFooter shell">
      <a
        className="designerCredit"
        href="https://koraycifci.com"
        target="_blank"
        rel="noreferrer"
        aria-label="Designed by Koray Cifci"
      >
        <span>Designed by</span>
        <img src="/brand/koray-logo.svg" alt="Koray Cifci" />
      </a>

      <div className="footerCenterLinks">
        <a className="liveActivityLink" href="/live" aria-label="Open live Technocore activity proof">
          <span>Live activity</span>
        </a>
        <a className="messagesLink" href="/messages" aria-label="Open agent messages">
          <span>Messages</span>
        </a>
      </div>

      <a
        className="githubCredit"
        href="https://github.com/dharmanan/technocore-agent-console"
        target="_blank"
        rel="noreferrer"
        aria-label="Technocore Agent Console source on GitHub"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.17c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.78 1.19 1.78 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.29-5.27-5.73 0-1.27.45-2.3 1.19-3.11-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.16 1.19A11 11 0 0 1 12 6.1c.98 0 1.95.13 2.87.38 2.19-1.5 3.15-1.19 3.15-1.19.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.11 0 4.45-2.71 5.43-5.29 5.72.42.36.79 1.07.79 2.15v3.22c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z" />
        </svg>
        <span>Source on GitHub ↗</span>
      </a>
    </footer>
  );
}

# Shared resource resolver

This module enriches URLs pasted in chat messages with best-effort metadata.

Supported provider detection:

- OneDrive: `1drv.ms`, `onedrive.live.com`
- SharePoint: `*.sharepoint.com`
- Google Drive: `drive.google.com`, `docs.google.com`
- Dropbox: `dropbox.com`, `dropboxusercontent.com`
- Direct URLs when the path contains a filename extension
- Unknown providers with the same SSRF checks and generic HTTP metadata

Resolution strategy:

1. Detect HTTPS URLs in text.
2. Validate the URL and every redirect against SSRF rules.
3. Try `HEAD`.
4. Fall back to a limited `GET` when headers are insufficient.
5. Read `Content-Disposition`, `Content-Type`, small HTML metadata and safe URL hints.
6. Normalize provider, name, extension, MIME, resource type, source and confidence.

Security:

- Only `https:` URLs are resolved.
- Localhost, private IPs, link-local ranges and cloud metadata IPs are rejected.
- DNS targets are validated before requests.
- Redirects are followed manually and each destination is validated again.
- Timeouts, redirect limits and HTML byte limits are enforced.
- User cookies and authorization headers are never forwarded.

Adding a provider:

Add host detection in `url.js`, then extend `resolveByHttp` or route to a provider-specific resolver in `resolver.js`. Provider APIs such as Microsoft Graph should return the same normalized metadata shape and must not hardcode file names.

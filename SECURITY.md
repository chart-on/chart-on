# Security policy

## Supported versions

charton is pre-1.0. Only the latest minor release gets security fixes. A fix ships as a patch release of that minor; older minors are not updated.

| Version | Security fixes |
| --- | --- |
| Latest `0.x` minor | Yes |
| Older `0.x` minors | No: upgrade to the latest minor |

From 1.0, the latest major gets fixes, and the previous major gets them for six months after the next major ships.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a vulnerability.**

Report it privately through the repository's private vulnerability reporting: open the **Security** tab and choose **Report a vulnerability**, or go straight to [the new advisory form](https://github.com/chart-on/charton/security/advisories/new). Only the maintainers can see the report.

A useful report includes:

- the affected package (`@charton/core`, `@charton/ui`, `@charton/ta`, `@charton/indicators`, `@charton/locales`, `@charton/react`, `@charton/vue`, `@charton/svelte`) and version;
- what an attacker controls (data from a data source, drawing text, a saved layout, options) and what they can achieve;
- steps or a minimal page that reproduces it, with the browser and OS;
- any fix or mitigation you have in mind.

## What to expect

| Step | Target |
| --- | --- |
| Acknowledge the report | Within 3 working days |
| Confirm or rule out the issue, with a first severity assessment | Within 10 working days |
| Fix released for a confirmed high or critical issue | Within 30 days of confirmation |
| Fix released for a confirmed low or moderate issue | In the next regular release |

These are targets, not guarantees: the project is run by volunteers. We keep you updated in the advisory thread, agree a disclosure date with you, and credit you in the advisory unless you prefer not to be named. Please give us a reasonable chance to release a fix before disclosing publicly.

## What counts

charton runs in the browser, inside the page that embeds it. It does not handle credentials, store data on a server, or make network requests of its own. In scope are flaws in the library that let untrusted input do something the embedding page did not intend, for example:

- **Script or markup injection:** text from a data source, a symbol list, drawing text, labels, legends or a saved layout ending up parsed as HTML or executed. The library builds every element with DOM calls and sets text with `textContent` or draws it on a canvas; any path that breaks this is a vulnerability.
- **Unsafe deserialization:** a crafted saved layout or drawing state that pollutes prototypes, calls unexpected code, or crashes the page in a way that persists across reloads.
- **Resource exhaustion from data:** input that makes the chart allocate without bound, hang the main thread, or exhaust GPU memory, beyond what the documented [limits](docs/guide/performance.md) describe.
- **WebGL misuse:** data that drives buffer or texture uploads out of bounds, or shader inputs that read memory they should not. Browsers sandbox WebGL, so report anything that gets past the library's own size and bounds checks.
- **Requests the library makes on its own**, or a way to make the built-in REST or WebSocket adapters call a URL the embedding app did not give them.

Out of scope:

- HTML or code that the embedding app itself passes to its own DOM, including content an app puts in a custom renderer or a plugin it installs. Plugins and custom drawing tools run with the page's full privileges, by design.
- Vulnerabilities in browsers, GPU drivers or the demo's synthetic data.
- Missing hardening headers on the documentation site, unless they lead to a concrete attack.

See [Security and strict pages](docs/guide/security.md) for how the library behaves under a strict content security policy and Trusted Types.

## Using charton safely

- Treat data from a data source, symbol lists and saved layouts as untrusted. Validate saved layouts from other users before restoring them.
- Show third-party text, such as drawing text from shared layouts, through the chart's own text APIs. Do not copy it into `innerHTML` in your own UI.
- Review a plugin before you install it: it runs as part of your page.

# Vercel Toolbar removal

## Inspection

No `@vercel/toolbar` dependency, Toolbar component, `vercel.live` script, or toolbar injection was found in application source, package manifests, the HTML entry, or `vercel.json`. Application toolbars for maps, records, and certificates are unrelated and remain unchanged.

## Configuration change

On November 6, 2026, Vercel accepted a project settings update for `lguhinunanganswineregistry` (`prj_kCOL4Ayv8ymN7S4zZO2csOpLXfn8`), linked to `Peter2-lang/finalnamongacaptone`:

```json
{
  "enablePreviewFeedback": false,
  "enableProductionFeedback": false
}
```

Only these two settings were submitted. No deployment, hosting, analytics, environment-variable, protection, or application changes were requested.

The Dashboard equivalent is **Project → Settings → General → Vercel Toolbar → Production: Off; Preview: Off**. Select Off explicitly rather than inheriting the team default. Official instructions: https://vercel.com/docs/vercel-toolbar/managing-toolbar#enable-or-disable-the-toolbar-project-wide

## Verification

A fresh HTTPS request to `https://lguhinunanganswineregistry.vercel.app` succeeded. Its HTML contains no `vercel.live`, `@vercel/toolbar`, or `vercel-live-feedback` injection. The project tool returns a reduced settings response without the feedback flags, so independent flag readback was unavailable.

A fresh headless Chromium visit returned HTTP 200 with the title `DA Hinunangan Swine Registry`. After ten seconds, there were zero toolbar network requests and zero matching toolbar elements or Vercel feedback iframes. This verifies the public production page in a clean browser; authenticated preview sessions and browser extensions were not exercised.

For a browser that already had the toolbar open, reload the page in a new tab. A browser extension can also be checked in a fresh profile without extensions.

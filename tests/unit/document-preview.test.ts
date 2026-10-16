import { describe, it, expect } from "vitest";
import { sanitizeDocumentHtml } from "@/lib/documents/preview";

/** Word previews are rendered inside the app, so the converted HTML must not be able to script it. */
describe("Word preview sanitizing", () => {
  it("keeps document structure", () => {
    const html = "<h1>Titre</h1><p><strong>Gras</strong> et <em>italique</em></p><ul><li>un</li></ul><table><tr><td colspan=\"2\">x</td></tr></table>";
    const out = sanitizeDocumentHtml(html);
    expect(out).toContain("<h1>Titre</h1>");
    expect(out).toContain("<strong>Gras</strong>");
    expect(out).toContain("<li>un</li>");
    expect(out).toContain('<td colspan="2">x</td>');
  });

  it("removes scripts, handlers, styles and javascript: links", () => {
    const out = sanitizeDocumentHtml(
      '<p onclick="alert(1)" style="color:red">t</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><iframe src="https://evil"></iframe>',
    );
    expect(out).not.toMatch(/onclick|style=|<script|javascript:|<iframe/i);
    expect(out).toContain("<p>t</p>");
  });

  it("opens links in a new tab without referrer", () => {
    expect(sanitizeDocumentHtml('<a href="https://example.com">e</a>')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">e</a>',
    );
  });

  it("drops empty bookmark anchors", () => {
    expect(sanitizeDocumentHtml('<h3><a id="_Toc1"></a>Titre</h3>')).toBe("<h3>Titre</h3>");
  });

  it("keeps embedded pictures but drops remote and non-image ones", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(sanitizeDocumentHtml(`<img src="${png}" alt="fig">`)).toContain(`src="${png}"`);
    expect(sanitizeDocumentHtml('<img src="https://tracker.example/p.gif">')).not.toContain("<img");
    expect(sanitizeDocumentHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">')).not.toContain("<img");
  });
});

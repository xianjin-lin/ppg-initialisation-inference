/* AUTHOR-MAINTAINED SITE SETTINGS (see docs/MAINTENANCE.md in the local handoff).
 * - status: shown in the header badge, hero and citation. Keep neutral until the author confirms a venue.
 * - links: leave null until a public, author-approved URL exists. Only https:// URLs are rendered; null => no button.
 *   Do not point these to the first paper's repository or site.
 * Title, authors and affiliations are written directly in index.html (copied from the v3 main.tex front matter).
 */
window.P2 = window.P2 || {};
window.P2.config = {
  status: "Manuscript in preparation",
  links: {
    paper: null,      // label "Paper"    e.g. "https://doi.org/..." once published
    preprint: null,   // label "Preprint"
    code: null,       // label "Code"
    data: null        // label "Data"
  }
};

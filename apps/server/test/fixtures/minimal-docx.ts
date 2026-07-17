import { crc32 } from "node:zlib";
import mammoth from "mammoth";

// Builds a real, minimal, valid .docx byte fixture for tests - no zip dependency.
// A .docx is an OPC package: a ZIP of XML parts. We emit the three parts a reader
// needs (the content-types map, the package relationships pointing at the main
// document, and the document body itself) into a ZIP using the "stored" method (no
// compression), so the only algorithm required beyond Buffer writes is CRC-32, which
// Node's zlib provides. The `bodyText` lands as the document's single paragraph, so
// a test can seed a unique known string and assert mammoth's HTML carries it.

const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const PACKAGE_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const documentXml = (bodyText: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escapeXml(
    bodyText,
  )}</w:t></w:r></w:p></w:body></w:document>`;

type ZipEntry = { name: string; data: Buffer };

// Assembles the ZIP: one local file header + data per entry, then the central
// directory, then the end-of-central-directory record. All entries are stored (method
// 0), so compressed size equals uncompressed size.
const zipStored = (entries: ZipEntry[]): Buffer => {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf-8");
    const crc = crc32(entry.data) >>> 0;
    const size = entry.data.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed to extract
    localHeader.writeUInt16LE(0, 6); // general purpose bit flag
    localHeader.writeUInt16LE(0, 8); // compression method: stored
    localHeader.writeUInt16LE(0, 10); // last mod file time
    localHeader.writeUInt16LE(0, 12); // last mod file date
    localHeader.writeUInt32LE(crc, 14); // crc-32
    localHeader.writeUInt32LE(size, 18); // compressed size
    localHeader.writeUInt32LE(size, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26); // file name length
    localHeader.writeUInt16LE(0, 28); // extra field length

    localChunks.push(localHeader, nameBytes, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central file header signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed to extract
    centralHeader.writeUInt16LE(0, 8); // general purpose bit flag
    centralHeader.writeUInt16LE(0, 10); // compression method: stored
    centralHeader.writeUInt16LE(0, 12); // last mod file time
    centralHeader.writeUInt16LE(0, 14); // last mod file date
    centralHeader.writeUInt32LE(crc, 16); // crc-32
    centralHeader.writeUInt32LE(size, 20); // compressed size
    centralHeader.writeUInt32LE(size, 24); // uncompressed size
    centralHeader.writeUInt16LE(nameBytes.length, 28); // file name length
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(0, 38); // external file attributes
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header

    centralChunks.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const localSection = Buffer.concat(localChunks);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  end.writeUInt16LE(0, 4); // number of this disk
  end.writeUInt16LE(0, 6); // disk where central directory starts
  end.writeUInt16LE(entries.length, 8); // central dir records on this disk
  end.writeUInt16LE(entries.length, 10); // total central dir records
  end.writeUInt32LE(centralDirectory.length, 12); // size of central directory
  end.writeUInt32LE(localSection.length, 16); // offset of central directory
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localSection, centralDirectory, end]);
};

// Produces a deterministic, valid minimal .docx whose body is `bodyText`.
export const buildMinimalDocx = (bodyText: string): Buffer =>
  zipStored([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(CONTENT_TYPES_XML, "utf-8"),
    },
    { name: "_rels/.rels", data: Buffer.from(PACKAGE_RELS_XML, "utf-8") },
    {
      name: "word/document.xml",
      data: Buffer.from(documentXml(bodyText), "utf-8"),
    },
  ]);

// A richer counter-fixture .docx (issue #67, criterion 1): a document whose body exercises
// every construct the normalized review-text must handle DISTINCTLY - a styled heading, a
// plain paragraph, a paragraph split across three runs (one bold), a run of collapsible
// whitespace, and a two-cell table. mammoth converts these to `<h1>`, `<p>`, a `<strong>`
// split run, a preserved-whitespace `<p>`, and a `<table>` with `<td>` cells; flattening
// that with the block-aware HTML tokenizer joins the blocks and cells with boundaries (not
// merged) and keeps the runs contiguous within their paragraph. The sentinels below are
// unique and their order/whitespace discriminating, so a hard-coded or raw-XML flatten
// yields a different sequence and the paired server + mounted-DOM cases fail.
//
// The exact mammoth HTML this produces, and its normalized review-text, are the SINGLE
// physical source of truth in `canonical-rendered-head.json`: `canonical-html.spec.ts` pins
// real `convertCanonicalHtml` output byte-for-byte against that file, and the mounted-DOM
// test (ReviewSurfaceView.canonical.dom.test.tsx) loads the same file - so the two-sided
// criterion-1 pair rests on one artifact, not a hand copy that could drift.
const CONTENT_TYPES_WITH_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

// The main document's relationships: it references the styles part, so mammoth can resolve
// the `Heading1` style ID to the name `heading 1` and map it to `<h1>`.
const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`;

const RICH_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Zephyr canonical overview.</w:t></w:r></w:p><w:p><w:r><w:t>The Bandersnatch metric holds firm across revisions.</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Second paragraph </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>about canonical scope</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Spaced    canonical    words.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Alpha canonical cell.</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Beta canonical cell.</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;

export const buildRichCanonicalDocx = (): Buffer =>
  zipStored([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(CONTENT_TYPES_WITH_STYLES_XML, "utf-8"),
    },
    { name: "_rels/.rels", data: Buffer.from(PACKAGE_RELS_XML, "utf-8") },
    {
      name: "word/_rels/document.xml.rels",
      data: Buffer.from(DOCUMENT_RELS_XML, "utf-8"),
    },
    { name: "word/styles.xml", data: Buffer.from(STYLES_XML, "utf-8") },
    {
      name: "word/document.xml",
      data: Buffer.from(RICH_DOCUMENT_XML, "utf-8"),
    },
  ]);

// A .docx carrying a document-EMBEDDED mammoth style map that maps a custom CHARACTER style
// to a non-default block element (`fieldset`), inside a paragraph so the mapped run would sit
// INLINE between plain text (issue #67, item 2). It is the adversarial case for parity: were
// the embedded map applied, mammoth would emit `<p>Alpha ... <fieldset>Beta ...</fieldset>
// Gamma ...</p>` - a block tag the shared allowlist does NOT carry, mid-paragraph, which the
// trusted UN-sanitized Canonical DOM would mount and the two block-aware engines would treat
// differently. `convertCanonicalHtml` passes `includeEmbeddedStyleMap: false`, so mammoth
// IGNORES this map and emits only default-set (allowlisted) tags - the `<fieldset>` never
// appears, and the server review-text and the client extraction agree. The style map is
// embedded with mammoth's own `embedStyleMap`, so mammoth genuinely reads it (proving the
// suppression is real, not a fixture that simply omits the map).
const EMBEDDED_STYLE_MAP_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="character" w:styleId="CustomInline"><w:name w:val="Custom Inline"/></w:style></w:styles>`;

const EMBEDDED_STYLE_MAP_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">Alpha inline sentinel </w:t></w:r><w:r><w:rPr><w:rStyle w:val="CustomInline"/></w:rPr><w:t>Beta boxed sentinel</w:t></w:r><w:r><w:t xml:space="preserve"> Gamma inline sentinel.</w:t></w:r></w:p><w:p><w:r><w:t>Delta plain paragraph sentinel.</w:t></w:r></w:p></w:body></w:document>`;

// The style map targets the custom character style, mapping it to a `fieldset` element.
const EMBEDDED_STYLE_MAP = "r[style-name='Custom Inline'] => fieldset";

export const buildEmbeddedStyleMapDocx = async (): Promise<Buffer> => {
  const base = zipStored([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(CONTENT_TYPES_WITH_STYLES_XML, "utf-8"),
    },
    { name: "_rels/.rels", data: Buffer.from(PACKAGE_RELS_XML, "utf-8") },
    {
      name: "word/_rels/document.xml.rels",
      data: Buffer.from(DOCUMENT_RELS_XML, "utf-8"),
    },
    {
      name: "word/styles.xml",
      data: Buffer.from(EMBEDDED_STYLE_MAP_STYLES_XML, "utf-8"),
    },
    {
      name: "word/document.xml",
      data: Buffer.from(EMBEDDED_STYLE_MAP_DOCUMENT_XML, "utf-8"),
    },
  ]);
  const embedded = await mammoth.embedStyleMap(
    { buffer: base },
    EMBEDDED_STYLE_MAP,
  );
  return embedded.toBuffer();
};

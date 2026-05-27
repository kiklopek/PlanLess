/**
 * Extracts plain text from a .docx ArrayBuffer.
 * .docx files are ZIP archives; text lives in word/document.xml as <w:t> nodes.
 * Uses only native browser APIs — no external packages needed.
 */
export async function extractDocxText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const xml = await extractFileFromZip(bytes, 'word/document.xml');
  if (!xml) throw new Error('Nepodařilo se najít obsah dokumentu (.docx).');

  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const nodes = doc.getElementsByTagNameNS(ns, 't');
  const parts = [];
  for (let i = 0; i < nodes.length; i++) parts.push(nodes[i].textContent);
  return parts.join('');
}

async function extractFileFromZip(bytes, targetName) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  while (offset < bytes.length - 4) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;

    const method     = view.getUint16(offset + 8,  true);
    const compSize   = view.getUint32(offset + 18, true);
    const nameLen    = view.getUint16(offset + 26, true);
    const extraLen   = view.getUint16(offset + 28, true);
    const name       = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLen));
    const dataStart  = offset + 30 + nameLen + extraLen;
    const compressed = bytes.slice(dataStart, dataStart + compSize);

    if (name === targetName) {
      if (method === 0) return new TextDecoder().decode(compressed);
      if (method === 8) return inflate(compressed);
      throw new Error('Nepodporovaná komprese ZIP.');
    }
    offset = dataStart + compSize;
  }
  return null;
}

async function inflate(data) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  writer.write(data);
  writer.close();

  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return new TextDecoder().decode(out);
}

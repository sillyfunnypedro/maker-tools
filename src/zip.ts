// Minimal ZIP writer (store-only, no compression).
//
// The bundle is almost entirely PNG and JPEG, which are already compressed, so
// deflating them would cost CPU on a phone and save almost nothing. Keeps this
// to plain structure-writing with no dependency. ZIP32 only — fine for bundles
// well under 4 GB.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed date/time, which is what ZIP entries carry. */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31),
    date: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
  };
}

export interface ZipEntry {
  /** Path inside the archive; use forward slashes. */
  name: string;
  /** Buffer type is pinned so the bytes can go straight into a Blob. */
  data: Uint8Array<ArrayBuffer>;
}

/** Build a stored (uncompressed) ZIP archive. */
export function zipStore(entries: ZipEntry[], when = new Date()): Blob {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(when);
  const body: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header
    lv.setUint16(4, 20, true);         // version needed
    lv.setUint16(6, 0, true);          // flags
    lv.setUint16(8, 0, true);          // method 0 = store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);      // compressed
    lv.setUint32(22, size, true);      // uncompressed
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);         // extra length
    local.set(name, 30);
    body.push(local, e.data);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); // central directory header
    dv.setUint16(4, 20, true);         // version made by
    dv.setUint16(6, 20, true);         // version needed
    dv.setUint16(8, 0, true);          // flags
    dv.setUint16(10, 0, true);         // method
    dv.setUint16(12, time, true);
    dv.setUint16(14, date, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, size, true);
    dv.setUint32(24, size, true);
    dv.setUint16(28, name.length, true);
    dv.setUint16(30, 0, true);         // extra
    dv.setUint16(32, 0, true);         // comment
    dv.setUint16(34, 0, true);         // disk number start
    dv.setUint16(36, 0, true);         // internal attrs
    dv.setUint32(38, 0, true);         // external attrs
    dv.setUint32(42, offset, true);    // offset of local header
    dir.set(name, 46);
    central.push(dir);

    offset += local.length + size;
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);   // end of central directory
  ev.setUint16(4, 0, true);            // this disk
  ev.setUint16(6, 0, true);            // disk with central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);      // central directory offset
  ev.setUint16(20, 0, true);           // comment length
  return new Blob([...body, ...central, end], { type: "application/zip" });
}

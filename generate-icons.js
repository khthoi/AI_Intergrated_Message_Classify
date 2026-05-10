// Tạo PNG icon đơn giản bằng raw bytes (không cần thêm package)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(size) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk: width, height, bit depth=8, color type=2 (RGB)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // RGB
  ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;

  // Raw image data: each row starts with filter byte 0, then RGB pixels
  const rowSize = 1 + size * 3;
  const raw = Buffer.alloc(size * rowSize);
  for (let y = 0; y < size; y++) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0; // filter type None
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 3;
      // Blue background (#1877f2)
      raw[px] = 0x18;
      raw[px + 1] = 0x77;
      raw[px + 2] = 0xf2;
    }
  }

  const compressed = zlib.deflateSync(raw);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeB, data]);
    const crc = crc32(body);
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc >>> 0);
    return Buffer.concat([len, body, crcB]);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdrData),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// CRC32 table
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff);
}

const outDir = path.join(__dirname, 'extension', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const buf = createPNG(size);
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), buf);
  console.log(`Created icon${size}.png (${buf.length} bytes)`);
}
console.log('Done.');

/* ------------------------------------------------------------------ */
/* Pictures                                                            */
/* ------------------------------------------------------------------ */
const readURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
async function prepImage(file, maxSide = 3000) {
  const url = await readURL(file);
  if (/svg|gif/.test(file.type)) return url;
  return new Promise(res => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, maxSide / Math.max(im.width, im.height));
      if (k === 1 && file.size < 4e6) return res(url);                // keep the original for best print quality
      const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      const x = c.getContext('2d'), png = file.type === 'image/png';
      if (!png) { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
      x.drawImage(im, 0, 0, c.width, c.height);
      res(c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.92));
    };
    im.onerror = () => res(url); im.src = url;
  });
}
async function insertImageFile(file, pos) {
  const src = await prepImage(file);
  const node = { type: 'image', attrs: { src, wrap: 'wl' } };
  if (typeof pos === 'number') editor.chain().focus().insertContentAt(pos, node).run();
  else ch().insertContent(node).run();
}
$('#fileIn').addEventListener('change', async e => { const files = Array.from(e.target.files); e.target.value = ''; for (const f of files) await insertImageFile(f); });
function pickImage(maxSide, cb) {
  const inp = $('#pickIn');
  inp.onchange = async () => { const f = inp.files[0]; inp.value = ''; if (f) cb(await prepImage(f, maxSide)); };
  inp.click();
}


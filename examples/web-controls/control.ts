// App-authored HTML; browser JavaScript talks to Node through JSON messages.
export const controlHTML = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { color-scheme: light dark; font: 16px -apple-system, sans-serif; }
body { margin: 0; padding: 24px; background: transparent; }
.card { padding: 28px; border: 1px solid #8885; border-radius: 20px; background: #8881; }
h2 { margin: 0 0 8px; font-size: 24px; } p { opacity: .65; }
#swatch { height: 120px; border-radius: 14px; margin: 24px 0; transition: background .1s; }
input { display: block; width: 100%; accent-color: hsl(220 80% 60%); }
output { display: block; margin-top: 14px; font-variant-numeric: tabular-nums; }
</style></head><body>
<div class="card">
  <h2>A custom web control</h2>
  <p>Drag the hue. The SwiftUI controls outside this page share the same value.</p>
  <div id="swatch"></div>
  <input id="hue" aria-label="Hue" type="range" min="0" max="360" value="180">
  <output id="value" for="hue">Waiting for native state…</output>
</div>
<script>
window.documentBoot = crypto.getRandomValues(new Uint32Array(4)).join('-');
const input = document.getElementById('hue');
function paint(value) {
  input.value = value;
  document.getElementById('swatch').style.background = 'hsl(' + value + ' 80% 55%)';
  document.getElementById('value').textContent = 'Hue: ' + value + '°';
}
window.jonui.onMessage(model => { if (model) paint(model.hue); });
input.addEventListener('input', () => {
  paint(Number(input.value));
  window.jonui.postMessage({ type: 'hue', value: Number(input.value) });
});
window.jonui.postMessage({ type: 'ready', boot: window.documentBoot });
</script></body></html>`;

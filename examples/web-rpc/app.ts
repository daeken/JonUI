import { Button, HStack, State, Text, Toggle, View, VStack, WebView, runApp } from 'jonui';
const points = State([{ id: 0, label: 'Alpha', value: 45 }, { id: 1, label: 'Beta', value: 80 }, { id: 2, label: 'Gamma', value: 60 }, { id: 3, label: 'Delta', value: 30 }]);
const selected = State<number | null>(null), revision = State(0), status = State('Click a bar in the visualization.');
const chartTabStop = State(true);
const api = {
  select(id: number) {
    const point = points.value.find(point => point.id === id);
    if (!point) throw new RangeError('Unknown chart point');
    selected.value = id; status.value = `Node selected ${point.label}: ${point.value}`;
    return { label: point.label, value: point.value };
  },
};
export type ChartAPI = typeof api;
const html = `<!doctype html><meta charset="utf-8"><style>
body { margin: 0; padding: 20px; font: 14px -apple-system,sans-serif; color-scheme: light dark; }
svg { display:block; width:100%; height:230px; } rect { fill:#7b6cf6; cursor:pointer; } rect.selected { fill:#eb9d42; }
text { fill:currentColor; text-anchor:middle; pointer-events:none; } #detail { text-align:center; }
</style><svg viewBox="0 0 500 230" aria-label="Selectable bar chart"></svg><p id="detail">Waiting for data…</p>
<script>
const node = jonui.remote(), svg = document.querySelector('svg'), items = new Map();
jonui.onMessage(model => {
  const live = new Set(model.points.map(point => point.id));
  for (const [id, item] of items) if (!live.has(id)) { item.bar.remove(); item.label.remove(); items.delete(id); }
  for (const point of model.points) {
    let item = items.get(point.id);
    if (!item) {
      const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      const select = async () => {
        try { await node.select(point.id); }
        catch (error) { document.getElementById('detail').textContent = error.message; }
      };
      bar.addEventListener('click', select);
      bar.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
      bar.setAttribute('tabindex', '0'); bar.setAttribute('role', 'button'); bar.dataset.id = point.id;
      svg.append(bar, label); item = { bar, label }; items.set(point.id, item);
    }
    const { bar, label } = item;
    bar.setAttribute('x', 35 + point.id * 120); bar.setAttribute('y', 190 - point.value * 1.8);
    bar.setAttribute('width', 80); bar.setAttribute('height', point.value * 1.8); bar.setAttribute('rx', 8);
    bar.classList.toggle('selected', point.id === model.selected); bar.setAttribute('aria-pressed', point.id === model.selected);
    bar.setAttribute('aria-label', point.label + ': ' + point.value);
    label.setAttribute('x', 75 + point.id * 120); label.setAttribute('y', 215); label.textContent = point.label;
  }
  const selected = model.points.find(point => point.id === model.selected);
  document.getElementById('detail').textContent = selected ? selected.label + ': ' + selected.value : 'Click a bar to select it.';
});
</script>`;
await runApp({ title: 'JonUI visualization RPC', width: 640, height: 440, content: VStack([
  Text('Node data, WebView visualization').font('title'),
  HStack([
    Button('Change data', () => { points.value = points.value.map(point => ({ ...point, value: 20 + (point.value + 17) % 75 })); }),
    Button('Clear selection', () => { selected.value = null; status.value = 'Selection cleared in Node.'; }),
    Button('Reload visualization', () => { revision.value++; }),
    Toggle('Chart Tab stop', { isOn: chartTabStop.binding }),
  ]),
  View(() => WebView({ html: html + `<!-- ${revision.value} -->`, data: { points: points.value, selected: selected.value }, api, tabFocusable: chartTabStop.value }).frame({ height: 300 })),
  View(() => Text(status.value).font('caption')),
], { alignment: 'leading', spacing: 12 }).padding(20) });

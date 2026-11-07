import { View, runApp } from 'jonui';
await runApp({ title: 'Startup failure', width: 400, height: 300, content: View(() => { throw new Error('intentional body failure'); }) });

import { createSSRApp } from 'vue';
import { App } from './App';

// Attach to the server's markup instead of rendering it again.
createSSRApp(App).mount('#app');

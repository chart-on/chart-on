import { hydrate } from 'svelte';
import App from './App.svelte';

// Attach to the server's markup instead of rendering it again.
hydrate(App, { target: document.getElementById('root')! });

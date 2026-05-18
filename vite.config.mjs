import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
    root: '.',
    server: {
        port: 5173,
        open: true,
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
    plugins: [
        {
            name: 'dev-csp-strip',
            transformIndexHtml(html) {
                if (command === 'serve') {
                    return html.replace(
                        /\s*<meta http-equiv="Content-Security-Policy"[^>]*>/i,
                        ''
                    );
                }
                return html;
            },
        },
    ],
}));

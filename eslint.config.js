import configPrettier from 'eslint-config-prettier'

export default [
    configPrettier,
    {
        ignores: [
            '*.njk',
            'dist/**',
            '.vite-inspect/**',
            'node_modules/**',
            'target/**',
            'coverage/**',
            '*.min.js',
            '*.bundle.js'
        ],
    }
];

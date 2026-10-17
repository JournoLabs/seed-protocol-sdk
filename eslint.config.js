import configPrettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    {
        ignores: [
            '**/*.njk',
            '**/dist/**',
            '**/.vite-inspect/**',
            '**/node_modules/**',
            '**/target/**',
            '**/coverage/**',
            '**/*.min.js',
            '**/*.bundle.js',
            'packages/eas/src/graphql/gql/**',
            'packages/arweave/src/graphql/gql/**',
        ],
    },
    {
        files: ['packages/*/src/**/*.{ts,tsx}'],
        extends: [tseslint.configs.recommended],
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_',
                    ignoreRestSiblings: true,
                },
            ],
        },
    },
    configPrettier,
)

import configPrettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
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
            // Next builds of packages/next's test fixture.
            '**/.next*/**',
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
            'prefer-const': ['error', { destructuring: 'all', ignoreReadBeforeAssign: true }],
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
    {
        files: ['packages/*/src/**/*.{ts,tsx}'],
        plugins: { 'react-hooks': reactHooks },
        rules: {
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
        },
    },
    {
        // A built package's class names are minified (and a consumer's bundler renames them again),
        // so an error's `name` compared with `SomeClass.name` stops matching there. Compare with a string
        // literal. Batch 18 item 1.
        files: ['packages/*/src/**/*.{ts,tsx}'],
        ignores: ['packages/*/src/**/*.test.{ts,tsx}'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        "BinaryExpression[operator=/^[!=]==?$/] > MemberExpression[property.name='name'][object.type='Identifier'][object.name=/^[A-Z]/]",
                    message:
                        "Don't compare with `SomeClass.name`: a minified build renames classes. Compare with the string literal.",
                },
            ],
        },
    },
    configPrettier,
)

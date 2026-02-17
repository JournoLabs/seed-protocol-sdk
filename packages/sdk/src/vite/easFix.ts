import { Plugin } from 'vite';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { statSync } from 'node:fs';
import { existsSync } from 'node:fs';

const root = import.meta.dirname;

/**
 * Vite plugin to fix eas-sdk module resolution issues
 * The eas-sdk package uses extensionless imports and directory imports which fail in strict ESM mode
 * This plugin intercepts and fixes these imports at build time without modifying the package files
 */
function easSdkFixPlugin(): Plugin {
  const easSdkPath = join(root, 'node_modules/@ethereum-attestation-service/eas-sdk/dist/lib.esm');

  // Map of known directory imports that need /index.js
  const directoryImports = new Set(['offchain', 'legacy/typechain']);

  // Map of known file imports that need .js extension
  const fileImports = new Set([
    'eas', 'eip712-proxy', 'request', 'schema-encoder', 'schema-registry',
    'transaction', 'utils', 'private-data', 'legacy/version'
  ]);

  return {
    name: 'fix-eas-sdk-resolution',
    resolveId(id, importer) {
      // Only handle imports from eas-sdk files
      if (!importer || !importer.includes('@ethereum-attestation-service/eas-sdk/dist/lib.esm')) {
        return null;
      }

      // Handle relative imports (./something or ../something)
      if (id.startsWith('./') || id.startsWith('../')) {
        const importerDir = dirname(importer);
        const resolvedPath = join(importerDir, id);

        // Check if it's a known directory import
        const isDirectoryImport = Array.from(directoryImports).some(dir =>
          id === `./${dir}` || id === `../${dir}` || id.endsWith(`/${dir}`)
        );

        // Check if it's a known file import
        const isFileImport = Array.from(fileImports).some(file =>
          id === `./${file}` || id === `../${file}` || id.endsWith(`/${file}`)
        );

        // Try to determine if it's actually a directory
        let actualIsDirectory = false;
        try {
          const stat = statSync(resolvedPath);
          actualIsDirectory = stat.isDirectory();
        } catch {
          // Path doesn't exist, use heuristics
        }

        let fixedId = id;

        if (isDirectoryImport || actualIsDirectory) {
          // It's a directory, add /index.js
          if (!id.endsWith('/index.js')) {
            fixedId = id.endsWith('/') ? `${id}index.js` : `${id}/index.js`;
          }
        } else if (isFileImport || !actualIsDirectory) {
          // It's a file, add .js extension if missing
          if (!id.match(/\.(js|mjs|ts|json)$/)) {
            fixedId = `${id}.js`;
          }
        }

        if (fixedId !== id) {
          // Resolve the fixed path
          const fixedPath = join(importerDir, fixedId);

          // Verify the resolved path exists before returning it
          try {
            if (existsSync(fixedPath)) {
              // Return the absolute path
              return fixedPath;
            } else {
              // If the fixed path doesn't exist, try the original (might be handled elsewhere)
              // This prevents the plugin from breaking valid imports
              return null;
            }
          } catch {
            // If we can't check, return the fixed path anyway (Vite will handle errors)
            return fixedPath;
          }
        }
      }

      return null;
    },
  };
}
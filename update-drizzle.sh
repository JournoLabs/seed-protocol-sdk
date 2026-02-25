#!/bin/bash

# Script to generate drizzle migrations and update drizzleFiles.ts
# This script:
# 1. Runs drizzle-kit generate
# 2. Copies the drizzle folder contents to src/db/drizzle
# 3. Removes the drizzle folder from root
# 4. Updates src/browser/db/drizzleFiles.ts with the new contents

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔧 Running drizzle-kit generate..."
npx drizzle-kit generate --dialect sqlite --schema ./src/seedSchema

# Check if drizzle folder was created
if [ ! -d "drizzle" ]; then
  echo "❌ Error: drizzle folder was not created"
  exit 1
fi

echo "📁 Copying drizzle folder contents to src/db/drizzle..."

# Remove existing drizzle folder in src/db if it exists
if [ -d "src/db/drizzle" ]; then
  rm -rf "src/db/drizzle"
fi

# Create the target directory
mkdir -p "src/db/drizzle"

# Copy all contents from drizzle to src/db/drizzle
cp -r drizzle/* "src/db/drizzle/"

echo "🧹 Removing drizzle folder from root..."
rm -rf drizzle

echo "📝 Updating src/browser/db/drizzleFiles.ts..."

# Find all SQL migration files (sorted by name to maintain order)
SQL_FILES=$(find "src/db/drizzle" -maxdepth 1 -name "*.sql" -type f | sort)

if [ -z "$SQL_FILES" ]; then
  echo "❌ Error: Could not find SQL migration files (*.sql)"
  exit 1
fi

# Find the snapshot JSON file (find the latest snapshot file, sorted by name)
SNAPSHOT_FILE=$(find "src/db/drizzle/meta" -name "*_snapshot.json" -type f | sort | tail -n 1)

if [ -z "$SNAPSHOT_FILE" ]; then
  echo "❌ Error: Could not find snapshot JSON file"
  exit 1
fi

# Use Node.js to generate the TypeScript file with proper escaping
SQL_FILES="$SQL_FILES" SNAPSHOT_FILE="$SNAPSHOT_FILE" node << 'NODE_SCRIPT'
const fs = require('fs');
const path = require('path');

const sqlFilesStr = process.env.SQL_FILES;
const journalFile = path.join('src/db/drizzle/meta/_journal.json');
const snapshotFile = process.env.SNAPSHOT_FILE;

// Read all SQL files and concatenate them
const sqlFiles = sqlFilesStr.trim().split('\n').filter(f => f);
let migrationSql = '';
for (const sqlFile of sqlFiles) {
  const content = fs.readFileSync(sqlFile, 'utf-8');
  migrationSql += content;
  if (!content.endsWith('\n')) {
    migrationSql += '\n';
  }
}

// Read JSON files
const journalJson = fs.readFileSync(journalFile, 'utf-8');
const snapshotJson = fs.readFileSync(snapshotFile, 'utf-8');

// Generate the TypeScript file
const content = `// This file embeds the drizzle migration files as strings for browser runtime
// These files are copied from src/db/drizzle at build time

// Migration SQL file
export const migrationSql = \`${migrationSql.replace(/\\/g, '\\\\').replace(/\`/g, '\\`').replace(/\${/g, '\\${')}\`

// Journal JSON file
export const journalJson = \`${journalJson.replace(/\\/g, '\\\\').replace(/\`/g, '\\`').replace(/\${/g, '\\${')}\`

// Snapshot JSON file - this is large, so we'll import it dynamically if needed
// For now, we'll read it from the actual file if ?raw works, otherwise we'll need to embed it
export const snapshotJson = \`${snapshotJson.replace(/\\/g, '\\\\').replace(/\`/g, '\\`').replace(/\${/g, '\\${')}\`
`;

fs.writeFileSync('src/browser/db/drizzleFiles.ts', content, 'utf-8');
NODE_SCRIPT

echo "✅ Successfully updated drizzle files!"
echo "   - SQL migrations: $(echo "$SQL_FILES" | xargs -n1 basename | tr '\n' ', ' | sed 's/,$//')"
echo "   - Snapshot: $(basename "$SNAPSHOT_FILE")"

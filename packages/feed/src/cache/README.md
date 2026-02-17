# Cache Configuration

The feed caching system can be configured using environment variables.

## Environment Variables

- `CACHE_TTL` - Cache time-to-live in seconds (default: 3600 = 1 hour)
- `CACHE_DIR` - Directory for persistent cache files (default: `./cache`)
- `CACHE_ENABLED` - Enable/disable caching (default: `true`, set to `false` to disable)
- `CACHE_BACKGROUND_REFRESH` - Enable background refresh job (default: `false`)
- `CACHE_REFRESH_INTERVAL` - Background refresh interval in seconds (default: 300 = 5 minutes)

## Example .env file

```bash
CACHE_TTL=3600
CACHE_DIR=./cache
CACHE_ENABLED=true
CACHE_BACKGROUND_REFRESH=false
CACHE_REFRESH_INTERVAL=300
```

## How It Works

1. **First Request (Cold Cache)**: Fetches all items from Seed Protocol, caches them, and generates the feed
2. **Subsequent Requests (Warm Cache)**: 
   - Checks cache validity
   - If valid and ETag matches, returns 304 Not Modified
   - If expired, fetches only new items (incremental update)
   - Merges new items with cached items
   - Regenerates and caches the feed

## Cache Storage

- **Memory Cache**: Fast in-memory storage for active requests
- **File Cache**: Persistent JSON files in `CACHE_DIR` that survive server restarts

## HTTP Conditional Requests

The cache supports HTTP conditional requests:
- `ETag` header is included in responses
- `If-None-Match` header is checked for 304 responses
- `Last-Modified` header is included for additional cache validation

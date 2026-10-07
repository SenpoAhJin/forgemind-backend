# Manual changes needed for src/index.ts (protected dirty file)

## Imports (after line 7)
```typescript
import photosRouter from './marketplace/photosRouter';
import * as path from 'path';
```

## Routes (before line 122 `app.use('/marketplace', marketplaceRouter)`)
```typescript
// Photo upload must come before JSON-only marketplace router
app.use('/marketplace', photosRouter);
```

## Static files (after line 122)
```typescript
// Serve uploaded photos
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  setHeaders: (res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=31536000');
  },
}));
```

These changes add:
- Photo upload routes at POST /marketplace/photos and DELETE /marketplace/photos/:id
- Static file serving at /uploads/listings/ with safe headers

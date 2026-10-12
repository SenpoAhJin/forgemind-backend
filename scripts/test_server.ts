#!/usr/bin/env ts-node
/**
 * Temporary test server for photo upload verification
 * Mounts photosRouter and static serving without modifying src/index.ts
 */

import express from 'express';
import * as path from 'path';
import photosRouter from '../src/marketplace/photosRouter';
import { marketplaceRouter } from '../src/marketplace/router';
import { authRouter } from '../src/auth/router';
import { startPhotoCleanup, stopPhotoCleanup } from '../src/marketplace/photoCleanup';

const app = express();
app.use(express.json());

// Mount routers in correct order
app.use('/marketplace', photosRouter);
app.use('/marketplace', marketplaceRouter);
app.use('/auth', authRouter);

// Serve static uploads with security headers
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  setHeaders: (res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=31536000');
  }
}));

const PORT = 4000;

const server = app.listen(PORT, () => {
  console.log(`Test server listening on http://localhost:${PORT}`);
  startPhotoCleanup();
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  stopPhotoCleanup();
  server.close(() => {
    process.exit(0);
  });
});

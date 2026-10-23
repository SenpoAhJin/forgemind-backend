#!/usr/bin/env tsx
/**
 * Backup database using app credentials
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { connectionString } from '../src/config';

const execAsync = promisify(exec);

async function backup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `backup_m1.2_start_${timestamp}.dump`;
  
  // Get connection string from app config
  const url = new URL(connectionString());
  const user = url.username;
  const password = url.password;
  const host = url.hostname;
  const port = url.port || '5432';
  const database = url.pathname.slice(1);
  
  console.log(`Backing up ${database} as ${user}...`);
  
  try {
    const env = { ...process.env, PGPASSWORD: password };
    const cmd = `pg_dump -h ${host} -p ${port} -U ${user} -d ${database} -F c -f ${filename}`;
    
    await execAsync(cmd, { env, cwd: process.cwd() });
    
    const stats = await execAsync(`dir ${filename}`);
    console.log(`Backup complete: ${filename}`);
    console.log(stats.stdout);
  } catch (error: any) {
    console.error('Backup failed:', error.message);
    process.exit(1);
  }
}

backup();

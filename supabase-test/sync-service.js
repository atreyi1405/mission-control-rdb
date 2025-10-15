import 'dotenv/config';
import { setupSheetsSyncHooks } from './sheets-sync.js';

console.log('🔄 Starting sync service...');

// Start listening for changes
const subscription = await setupSheetsSyncHooks();

console.log('✅ Sync service running!');
console.log('Press Ctrl+C to stop');

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n⏹️  Stopping sync service...');
    subscription.unsubscribe();
    process.exit();
});
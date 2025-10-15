// test-supabase.js
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY; // or SERVICE_ROLE on server-only scripts
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  // 1) SELECT clients
  let { data: clients, error: err1 } = await supabase
    .from('clients')
    .select('*')
    .limit(10);

  if (err1) return console.error('Select error:', err1);
  console.log('Clients:', clients);

  // 2) INSERT a test programme (rollback-safe example)
  const { data: inserted, error: err2 } = await supabase
    .from('programmes')
    .insert([{ programme_name: 'Test Programme ' + Date.now(), programme_type: 'Standard' }])
    .select()
    .limit(1);

  if (err2) console.error('Insert error:', err2);
  else console.log('Inserted programme:', inserted);
}

const { data: programmes, error: err3 } = await supabase
  .from('programmes')
  .select('*')
  .limit(10);

if (err3) console.error('Select programmes error:', err3);
else console.log('Programmes:', programmes);

main().catch(console.error);
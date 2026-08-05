import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

async function main() {
  console.log('Calling sync_all_listed_permutations()…')
  const start = Date.now()
  const { data, error } = await supabase.rpc('sync_all_listed_permutations')
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  if (error) {
    console.error(`FAILED after ${elapsed}s:`, JSON.stringify(error, null, 2))
    process.exit(1)
  }
  console.log(`Succeeded in ${elapsed}s. Result:`, data)
}
main()
